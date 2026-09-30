/** Leitura/gravação da configuração NÃO secreta da ponte, só para administradores. */
import type { ConfigEntrada } from "./n8n-bridge.schema";

import { randomBytes, createHash } from "crypto";

import { envTokenValido } from "./n8n-bridge.core";
import {
  configGhl,
  lerConfigBridge,
  lerCredencialBridge,
  resolverEscopo,
  utilizadorNaLocation,
  type ClienteBridge,
} from "./n8n-bridge.server";
import { ghlFetch } from "./ghl.server";

export type Sessao = {
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
  /** Token de ambiente válido OU credencial por organização guardada. */
  tokenPresente: boolean;
  /** Criação guiada disponível: sem token de ambiente, schema presente, sem credencial, binding ok. */
  podeCriarChave: boolean;
  credentialSchemaAvailable: boolean;
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
  zaptosProviderId: string | null;
  channelVerified: boolean;
  smsRouteConfigured: false;
};

const NEGADO: EstadoPonteN8n = {
  autorizado: false,
  tokenPresente: false,
  podeCriarChave: false,
  credentialSchemaAvailable: false,
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
  zaptosProviderId: null,
  channelVerified: false,
  smsRouteConfigured: false,
};

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as ClienteBridge;
}

/** Sessão real + papel administrador + organização da sessão igual à org da ponte. */
export async function autorizar(ctx: Sessao, db: ClienteBridge) {
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

export async function lerEstadoPonte(
  ctx: Sessao,
  dbInjetado?: ClienteBridge,
): Promise<EstadoPonteN8n> {
  const db = dbInjetado ?? (await admin());
  const a = await autorizar(ctx, db);
  if (!a) return NEGADO;
  const envRaw = process.env["N8N_JORNADA_BRIDGE_TOKEN"];
  const envOk = envTokenValido(envRaw);
  const cred = await lerCredencialBridge(db, a.org).catch(() => ({ ok: false as const }));
  const credOk = cred.ok && cred.digest !== null;
  const lida = await lerConfigBridge(db, a.org).catch(() => ({ ok: false as const }));
  const cfg = lida.ok ? lida.cfg : null;
  return {
    autorizado: true,
    tokenPresente: envOk || (!envRaw && credOk && a.escopo !== null),
    podeCriarChave: !envRaw && cred.ok && cred.digest === null && a.escopo !== null,
    credentialSchemaAvailable: cred.ok,
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
    zaptosProviderId: cfg?.zaptosProviderId ?? null,
    channelVerified: cfg?.channelVerified ?? false,
    smsRouteConfigured: false,
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
  const atual = await lerConfigBridge(db, a.org).catch(() => ({ ok: false as const }));
  if (!atual.ok)
    return {
      ok: false,
      message: "Configuração não guardada: a migração da ponte ainda não está aplicada.",
    };
  const mudouCanal =
    atual.cfg.channel !== e.channel || atual.cfg.zaptosProviderId !== e.zaptosProviderId;
  const r = await db.from("n8n_bridge_settings").upsert(
    {
      zaptos_provider_id: e.zaptosProviderId,
      // Alterar canal ou provedor invalida qualquer verificação anterior. O formulário nunca marca true.
      ...(mudouCanal ? { channel_verified: false } : {}),
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
  return { ok: true, message: "Configuração guardada; estado de ativação não alterado." };
}

/** Origens de confiança para a mutação (CSRF): produção e pré-visualização exata do projeto. */
export const ORIGENS_CONFIAVEIS = [
  "https://jornada-ai-conecta.lovable.app",
  "https://id-preview--36345211-2616-42f7-bb9e-e78a9d00ca22.lovable.app",
] as const;

export function origemConfiavel(headers: Headers): boolean {
  const origin = headers.get("origin");
  if (!origin || !(ORIGENS_CONFIAVEIS as readonly string[]).includes(origin)) return false;
  const site = headers.get("sec-fetch-site");
  return site === null || site === "same-origin";
}

export type ResultadoChave =
  | { ok: true; key: string }
  | {
      ok: false;
      code: "forbidden" | "untrusted_origin" | "unavailable" | "exists" | "failed";
      message: string;
    };

/**
 * Cria a credencial por organização (create-only). Persiste só o SHA-256 e devolve a chave em
 * claro uma única vez. Qualquer falha de persistência -> nenhuma chave devolvida.
 */
export async function criarChaveBridge(
  ctx: Sessao,
  headers: Headers,
  dbInjetado?: ClienteBridge,
  gerar: () => Buffer = () => randomBytes(32),
): Promise<ResultadoChave> {
  if (!origemConfiavel(headers))
    return {
      ok: false,
      code: "untrusted_origin",
      message: "Pedido recusado: origem não confiável.",
    };
  const db = dbInjetado ?? (await admin());
  const a = await autorizar(ctx, db);
  if (!a) return { ok: false, code: "forbidden", message: "Acesso reservado a administradores." };
  if (!a.escopo)
    return {
      ok: false,
      code: "unavailable",
      message: "Vínculo GoHighLevel não confirmado no servidor.",
    };
  if (process.env["N8N_JORNADA_BRIDGE_TOKEN"])
    return {
      ok: false,
      code: "unavailable",
      message: "Já existe uma chave configurada no servidor; não é possível criar outra aqui.",
    };
  const atual = await lerCredencialBridge(db, a.org).catch(() => ({ ok: false as const }));
  if (!atual.ok)
    return {
      ok: false,
      code: "unavailable",
      message: "Criação indisponível: a migração das chaves ainda não está aplicada.",
    };
  if (atual.digest !== null)
    return {
      ok: false,
      code: "exists",
      message: "A chave já foi criada e não pode ser mostrada de novo.",
    };
  const bytes = gerar();
  if (bytes.length !== 32)
    return { ok: false, code: "failed", message: "Não foi possível criar a chave." };
  const key = bytes.toString("hex");
  const digest = createHash("sha256").update(key).digest("hex");
  let r: { error: { code?: string } | null };
  try {
    r = await db.from("n8n_bridge_credentials").insert({
      organization_id: a.org,
      key_sha256: digest,
      created_by: ctx.userId,
    });
  } catch {
    return { ok: false, code: "failed", message: "Não foi possível guardar a chave." };
  }
  if (r.error)
    return r.error.code === "23505"
      ? {
          ok: false,
          code: "exists",
          message: "A chave já foi criada e não pode ser mostrada de novo.",
        }
      : { ok: false, code: "failed", message: "Não foi possível guardar a chave." };
  // Confirma a persistência lendo o digest de volta antes de devolver a chave.
  const conf = await lerCredencialBridge(db, a.org).catch(() => ({ ok: false as const }));
  if (!conf.ok || conf.digest !== digest)
    return { ok: false, code: "failed", message: "Não foi possível confirmar a chave guardada." };
  return { ok: true, key };
}
