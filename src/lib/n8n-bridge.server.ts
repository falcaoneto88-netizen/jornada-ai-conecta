/** Dependências reais da ponte n8n. Server-only: nunca devolve tokens. */
import {
  CONFIG_PADRAO,
  DIGEST_HEX,
  processarBridge,
  BRIDGE_RATE_POR_MINUTO,
  type Canal,
  type ConfigBridge,
  type DepsBridge,
  type LeituraCredencial,
  type Resolucao,
} from "./n8n-bridge.core";
import type { DepsLembretes, ReminderEvidence } from "./n8n-bridge-reminders";
import { normalizarMensagemGhl, type DepsConfirmacao } from "./n8n-bridge-confirmation";
import type { PilotRead } from "./n8n-bridge-pilot";
import { GHL_ORIGIN, GHL_VERSION, ghlFetch, readGhlSecrets, type GhlConfig } from "./ghl.server";

type Resp = { data: unknown; error: { code?: string; message?: string } | null };
type Filtro = {
  eq: (k: string, v: unknown) => Filtro;
  maybeSingle: () => PromiseLike<Resp>;
};
/** Cliente service-role mínimo (tabelas novas ainda não estão nos tipos gerados). */
export type ClienteBridge = {
  from: (t: string) => {
    select: (c: string) => Filtro;
    upsert: (v: Record<string, unknown>, o?: { onConflict: string }) => PromiseLike<Resp>;
    insert: (v: Record<string, unknown>) => PromiseLike<Resp>;
  };
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<Resp>;
};

export function configGhl(locationId: string): GhlConfig | null {
  const { token } = readGhlSecrets();
  if (!token) return null;
  return { baseUrl: GHL_ORIGIN, version: GHL_VERSION, token, locationId };
}

/**
 * Org e location vêm só do servidor: secret da location -> ghl_location_bindings (como
 * ghl-agenda.server.ts) -> ghl_connections. Se JORNADA_AI_ORGANIZATION_ID existir, tem de
 * coincidir com o binding; se faltar, vale o binding estabelecido no servidor.
 */
export async function resolverEscopo(
  db: ClienteBridge,
  env: { orgId?: string | undefined } = { orgId: process.env["JORNADA_AI_ORGANIZATION_ID"] },
): Promise<Resolucao | null> {
  const { locationId, token } = readGhlSecrets();
  if (!locationId || !token) return null;
  const b = await db
    .from("ghl_location_bindings")
    .select("organization_id")
    .eq("location_id", locationId)
    .maybeSingle();
  const orgId = (b.data as { organization_id?: unknown } | null)?.organization_id;
  if (b.error || typeof orgId !== "string" || !orgId) return null;
  if (env.orgId && env.orgId !== orgId) return null;
  const g = await db
    .from("ghl_connections")
    .select("location_id,status,write_enabled")
    .eq("organization_id", orgId)
    .maybeSingle();
  const row = g.data as { location_id?: unknown; status?: unknown; write_enabled?: unknown } | null;
  if (g.error || !row || row.location_id !== locationId) return null;
  return {
    orgId,
    locationId,
    writeEnabled: row.write_enabled === true,
    // Valor gravado por ghl.functions.ts após teste de ligação bem-sucedido.
    integracaoConectada: row.status === "conectada",
  };
}

export function configDeLinha(row: Record<string, unknown> | null): ConfigBridge {
  if (!row) return CONFIG_PADRAO;
  const canal = row["channel"];
  return {
    bridgeEnabled: row["bridge_enabled"] === true,
    liveSendEnabled: row["live_send_enabled"] === true,
    simulation: row["simulation"] !== false,
    calendarId: typeof row["calendar_id"] === "string" ? row["calendar_id"] : null,
    channel: canal === "sms" || canal === "whatsapp_zaptos" ? (canal as Canal) : null,
    clinicAddress: typeof row["clinic_address"] === "string" ? row["clinic_address"] : "",
    fallbackUserId: typeof row["fallback_user_id"] === "string" ? row["fallback_user_id"] : null,
    zaptosProviderId:
      typeof row["zaptos_provider_id"] === "string" ? row["zaptos_provider_id"] : null,
    channelVerified: row["channel_verified"] === true,
  };
}

export async function lerConfigBridge(
  db: ClienteBridge,
  orgId: string,
): Promise<{ ok: true; cfg: ConfigBridge } | { ok: false }> {
  const r = await db
    .from("n8n_bridge_settings")
    .select(
      "bridge_enabled,live_send_enabled,simulation,calendar_id,channel,clinic_address,fallback_user_id,zaptos_provider_id,channel_verified",
    )
    .eq("organization_id", orgId)
    .maybeSingle();
  if (r.error) return { ok: false };
  return { ok: true, cfg: configDeLinha(r.data as Record<string, unknown> | null) };
}

/** Lê só o digest da credencial da organização. Erro/schema em falta -> { ok:false } (fail-closed). */
export async function lerCredencialBridge(
  db: ClienteBridge,
  orgId: string,
): Promise<LeituraCredencial> {
  const r = await db
    .from("n8n_bridge_credentials")
    .select("key_sha256")
    .eq("organization_id", orgId)
    .maybeSingle();
  if (r.error) return { ok: false };
  const d = (r.data as { key_sha256?: unknown } | null)?.key_sha256;
  if (d === undefined || d === null) return { ok: true, digest: null };
  return typeof d === "string" && DIGEST_HEX.test(d) ? { ok: true, digest: d } : { ok: false };
}

export async function utilizadorNaLocation(
  cfg: GhlConfig,
  userId: string,
): Promise<boolean | null> {
  const r = await ghlFetch<{ users?: { id?: string }[] }>(cfg, "users/", {
    query: { locationId: cfg.locationId },
  });
  if (!r.ok || !Array.isArray(r.data.users)) return null;
  return r.data.users.some((u) => u?.id === userId);
}

/** GHL calls remain server scoped; no caller-supplied credentials or URL. */
export function criarDepsConfirmacao(db: ClienteBridge): DepsConfirmacao {
  return {
    confirmedReply: async (orgId, appointmentId, startTime) => {
      const r = await db
        .from("n8n_bridge_confirmations")
        .select("request_send_id,inbound_message_id,reply_at,finished_at")
        .eq("organization_id", orgId)
        .eq("ghl_appointment_id", appointmentId)
        .eq("start_time", startTime)
        .eq("state", "confirmed")
        .maybeSingle();
      if (r.error) return { ok: false, code: "schema_unavailable" };
      if (!r.data) return { ok: true, data: null };
      const row = r.data as Record<string, unknown>;
      if (
        ["request_send_id", "inbound_message_id", "reply_at", "finished_at"].some(
          (key) => typeof row[key] !== "string" || !row[key],
        )
      )
        return { ok: false, code: "invalid_evidence" };
      return {
        ok: true,
        data: {
          requestId: String(row["request_send_id"]),
          inboundMessageId: String(row["inbound_message_id"]),
          replyAt: String(row["reply_at"]),
          finishedAt: String(row["finished_at"]),
        },
      };
    },
    message: async (locationId, id) => {
      const cfg = configGhl(locationId);
      if (!cfg) return { ok: false, code: "missing_secrets" };
      const r = await ghlFetch(cfg, `conversations/messages/${encodeURIComponent(id)}`);
      return r.ok ? { ok: true, data: normalizarMensagemGhl(r.data) } : { ok: false, code: r.code };
    },
    conversationMessages: async (locationId, conversationId, cursor) => {
      const cfg = configGhl(locationId);
      if (!cfg) return { ok: false, code: "missing_secrets" };
      const r = await ghlFetch(
        cfg,
        `conversations/${encodeURIComponent(conversationId)}/messages`,
        {
          query: { limit: "100", ...(cursor ? { lastMessageId: cursor } : {}) },
        },
      );
      return r.ok ? { ok: true, data: r.data } : { ok: false, code: r.code };
    },
    requests: async (orgId, contactId, replyAt) => {
      const r = await db.rpc("n8n_bridge_confirmation_requests", {
        _org: orgId,
        _reply_at: replyAt,
        _contact: contactId,
      });
      if (r.error || !Array.isArray(r.data)) return { ok: false, code: "schema_unavailable" };
      const rows = r.data as Record<string, unknown>[];
      if (
        rows.some(
          (x) =>
            !x ||
            ["id", "appointment_id", "start_time", "message_id", "accepted_at"].some(
              (k) => typeof x[k] !== "string" || !x[k],
            ),
        )
      )
        return { ok: false, code: "invalid_evidence" };
      return {
        ok: true,
        data: rows.map((x) => ({
          id: String(x["id"]),
          appointmentId: String(x["appointment_id"]),
          startTime: String(x["start_time"]),
          messageId: String(x["message_id"]),
          acceptedAt: String(x["accepted_at"]),
        })),
      };
    },
    claim: async (orgId, evidence, inboundMessageId, replyAt) => {
      const r = await db.rpc("n8n_bridge_claim_confirmation", {
        _org: orgId,
        _request: evidence.id,
        _inbound: inboundMessageId,
        _reply_at: replyAt,
      });
      const d = r.data as Record<string, unknown> | null;
      if (r.error || !d || typeof d["id"] !== "string") return null;
      if (d["reserved"] === true) return { reserved: true, id: d["id"] };
      return typeof d["state"] === "string"
        ? { reserved: false, id: d["id"], state: d["state"] }
        : null;
    },
    finish: async (orgId, id, state, error) => {
      const r = await db.rpc("n8n_bridge_finish_confirmation", {
        _org: orgId,
        _id: id,
        _state: state,
        _error: error,
      });
      const d = r.data as Record<string, unknown> | null;
      return !r.error && d?.["persisted"] === true && d["state"] === state;
    },
    confirm: async (locationId, id) => {
      const cfg = configGhl(locationId);
      if (!cfg) return { ok: false, definitive: true };
      const r = await ghlFetch(cfg, `calendars/events/appointments/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: { appointmentStatus: "confirmed", toNotify: false },
      });
      return r.ok ? { ok: true } : { ok: false, definitive: r.status >= 400 && r.status < 500 };
    },
  };
}

/** Exact accepted journey sends; no schema change or unscoped contact history query. */
export function criarDepsLembretes(db: ClienteBridge): DepsLembretes {
  const read = criarDepsConfirmacao(db);
  return {
    message: read.message,
    conversationMessages: read.conversationMessages,
    sends: async (orgId, appointmentId, startTime, contactId) => {
      const rows: ReminderEvidence[] = [];
      for (const kind of ["booking", "req24", "req12"] as const) {
        const result = await db
          .from("n8n_bridge_sends")
          .select("ghl_appointment_id,start_time,contact_id,message_id,finished_at")
          .eq("organization_id", orgId)
          .eq("ghl_appointment_id", appointmentId)
          .eq("start_time", startTime)
          .eq("contact_id", contactId)
          .eq("kind", kind)
          .eq("state", "accepted")
          .maybeSingle();
        if (result.error) return { ok: false, code: "schema_unavailable" };
        if (!result.data) continue;
        const row = result.data as Record<string, unknown>;
        if (
          ["ghl_appointment_id", "start_time", "contact_id", "message_id", "finished_at"].some(
            (key) => typeof row[key] !== "string" || !row[key],
          )
        )
          return { ok: false, code: "invalid_evidence" };
        rows.push({
          kind,
          appointmentId: String(row["ghl_appointment_id"]),
          startTime: String(row["start_time"]),
          contactId: String(row["contact_id"]),
          messageId: String(row["message_id"]),
          acceptedAt: String(row["finished_at"]),
        });
      }
      return { ok: true, data: rows };
    },
  };
}

export function criarDepsBridge(db: ClienteBridge): DepsBridge {
  const cfgDe = (loc: string) => configGhl(loc);
  return {
    token: process.env["N8N_JORNADA_BRIDGE_TOKEN"],
    lerPiloto: (orgId) => lerPilotoBridge(db, orgId),
    confirmacao: criarDepsConfirmacao(db),
    lembretes: criarDepsLembretes(db),
    verifiedConfirmation: async (orgId, appointmentId, startTime) => {
      const r = await db
        .from("n8n_bridge_confirmations")
        .select("id")
        .eq("organization_id", orgId)
        .eq("ghl_appointment_id", appointmentId)
        .eq("start_time", startTime)
        .eq("state", "confirmed")
        .maybeSingle();
      if (r.error) return null;
      return !!r.data && typeof (r.data as Record<string, unknown>)["id"] === "string";
    },
    credencial: (org) => lerCredencialBridge(db, org),
    now: () => Date.now(),
    resolver: () => resolverEscopo(db),
    lerConfig: (org) => lerConfigBridge(db, org),
    hit: async (org) => {
      const r = await db.rpc("n8n_bridge_hit", { _org: org, _limit: BRIDGE_RATE_POR_MINUTO });
      return r.error || typeof r.data !== "boolean" ? null : r.data;
    },
    contacto: async (loc, id) => {
      const cfg = cfgDe(loc);
      if (!cfg) return { ok: false, code: "missing_secrets" };
      // Read the individual contact: search can omit channel-level DND settings.
      // Normalize only the envelope; parseContacto still verifies identity, location and DND.
      const r = await ghlFetch(cfg, `contacts/${encodeURIComponent(id)}`);
      if (!r.ok) return { ok: false, code: r.code };
      const raw = r.data;
      const contact =
        raw && typeof raw === "object" && !Array.isArray(raw)
          ? (raw as Record<string, unknown>)["contact"]
          : null;
      return { ok: true, data: { contacts: [contact], total: 1 } };
    },
    consulta: async (id) => {
      const { locationId } = readGhlSecrets();
      const cfg = locationId ? cfgDe(locationId) : null;
      if (!cfg) return { ok: false, code: "missing_secrets" };
      const r = await ghlFetch(cfg, `calendars/events/appointments/${encodeURIComponent(id)}`);
      return r.ok ? { ok: true, data: r.data } : { ok: false, code: r.code };
    },
    utilizadorNaLocation: async (loc, userId) => {
      const cfg = cfgDe(loc);
      return cfg ? utilizadorNaLocation(cfg, userId) : null;
    },
    enviar: async (corpo) => {
      const { locationId } = readGhlSecrets();
      const cfg = locationId ? cfgDe(locationId) : null;
      if (!cfg) return { ok: false, definitivo: true, code: "missing_secrets" };
      const r = await ghlFetch<{ messageId?: unknown }>(cfg, "conversations/messages", {
        method: "POST",
        body: corpo,
      });
      if (r.ok)
        return {
          ok: true,
          messageId:
            typeof r.data.messageId === "string" && r.data.messageId ? r.data.messageId : null,
        };
      // Só uma recusa HTTP 4xx explícita é definitiva. Timeout, rede, 3xx e 5xx = resultado desconhecido.
      return { ok: false, definitivo: r.status >= 400 && r.status < 500, code: r.code };
    },
    claim: async (org, appt, start, kind, contactId) => {
      const r = await db.rpc("n8n_bridge_claim_send", {
        _org: org,
        _appointment: appt,
        _start: start,
        _kind: kind,
        _contact: contactId,
      });
      const d = r.data as Record<string, unknown> | null;
      if (r.error || !d || typeof d["id"] !== "string") return null;
      if (d["reserved"] === true) return { reserved: true, id: d["id"] };
      return {
        reserved: false,
        id: d["id"],
        state: String(d["state"]),
        messageId: typeof d["message_id"] === "string" ? d["message_id"] : null,
      };
    },
    finish: async (org, id, state, messageId, error) => {
      const r = await db.rpc("n8n_bridge_finish_send", {
        _org: org,
        _id: id,
        _state: state,
        _message_id: messageId,
        _error: error,
      });
      const d = r.data as Record<string, unknown> | null;
      return (
        !r.error &&
        d?.["persisted"] === true &&
        d["state"] === state &&
        (state !== "accepted" || d["message_id"] === messageId)
      );
    },
  };
}

/** Service role lookup is constrained by the organization authenticated by the bridge. */
export async function lerPilotoBridge(db: ClienteBridge, orgId: string): Promise<PilotRead> {
  const r = await db
    .from("n8n_bridge_pilot_grants")
    .select(
      "organization_id,enabled,contact_id,ghl_appointment_id,start_time,expires_at,allowed_kinds",
    )
    .eq("organization_id", orgId)
    .maybeSingle();
  return r.error ? { ok: false } : { ok: true, data: r.data };
}

export async function receberBridgeN8n(request: Request): Promise<Response> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return processarBridge(request, criarDepsBridge(supabaseAdmin as unknown as ClienteBridge));
}
