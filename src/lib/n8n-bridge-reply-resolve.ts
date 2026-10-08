/** Read-only discovery: a webhook contact ID is a wakeup, never message evidence. */
import { z } from "zod";
import {
  normalizarInstante,
  parseContacto,
  parseEvento,
  type ConfigBridge,
  type DepsBridge,
  type Ler,
  type Resolucao,
} from "./n8n-bridge.core";
import {
  lerHistoricoResposta,
  parseMessage,
  replyContext,
  validarContextoResposta,
  type DepsConfirmacao,
  type Message,
  type RequestEvidence,
} from "./n8n-bridge-confirmation";

const timestamp = z.string().datetime({ offset: true });
const id = /^[A-Za-z0-9_-]{6,64}$/;
const response = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
const fail = (error: string, status = 409) => response({ error }, status);
const unavailable = (): Ler<unknown> => ({ ok: false, code: "unavailable" });
type ReadEvidence = Pick<DepsConfirmacao, "requests" | "message" | "conversationMessages">;

/** Deliberately excludes every mutation/reservation method from the dependencies. */
export async function resolverResposta(
  contactId: string,
  cfg: ConfigBridge,
  scope: Resolucao,
  deps: Pick<DepsBridge, "now" | "contacto" | "consulta">,
  evidence: ReadEvidence,
): Promise<Response> {
  const observedAt = deps.now();
  if (!Number.isFinite(observedAt)) return fail("reply_clock_unavailable", 503);
  const contact = await deps.contacto(scope.locationId, contactId).catch(unavailable);
  if (!contact.ok) return fail("ghl_unavailable", 502);
  if (!parseContacto(contact.data, contactId, scope.locationId))
    return fail("contact_not_verified");

  // The existing scoped RPC returns accepted req24/req12 sends only. 51 means overflow.
  const listed = await evidence
    .requests(scope.orgId, contactId, new Date(observedAt).toISOString())
    .catch(() => ({ ok: false as const, code: "unavailable" }));
  if (!listed.ok) return fail("confirmation_evidence_unavailable", 503);
  if (listed.data.length > 50) return fail("confirmation_evidence_overflow");
  if (!listed.data.length) return fail("confirmation_request_missing");
  const candidates = new Set<string>();
  const conversations = new Set<string>();
  const acceptedIds = new Set<string>();
  const ledgerIds = new Set<string>();
  const sentById = new Map<string, Message>();
  let request: RequestEvidence | null = null;
  for (const row of listed.data) {
    if (
      !row.id ||
      ledgerIds.has(row.id) ||
      !id.test(row.appointmentId) ||
      !id.test(row.messageId) ||
      acceptedIds.has(row.messageId) ||
      !timestamp.safeParse(row.startTime).success ||
      !timestamp.safeParse(row.acceptedAt).success ||
      Date.parse(row.acceptedAt) >= observedAt ||
      Date.parse(row.startTime) <= observedAt
    )
      return fail("confirmation_evidence_invalid");
    const read = await evidence.message(scope.locationId, row.messageId).catch(unavailable);
    if (!read.ok) return fail("confirmation_evidence_unavailable", 502);
    const sent = parseMessage(read.data, row.messageId, scope.locationId, "outbound", cfg);
    if (
      !sent ||
      sent.contactId !== contactId ||
      !id.test(sent.conversationId) ||
      sent.time > Date.parse(row.acceptedAt)
    )
      return fail("confirmation_evidence_invalid");
    ledgerIds.add(row.id);
    acceptedIds.add(row.messageId);
    sentById.set(row.messageId, sent);
    candidates.add(`${row.appointmentId}:${normalizarInstante(row.startTime)}`);
    conversations.add(sent.conversationId);
    if (!request || Date.parse(row.acceptedAt) > Date.parse(request.acceptedAt)) request = row;
  }
  // Contact-only input cannot select between conversations or requested appointments.
  if (candidates.size !== 1 || conversations.size !== 1) return fail("confirmation_ambiguous");
  const linked = request!;
  const sent = sentById.get(linked.messageId)!;
  const history = await lerHistoricoResposta(evidence, scope, contactId, sent.conversationId);
  if (!history) return fail("reply_history_unavailable");
  for (const [messageId, outbound] of sentById) {
    if (history.get(messageId)?.time !== outbound.time) return fail("reply_history_unavailable");
  }
  const sorted = [...history.entries()].sort((a, b) => b[1].time - a[1].time);
  if (!sorted.length) return fail("reply_missing");
  const [latestId, latest] = sorted[0]!;
  if (!id.test(latestId)) return fail("reply_not_verified");
  if (sorted[1]?.[1].time === latest.time) return fail("reply_superseded");
  if (latest.raw["direction"] !== "inbound") return fail("reply_missing");
  const candidate = parseMessage(latest.raw, latestId, scope.locationId, "inbound", cfg);
  if (!candidate || candidate.channel !== sent.channel) return fail("reply_not_verified");
  if (
    candidate.time <= Date.parse(linked.acceptedAt) ||
    candidate.time > observedAt ||
    candidate.time >= Date.parse(linked.startTime)
  )
    return fail("reply_outside_window");
  const contextError = validarContextoResposta(history, candidate, linked, acceptedIds);
  if (contextError) return fail(contextError);

  // Message endpoint is authoritative; history alone never fabricates a reply ID or body.
  const direct = await evidence.message(scope.locationId, candidate.id).catch(unavailable);
  if (!direct.ok) return fail("message_unavailable", 502);
  const inbound = parseMessage(direct.data, candidate.id, scope.locationId, "inbound", cfg);
  if (
    !inbound ||
    inbound.contactId !== contactId ||
    inbound.conversationId !== sent.conversationId ||
    inbound.time !== candidate.time ||
    inbound.body !== candidate.body ||
    inbound.channel !== sent.channel
  )
    return fail("reply_not_verified");

  const current = await deps.consulta(linked.appointmentId).catch(unavailable);
  if (!current.ok) return fail("ghl_unavailable", 502);
  const appointment = parseEvento(current.data, linked.appointmentId, scope.locationId);
  const startTime = normalizarInstante(linked.startTime)!;
  if (
    !appointment ||
    appointment.contactId !== contactId ||
    appointment.calendarId !== cfg.calendarId ||
    !timestamp.safeParse(appointment.startTime).success ||
    normalizarInstante(appointment.startTime) !== startTime ||
    !["new", "booked", "confirmed"].includes(appointment.appointmentStatus) ||
    Date.parse(startTime) <= deps.now()
  )
    return fail("appointment_changed");
  // A newer inbound or human intervention during discovery must not resurrect the old reply.
  const freshContextError = await replyContext(evidence, scope, inbound, linked, acceptedIds);
  if (freshContextError) return fail(freshContextError);
  const normalized = inbound.body.trim();
  const intent = /^(SIM|CONFIRMO)$/i.test(normalized)
    ? "confirm"
    : /^(NÃO|NAO)$/i.test(normalized)
      ? "decline"
      : /^REMARCAR$/i.test(normalized)
        ? "reschedule"
        : "other";
  return response({
    status: "resolved",
    readOnly: true,
    reply: {
      inboundMessageId: inbound.id,
      conversationId: inbound.conversationId,
      contactId,
      locationId: scope.locationId,
      replyAt: new Date(inbound.time).toISOString(),
      intent,
    },
    appointment: {
      appointmentId: appointment.id,
      calendarId: appointment.calendarId,
      startTime,
      appointmentStatus: appointment.appointmentStatus,
    },
  });
}
