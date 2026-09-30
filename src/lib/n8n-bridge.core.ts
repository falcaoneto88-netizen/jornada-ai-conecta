/**
 * Ponte restrita n8n -> Jornada -> GoHighLevel (v1). Lógica pura com dependências
 * injetadas: autenticação de máquina, união estrita de operações, reconsulta no
 * GHL, DND explícito, reserva durável antes do envio e no máximo uma tentativa.
 */
import { createHash, timingSafeEqual } from "crypto";
import { z } from "zod";

import { KINDS_INTERNOS, N8N_KINDS, montarMensagem, type KindN8n } from "./n8n-bridge.templates";

export const BRIDGE_MAX_BYTES = 2048;
export const BRIDGE_RATE_POR_MINUTO = 60;
export const BRIDGE_TOKEN_MIN = 32;

const idGhl = z.string().regex(/^[A-Za-z0-9_-]{6,64}$/);

export const pedidoSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("health") }).strict(),
  z.object({ op: z.literal("contact.get"), contactId: idGhl }).strict(),
  z.object({ op: z.literal("appointment.get"), appointmentId: idGhl }).strict(),
  z
    .object({
      op: z.literal("message.send"),
      appointmentId: idGhl,
      contactId: idGhl,
      expectedStartTime: z.string().datetime({ offset: true }),
      kind: z.enum(N8N_KINDS),
    })
    .strict(),
]);
export type PedidoBridge = z.infer<typeof pedidoSchema>;

export type Canal = "sms" | "whatsapp_zaptos";
export type ConfigBridge = {
  bridgeEnabled: boolean;
  liveSendEnabled: boolean;
  simulation: boolean;
  calendarId: string | null;
  channel: Canal | null;
  clinicAddress: string;
  fallbackUserId: string | null;
  /** conversationProviderId do ZaptosWPP (não secreto), definido no servidor. */
  zaptosProviderId: string | null;
  /** Só a implantação administrativa marca true; nunca quem chama. */
  channelVerified: boolean;
};
export const CONFIG_PADRAO: ConfigBridge = {
  bridgeEnabled: false,
  liveSendEnabled: false,
  simulation: true,
  calendarId: null,
  channel: null,
  clinicAddress: "",
  fallbackUserId: null,
  zaptosProviderId: null,
  channelVerified: false,
};

export type Resolucao = {
  orgId: string;
  locationId: string;
  writeEnabled: boolean;
  integracaoConectada: boolean;
};

export type EstadoDnd = "active" | "inactive";
export type ContactoBridge = {
  id: string;
  locationId: string;
  firstName: string | null;
  phone: string | null;
  assignedTo: string | null;
  dnd: boolean;
  dndSettings: Record<string, { status: EstadoDnd }>;
};
export type EventoBridge = {
  id: string;
  locationId: string;
  calendarId: string;
  contactId: string;
  startTime: string;
  endTime: string;
  appointmentStatus: string;
};

export type Ler<T> = { ok: true; data: T } | { ok: false; code: string };
export type EnvioGhl =
  { ok: true; messageId: string | null } | { ok: false; definitivo: boolean; code: string };
export type Reserva =
  | { reserved: true; id: string }
  | { reserved: false; id: string; state: string; messageId: string | null };

/** Digest SHA-256 (hex minúsculo) guardado em n8n_bridge_credentials; null = sem credencial. */
export type LeituraCredencial = { ok: true; digest: string | null } | { ok: false };

export type DepsBridge = {
  token: string | undefined;
  /** Credencial por organização (só usada quando o token de ambiente não está configurado). */
  credencial?: (orgId: string) => Promise<LeituraCredencial>;
  now: () => number;
  resolver: () => Promise<Resolucao | null>;
  lerConfig: (orgId: string) => Promise<{ ok: true; cfg: ConfigBridge } | { ok: false }>;
  hit: (orgId: string) => Promise<boolean | null>;
  contacto: (locationId: string, id: string) => Promise<Ler<unknown>>;
  consulta: (id: string) => Promise<Ler<unknown>>;
  utilizadorNaLocation: (locationId: string, userId: string) => Promise<boolean | null>;
  enviar: (corpo: Record<string, unknown>) => Promise<EnvioGhl>;
  claim: (
    orgId: string,
    appointmentId: string,
    start: string,
    kind: KindN8n,
  ) => Promise<Reserva | null>;
  finish: (
    orgId: string,
    id: string,
    state: "accepted" | "rejected" | "unknown",
    messageId: string | null,
    error: string | null,
  ) => Promise<boolean>;
};

const reply = (body: unknown, status: number) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
const erro = (code: string, status: number) => reply({ error: code }, status);

/** Comparação em tempo constante (digests de tamanho fixo). */
export function tokenIgual(esperado: string, recebido: string): boolean {
  const a = createHash("sha256").update(esperado).digest();
  const b = createHash("sha256").update(recebido).digest();
  return timingSafeEqual(a, b);
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
export const DIGEST_HEX = /^[0-9a-f]{64}$/;

/** Compara sha256(recebido) com um digest hex guardado, em tempo constante e tamanho fixo. */
export function digestIgual(digestHex: string, recebido: string): boolean {
  if (!DIGEST_HEX.test(digestHex)) return false;
  const a = Buffer.from(digestHex, "hex");
  const b = createHash("sha256").update(recebido).digest();
  return a.length === 32 && timingSafeEqual(a, b);
}

export function envTokenValido(t: string | undefined): t is string {
  return typeof t === "string" && t.length >= BRIDGE_TOKEN_MIN;
}

const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);

/** Resposta da pesquisa por ID exato: um único contacto, na location, com DND explícito. */
export function parseContacto(raw: unknown, id: string, locationId: string): ContactoBridge | null {
  const r = obj(raw);
  const rows = r?.["contacts"];
  if (!r || r["total"] !== 1 || !Array.isArray(rows) || rows.length !== 1) return null;
  const c = obj(rows[0]);
  if (!c || c["id"] !== id || c["locationId"] !== locationId || typeof c["dnd"] !== "boolean")
    return null;
  const ds = obj(c["dndSettings"]);
  if (!ds) return null;
  const dndSettings: Record<string, { status: EstadoDnd }> = {};
  for (const [canal, valor] of Object.entries(ds)) {
    const status = obj(valor)?.["status"];
    if (status !== "active" && status !== "inactive") return null;
    dndSettings[canal] = { status };
  }
  const phone = str(c["phone"]);
  return {
    id,
    locationId,
    firstName: str(c["firstName"]),
    phone: phone && /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null,
    assignedTo:
      str(c["assignedTo"]) && idGhl.safeParse(c["assignedTo"]).success
        ? String(c["assignedTo"])
        : null,
    dnd: c["dnd"] as boolean,
    dndSettings,
  };
}

export function parseEvento(raw: unknown, id: string, locationId: string): EventoBridge | null {
  const r = obj(raw);
  const e = obj(r?.["appointment"]) ?? obj(r?.["event"]);
  if (!e || e["id"] !== id || e["locationId"] !== locationId) return null;
  const campos = ["calendarId", "contactId", "startTime", "endTime", "appointmentStatus"] as const;
  if (campos.some((k) => !str(e[k]))) return null;
  if (
    Number.isNaN(Date.parse(String(e["startTime"]))) ||
    Number.isNaN(Date.parse(String(e["endTime"])))
  )
    return null;
  return {
    id,
    locationId,
    calendarId: String(e["calendarId"]),
    contactId: String(e["contactId"]),
    startTime: String(e["startTime"]),
    endTime: String(e["endTime"]),
    appointmentStatus: String(e["appointmentStatus"]),
  };
}

/** Canais DND que têm de estar explicitamente "inactive" para cada escolha. */
export const CANAIS_DND: Record<Canal, readonly string[]> = {
  sms: ["SMS"],
  whatsapp_zaptos: ["SMS", "WhatsApp"],
};

/** Ausência de chave nunca é consentimento. */
export function dndPermite(c: ContactoBridge, canal: Canal): boolean {
  if (c.dnd !== false) return false;
  return CANAIS_DND[canal].every((k) => c.dndSettings[k]?.status === "inactive");
}

const ESTADOS_ATIVOS = new Set(["confirmed", "new", "booked"]);

export function normalizarInstante(iso: string): string | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(Math.floor(t / 1000) * 1000).toISOString();
}

async function lerCorpo(request: Request): Promise<string | null | "grande"> {
  const len = Number(request.headers.get("content-length") ?? "0");
  if (len > BRIDGE_MAX_BYTES) return "grande";
  const buf = new Uint8Array(await request.arrayBuffer());
  if (buf.byteLength > BRIDGE_MAX_BYTES) return "grande";
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return null;
  }
}

export async function processarBridge(request: Request, deps: DepsBridge): Promise<Response> {
  // Fail-closed. Token de ambiente válido tem precedência; sem ele, vale só a credencial
  // (hash) da organização resolvida no servidor. Nunca ambas em simultâneo.
  const auth = request.headers.get("authorization") ?? "";
  const m = /^Bearer ([\x21-\x7E]{1,512})$/.exec(auth);
  let resAuth: Resolucao | null = null;
  if (envTokenValido(deps.token)) {
    if (!m || !tokenIgual(deps.token, m[1]!)) return erro("unauthorized", 401);
  } else {
    if (deps.token || !deps.credencial) return erro("bridge_unavailable", 503);
    try {
      resAuth = await deps.resolver();
    } catch {
      resAuth = null;
    }
    if (!resAuth) return erro("bridge_unavailable", 503);
    const c = await deps.credencial(resAuth.orgId).catch(() => ({ ok: false as const }));
    if (!c.ok || !c.digest) return erro("bridge_unavailable", 503);
    if (!m || !digestIgual(c.digest, m[1]!)) return erro("unauthorized", 401);
  }
  if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json")
    return erro("invalid_content_type", 415);
  const corpo = await lerCorpo(request);
  if (corpo === "grande") return erro("request_too_large", 413);
  if (corpo === null) return erro("invalid_request", 400);
  let json: unknown;
  try {
    json = JSON.parse(corpo);
  } catch {
    return erro("invalid_request", 400);
  }
  const p = pedidoSchema.safeParse(json);
  if (!p.success) return erro("invalid_request", 400);
  const pedido = p.data;

  let res: Resolucao | null = resAuth;
  if (!res) {
    try {
      res = await deps.resolver();
    } catch {
      res = null;
    }
  }
  if (!res) return erro("binding_unavailable", 503);

  const lida = await deps.lerConfig(res.orgId).catch(() => ({ ok: false as const }));
  if (!lida.ok) return erro("bridge_schema_unavailable", 503);
  const cfg = lida.cfg;

  const cabe = await deps.hit(res.orgId).catch(() => null);
  if (cabe === null) return erro("bridge_schema_unavailable", 503);
  if (!cabe) return erro("rate_limited", 429);

  if (pedido.op === "health") {
    return reply(
      {
        ok: true,
        bridgeEnabled: cfg.bridgeEnabled,
        simulation: cfg.simulation,
        liveSendEnabled: cfg.liveSendEnabled,
        writeEnabled: res.writeEnabled,
        calendarConfigured: cfg.calendarId !== null,
        channelConfigured: cfg.channel !== null,
        channelVerified: cfg.channelVerified,
        smsRouteConfigured: false,
        addressConfigured: cfg.clinicAddress.trim() !== "",
      },
      200,
    );
  }
  if (!cfg.bridgeEnabled) return erro("bridge_disabled", 403);

  if (pedido.op === "contact.get") {
    const c = await lerContacto(deps, res.locationId, pedido.contactId);
    if (!c.ok) return erro(c.code, c.status);
    return reply({ contact: c.data }, 200);
  }

  if (!cfg.calendarId) return erro("calendar_not_configured", 409);
  const ev = await lerEvento(deps, res.locationId, pedido.appointmentId, cfg.calendarId);
  if (!ev.ok) return erro(ev.code, ev.status);
  if (pedido.op === "appointment.get") return reply({ event: ev.data }, 200);

  // ---- message.send ----
  const e = ev.data;
  if (e.contactId !== pedido.contactId) return erro("contact_mismatch", 409);
  const esperado = normalizarInstante(pedido.expectedStartTime);
  const atual = normalizarInstante(e.startTime);
  if (!esperado || esperado !== atual) return erro("appointment_rescheduled", 409);
  if (!ESTADOS_ATIVOS.has(e.appointmentStatus)) return erro("appointment_not_active", 409);
  if (Date.parse(atual) <= deps.now()) return erro("appointment_in_past", 409);

  const c = await lerContacto(deps, res.locationId, pedido.contactId);
  if (!c.ok) return erro(c.code, c.status);
  const interno = KINDS_INTERNOS.includes(pedido.kind);

  let corpoGhl: Record<string, unknown>;
  if (interno) {
    // Menção ao responsável COMERCIAL do contacto; nunca ao médico da consulta.
    let responsavel = c.data.assignedTo;
    if (!responsavel) responsavel = cfg.fallbackUserId;
    if (!responsavel) return erro("seller_not_configured", 409);
    const valido = await deps.utilizadorNaLocation(res.locationId, responsavel).catch(() => null);
    if (valido === null) return erro("ghl_unavailable", 502);
    if (!valido) return erro("seller_not_in_location", 409);
    corpoGhl = {
      type: "InternalComment",
      contactId: c.data.id,
      // API oficial: menção inline E lista mentions, com o mesmo ID.
      message: `@Responsável<userId>${responsavel}</userId> ${montarMensagem(pedido.kind, {
        firstName: c.data.firstName,
        startTime: atual,
        morada: "",
      })}`,
      mentions: [responsavel],
      appointmentId: e.id,
      status: "pending",
    };
  } else {
    if (!cfg.channel) return erro("channel_not_configured", 409);
    // v1: não existe rota de SMS de operadora verificada; o tipo SMS da conta sai pelo ZaptosWPP.
    if (cfg.channel === "sms") return erro("sms_route_not_configured", 409);
    if (!cfg.zaptosProviderId) return erro("provider_not_configured", 409);
    if (!cfg.channelVerified) return erro("channel_not_verified", 409);
    if (pedido.kind === "confirm" && cfg.clinicAddress.trim() === "")
      return erro("address_not_configured", 409);
    if (!c.data.phone) return erro("contact_phone_missing", 409);
    if (!dndPermite(c.data, cfg.channel)) return erro("dnd_not_confirmed", 409);
    corpoGhl = {
      // whatsapp_zaptos: tipo SMS com o provedor ZaptosWPP fixado explicitamente.
      type: "SMS",
      contactId: c.data.id,
      conversationProviderId: cfg.zaptosProviderId,
      appointmentId: e.id,
      status: "pending",
      message: montarMensagem(pedido.kind, {
        firstName: c.data.firstName,
        startTime: atual,
        morada: cfg.clinicAddress.trim(),
      }),
    };
  }

  if (cfg.simulation) {
    return reply(
      {
        simulated: true,
        status: "simulated",
        messageId: null,
        duplicate: false,
        delivered: false,
        kind: pedido.kind,
      },
      200,
    );
  }
  if (!cfg.liveSendEnabled || !res.writeEnabled || !res.integracaoConectada)
    return erro("live_send_disabled", 403);

  const reserva = await deps.claim(res.orgId, e.id, atual, pedido.kind).catch(() => null);
  if (!reserva) return erro("reservation_unavailable", 503);
  if (!reserva.reserved) {
    if (reserva.state === "accepted" && reserva.messageId)
      return reply(
        { messageId: reserva.messageId, status: "accepted", duplicate: true, delivered: false },
        200,
      );
    return reply({ error: "send_already_attempted", state: reserva.state }, 409);
  }

  // Única tentativa externa desta reserva.
  const envio = await deps
    .enviar(corpoGhl)
    .catch((): EnvioGhl => ({ ok: false, definitivo: false, code: "outcome_unknown" }));
  if (envio.ok && envio.messageId) {
    const gravado = await deps
      .finish(res.orgId, reserva.id, "accepted", envio.messageId, null)
      .catch(() => false);
    if (!gravado) {
      await deps
        .finish(res.orgId, reserva.id, "unknown", null, "persist_failed")
        .catch(() => false);
      return erro("outcome_unknown", 502);
    }
    return reply(
      { messageId: envio.messageId, status: "accepted", duplicate: false, delivered: false },
      200,
    );
  }
  if (!envio.ok && envio.definitivo) {
    await deps.finish(res.orgId, reserva.id, "rejected", null, "ghl_rejected").catch(() => false);
    return erro("send_rejected", 502);
  }
  await deps
    .finish(
      res.orgId,
      reserva.id,
      "unknown",
      null,
      envio.ok ? "missing_message_id" : "outcome_unknown",
    )
    .catch(() => false);
  return erro("outcome_unknown", 502);
}

type Lido<T> = { ok: true; data: T } | { ok: false; code: string; status: number };

async function lerContacto(
  deps: DepsBridge,
  locationId: string,
  id: string,
): Promise<Lido<ContactoBridge>> {
  const r = await deps
    .contacto(locationId, id)
    .catch((): Ler<unknown> => ({ ok: false, code: "network_error" }));
  if (!r.ok)
    return r.code === "not_found"
      ? { ok: false, code: "contact_not_found", status: 404 }
      : { ok: false, code: "ghl_unavailable", status: 502 };
  const c = parseContacto(r.data, id, locationId);
  return c ? { ok: true, data: c } : { ok: false, code: "contact_not_verified", status: 409 };
}

async function lerEvento(
  deps: DepsBridge,
  locationId: string,
  id: string,
  calendarId: string,
): Promise<Lido<EventoBridge>> {
  const r = await deps
    .consulta(id)
    .catch((): Ler<unknown> => ({ ok: false, code: "network_error" }));
  if (!r.ok)
    return r.code === "not_found"
      ? { ok: false, code: "appointment_not_found", status: 404 }
      : { ok: false, code: "ghl_unavailable", status: 502 };
  const e = parseEvento(r.data, id, locationId);
  if (!e) return { ok: false, code: "appointment_not_verified", status: 409 };
  if (e.calendarId !== calendarId) return { ok: false, code: "calendar_mismatch", status: 409 };
  return { ok: true, data: e };
}
