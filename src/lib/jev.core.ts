import { z } from "zod";

/** Contrato OpenRouter Decisions (alpha) para o Jev da TypeSafe. Destino fixo. */
export const JEV_URL = "https://openrouter.ai/api/alpha/decisions";
export const JEV_MODELO = "typesafe/jev-1.13";
export const JEV_MENSAGEM_FICTICIA = "Gostaria de saber os horários disponíveis para uma consulta";
export const JEV_OPCOES = ["agendamento", "preco", "outro"] as const;

export type CategoriaJev =
  | "ok"
  | "sem_chave"
  | "nao_autorizado"
  | "saldo_insuficiente"
  | "limite_taxa"
  | "timeout"
  | "erro_servidor"
  | "resposta_invalida"
  | "indisponivel"
  | "sem_permissao";

export const MENSAGENS_JEV: Record<CategoriaJev, string> = {
  ok: "Chamada autenticada concluída e resposta validada.",
  sem_chave: "Chave OpenRouter não configurada no backend.",
  nao_autorizado: "A OpenRouter recusou a chave (401/403). Verifique a chave ou as permissões.",
  saldo_insuficiente: "Saldo insuficiente na conta OpenRouter (402).",
  limite_taxa: "Limite de pedidos atingido (429). Tente mais tarde.",
  timeout: "A OpenRouter não respondeu a tempo.",
  erro_servidor: "Erro temporário do serviço (5xx).",
  resposta_invalida: "A resposta não corresponde ao formato esperado do Jev.",
  indisponivel: "Não foi possível contactar a OpenRouter.",
  sem_permissao: "Reservado ao administrador de uma organização com vínculo autorizado.",
};

export function pedidoTeste() {
  return {
    model: JEV_MODELO,
    state: { mensagem: JEV_MENSAGEM_FICTICIA },
    questions: {
      intencao: {
        type: "choice",
        instructions: "Qual é a intenção principal de `mensagem`?",
        criteria: {
          agendamento: "Pedido de marcação, horários ou disponibilidade para consulta",
          preco: "Pergunta sobre valores, preços ou pagamento",
          outro: "Qualquer outro assunto",
        },
      },
      pergunta_horario: {
        type: "noul",
        instructions: "`mensagem` pergunta por horários disponíveis?",
      },
    },
  } as const;
}

const prob = z.number().finite().min(0).max(1);

const respostaSchema = z.object({
  model: z.string().min(1),
  answers: z.object({
    intencao: z.object({
      type: z.literal("choice"),
      choice: z.enum(JEV_OPCOES),
      probabilities: z.record(z.string(), prob),
      confidence: prob,
    }),
    pergunta_horario: z.object({ type: z.literal("noul"), noul: prob }),
  }),
});

export type ResultadoValidado = {
  modelo: string;
  escolha: (typeof JEV_OPCOES)[number];
  confianca: number;
  noul: number;
};

/** Valida estrutura, modelo Jev, enum e probabilidades. Nunca devolve o corpo bruto. */
export function validarResposta(corpo: unknown): ResultadoValidado | null {
  const r = respostaSchema.safeParse(corpo);
  if (!r.success) return null;
  const { model, answers } = r.data;
  if (!model.startsWith("typesafe/jev-")) return null;
  const chaves = Object.keys(answers.intencao.probabilities).sort();
  if (chaves.join(",") !== [...JEV_OPCOES].sort().join(",")) return null;
  const soma = Object.values(answers.intencao.probabilities).reduce((a, b) => a + b, 0);
  if (Math.abs(soma - 1) > 0.02) return null;
  return {
    modelo: model.slice(0, 64),
    escolha: answers.intencao.choice,
    confianca: answers.intencao.confidence,
    noul: answers.pergunta_horario.noul,
  };
}

export function categoriaDoStatus(status: number): CategoriaJev {
  if (status === 401 || status === 403) return "nao_autorizado";
  if (status === 402) return "saldo_insuficiente";
  if (status === 429) return "limite_taxa";
  if (status >= 500) return "erro_servidor";
  return "resposta_invalida";
}

/** Retry-After em ms (segundos ou data HTTP), limitado ao teto. */
export function esperaRetry(valor: string | null, tentativa: number, tetoMs = 3000): number {
  if (valor) {
    const s = Number(valor);
    if (Number.isFinite(s) && s >= 0) return Math.min(s * 1000, tetoMs);
    const d = Date.parse(valor);
    if (Number.isFinite(d)) return Math.min(Math.max(d - Date.now(), 0), tetoMs);
  }
  return Math.min(400 * 2 ** tentativa, tetoMs);
}

export type TesteRegistado = {
  categoria: CategoriaJev;
  em: string;
  modelo: string | null;
  latencia_ms: number | null;
};

export type EstadoJev =
  | { tipo: "sem_chave" }
  | { tipo: "sem_teste" }
  | { tipo: "sucesso"; ultimo: TesteRegistado }
  | { tipo: "falha"; ultimo: TesteRegistado; ultimoSucesso: TesteRegistado | null };

/** O teste mais recente prevalece; um sucesso anterior é apenas histórico. */
export function derivarEstado(
  chavePresente: boolean,
  ultimo: TesteRegistado | null,
  ultimoSucesso: TesteRegistado | null,
): EstadoJev {
  if (!chavePresente) return { tipo: "sem_chave" };
  if (!ultimo) return { tipo: "sem_teste" };
  if (ultimo.categoria === "ok") return { tipo: "sucesso", ultimo };
  return { tipo: "falha", ultimo, ultimoSucesso };
}
