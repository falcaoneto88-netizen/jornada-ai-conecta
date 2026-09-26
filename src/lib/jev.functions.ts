import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolverAcesso, type DepsAcesso } from "./ghl.functions";
import { derivarEstado, type CategoriaJev, type EstadoJev, type TesteRegistado } from "./jev.core";
import { testarJevServidor, type DepsJev } from "./jev.server";

type Ctx = { supabase: SupabaseClient; userId: string };
const ACAO = "jev.teste_conexao";

function paraRegisto(linha: { created_at: string; metadata: unknown } | null): TesteRegistado | null {
  if (!linha) return null;
  const m = (linha.metadata ?? {}) as Record<string, unknown>;
  return {
    categoria: (typeof m["categoria"] === "string" ? m["categoria"] : "resposta_invalida") as CategoriaJev,
    em: linha.created_at,
    modelo: typeof m["modelo"] === "string" ? m["modelo"] : null,
    latencia_ms: typeof m["latencia_ms"] === "number" ? m["latencia_ms"] : null,
  };
}

export type DepsTeste = {
  acesso?: DepsAcesso;
  lerChave?: () => string | undefined;
  jev?: DepsJev;
};

/** Estado para o cartão. Autorização antes de consultar a presença da chave. */
export async function estadoJevHandler(ctx: Ctx, deps: DepsTeste = {}): Promise<{ ok: false } | { ok: true; estado: EstadoJev }> {
  const acesso = await resolverAcesso(ctx, ["administrador"], deps.acesso);
  if (!acesso.ok) return { ok: false };
  const orgId = acesso.acesso.orgId;
  const chave = (deps.lerChave ?? (() => process.env["OPENROUTER_API_KEY"]))();
  const base = () =>
    ctx.supabase
      .from("audit_logs")
      .select("created_at, metadata")
      .eq("organization_id", orgId)
      .eq("entity", "jev")
      .eq("action", ACAO);
  const { data: ultimo } = await base().order("created_at", { ascending: false }).limit(1).maybeSingle();
  const { data: sucesso } = await base()
    .eq("metadata->>categoria", "ok")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return { ok: true, estado: derivarEstado(Boolean(chave), paraRegisto(ultimo), paraRegisto(sucesso)) };
}

/** Teste explícito: autoriza, só então lê o secret e faz a chamada fixa fictícia. */
export async function testarJevHandler(ctx: Ctx, deps: DepsTeste = {}) {
  const acesso = await resolverAcesso(ctx, ["administrador"], deps.acesso);
  if (!acesso.ok) return { ok: false as const, categoria: "sem_permissao" as CategoriaJev };
  const { orgId, nome } = acesso.acesso;
  const chave = (deps.lerChave ?? (() => process.env["OPENROUTER_API_KEY"]))();
  if (!chave) return { ok: false as const, categoria: "sem_chave" as CategoriaJev };

  const r = await testarJevServidor(chave, deps.jev);
  const em = new Date().toISOString();
  await ctx.supabase.from("audit_logs").insert({
    organization_id: orgId,
    actor_id: ctx.userId,
    actor_name: nome,
    action: ACAO,
    entity: "jev",
    metadata: { categoria: r.categoria, modelo: r.resultado?.modelo ?? null, latencia_ms: r.latencia_ms },
  });
  return {
    ok: r.categoria === "ok",
    categoria: r.categoria,
    em,
    modelo: r.resultado?.modelo ?? null,
    latencia_ms: r.latencia_ms,
    escolha: r.resultado?.escolha ?? null,
  };
}

export const estadoJev = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(({ context }) => estadoJevHandler(context as unknown as Ctx));

export const testarJev = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(({ context }) => testarJevHandler(context as unknown as Ctx));
