// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ ler: vi.fn(), testar: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (f: unknown) => f }));
vi.mock("@/lib/jev.functions", () => ({ estadoJev: m.ler, testarJev: m.testar }));
import { JevCard } from "./jev-card";
const wrap = () => render(<QueryClientProvider client={new QueryClient()}><JevCard allowed escopo="a" /></QueryClientProvider>);
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("chave ausente desativa teste", async () => {
  m.ler.mockResolvedValue({ ok: true, estado: { tipo: "sem_chave" } });
  wrap();
  expect(await screen.findByText("Chave ausente")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Testar conexão Jev" }) as HTMLButtonElement).disabled).toBe(true);
});
it("falha posterior prevalece e sucesso aparece como histórico", async () => {
  m.ler.mockResolvedValue({ ok: true, estado: { tipo: "falha",
    ultimo: { categoria: "saldo_insuficiente", em: "2026-09-26T10:00:00Z", modelo: null, latencia_ms: 20 },
    ultimoSucesso: { categoria: "ok", em: "2026-09-25T10:00:00Z", modelo: "typesafe/jev-1.13-x", latencia_ms: 30 } } });
  wrap();
  expect(await screen.findByText("Último teste falhou")).toBeTruthy();
  expect(screen.getByText(/Sucesso anterior \(histórico\)/)).toBeTruthy();
});
it("clique único mesmo com cliques concorrentes", async () => {
  m.ler.mockResolvedValue({ ok: true, estado: { tipo: "sem_teste" } });
  let solta: (v: unknown) => void = () => {};
  m.testar.mockReturnValue(new Promise((r) => { solta = r; }));
  wrap();
  const b = await screen.findByRole("button", { name: "Testar conexão Jev" });
  fireEvent.click(b); fireEvent.click(b);
  expect(m.testar).toHaveBeenCalledTimes(1);
  solta({ ok: false, categoria: "nao_autorizado" });
  expect(await screen.findByRole("alert")).toBeTruthy();
  await waitFor(() => expect(m.ler).toHaveBeenCalledTimes(2));
});
