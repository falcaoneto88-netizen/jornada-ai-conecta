import { z } from "zod";

/** Dados mínimos do paciente enviados ao modelo. Sem telefone, e-mail ou identificadores. */
export const briefingSchema = z.object({
  primeiro_nome: z.string().trim().min(1).max(60),
  etapa: z.string().trim().max(80),
  origem: z.string().trim().max(80),
  canal: z.string().trim().max(40),
  proxima_acao: z.string().trim().max(200),
  agendamento: z.string().trim().max(60).nullable(),
  tags: z.array(z.string().trim().max(60)).max(20),
  historico: z
    .array(
      z.object({
        data: z.string().trim().max(30),
        titulo: z.string().trim().max(120),
        detalhe: z.string().trim().max(400),
      }),
    )
    .max(20),
});

export type EntradaBriefing = z.infer<typeof briefingSchema>;

export const resultadoBriefingSchema = z.object({
  interesses: z.array(z.string().min(1)).min(1).max(6),
  duvidas: z.array(z.string().min(1)).min(1).max(6),
  proximo_passo: z.string().min(1),
  revisao_clinica: z.boolean(),
});

export type ResultadoBriefing = z.infer<typeof resultadoBriefingSchema>;

export const SISTEMA_BRIEFING = `És o apoio de bastidores da equipa de atendimento da clínica do Dr. João Falcão (medicina estética, emagrecimento, composição corporal e alta performance).
Produzes um briefing curto, clínico-comercial, em português, para a equipa ler antes de falar com o paciente.
REGRAS OBRIGATÓRIAS:
- NUNCA fazes diagnóstico, prescrição, indicação clínica ou promessa de resultado.
- Não inventas preços, datas, disponibilidades nem procedimentos que não constem do histórico.
- Se o histórico referir sintoma, queixa física ou urgência, define "revisao_clinica": true.
- Frases curtas, profissionais e discretas. Sem emojis.
Responde SEMPRE em JSON válido, sem texto fora do JSON, com esta forma:
{"interesses":["..."],"duvidas":["..."],"proximo_passo":"","revisao_clinica":true|false}`;

export function promptBriefing(entrada: EntradaBriefing): string {
  return `Ficha do paciente (dados internos, sem contactos):\n${JSON.stringify(entrada, null, 2)}`;
}

/** Extrai o JSON do texto devolvido pelo modelo. */
export function interpretarBriefing(bruto: string): ResultadoBriefing | null {
  const limpo = bruto.replace(/```json|```/g, "").trim();
  try {
    return resultadoBriefingSchema.parse(JSON.parse(limpo));
  } catch {
    return null;
  }
}

/** Junta o texto de uma resposta do endpoint /v1/responses. */
export function textoDaResposta(json: unknown): string {
  const raiz = json as {
    output_text?: string;
    output?: { content?: { type?: string; text?: string }[] }[];
  } | null;
  if (!raiz) return "";
  if (typeof raiz.output_text === "string" && raiz.output_text.trim()) return raiz.output_text;
  const partes: string[] = [];
  for (const item of raiz.output ?? [])
    for (const c of item.content ?? [])
      if (c?.type === "output_text" && typeof c.text === "string") partes.push(c.text);
  return partes.join("\n").trim();
}
