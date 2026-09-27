import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolverAcesso, type DepsAcesso } from "./ghl.functions";
import { JEV_URL, MENSAGENS_JEV, categoriaDoStatus, type CategoriaJev } from "./jev.core";
import {
  classificarSchema,
  interpretarClassificacao,
  pedidoClassificacao,
  type Classificacao,
  type ModeloCandidato,
} from "./jev-pedidos.core";

type Ctx = { supabase: SupabaseClient; userId: string };

export type DepsClassificar = {
  acesso?: DepsAcesso;
  lerChave?: () => string | undefined;
  fetch?: typeof fetch;
};

export type RespostaClassificar =
  | { ok: true; classificacao: Classificacao }
  | { ok: false; categoria: CategoriaJev; message: string };

const falha = (categoria: CategoriaJev): RespostaClassificar => ({
  ok: false,
  categoria,
  message: MENSAGENS_JEV[categoria],
});

/** Botão manual: autoriza, lê a biblioteca, chama o Jev. Sem escrita no CRM/funil. */
export async function classificarHandler(ctx: Ctx, texto: string, deps: DepsClassificar = {}): Promise<RespostaClassificar> {
  const acesso = await resolverAcesso(ctx, ["administrador", "gestor", "comercial"], deps.acesso);
  if (!acesso.ok) return falha("sem_permissao");
  const { orgId, nome } = acesso.acesso;
  const chave = (deps.lerChave ?? (() => process.env["LOVABLE_API_KEY"]))();
  if (!chave) return falha("sem_chave");

  const { data: linhas } = await ctx.supabase
    .from("message_templates")
    .select("id,name,usage_note,body")
    .eq("organization_id", orgId)
    .eq("is_demo", false)
    .eq("lifecycle", "draft")
    .order("created_at")
    .limit(40);
  const modelos: ModeloCandidato[] = (linhas ?? []).map((l) => ({
    id: String(l.id),
    name: String(l.name),
    usage_note: String(l.usage_note ?? ""),
    body: String(l.body ?? ""),
  }));

  const inicio = Date.now();
  let resultado: RespostaClassificar;
  try {
    const res = await (deps.fetch ?? fetch)(JEV_URL, {
      method: "POST",
      redirect: "manual",
      headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json", "X-Lovable-AIG-SDK": "fetch" },
      body: JSON.stringify(pedidoClassificacao(texto, modelos)),
    });
    if (!res.ok) resultado = falha(res.status >= 300 && res.status < 400 ? "resposta_invalida" : categoriaDoStatus(res.status));
    else {
      const c = interpretarClassificacao(await res.json().catch(() => null), modelos);
      resultado = c ? { ok: true, classificacao: c } : falha("resposta_invalida");
    }
  } catch {
    resultado = falha("indisponivel");
  }

  // Auditoria sem texto do paciente nem identificadores de contacto.
  await ctx.supabase.from("audit_logs").insert({
    organization_id: orgId,
    actor_id: ctx.userId,
    actor_name: nome,
    action: "jev.classificar_pedido",
    entity: "jev",
    metadata: resultado.ok
      ? {
          categoria: "ok",
          classe: resultado.classificacao.categoria,
          acao: resultado.classificacao.acao,
          revisao_humana: resultado.classificacao.revisao_humana,
          latencia_ms: Date.now() - inicio,
        }
      : { categoria: resultado.categoria, latencia_ms: Date.now() - inicio },
  });
  return resultado;
}

export const classificarPedido = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(classificarSchema)
  .handler(({ data, context }) => classificarHandler(context as unknown as Ctx, data.texto));
