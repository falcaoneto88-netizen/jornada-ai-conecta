/** Dependências reais da ponte n8n. Server-only: nunca devolve tokens. */
import {
  CONFIG_PADRAO,
  processarBridge,
  BRIDGE_RATE_POR_MINUTO,
  type Canal,
  type ConfigBridge,
  type DepsBridge,
  type Resolucao,
} from "./n8n-bridge.core";
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
  };
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<Resp>;
};

export function configGhl(locationId: string): GhlConfig | null {
  const { token } = readGhlSecrets();
  if (!token) return null;
  return { baseUrl: GHL_ORIGIN, version: GHL_VERSION, token, locationId };
}

/** Org e location vêm só do servidor: variável de org + secret da location + binding + integração. */
export async function resolverEscopo(db: ClienteBridge): Promise<Resolucao | null> {
  const orgId = process.env["JORNADA_AI_ORGANIZATION_ID"];
  const { locationId, token } = readGhlSecrets();
  if (!orgId || !locationId || !token) return null;
  const b = await db
    .from("ghl_location_bindings")
    .select("organization_id")
    .eq("location_id", locationId)
    .maybeSingle();
  if (b.error || (b.data as { organization_id?: string } | null)?.organization_id !== orgId)
    return null;
  const g = await db
    .from("ghl_integrations")
    .select("location_id,status,write_enabled")
    .eq("organization_id", orgId)
    .maybeSingle();
  const row = g.data as { location_id?: string; status?: string; write_enabled?: boolean } | null;
  if (g.error || !row || row.location_id !== locationId) return null;
  return {
    orgId,
    locationId,
    writeEnabled: row.write_enabled === true,
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
  };
}

export async function lerConfigBridge(
  db: ClienteBridge,
  orgId: string,
): Promise<{ ok: true; cfg: ConfigBridge } | { ok: false }> {
  const r = await db
    .from("n8n_bridge_settings")
    .select(
      "bridge_enabled,live_send_enabled,simulation,calendar_id,channel,clinic_address,fallback_user_id",
    )
    .eq("organization_id", orgId)
    .maybeSingle();
  if (r.error) return { ok: false };
  return { ok: true, cfg: configDeLinha(r.data as Record<string, unknown> | null) };
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

export function criarDepsBridge(db: ClienteBridge): DepsBridge {
  const cfgDe = (loc: string) => configGhl(loc);
  return {
    token: process.env["N8N_JORNADA_BRIDGE_TOKEN"],
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
      // Pesquisa por ID exato: o GET simples omite o DND em contactos recentes.
      const r = await ghlFetch(cfg, "contacts/search", {
        method: "POST",
        body: {
          locationId: loc,
          page: 1,
          pageLimit: 2,
          filters: [{ field: "id", operator: "eq", value: id }],
        },
      });
      return r.ok ? { ok: true, data: r.data } : { ok: false, code: r.code };
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
      return { ok: false, definitivo: r.code !== "outcome_unknown", code: r.code };
    },
    claim: async (org, appt, start, kind) => {
      const r = await db.rpc("n8n_bridge_claim_send", {
        _org: org,
        _appointment: appt,
        _start: start,
        _kind: kind,
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

export async function receberBridgeN8n(request: Request): Promise<Response> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return processarBridge(request, criarDepsBridge(supabaseAdmin as unknown as ClienteBridge));
}
