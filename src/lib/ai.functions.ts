import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SISTEMA = `És o assistente de apoio comercial da clínica do Dr. João Falcão (medicina estética, emagrecimento, composição corporal e alta performance).
Objetivo: apoiar a equipa de atendimento a responder com clareza, acolhimento e tom premium, favorecendo o agendamento.
REGRAS OBRIGATÓRIAS:
- NUNCA fazes diagnóstico, prescrição, indicação clínica ou promessa de resultado.
- Se o tema for clínico, sensível ou de urgência, indicas explicitamente que precisa de revisão por profissional de saúde.
- Não inventas preços, disponibilidades, datas ou condições. Usa marcadores como [valor a confirmar].
- Português europeu ou do Brasil conforme a conversa. Frases curtas, humanas e profissionais.
Responde SEMPRE em JSON válido, sem texto fora do JSON, com esta forma:
{"resumo":"","intencao":"informacao|preco|agendamento|objecao|pos_procedimento|urgencia","sentimento":"positivo|neutro|negativo","prioridade":"baixa|media|alta","revisao_humana":true|false,"sugestoes":[{"tom":"objetiva","texto":""},{"tom":"acolhedora","texto":""},{"tom":"premium","texto":""}]}`;

export type AnaliseIA = {
  resumo: string;
  intencao: string;
  sentimento: string;
  prioridade: string;
  revisao_humana: boolean;
  sugestoes: { tom: string; texto: string }[];
};

export const aiSupport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { conversa: string; contexto?: string }) => {
    if (!input?.conversa || input.conversa.length > 12000) throw new Error("Conversa inválida.");
    return input;
  })
  .handler(async ({ data }) => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) {
      return {
        ok: false as const,
        code: "ia_nao_configurada" as const,
        message: "IA não configurada. Peça ao administrador para ativar a IA no backend.",
      };
    }

    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: SISTEMA },
            {
              role: "user",
              content: `Contexto: ${data.contexto ?? "sem contexto adicional"}\n\nConversa:\n${data.conversa}`,
            },
          ],
        }),
      });

      if (res.status === 429) {
        return { ok: false as const, code: "rate_limited" as const, message: "Limite de pedidos de IA atingido. Tente novamente em instantes." };
      }
      if (res.status === 402) {
        return { ok: false as const, code: "sem_creditos" as const, message: "Sem créditos de IA disponíveis no workspace." };
      }
      if (!res.ok) {
        return { ok: false as const, code: "erro_ia" as const, message: "A IA não conseguiu responder neste momento." };
      }

      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const bruto = json.choices?.[0]?.message?.content ?? "";
      const limpo = bruto.replace(/```json|```/g, "").trim();
      const analise = JSON.parse(limpo) as AnaliseIA;
      return { ok: true as const, analise };
    } catch {
      return { ok: false as const, code: "erro_ia" as const, message: "Não foi possível interpretar a resposta da IA." };
    }
  });

const SISTEMA_TEXTO = `És redator da clínica do Dr. João Falcão. Reescreves mensagens mantendo tom acolhedor, premium, direto e humano, em frases curtas.
REGRAS: não inventes preços, datas, condições clínicas nem promessas de resultado; mantém todas as variáveis no formato {{variavel}} exatamente como estão; devolve apenas o texto final, sem aspas nem comentários.`;

/** Melhora o texto de um modelo de mensagem preservando variáveis. */
export const melhorarTexto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { texto: string }) => {
    if (!input?.texto || input.texto.length > 6000) throw new Error("Texto inválido.");
    return input;
  })
  .handler(async ({ data }) => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) {
      return {
        ok: false as const,
        code: "ia_nao_configurada" as const,
        message: "IA não configurada. Peça ao administrador para ativar a IA no backend.",
      };
    }
    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: SISTEMA_TEXTO },
            { role: "user", content: data.texto },
          ],
        }),
      });
      if (res.status === 429) {
        return { ok: false as const, code: "rate_limited" as const, message: "Limite de pedidos de IA atingido." };
      }
      if (res.status === 402) {
        return { ok: false as const, code: "sem_creditos" as const, message: "Sem créditos de IA disponíveis." };
      }
      if (!res.ok) {
        return { ok: false as const, code: "erro_ia" as const, message: "A IA não conseguiu responder neste momento." };
      }
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const texto = (json.choices?.[0]?.message?.content ?? "").trim();
      if (!texto) return { ok: false as const, code: "erro_ia" as const, message: "A IA devolveu uma resposta vazia." };
      return { ok: true as const, texto };
    } catch {
      return { ok: false as const, code: "erro_ia" as const, message: "Falha ao contactar a IA." };
    }
  });
