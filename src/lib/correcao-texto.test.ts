import { expect, it, vi } from "vitest";
import { corrigirTexto, violacoesInvariantes } from "./correcao-texto.core";

const resp = (content: string, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status }));
const T = "Ola, Cliente Teste! nos podemos conversa amanha as 14h? O valor informado foi 50€ e o link e https://example.com/consulta.";

it("aceita correção que preserva números, moeda e link", async () => {
  const f = resp("Olá, Cliente Teste! Nós podemos conversar amanhã às 14h? O valor informado foi 50€ e o link é https://example.com/consulta.");
  const r = await corrigirTexto(T, { apiKey: "k", fetch: f as unknown as typeof fetch });
  expect(r.ok).toBe(true);
  const body = JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
  expect(body.messages[0].content).toMatch(/ÚNICA tarefa é corrigir/);
  expect(body.messages[1].content).toContain(T);
});
it("rejeita alteração de número, preço ou link", async () => {
  expect(violacoesInvariantes(T, T.replace("14h", "15h"))).toContain("numeros");
  expect(violacoesInvariantes(T, T.replace("50€", "50 euros"))).toContain("moedas");
  expect(violacoesInvariantes(T, T.replace("example.com", "exemplo.com"))).toContain("urls");
  expect(violacoesInvariantes("Olá {{nome}}, tudo bem?", "Olá nome, tudo bem?")).toContain("variaveis");
  const r = await corrigirTexto(T, { apiKey: "k", fetch: resp(T.replace("50", "60")) as unknown as typeof fetch });
  expect(r).toMatchObject({ ok: false, code: "invariante" });
});
it("rejeita reescrita comercial longa", async () => {
  const r = await corrigirTexto(T, { apiKey: "k", fetch: resp(T + " Aproveite a nossa oferta exclusiva premium para si hoje mesmo! ".repeat(3)) as unknown as typeof fetch });
  expect(r).toMatchObject({ ok: false, code: "invariante" });
});
it("erros: 402, 429, vazio, timeout, sem chave", async () => {
  const f = (s: number) => vi.fn(async () => new Response("{}", { status: s })) as unknown as typeof fetch;
  expect((await corrigirTexto(T, { apiKey: "k", fetch: f(402) })).ok).toBe(false);
  expect(await corrigirTexto(T, { apiKey: "k", fetch: f(429) })).toMatchObject({ code: "rate_limited" });
  expect(await corrigirTexto(T, { apiKey: "k", fetch: resp("  ") as unknown as typeof fetch })).toMatchObject({ code: "resposta_vazia" });
  const to = vi.fn(async () => { throw Object.assign(new Error("t"), { name: "TimeoutError" }); }) as unknown as typeof fetch;
  expect(await corrigirTexto(T, { apiKey: "k", fetch: to })).toMatchObject({ code: "timeout" });
  expect(await corrigirTexto(T, { apiKey: undefined, fetch: to })).toMatchObject({ code: "ia_nao_configurada" });
});
