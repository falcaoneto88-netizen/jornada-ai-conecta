import { z } from "zod";
import { JEV_MODELO } from "./jev.core";

/** Classificação de pedidos de pacientes pelo Jev. Só sugere; nunca escreve no CRM. */
export const CATEGORIAS = {
  agendamento: "Marcar, remarcar ou cancelar consulta; horários ou disponibilidade",
  preco: "Valores, orçamento, formas de pagamento ou condições",
  duvida_procedimento: "Dúvida geral sobre um procedimento ou tratamento, antes de o realizar",
  pos_procedimento: "Acompanhamento depois de um procedimento já realizado, sem sintoma preocupante",
  urgencia: "Relato de dor intensa, febre, inchaço anormal, reação ou outro sintoma preocupante",
  administrativo: "Documentos, faturas, morada, reembolsos ou outros assuntos administrativos",
  outro: "Nenhuma das anteriores, saudação ou mensagem sem pedido claro",
} as const;
export type Categoria = keyof typeof CATEGORIAS;

export const ROTULO_CATEGORIA: Record<Categoria, string> = {
  agendamento: "Agendamento",
  preco: "Preço / orçamento",
  duvida_procedimento: "Dúvida sobre procedimento",
  pos_procedimento: "Pós-procedimento",
  urgencia: "Urgência / sintoma",
  administrativo: "Administrativo",
  outro: "Outro",
};

export const ACOES = {
  responder_modelo: "Responder com uma mensagem da biblioteca",
  propor_horarios: "Propor horários de consulta",
  encaminhar_medico: "Encaminhar para revisão de um profissional de saúde",
  encaminhar_equipa: "Encaminhar para a equipa administrativa ou comercial",
  sem_acao: "Nenhuma resposta necessária",
} as const;
export type Acao = keyof typeof ACOES;

export const ROTULO_ACAO: Record<Acao, string> = {
  responder_modelo: "Responder com modelo",
  propor_horarios: "Propor horários",
  encaminhar_medico: "Encaminhar ao médico",
  encaminhar_equipa: "Encaminhar à equipa",
  sem_acao: "Sem ação",
};

export type ModeloCandidato = { id: string; name: string; usage_note: string };

export const classificarSchema = z
  .object({ texto: z.string().trim().min(1).max(4000) })
  .strict();

/** Aliases curtos (m0…) para os modelos: IDs internos não seguem para o modelo. */
export function pedidoClassificacao(texto: string, modelos: readonly ModeloCandidato[]) {
  const criteriosModelo: Record<string, string> = {};
  modelos.forEach((m, i) => {
    criteriosModelo[`m${i}`] = `${m.name}${m.usage_note ? ` — ${m.usage_note}` : ""}`.slice(0, 400);
  });
  criteriosModelo["nenhum"] = "Nenhuma mensagem da biblioteca responde adequadamente ao pedido";
  return {
    model: JEV_MODELO,
    state: { mensagem_paciente: texto },
    questions: {
      categoria: {
        type: "choice",
        instructions: "Qual é o assunto principal de `mensagem_paciente`, enviada a uma clínica de medicina estética?",
        criteria: CATEGORIAS,
      },
      acao: {
        type: "choice",
        instructions: "Qual deve ser a próxima ação da equipa da clínica perante `mensagem_paciente`?",
        criteria: ACOES,
      },
      sintoma: {
        type: "noul",
        instructions: "`mensagem_paciente` relata um sintoma, dor, reação ou complicação física?",
        criteria: {
          true: "Descreve algo físico que o paciente sente ou observa no corpo",
          false: "Não descreve sintomas; perguntas gerais sobre procedimentos não contam",
        },
      },
      modelo: {
        type: "choice",
        instructions: "Qual mensagem da biblioteca da clínica melhor serve de rascunho de resposta a `mensagem_paciente`?",
        criteria: criteriosModelo,
      },
    },
  };
}

const prob = z.number().finite().min(0).max(1);
const escolha = z.object({ choice: z.string(), confidence: prob });
const respostaSchema = z.object({
  model: z.string().min(1),
  answers: z.object({
    categoria: escolha,
    acao: escolha,
    sintoma: z.object({ noul: prob }),
    modelo: escolha,
  }),
});

export type Classificacao = {
  modelo_ia: string;
  categoria: Categoria;
  confianca_categoria: number;
  acao: Acao;
  confianca_acao: number;
  prob_sintoma: number;
  revisao_humana: boolean;
  modelo_sugerido: ModeloCandidato | null;
};

/** Valida a resposta e aplica a política da clínica em código (sintoma → médico). */
export function interpretarClassificacao(
  corpo: unknown,
  modelos: readonly ModeloCandidato[],
): Classificacao | null {
  const r = respostaSchema.safeParse(corpo);
  if (!r.success || !r.data.model.startsWith("typesafe/jev-")) return null;
  const a = r.data.answers;
  if (!Object.hasOwn(CATEGORIAS, a.categoria.choice) || !Object.hasOwn(ACOES, a.acao.choice)) return null;
  const categoria = a.categoria.choice as Categoria;
  let acao = a.acao.choice as Acao;
  const revisao = categoria === "urgencia" || a.sintoma.noul >= 0.5;
  if (revisao) acao = "encaminhar_medico";
  const idx = /^m(\d+)$/.exec(a.modelo.choice);
  const sugerido = !revisao && idx ? (modelos[Number(idx[1])] ?? null) : null;
  return {
    modelo_ia: r.data.model.slice(0, 64),
    categoria,
    confianca_categoria: a.categoria.confidence,
    acao,
    confianca_acao: a.acao.confidence,
    prob_sintoma: a.sintoma.noul,
    revisao_humana: revisao,
    modelo_sugerido: sugerido,
  };
}
