/** Leitura/gravação da configuração NÃO secreta da ponte, só para administradores. */
import type { ConfigEntrada } from "./n8n-bridge.schema";

import { BRIDGE_TOKEN_MIN } from "./n8n-bridge.core";
import {
  configGhl,
  lerConfigBridge,
  resolverEscopo,
  utilizadorNaLocation,
  type ClienteBridge,
} from "./n8n-bridge.server";
import { ghlFetch } from "./ghl.server";

type Sessao = {
  supabase: {
    auth: { getUser: () => Promise<{ data: { user: { id: string } | null }; error: unknown }> };
    rpc: (fn: string, a: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
    from: (t: string) => {
      select: (c: string) => {
        eq: (
          k: string,
          v: string,
        ) => { maybeSingle: () => PromiseLike<{ data: unknown; error: unknown }> };
      };
    };
  };
  userId: string;
};

export type EstadoPonteN8n = {
  autorizado: boolean;
  tokenPresente: boolean;
  schemaDisponivel: boolean;
  bindingOk: boolean;
  writeEnabled: boolean;
  bridgeEnabled: boolean;
  liveSendEnabled: boolean;
  simulation: boolean;
  calendarId: string | null;
  channel: "sms" | "whatsapp_zaptos" | null;
  clinicAddress: string;
  fallbackUserId: string | null;
};

const NEGADO: EstadoPonteN8n = {
  autorizado: false,
  tokenPresente: false,
  schemaDisponivel: false,
  bindingOk: false,
  writeEnabled: false,
  bridgeEnabled: false,
  liveSendEnabled: false,
  simulation: true,
  calendarId: null,
  channel: null,
  clinicAddress: "",
  fallbackUserId: null,
};

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as ClienteBridge;
}

/** Sessão real + papel administrador + organização da sessão igual à org da ponte. */
async function autorizar(ctx: Sessao, db: ClienteBridge) {
  try {
    const { data, error } = await ctx.supabase.auth.getUser();
    if (error || data.user?.id !== ctx.userId) return null;
    const papel = await ctx.supabase.rpc("tem_papel", { _papeis: ["administrador"] });
    if (papel.error || papel.data !== true) return null;
    const perfil = await ctx.supabase
      .from("profiles")
      .select("organization_id")
      .eq("id", ctx.userId)
      .maybeSingle();
    const org = (perfil.data as { organization_id?: string } | null)?.organization_id;
    if (perfil.error || !org) return null;
    const escopo = await resolverEscopo(db);
    return { org, escopo: escopo && escopo.orgId === org ? escopo : null };
  } catch {
    return null;
  }
}

export async function lerEstadoPonte(ctx: Sessao): Promise<EstadoPonteN8n> {
  const db = await admin();
  const a = await autorizar(ctx, db);
  if (!a) return NEGADO;
  const token = process.env["N8N_JORNADA_BRIDGE_TOKEN"];
  const lida = await lerConfigBridge(db, a.org).catch(() => ({ ok: false as const }));
  const cfg = lida.ok ? lida.cfg : null;
  return {
    autorizado: true,
    tokenPresente: typeof token === "string" && token.length >= BRIDGE_TOKEN_MIN,
    schemaDisponivel: lida.ok,
    bindingOk: a.escopo !== null,
    writeEnabled: a.escopo?.writeEnabled ?? false,
    bridgeEnabled: cfg?.bridgeEnabled ?? false,
    liveSendEnabled: cfg?.liveSendEnabled ?? false,
    simulation: cfg?.simulation ?? true,
    calendarId: cfg?.calendarId ?? null,
    channel: cfg?.channel ?? null,
    clinicAddress: cfg?.clinicAddress ?? "",
    fallbackUserId: cfg?.fallbackUserId ?? null,
  };
}

/** Grava apenas campos não secretos. Nunca altera bridge_enabled, live_send_enabled ou simulation. */
export async function guardarConfigPonte(
  ctx: Sessao,
  e: ConfigEntrada,
): Promise<{ ok: boolean; message: string }> {
  const db = await admin();
  const a = await autorizar(ctx, db);
  if (!a) return { ok: false, message: "Acesso reservado a administradores." };
  if (!a.escopo) return { ok: false, message: "Vínculo GoHighLevel não confirmado no servidor." };
  const cfg = configGhl(a.escopo.locationId);
  if (!cfg) return { ok: false, message: "Ligação ao GoHighLevel indisponível no servidor." };
  if (e.calendarId) {
    const r = await ghlFetch<{ calendars?: { id?: string }[] }>(cfg, "calendars/", {
      query: { locationId: cfg.locationId },
    });
    if (!r.ok || !Array.isArray(r.data.calendars))
      return { ok: false, message: "Não foi possível verificar a agenda." };
    if (!r.data.calendars.some((c) => c?.id === e.calendarId))
      return { ok: false, message: "A agenda indicada não pertence a esta location." };
  }
  if (e.fallbackUserId) {
    const ok = await utilizadorNaLocation(cfg, e.fallbackUserId);
    if (ok === null)
      return { ok: false, message: "Não foi possível verificar o utilizador de reserva." };
    if (!ok) return { ok: false, message: "O utilizador de reserva não pertence a esta location." };
  }
  const r = await db.from("n8n_bridge_settings").upsert(
    {
      organization_id: a.org,
      calendar_id: e.calendarId,
      channel: e.channel,
      clinic_address: e.clinicAddress,
      fallback_user_id: e.fallbackUserId,
      updated_at: new Date().toISOString(),
      updated_by: ctx.userId,
    },
    { onConflict: "organization_id" },
  );
  if (r.error)
    return {
      ok: false,
      message: "Configuração não guardada: a migração da ponte ainda não está aplicada.",
    };
  return { ok: true, message: "Configuração guardada. A ponte continua desligada." };
}
