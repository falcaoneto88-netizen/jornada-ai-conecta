import { describe, expect, it } from "vitest";
import { interpretarClassificacao, pedidoClassificacao } from "./jev-pedidos.core";

const modelos = [{ id: "u1", name: "Confirmação", usage_note: "confirmar consulta", body: "Olá {{contact.first_name}}" }];
const resp = (cat: string, acao: string, noul: number, modelo = "m0") => ({
  model: "typesafe/jev-1.13",
  answers: {
    categoria: { choice: cat, confidence: 0.9 },
    acao: { choice: acao, confidence: 0.8 },
    sintoma: { noul },
    modelo: { choice: modelo, confidence: 0.7 },
  },
});

describe("classificação de pedidos", () => {
  it("não envia IDs internos da biblioteca ao modelo", () => {
    const p = JSON.stringify(pedidoClassificacao("olá", modelos));
    expect(p).not.toContain("u1");
    expect(p).toContain('"m0"');
  });
  it("mapeia o modelo sugerido", () => {
    const c = interpretarClassificacao(resp("agendamento", "responder_modelo", 0.1), modelos);
    expect(c?.modelo_sugerido?.id).toBe("u1");
    expect(c?.revisao_humana).toBe(false);
  });
  it("sintoma força encaminhamento ao médico e sem rascunho", () => {
    const c = interpretarClassificacao(resp("pos_procedimento", "responder_modelo", 0.8), modelos);
    expect(c?.acao).toBe("encaminhar_medico");
    expect(c?.modelo_sugerido).toBeNull();
  });
  it("recusa categorias desconhecidas", () => {
    expect(interpretarClassificacao(resp("x", "sem_acao", 0), modelos)).toBeNull();
  });
});
