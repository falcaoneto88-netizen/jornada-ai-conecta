/** A reply is evidence only after authenticated GHL reads; caller text is never trusted. */
import { z } from "zod";
import { autorizarPiloto } from "./n8n-bridge-pilot";
import {
  normalizarInstante,
  parseEvento,
  parseContacto,
  type ConfigBridge,
  type DepsBridge,
  type EventoBridge,
  type Ler,
  type Resolucao,
} from "./n8n-bridge.core";

export type PedidoConfirmacao = {
  op: "appointment.confirm";
  appointmentId: string;
  contactId: string;
  expectedStartTime: string;
  inboundMessageId: string;
};
export type RequestEvidence = {
  id: string;
  appointmentId: string;
  startTime: string;
  messageId: string;
  acceptedAt: string;
};
export type ConfirmedReply = {
  requestId: string;
  inboundMessageId: string;
  replyAt: string;
  finishedAt: string;
};
export type ConfirmationReservation =
  { reserved: true; id: string } | { reserved: false; id: string; state: string };
export type DepsConfirmacao = {
  confirmedReply: (
    orgId: string,
    appointmentId: string,
    startTime: string,
  ) => Promise<Ler<ConfirmedReply | null>>;
  message: (locationId: string, id: string) => Promise<Ler<unknown>>;
  conversationMessages: (
    locationId: string,
    conversationId: string,
    cursor?: string,
  ) => Promise<Ler<unknown>>;
  requests: (orgId: string, contactId: string, replyAt: string) => Promise<Ler<RequestEvidence[]>>;
  claim: (
    orgId: string,
    request: RequestEvidence,
    inboundMessageId: string,
    replyAt: string,
  ) => Promise<ConfirmationReservation | null>;
  finish: (
    orgId: string,
    id: string,
    state: "confirmed" | "rejected" | "unknown",
    error: string | null,
  ) => Promise<boolean>;
  confirm: (
    locationId: string,
    appointmentId: string,
  ) => Promise<{ ok: true } | { ok: false; definitive: boolean }>;
};
const response = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
const failure = (error: string, status = 409) => response({ error }, status);
const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const sourceTimestamp = z.string().datetime({ offset: true });
const messageTypes = new Set(["SMS", "TYPE_SMS", "WHATSAPP", "TYPE_WHATSAPP"]);

/** Normalize only the authenticated GET-message response shapes; never merge identities. */
export function normalizarMensagemGhl(raw: unknown): Record<string, unknown> | null {
  const envelope = object(raw);
  if (!envelope) return null;
  if (!("message" in envelope)) return envelope;
  if (
    Object.keys(envelope).some((key) => key !== "message" && key !== "traceId") ||
    ("traceId" in envelope && typeof envelope["traceId"] !== "string")
  )
    return null;
  const message = object(envelope["message"]);
  return message && !("message" in message) ? message : null;
}

export type Message = {
  id: string;
  contactId: string;
  conversationId: string;
  time: number;
  body: string;
  channel: "sms" | "whatsapp";
};
export function parseMessage(
  raw: unknown,
  id: string,
  locationId: string,
  direction: "inbound" | "outbound",
  route?: Pick<ConfigBridge, "channel" | "zaptosProviderId">,
): Message | null {
  const m = object(raw);
  // Authenticated custom-provider outbound is SMS transport in GHL. Its inbound
  // replies remain TYPE_SMS and need not carry a provider ID. No custom inbound
  // or provider inferred from the caller/response is admitted by this exception.
  const customOutbound =
    direction === "outbound" &&
    m?.["messageType"] === "TYPE_CUSTOM_SMS" &&
    m["type"] === 20 &&
    m["source"] === "api" &&
    route?.channel === "whatsapp_zaptos" &&
    typeof route.zaptosProviderId === "string" &&
    route.zaptosProviderId.length > 0 &&
    m["conversationProviderId"] === route.zaptosProviderId;
  if (
    !m ||
    m["id"] !== id ||
    m["locationId"] !== locationId ||
    m["direction"] !== direction ||
    typeof m["contactId"] !== "string" ||
    typeof m["conversationId"] !== "string" ||
    !m["conversationId"] ||
    !sourceTimestamp.safeParse(m["dateAdded"]).success ||
    typeof m["body"] !== "string" ||
    (!messageTypes.has(String(m["messageType"])) && !customOutbound) ||
    m["contentType"] !== "text/plain"
  )
    return null;
  const time = Date.parse(String(m["dateAdded"]));
  return Number.isFinite(time)
    ? {
        id,
        contactId: m["contactId"],
        conversationId: m["conversationId"],
        time,
        body: m["body"],
        channel: String(m["messageType"]).includes("WHATSAPP") ? "whatsapp" : "sms",
      }
    : null;
}
const readFailed = (): Ler<unknown> => ({ ok: false, code: "unavailable" });

export type ReplyHistory = Map<string, { time: number; raw: Record<string, unknown> }>;

/** Complete bounded history, not a truncated first page or caller-supplied "latest" flag. */
export async function lerHistoricoResposta(
  deps: Pick<DepsConfirmacao, "conversationMessages">,
  scope: Resolucao,
  contactId: string,
  conversationId: string,
): Promise<ReplyHistory | null> {
  let cursor: string | undefined;
  const cursors = new Set<string>();
  const messages: ReplyHistory = new Map();
  for (let page = 0; page < 10; page++) {
    const read = await deps
      .conversationMessages(scope.locationId, conversationId, cursor)
      .catch(readFailed);
    const envelope = read.ok ? object(object(read.data)?.["messages"]) : null;
    const rows = envelope?.["messages"];
    if (!envelope || !Array.isArray(rows) || typeof envelope["nextPage"] !== "boolean") return null;
    for (const raw of rows) {
      const message = object(raw);
      if (
        !message ||
        typeof message["id"] !== "string" ||
        message["locationId"] !== scope.locationId ||
        message["contactId"] !== contactId ||
        message["conversationId"] !== conversationId ||
        !sourceTimestamp.safeParse(message["dateAdded"]).success
      )
        return null;
      const time = Date.parse(String(message["dateAdded"]));
      if (!Number.isFinite(time) || messages.has(message["id"])) return null;
      messages.set(message["id"], { time, raw: message });
      if (messages.size > 1000) return null;
    }
    if (envelope["nextPage"] === false) return messages;
    const next = envelope["lastMessageId"];
    if (typeof next !== "string" || !/^[A-Za-z0-9_-]{6,64}$/.test(next) || cursors.has(next))
      return null;
    cursors.add(next);
    cursor = next;
  }
  return null;
}

export function validarContextoResposta(
  messages: ReplyHistory,
  inbound: Message,
  request: RequestEvidence,
  acceptedRequestIds: Set<string>,
): string | null {
  if (messages.get(inbound.id)?.time !== inbound.time || !messages.has(request.messageId))
    return "reply_history_unavailable";
  const requestTime = messages.get(request.messageId)!.time;
  if (requestTime >= inbound.time) return "confirmation_context_changed";
  for (const [id, { time }] of messages) {
    if (id === inbound.id) continue;
    if (time >= inbound.time) return "reply_superseded";
    if (time >= requestTime && !acceptedRequestIds.has(id)) return "confirmation_context_changed";
  }
  return null;
}

export async function replyContext(
  deps: Pick<DepsConfirmacao, "conversationMessages">,
  scope: Resolucao,
  inbound: Message,
  request: RequestEvidence,
  acceptedRequestIds: Set<string>,
): Promise<string | null> {
  const messages = await lerHistoricoResposta(
    deps,
    scope,
    inbound.contactId,
    inbound.conversationId,
  );
  return messages
    ? validarContextoResposta(messages, inbound, request, acceptedRequestIds)
    : "reply_history_unavailable";
}

/** ACK only: correlate one technical update; this does not establish its actor. */
function acknowledgementContext(
  messages: ReplyHistory,
  inbound: Message,
  request: RequestEvidence,
  event: EventoBridge,
  finishedAt: string,
  now: number,
): string | null {
  const completed = Date.parse(finishedAt);
  // PostgreSQL retains microseconds while GHL's observed activity uses milliseconds.
  // Round the lower bound up, never admit an activity just before completion.
  const fraction = finishedAt.match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/)?.[1] ?? "";
  const earliest = completed + (/[1-9]/.test(fraction.slice(3)) ? 1 : 0);
  const filtered = new Map(messages);
  let correlated = 0;
  for (const [id, { time, raw }] of messages) {
    const activity = object(raw["activity"]);
    const data = object(activity?.["data"]);
    const members = data?.["members"];
    if (
      id === inbound.id ||
      !/^[A-Za-z0-9_-]{6,64}$/.test(id) ||
      raw["messageType"] !== "TYPE_ACTIVITY_APPOINTMENT" ||
      raw["type"] !== 31 ||
      raw["source"] !== "app" ||
      raw["direction"] !== "outbound" ||
      "userId" in raw ||
      activity?.["type"] !== "appointment_updated" ||
      Object.keys(activity).some((key) => !["data", "title", "type"].includes(key)) ||
      ("title" in activity && typeof activity["title"] !== "string") ||
      data?.["id"] !== event.id ||
      Object.keys(data).some(
        (key) =>
          ![
            "id",
            "timestamp",
            "serviceBookingId",
            "industryType",
            "appointmentTitle",
            "members",
          ].includes(key),
      ) ||
      ("members" in data &&
        (!object(members) ||
          Object.getPrototypeOf(members) !== Object.prototype ||
          Reflect.ownKeys(members as object).length !== 0)) ||
      ("appointmentTitle" in data && typeof data["appointmentTitle"] !== "string") ||
      data["serviceBookingId"] !== null ||
      data["industryType"] !== null ||
      !sourceTimestamp.safeParse(data?.["timestamp"]).success ||
      Date.parse(String(data?.["timestamp"])) !== Date.parse(event.startTime) ||
      !sourceTimestamp.safeParse(raw["dateUpdated"]).success ||
      raw["dateAdded"] !== raw["dateUpdated"] ||
      time < earliest ||
      time > completed + 5000 ||
      time > now
    )
      continue;
    if (++correlated > 1) return "reply_superseded";
    filtered.delete(id);
  }
  return validarContextoResposta(filtered, inbound, request, new Set([request.messageId]));
}

/** Revalidate the persisted affirmative reply before acknowledgement; never performs PUT. */
export async function validarAgradecimento(
  scope: Resolucao,
  event: EventoBridge,
  now: number,
  deps: Pick<DepsBridge, "consulta">,
  confirmation: DepsConfirmacao,
  cfg: ConfigBridge,
): Promise<{ ok: true } | { ok: false; code: string; status: number }> {
  const fail = (code: string, status = 409) => ({ ok: false as const, code, status });
  const start = normalizarInstante(event.startTime);
  if (!start || event.appointmentStatus !== "confirmed" || Date.parse(start) <= now)
    return fail("appointment_not_confirmed");
  const recorded = await confirmation
    .confirmedReply(scope.orgId, event.id, start)
    .catch(() => ({ ok: false as const, code: "unavailable" }));
  if (!recorded.ok) return fail("confirmation_evidence_unavailable", 503);
  if (!recorded.data) return fail("confirmation_not_persisted");
  const record = recorded.data;
  const inboundRead = await confirmation
    .message(scope.locationId, record.inboundMessageId)
    .catch(readFailed);
  if (!inboundRead.ok) return fail("message_unavailable", 502);
  const inbound = parseMessage(
    inboundRead.data,
    record.inboundMessageId,
    scope.locationId,
    "inbound",
    cfg,
  );
  if (!inbound || inbound.contactId !== event.contactId) return fail("reply_not_verified");
  if (!/^(SIM|CONFIRMO)$/i.test(inbound.body.trim())) return fail("reply_not_confirmation");
  if (
    !sourceTimestamp.safeParse(record.replyAt).success ||
    inbound.time !== Date.parse(record.replyAt) ||
    inbound.time >= Date.parse(start) ||
    inbound.time > now
  )
    return fail("reply_outside_window");
  if (
    !sourceTimestamp.safeParse(record.finishedAt).success ||
    Date.parse(record.finishedAt) <= inbound.time ||
    Date.parse(record.finishedAt) > now ||
    Date.parse(record.finishedAt) >= Date.parse(start)
  )
    return fail("confirmation_evidence_invalid");
  const listed = await confirmation
    .requests(scope.orgId, event.contactId, record.replyAt)
    .catch(() => ({ ok: false as const, code: "unavailable" }));
  if (!listed.ok) return fail("confirmation_evidence_unavailable", 503);
  if (listed.data.length > 50) return fail("confirmation_evidence_overflow");
  const linked = listed.data.filter((request) => request.id === record.requestId);
  if (linked.length !== 1) return fail("confirmation_request_missing");
  const request = linked[0]!;
  const accepted = Date.parse(request.acceptedAt);
  if (
    request.appointmentId !== event.id ||
    normalizarInstante(request.startTime) !== start ||
    !sourceTimestamp.safeParse(request.acceptedAt).success ||
    accepted >= inbound.time
  )
    return fail("confirmation_request_mismatch");
  const sentRead = await confirmation
    .message(scope.locationId, request.messageId)
    .catch(readFailed);
  if (!sentRead.ok) return fail("confirmation_evidence_unavailable", 502);
  const sent = parseMessage(sentRead.data, request.messageId, scope.locationId, "outbound", cfg);
  if (
    !sent ||
    sent.contactId !== event.contactId ||
    sent.conversationId !== inbound.conversationId ||
    sent.time > accepted ||
    sent.time >= inbound.time
  )
    return fail("confirmation_evidence_invalid");
  const history = await lerHistoricoResposta(
    confirmation,
    scope,
    inbound.contactId,
    inbound.conversationId,
  );
  const historyError = history
    ? acknowledgementContext(history, inbound, request, event, record.finishedAt, now)
    : "reply_history_unavailable";
  if (historyError) return fail(historyError);
  // The original calendar read can have become stale during evidence/history reads.
  const freshRead = await deps.consulta(event.id).catch(readFailed);
  if (!freshRead.ok) return fail("ghl_unavailable", 502);
  const fresh = parseEvento(freshRead.data, event.id, scope.locationId);
  if (
    !fresh ||
    fresh.contactId !== event.contactId ||
    fresh.calendarId !== event.calendarId ||
    normalizarInstante(fresh.startTime) !== start ||
    fresh.appointmentStatus !== "confirmed"
  )
    return fail("appointment_changed");
  return { ok: true };
}

export async function processarConfirmacao(
  pedido: PedidoConfirmacao,
  cfg: ConfigBridge,
  scope: Resolucao,
  event: EventoBridge,
  deps: DepsBridge,
  confirmation: DepsConfirmacao,
): Promise<Response> {
  const expected = normalizarInstante(pedido.expectedStartTime);
  const start = normalizarInstante(event.startTime);
  if (event.contactId !== pedido.contactId) return failure("contact_mismatch");
  if (!sourceTimestamp.safeParse(event.startTime).success || !expected || expected !== start)
    return failure("appointment_rescheduled");
  if (!["new", "booked", "confirmed"].includes(event.appointmentStatus))
    return failure("appointment_not_active");
  if (Date.parse(expected) <= deps.now()) return failure("appointment_in_past");

  const c = await deps.contacto(scope.locationId, pedido.contactId).catch(readFailed);
  if (!c.ok) return failure("ghl_unavailable", 502);
  if (!parseContacto(c.data, pedido.contactId, scope.locationId))
    return failure("contact_not_verified");
  const inboundRead = await confirmation
    .message(scope.locationId, pedido.inboundMessageId)
    .catch(readFailed);
  if (!inboundRead.ok) return failure("message_unavailable", 502);
  const inbound = parseMessage(
    inboundRead.data,
    pedido.inboundMessageId,
    scope.locationId,
    "inbound",
    cfg,
  );
  if (!inbound || inbound.contactId !== pedido.contactId) return failure("reply_not_verified");
  if (!/^(SIM|CONFIRMO)$/i.test(inbound.body.trim())) return failure("reply_not_confirmation");
  if (inbound.time > deps.now() || inbound.time >= Date.parse(expected))
    return failure("reply_outside_window");

  const replyAt = new Date(inbound.time).toISOString();
  const listed = await confirmation
    .requests(scope.orgId, pedido.contactId, replyAt)
    .catch(() => ({ ok: false as const, code: "unavailable" }));
  if (!listed.ok) return failure("confirmation_evidence_unavailable", 503);
  // All potentially relevant accepted requests are examined. Never silently truncate.
  if (listed.data.length > 50) return failure("confirmation_evidence_overflow");
  const candidates = new Map<string, RequestEvidence>();
  const acceptedRequestIds = new Set<string>();
  for (const request of listed.data) {
    const accepted = Date.parse(request.acceptedAt);
    const requestStart = normalizarInstante(request.startTime);
    if (
      !requestStart ||
      !Number.isFinite(accepted) ||
      accepted >= inbound.time ||
      Date.parse(requestStart) <= inbound.time
    )
      return failure("confirmation_evidence_invalid");
    const sentRead = await confirmation
      .message(scope.locationId, request.messageId)
      .catch(readFailed);
    if (!sentRead.ok) return failure("confirmation_evidence_unavailable", 502);
    const sent = parseMessage(sentRead.data, request.messageId, scope.locationId, "outbound", cfg);
    if (!sent || sent.time > accepted || sent.time >= inbound.time)
      return failure("confirmation_evidence_invalid");
    if (sent.contactId !== pedido.contactId || sent.conversationId !== inbound.conversationId)
      continue;
    // Do not erase competing requests because the cached appointment state changed.
    // Two requested appointments in the same conversation require human disambiguation.
    const key = `${request.appointmentId}:${requestStart}`;
    acceptedRequestIds.add(request.messageId);
    const previous = candidates.get(key);
    if (!previous || Date.parse(previous.acceptedAt) < accepted) candidates.set(key, request);
  }
  if (candidates.size !== 1)
    return failure(candidates.size ? "confirmation_ambiguous" : "confirmation_request_missing");
  const evidence = [...candidates.values()][0]!;
  if (evidence.appointmentId !== event.id || normalizarInstante(evidence.startTime) !== expected)
    return failure("confirmation_request_mismatch");

  const contextError = await replyContext(
    confirmation,
    scope,
    inbound,
    evidence,
    acceptedRequestIds,
  );
  if (contextError) return failure(contextError);

  if (cfg.simulation)
    return response({
      status: "simulated",
      simulated: true,
      confirmed: false,
      appointmentId: event.id,
      duplicate: false,
    });
  if (!cfg.liveSendEnabled || !scope.writeEnabled || !scope.integracaoConectada)
    return failure("live_send_disabled", 403);

  const revalidatePilot = () =>
    autorizarPiloto(deps, scope.orgId, {
      contactId: event.contactId,
      appointmentId: event.id,
      startTime: expected,
      kind: "appointment.confirm",
    });
  const pilot = await revalidatePilot();
  if (!pilot.ok) return failure(pilot.code, pilot.status);

  const reservation = await confirmation
    .claim(scope.orgId, evidence, inbound.id, replyAt)
    .catch(() => null);
  if (!reservation) return failure("confirmation_reservation_unavailable", 503);
  if (!reservation.reserved) {
    if (reservation.state === "confirmed" && event.appointmentStatus === "confirmed")
      return response({
        status: "confirmed",
        confirmed: true,
        appointmentId: event.id,
        startTime: expected,
        duplicate: true,
      });
    return response({ error: "confirmation_already_attempted", state: reservation.state }, 409);
  }
  const finish = (state: "confirmed" | "rejected" | "unknown", error: string | null) =>
    confirmation.finish(scope.orgId, reservation.id, state, error).catch(() => false);
  const freshRead = await deps.consulta(event.id).catch(readFailed);
  const fresh = freshRead.ok ? parseEvento(freshRead.data, event.id, scope.locationId) : null;
  const same = (e: EventoBridge | null) =>
    e &&
    e.calendarId === cfg.calendarId &&
    e.contactId === pedido.contactId &&
    normalizarInstante(e.startTime) === expected;
  if (
    !same(fresh) ||
    !fresh ||
    !["new", "booked", "confirmed"].includes(fresh.appointmentStatus) ||
    Date.parse(expected) <= deps.now()
  ) {
    await finish("rejected", "appointment_changed");
    return failure("appointment_changed");
  }
  const freshContextError = await replyContext(
    confirmation,
    scope,
    inbound,
    evidence,
    acceptedRequestIds,
  );
  if (freshContextError) {
    await finish("rejected", freshContextError);
    return failure(freshContextError);
  }
  const latestPilot = await revalidatePilot();
  if (!latestPilot.ok) {
    await finish("rejected", latestPilot.code);
    return failure(latestPilot.code, latestPilot.status);
  }
  if (fresh.appointmentStatus !== "confirmed") {
    const updated = await confirmation
      .confirm(scope.locationId, event.id)
      .catch(() => ({ ok: false as const, definitive: false }));
    if (!updated.ok) {
      await finish(
        updated.definitive ? "rejected" : "unknown",
        updated.definitive ? "ghl_rejected" : "outcome_unknown",
      );
      return failure(
        updated.definitive ? "confirmation_rejected" : "confirmation_outcome_unknown",
        502,
      );
    }
  }
  // PUT success alone is not proof; read the same ID and context again.
  const verifyRead = await deps.consulta(event.id).catch(readFailed);
  const verified = verifyRead.ok ? parseEvento(verifyRead.data, event.id, scope.locationId) : null;
  if (!same(verified) || verified?.appointmentStatus !== "confirmed") {
    await finish("unknown", "verification_failed");
    return failure("confirmation_outcome_unknown", 502);
  }
  if (!(await finish("confirmed", null))) return failure("confirmation_outcome_unknown", 502);
  return response({
    status: "confirmed",
    confirmed: true,
    appointmentId: event.id,
    startTime: expected,
    duplicate: false,
  });
}
