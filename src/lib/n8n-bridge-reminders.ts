/** Eligibility of a reminder comes from GHL and the accepted-send ledger, never n8n state. */
import { z } from "zod";
import {
  lerHistoricoResposta,
  parseMessage,
  type DepsConfirmacao,
} from "./n8n-bridge-confirmation";
import {
  dndPermite,
  normalizarInstante,
  parseContacto,
  parseEvento,
  type ConfigBridge,
  type DepsBridge,
  type EventoBridge,
  type Ler,
  type Resolucao,
} from "./n8n-bridge.core";

export type ReminderEvidence = {
  kind: "booking" | "req24" | "req12";
  appointmentId: string;
  startTime: string;
  contactId: string;
  messageId: string;
  acceptedAt: string;
};
export type DepsLembretes = Pick<DepsConfirmacao, "message" | "conversationMessages"> & {
  sends: (
    orgId: string,
    appointmentId: string,
    startTime: string,
    contactId: string,
  ) => Promise<Ler<ReminderEvidence[]>>;
};
const timestamp = z.string().datetime({ offset: true });
const unavailable = (): Ler<unknown> => ({ ok: false, code: "unavailable" });

export async function validarLembrete(
  kind: "req24" | "req12",
  cfg: ConfigBridge,
  scope: Resolucao,
  event: EventoBridge,
  deps: Pick<DepsBridge, "now" | "consulta" | "contacto">,
  evidence: DepsLembretes,
): Promise<{ ok: true } | { ok: false; code: string; status: number }> {
  const fail = (code: string, status = 409) => ({ ok: false as const, code, status });
  const start = normalizarInstante(event.startTime);
  if (!start) return fail("appointment_changed");
  const listed = await evidence
    .sends(scope.orgId, event.id, start, event.contactId)
    .catch(() => ({ ok: false as const, code: "unavailable" }));
  if (!listed.ok) return fail("reminder_evidence_unavailable", 503);
  if (listed.data.length > 3) return fail("reminder_evidence_invalid");
  const byKind = new Map<string, ReminderEvidence>();
  const sentById = new Map<string, NonNullable<ReturnType<typeof parseMessage>>>();
  for (const row of listed.data) {
    if (
      !["booking", "req24", "req12"].includes(row.kind) ||
      byKind.has(row.kind) ||
      row.appointmentId !== event.id ||
      row.contactId !== event.contactId ||
      !timestamp.safeParse(row.startTime).success ||
      normalizarInstante(row.startTime) !== start ||
      !timestamp.safeParse(row.acceptedAt).success ||
      Date.parse(row.acceptedAt) > deps.now() ||
      !/^[A-Za-z0-9_-]{6,64}$/.test(row.messageId) ||
      sentById.has(row.messageId)
    )
      return fail("reminder_evidence_invalid");
    const read = await evidence.message(scope.locationId, row.messageId).catch(unavailable);
    if (!read.ok) return fail("reminder_evidence_unavailable", 502);
    const sent = parseMessage(read.data, row.messageId, scope.locationId, "outbound", cfg);
    if (!sent || sent.contactId !== event.contactId || sent.time > Date.parse(row.acceptedAt))
      return fail("reminder_evidence_invalid");
    byKind.set(row.kind, row);
    sentById.set(row.messageId, sent);
  }
  const booking = byKind.get("booking");
  if (!booking || (kind === "req12" && !byKind.has("req24")))
    return fail("reminder_request_missing");
  const anchor = sentById.get(booking.messageId)!;
  for (const [messageId, sent] of sentById) {
    if (
      sent.conversationId !== anchor.conversationId ||
      sent.channel !== anchor.channel ||
      sent.time < anchor.time
    )
      return fail("reminder_evidence_invalid");
    const row = listed.data.find((r) => r.messageId === messageId)!;
    if (Date.parse(row.acceptedAt) < Date.parse(booking.acceptedAt))
      return fail("reminder_evidence_invalid");
  }
  // Use the FIRST booking, not the last reminder: a delayed reminder cannot reset the reply boundary.
  const history = await lerHistoricoResposta(
    evidence,
    scope,
    event.contactId,
    anchor.conversationId,
  );
  if (!history) return fail("reminder_history_unavailable");
  for (const [messageId, sent] of sentById) {
    if (history.get(messageId)?.time !== sent.time) return fail("reminder_history_unavailable");
  }
  for (const [messageId, message] of history) {
    if (message.time >= anchor.time && !sentById.has(messageId))
      return fail("reminder_reply_or_intervention");
  }
  // Eligibility may have changed while the full history was read or the send was reserved.
  const contactRead = await deps.contacto(scope.locationId, event.contactId).catch(unavailable);
  if (!contactRead.ok) return fail("ghl_unavailable", 502);
  const contact = parseContacto(contactRead.data, event.contactId, scope.locationId);
  if (!contact) return fail("contact_not_verified");
  if (!cfg.channel || !dndPermite(contact, cfg.channel)) return fail("dnd_not_confirmed");
  const freshRead = await deps.consulta(event.id).catch(unavailable);
  if (!freshRead.ok) return fail("ghl_unavailable", 502);
  const fresh = parseEvento(freshRead.data, event.id, scope.locationId);
  if (
    !fresh ||
    fresh.contactId !== event.contactId ||
    fresh.calendarId !== cfg.calendarId ||
    normalizarInstante(fresh.startTime) !== start
  )
    return fail("appointment_changed");
  if (fresh.appointmentStatus === "confirmed") return fail("appointment_already_confirmed");
  if (!["new", "booked"].includes(fresh.appointmentStatus) || Date.parse(start) <= deps.now())
    return fail("appointment_changed");
  return { ok: true };
}
