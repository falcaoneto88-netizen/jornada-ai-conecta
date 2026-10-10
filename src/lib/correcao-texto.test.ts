import { expect, it, vi } from "vitest";
import { corrigirTexto, violacoesInvariantes } from "./correcao-texto.core";

const resp = (content: unknown, status = 200) =>
  vi.fn(
    async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status }),
  ) as unknown as typeof fetch;
const T =
  "Ola, Cliente Teste! nos podemos conversa amanha as 14h? O valor informado foi 50€ e o link e https://example.com/consulta.";
const OK =
  "Olá, Cliente Teste! Nós podemos conversar amanhã às 14h? O valor informado foi 50€ e o link é https://example.com/consulta.";

it("aceita correção que preserva números, moeda e link; prompt isolado", async () => {
  const f = resp(OK);
  expect(await corrigirTexto(T, { apiKey: "k", fetch: f })).toEqual({ ok: true, texto: OK });
  const body = JSON.parse(
    (vi.mocked(f).mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
  );
  expect(body.messages[0].content).toMatch(/ÚNICA tarefa é corrigir/);
});
it("troca de unidades/números entre si é recusada", () => {
  const o = "Ana Maria de Souza toma 5 mg pela manha e 10 mcg a noite.";
  expect(
    violacoesInvariantes(o, "Ana Maria de Souza toma 10 mg pela manhã e 5 mcg à noite."),
  ).toContain("protegidos");
  expect(
    violacoesInvariantes(o, "Ana Maria de Souza toma 5 mcg pela manhã e 10 mcg à noite."),
  ).toContain("protegidos");
  expect(
    violacoesInvariantes(o, "Ana Maria de Souza toma 5 mg pela manhã e 10 mcg à noite."),
  ).toEqual([]);
});
it("rejeita alteração de hora, preço, link, variável e reordenação", () => {
  expect(violacoesInvariantes(T, T.replace("14h", "15h"))).not.toEqual([]);
  expect(violacoesInvariantes(T, T.replace("50€", "50 euros"))).not.toEqual([]);
  expect(violacoesInvariantes(T, T.replace("example.com", "exemplo.com"))).not.toEqual([]);
  expect(violacoesInvariantes("Olá {{nome}}, tudo bem?", "Olá nome, tudo bem?")).not.toEqual([]);
  expect(violacoesInvariantes("Dia 09/10 às 11h", "Dia 11h às 09/10")).not.toEqual([]);
});
it("rejeita reescrita comercial longa", async () => {
  const r = await corrigirTexto(T, {
    apiKey: "k",
    fetch: resp(T + " Aproveite a nossa oferta exclusiva premium hoje!".repeat(3)),
  });
  expect(r).toMatchObject({ ok: false, code: "invariante" });
});
it("conteúdo não-string ou vazio é erro, sem lançar", async () => {
  expect(await corrigirTexto(T, { apiKey: "k", fetch: resp({ x: 1 }) })).toMatchObject({
    ok: false,
    code: "erro_ia",
  });
  expect(await corrigirTexto(T, { apiKey: "k", fetch: resp(["a"]) })).toMatchObject({
    ok: false,
    code: "erro_ia",
  });
  expect(await corrigirTexto(T, { apiKey: "k", fetch: resp("  ") })).toMatchObject({
    code: "resposta_vazia",
  });
});
it("erros: 402, 429, timeout, sem chave, acima do limite", async () => {
  const f = (s: number) =>
    vi.fn(async () => new Response("{}", { status: s })) as unknown as typeof fetch;
  expect(await corrigirTexto(T, { apiKey: "k", fetch: f(402) })).toMatchObject({
    code: "sem_creditos",
  });
  expect(await corrigirTexto(T, { apiKey: "k", fetch: f(429) })).toMatchObject({
    code: "rate_limited",
  });
  const to = vi.fn(async () => {
    throw Object.assign(new Error("t"), { name: "TimeoutError" });
  }) as unknown as typeof fetch;
  expect(await corrigirTexto(T, { apiKey: "k", fetch: to })).toMatchObject({ code: "timeout" });
  expect(await corrigirTexto(T, { apiKey: undefined, fetch: to })).toMatchObject({
    code: "ia_nao_configurada",
  });
  expect(await corrigirTexto("a".repeat(1501), { apiKey: "k", fetch: to })).toMatchObject({
    code: "texto_invalido",
  });
});

describe("sinais, comparadores e unidades compostas", () => {
  it.each([
    ["Perdeu -5 kg em um mes.", "Perdeu 5 kg em um mês."],
    ["Dose de 5 mg/mL agora.", "Dose de 5 mg/L agora."],
    ["Valor <5 mg/dL no exame.", "Valor >5 mg/dL no exame."],
    ["Tomar 5 mg/kg/dia sempre.", "Tomar 5 mg/kg/semana sempre."],
  ])("recusa %s → %s", (a, b) => {
    expect(violacoesInvariantes(a, b)).toContain("protegidos");
  });
  it("aceita correção gramatical que preserva os valores", () => {
    expect(
      violacoesInvariantes(
        "voce tem -5 kg e <5 mg/dL, tome 5 mg/kg/dia",
        "Você tem -5 kg e <5 mg/dL, tome 5 mg/kg/dia.",
      ),
    ).toEqual([]);
  });
});
