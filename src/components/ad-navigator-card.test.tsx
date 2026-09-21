// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ ler: vi.fn(), gerar: vi.fn(), revogar: vi.fn(), prontidao: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (f: unknown) => f }));
vi.mock("@/lib/ad-navigator.functions", () => ({
  estadoAdNavigator: m.ler,
  gerarCodigoAdNavigator: m.gerar,
  revogarAcessoAdNavigator: m.revogar,
  prontidaoAdNavigator: m.prontidao,
}));
import { AdNavigatorCard } from "./ad-navigator-card";
const state = {
  organization_id: "test",
  organization_name: "Clínica teste",
  location_id: "test",
  pipeline_id: "test",
  binding_ok: true,
  connection_ok: true,
  pending_pairing: null,
  grants: [],
  scope: "commercial_summary:read",
};
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("consulta estado sem gerar código e exige receptor pronto", async () => {
  m.ler.mockResolvedValue({ autorizado: true, leituraOk: true, estado: state });
  m.prontidao.mockResolvedValue({
    autorizado: true,
    leituraOk: true,
    podeGerar: true,
    verificacoes: [
      { id: "vinculo", rotulo: "Vínculo real ao GoHighLevel", ok: true, detalhe: "ok" },
    ],
    sonda: { exchange_ok: true, summary_ok: true, motivo: "ok" },
  });
  m.gerar.mockResolvedValue({ ok: false, message: "Falha sintética" });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <AdNavigatorCard allowed escopo="test" />
    </QueryClientProvider>,
  );
  await screen.findByText("Aguardando receptor/ativação");
  const button = screen.getByRole("button", {
    name: "Gerar código de pareamento",
  }) as HTMLButtonElement;
  await waitFor(() => expect(m.prontidao).toHaveBeenCalled());
  await screen.findByText("Vínculo real ao GoHighLevel");
  expect(button.disabled).toBe(true);
  expect(m.gerar).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox"));
  expect(button.disabled).toBe(false);
  fireEvent.click(button);
  await waitFor(() => expect(m.gerar).toHaveBeenCalledTimes(1));
  expect(m.gerar).toHaveBeenCalledWith({ data: { confirm: true } });
  qc.clear();
});
it("não consulta nem gera para utilizador sem acesso", () => {
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <AdNavigatorCard allowed={false} escopo="test" />
    </QueryClientProvider>,
  );
  expect(m.ler).not.toHaveBeenCalled();
  expect(m.prontidao).not.toHaveBeenCalled();
  expect(m.gerar).not.toHaveBeenCalled();
  expect(screen.queryByRole("checkbox")).toBeNull();
  qc.clear();
});
