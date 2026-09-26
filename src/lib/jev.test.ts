import { describe, expect, it, vi } from "vitest";
import { derivarEstado, pedidoTeste, validarResposta, JEV_URL, type TesteRegistado } from "./jev.core";
import { testarJevServidor } from "./jev.server";
import { testarJevHandler, estadoJevHandler } from "./jev.functions";

const valido = {
  model: "typesafe/jev-1.13-20260917",
  answers: {
    intencao: { type: "choice", choice: "agendamento", probabilities: { agendamento: 0.97, preco: 0.02, outro: 0.01 }, confidence: 0.95 },
    pergunta_horario: { type: "noul", noul: 0.98 },
  },
  usage: { input_tokens: 10 },
};
const resp = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

describe("contrato", () => {
  it("pedido fixo usa modelo e mensagem fictícia, sem score", () => {
    const p = pedidoTeste();
    expect(p.model).toBe("typesafe/jev-1.13");
    expect(Object.keys(p.questions)).toEqual(["intencao", "pergunta_horario"]);
  });
  it("valida resposta correta", () => expect(validarResposta(valido)?.escolha).toBe("agendamento"));
  it.each([
    ["modelo não Jev", { ...valido, model: "openai/gpt" }],
    ["enum inválido", { ...valido, answers: { ...valido.answers, intencao: { ...valido.answers.intencao, choice: "x" } } }],
    ["prob > 1", { ...valido, answers: { ...valido.answers, pergunta_horario: { type: "noul", noul: 1.2 } } }],
    ["soma errada", { ...valido, answers: { ...valido.answers, intencao: { ...valido.answers.intencao, probabilities: { agendamento: 0.5, preco: 0.1, outro: 0.1 } } } }],
    ["vazio", null],
  ])("rejeita %s", (_n, b) => expect(validarResposta(b)).toBeNull());
});

describe("cliente", () => {
  const esperar = vi.fn(async () => {});
  it("sucesso: destino fixo, bearer, redirect manual", async () => {
    const f = vi.fn(async () => resp(200, valido));
    const r = await testarJevServidor("k", { fetch: f as unknown as typeof fetch, esperar });
    expect(r.categoria).toBe("ok");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(JEV_URL);
    expect(init.redirect).toBe("manual");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer k");
  });
  it.each([[401, "nao_autorizado"], [403, "nao_autorizado"], [402, "saldo_insuficiente"]])("%i sem retry", async (s, c) => {
    const f = vi.fn(async () => resp(s, {}));
    const r = await testarJevServidor("k", { fetch: f as unknown as typeof fetch, esperar });
    expect(r.categoria).toBe(c);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("429 respeita Retry-After e limita tentativas", async () => {
    esperar.mockClear();
    const f = vi.fn(async () => resp(429, {}, { "retry-after": "1" }));
    const r = await testarJevServidor("k", { fetch: f as unknown as typeof fetch, esperar });
    expect(r.categoria).toBe("limite_taxa");
    expect(f).toHaveBeenCalledTimes(2);
    expect(esperar).toHaveBeenCalledWith(1000);
  });
  it("5xx depois sucesso", async () => {
    const f = vi.fn().mockResolvedValueOnce(resp(503, {})).mockResolvedValueOnce(resp(200, valido));
    expect((await testarJevServidor("k", { fetch: f as unknown as typeof fetch, esperar })).categoria).toBe("ok");
  });
  it("redirect recusado", async () => {
    const f = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://x" } }));
    expect((await testarJevServidor("k", { fetch: f as unknown as typeof fetch, esperar })).categoria).toBe("resposta_invalida");
  });
  it("timeout", async () => {
    const f = vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_r, rej) => {
      init.signal?.addEventListener("abort", () => rej(Object.assign(new Error("a"), { name: "AbortError" })));
    }));
    const r = await testarJevServidor("k", { fetch: f as unknown as typeof fetch, esperar, timeoutMs: 5, maxTentativas: 1 });
    expect(r.categoria).toBe("timeout");
  });
  it("JSON inválido", async () => {
    const f = vi.fn(async () => new Response("não json", { status: 200 }));
    expect((await testarJevServidor("k", { fetch: f as unknown as typeof fetch, esperar })).categoria).toBe("resposta_invalida");
  });
});

function fakeCtx(papel: string | null, inserts: unknown[] = []) {
  const chain = (tabela: string) => {
    const q: Record<string, unknown> = {};
    const self = () => q;
    for (const k of ["select", "eq", "order", "limit"]) q[k] = self;
    q["maybeSingle"] = async () => ({ data: tabela === "profiles" ? { organization_id: "org-a", full_name: null } : null });
    q["then"] = (res: (v: unknown) => void) => res({ data: tabela === "user_roles" && papel ? [{ role: papel }] : [] });
    q["insert"] = async (v: unknown) => { inserts.push(v); return { error: null }; };
    return q;
  };
  return { userId: "u", supabase: { from: chain } } as never;
}
const acessoOk = { lerBinding: async () => "loc", locationDoToken: () => "loc" };

describe("autorização antes do secret e do fetch", () => {
  it("não administrador: não lê chave nem faz fetch", async () => {
    const lerChave = vi.fn(() => "k"); const f = vi.fn();
    const r = await testarJevHandler(fakeCtx("atendente"), { acesso: acessoOk, lerChave, jev: { fetch: f as unknown as typeof fetch } });
    expect(r.categoria).toBe("sem_permissao");
    expect(lerChave).not.toHaveBeenCalled(); expect(f).not.toHaveBeenCalled();
  });
  it("organização sem vínculo autorizado (outra org) é negada", async () => {
    const lerChave = vi.fn(() => "k"); const f = vi.fn();
    const r = await testarJevHandler(fakeCtx("administrador"), { acesso: { lerBinding: async () => "outra", locationDoToken: () => "loc" }, lerChave, jev: { fetch: f as unknown as typeof fetch } });
    expect(r.categoria).toBe("sem_permissao");
    expect(lerChave).not.toHaveBeenCalled(); expect(f).not.toHaveBeenCalled();
  });
  it("chave ausente sem fetch", async () => {
    const f = vi.fn();
    const r = await testarJevHandler(fakeCtx("administrador"), { acesso: acessoOk, lerChave: () => undefined, jev: { fetch: f as unknown as typeof fetch } });
    expect(r.categoria).toBe("sem_chave"); expect(f).not.toHaveBeenCalled();
  });
  it("audita só metadados sanitizados na própria organização", async () => {
    const ins: Record<string, unknown>[] = [];
    const f = vi.fn(async () => resp(200, valido));
    await testarJevHandler(fakeCtx("administrador", ins), { acesso: acessoOk, lerChave: () => "segredo", jev: { fetch: f as unknown as typeof fetch } });
    expect(ins[0]?.["organization_id"]).toBe("org-a");
    expect(JSON.stringify(ins)).not.toContain("segredo");
    expect(Object.keys(ins[0]?.["metadata"] as object).sort()).toEqual(["categoria", "latencia_ms", "modelo"]);
  });
  it("estado negado sem acesso", async () => {
    expect(await estadoJevHandler(fakeCtx(null), { acesso: acessoOk })).toEqual({ ok: false });
  });
});

describe("estado", () => {
  const t = (c: TesteRegistado["categoria"], em: string): TesteRegistado => ({ categoria: c, em, modelo: null, latencia_ms: 1 });
  it("sem chave / sem teste", () => {
    expect(derivarEstado(false, t("ok", "a"), null).tipo).toBe("sem_chave");
    expect(derivarEstado(true, null, null).tipo).toBe("sem_teste");
  });
  it("falha posterior prevalece sobre sucesso", () => {
    const e = derivarEstado(true, t("limite_taxa", "2"), t("ok", "1"));
    expect(e.tipo).toBe("falha");
  });
});
