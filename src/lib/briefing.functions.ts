import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolverAcesso, type DepsAcesso } from "./ghl.functions";
import {
  briefingSchema,
  interpretarBriefing,
  promptBriefing,
  SISTEMA_BRIEFING,
  textoDaResposta,
  type EntradaBriefing,
  type ResultadoBriefing,
} from "./briefing.core";

const URL_IA = "https://ai.gateway.lovable.dev/v1/responses";
const MODELO = "openai/gpt-6-astra";

type Ctx = { supabase: SupabaseClient; userId: string };

export type DepsBriefing = {
  acesso?: DepsAcesso;
  lerChave?: () => string | undefined;
  fetch?: typeof fetch;
};

export type RespostaBriefing =
  | { ok: true; briefing: ResultadoBriefing }
  | { ok: false; code: string; message: string };

const falha = (code: string, message: string): RespostaBriefing => ({ ok: false, code, message });

export async function briefingHandler(
  ctx: Ctx,
  entrada: EntradaBriefing,
  deps: DepsBriefing = {},
): Promise<RespostaBriefing> {
  const acesso = await resolverAcesso(ctx, ["administrador", "gestor", "comercial"], deps.acesso);
  if (!acesso.ok) return falha("sem_permissao", "Sem permissão para gerar o briefing.");
  const { orgId, nome } = acesso.acesso;

  const chave = (deps.lerChave ?? (() => process.env["LOVABLE_API_KEY"]))();
  if (!chave) return falha("ia_nao_configurada", "IA não configurada no backend.");

  const inicio = Date.now();
  let resultado: RespostaBriefing;
  try {
    const res = await (deps.fetch ?? fetch)(URL_IA, {
      method: "POST",
      redirect: "manual",
      headers: {
        Authorization: `Bearer ${chave}`,
        "Content-Type": "application/json",
        "X-Lovable-AIG-SDK": "fetch",
      },
      body: JSON.stringify({
        model: MODELO,
        store: false,
        reasoning: { effort: "low", summary: "auto" },
        input: [
          { role: "system", content: SISTEMA_BRIEFING },
          { role: "user", content: promptBriefing(entrada) },
        ],
      }),
    });

    if (res.status === 429)
      resultado = falha(
        "limite_taxa",
        "Limite de pedidos de IA atingido. Tente novamente em instantes.",
      );
    else if (res.status === 402)
      resultado = falha("sem_creditos", "Sem créditos de IA disponíveis no workspace.");
    else if (res.status === 401 || res.status === 403)
      resultado = falha("sem_acesso", "A IA recusou o pedido. Verifique o acesso do workspace.");
    else if (!res.ok) resultado = falha("erro_ia", "A IA não conseguiu responder neste momento.");
    else {
      const texto = textoDaResposta(await res.json().catch(() => null));
      const briefing = interpretarBriefing(texto);
      resultado = briefing
        ? { ok: true, briefing }
        : falha("resposta_invalida", "A resposta da IA não pôde ser lida.");
    }
  } catch {
    resultado = falha("indisponivel", "Não foi possível contactar a IA.");
  }

  // Auditoria sem dados do paciente.
  await ctx.supabase.from("audit_logs").insert({
    organization_id: orgId,
    actor_id: ctx.userId,
    actor_name: nome,
    action: "ia.briefing_pre_consulta",
    entity: "briefing",
    metadata: resultado.ok
      ? {
          categoria: "ok",
          revisao_clinica: resultado.briefing.revisao_clinica,
          latencia_ms: Date.now() - inicio,
        }
      : { categoria: resultado.code, latencia_ms: Date.now() - inicio },
  });

  return resultado;
}

export const gerarBriefing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(briefingSchema)
  .handler(({ data, context }) => briefingHandler(context as unknown as Ctx, data));
