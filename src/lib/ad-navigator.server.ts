/**
 * Ponte Jornada -> Ad Navigator (v1) — camada server-only.
 *
 * O código de pareamento e o bearer do recetor NUNCA são persistidos nem
 * registados: guardamos apenas SHA256. Erros para fora são sanitizados.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { SondaPonte } from "./ad-navigator-prontidao";

import {
  AD_NAV_CODE_PREFIX,
  AD_NAV_CODE_TTL_SEGUNDOS,
  HEX64,
  montarResposta,
  normalizarResumo,
  type RespostaResumo,
} from "./ad-navigator.core";

export const AD_NAV_RATE_LIMITE = 30;
/** Teto da rota inteira por janela: impede crescimento por chaves aleatórias. */
export const AD_NAV_TETO_ROTA = 600;
export const AD_NAV_RATE_JANELA_SEGUNDOS = 60;

export type RotaAdNav = "exchange" | "summary";

export function sha256hex(valor: string): string {
  return createHash("sha256").update(valor, "utf8").digest("hex");
}

/** Código de uso único: 32 bytes aleatórios em base64url (43 caracteres). */
export function gerarCodigoPareamento(): string {
  return `${AD_NAV_CODE_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function compararHex(a: string, b: string): boolean {
  if (!HEX64.test(a) || !HEX64.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

type ClienteRpc = Pick<SupabaseClient, "rpc">;

async function admin(): Promise<ClienteRpc> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as ClienteRpc;
}

/**
 * Limite de abuso persistente: teto da rota avaliado antes do balde derivado
 * do segredo apresentado. Sem IP, sem cabeçalhos do cliente e sem PII — nada
 * enviado pelo chamador pode aumentar o que lhe é permitido.
 */
export async function limitePermitido(
  rota: RotaAdNav,
  chaveBruta: string,
  cliente?: ClienteRpc,
): Promise<boolean> {
  const c = cliente ?? (await admin());
  const { data, error } = await c.rpc("ad_navigator_rate_hit_v2", {
    _route: rota,
    _bucket_key: sha256hex(`${rota}:${chaveBruta}`),
    _limit: AD_NAV_RATE_LIMITE,
    _route_limit: AD_NAV_TETO_ROTA,
    _window_seconds: AD_NAV_RATE_JANELA_SEGUNDOS,
  });
  if (error) return false;
  return data === true;
}

export type ResultadoTroca =
  { ok: true; body: Record<string, unknown> } | { ok: false; status: number; erro: string };

export async function trocarCodigo(
  pedido: { code: string; receiver_tenant_id: string; credential_hash: string },
  cliente?: ClienteRpc,
): Promise<ResultadoTroca> {
  const c = cliente ?? (await admin());
  const { data, error } = await c.rpc("ad_navigator_exchange", {
    _code_sha256: sha256hex(pedido.code),
    _receiver_tenant_id: pedido.receiver_tenant_id,
    _credential_hash: pedido.credential_hash,
  });
  if (error || data === null || typeof data !== "object") {
    // Sem detalhe do servidor: qualquer recusa é indistinguível do exterior.
    return { ok: false, status: 400, erro: "pareamento_invalido" };
  }
  return { ok: true, body: data as Record<string, unknown> };
}

export type ResultadoResumo =
  { ok: true; body: RespostaResumo } | { ok: false; status: number; erro: string };

export async function lerResumo(
  bearer: string,
  cliente?: ClienteRpc,
  agora: Date = new Date(),
): Promise<ResultadoResumo> {
  const c = cliente ?? (await admin());
  // Só o hash é procurado no servidor; o bearer nunca é escrito em lado nenhum.
  const { data, error } = await c.rpc("ad_navigator_summary", {
    _credential_hash: sha256hex(bearer),
  });
  if (error || data === null || typeof data !== "object") {
    return { ok: false, status: 401, erro: "credencial_invalida" };
  }
  const resumo = normalizarResumo(data);
  if (!resumo) return { ok: false, status: 500, erro: "resumo_indisponivel" };
  return { ok: true, body: montarResposta(resumo, sha256hex, agora) };
}

type ClienteSessao = Pick<SupabaseClient, "rpc">;

export type EstadoAdNavigator = {
  organization_id: string;
  organization_name: string | null;
  location_id: string | null;
  pipeline_id: string | null;
  binding_ok: boolean;
  connection_ok: boolean;
  scope: string;
  pending_pairing: { pairing_id: string; expires_at: string; created_at: string } | null;
  grants: Array<{
    grant_id: string;
    receiver_tenant_id: string;
    created_at: string;
    expires_at: string;
    revoked_at: string | null;
    last_used_at: string | null;
    use_count: number;
    scope: string;
  }>;
};

export async function lerEstadoAdNavigator(
  supabase: ClienteSessao,
): Promise<{ ok: true; estado: EstadoAdNavigator } | { ok: false; message: string }> {
  const { data, error } = await supabase.rpc("ad_navigator_state");
  if (error || data === null || typeof data !== "object") {
    return { ok: false, message: "Estado indisponível." };
  }
  return { ok: true, estado: data as unknown as EstadoAdNavigator };
}

/**
 * Gera o código de uso único. O valor em claro é devolvido UMA vez para o
 * administrador copiar; no servidor fica só o SHA256.
 */
export type DetalhePareamento = {
  pairing_id: string;
  organization_id: string;
  organization_name: string | null;
  location_id: string;
  pipeline_id: string;
  scope: string;
  expires_at: string;
};

export async function criarPareamentoAdNavigator(
  supabase: ClienteSessao,
): Promise<
  { ok: true; code: string; detalhe: DetalhePareamento } | { ok: false; message: string }
> {
  const code = gerarCodigoPareamento();
  const { data, error } = await supabase.rpc("ad_navigator_create_pairing", {
    _code_sha256: sha256hex(code),
    _ttl_seconds: AD_NAV_CODE_TTL_SEGUNDOS,
    _confirm: true,
  });
  if (error || data === null || typeof data !== "object") {
    return {
      ok: false,
      message:
        "Não foi possível gerar o código. Confirme que é administrador desta conta e que a ligação ao GoHighLevel está validada.",
    };
  }
  return { ok: true, code, detalhe: data as unknown as DetalhePareamento };
}

export type DetalheRevogacao = { pairings_revoked: number; grants_revoked: number };

export async function revogarAdNavigator(
  supabase: ClienteSessao,
): Promise<{ ok: true; detalhe: DetalheRevogacao } | { ok: false; message: string }> {
  const { data, error } = await supabase.rpc("ad_navigator_revoke_access", { _confirm: true });
  if (error || data === null || typeof data !== "object") {
    return { ok: false, message: "Não foi possível revogar o acesso." };
  }
  return { ok: true, detalhe: data as unknown as DetalheRevogacao };
}

/**
 * Sonda somente-leitura ao caminho autenticado da própria ponte publicada.
 * Usa um código e um bearer aleatórios que nunca existiram: confirma que a
 * troca recusa código inválido (400) e que o resumo recusa credencial
 * inválida (401). Não cria pareamento, concessão nem leitura.
 */
export async function sondarPonte(
  origem: string,
  transporte: typeof fetch = fetch,
): Promise<SondaPonte> {
  const cabecalhos = { "Content-Type": "application/json" } as const;
  try {
    const [troca, resumo] = await Promise.all([
      transporte(`${origem}/api/ad-navigator/v1/exchange`, {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(10000),
        headers: cabecalhos,
        body: JSON.stringify({
          code: gerarCodigoPareamento(),
          receiver_tenant_id: "00000000-0000-4000-8000-000000000000",
          credential_hash: sha256hex(randomBytes(32).toString("base64url")),
        }),
      }),
      transporte(`${origem}/api/ad-navigator/v1/summary`, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(10000),
        headers: { Authorization: `Bearer ${randomBytes(32).toString("base64url")}` },
      }),
    ]);
    const exchange_ok = troca.status === 400;
    const summary_ok = resumo.status === 401;
    await Promise.all([troca.body?.cancel(), resumo.body?.cancel()]);
    return {
      exchange_ok,
      summary_ok,
      motivo: exchange_ok && summary_ok ? "ok" : "resposta_inesperada",
    };
  } catch {
    return { exchange_ok: false, summary_ok: false, motivo: "indisponivel" };
  }
}

/**
 * Sonda várias origens próprias (pedido atual, loopback local e URL canónica
 * publicada) e fica pela primeira que responda como esperado. Resolve o caso
 * do preview, onde a origem do pedido não serve as rotas da ponte.
 */
export async function sondarPonteNasOrigens(
  origens: readonly string[],
  transporte: typeof fetch = fetch,
): Promise<SondaPonte> {
  let ultima: SondaPonte = { exchange_ok: false, summary_ok: false, motivo: "nao_verificado" };
  for (const origem of origens) {
    const r = await sondarPonte(origem, transporte);
    if (r.motivo === "ok") return r;
    ultima = r;
  }
  return ultima;
}

