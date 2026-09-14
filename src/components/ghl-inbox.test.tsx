// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent, act } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ analisar: vi.fn(), escopo: "conta-a", error: false }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (f: unknown) => f }));
vi.mock("@/lib/ai.functions", () => ({ aiSupport: mocks.analisar }));
vi.mock("@/lib/organization", () => ({
  useOrganizacao: () => ({ data: { organizacao: { id: "orgA", timezone: "Europe/Lisbon" } } }),
}));
vi.mock("@/lib/repo", () => ({ useModoDados: () => ({ escopo: mocks.escopo }) }));
vi.mock("@/lib/ghl-observation", () => ({
  useConversasGhl: () => ({
    data: {
      pages: [
        {
          consultadoEm: "2026-09-14T12:00:00Z",
          conversas: ["Ana", "Bruno"].map((nome) => ({
            id: nome,
            contactId: nome,
            locationId: "locA",
            nome,
            ultimaMensagem: "Olá",
            tipo: "SMS",
            ultimaData: "2026-09-14T12:00:00Z",
            naoLidas: 1,
          })),
        },
      ],
    },
    refetch: vi.fn(),
  }),
  useMensagensGhl: (id: string) => ({
    isError: mocks.error,
    error: new Error("Token sem escopo de mensagens"),
    refetch: vi.fn(),
    data: {
      pages: [
        {
          consultadoEm: "2026-09-14T12:00:00Z",
          mensagens: [
            {
              id: `msg-${id}`,
              texto: "SIM",
              tipo: "SMS",
              direcao: "inbound",
              data: "2026-09-14T12:00:00Z",
              estado: "delivered",
              anexos: 0,
            },
          ],
        },
      ],
    },
  }),
}));
import { GhlInbox } from "./ghl-inbox";
afterEach(cleanup);
beforeEach(() => {
  mocks.analisar.mockReset();
  mocks.escopo = "conta-a";
  mocks.error = false;
});
function bruno() {
  fireEvent.click(screen.getByRole("button", { name: /Bruno/ }));
}
it("rascunho não acompanha a troca de conversa nem volta ao reabrir", () => {
  render(<GhlInbox />);
  fireEvent.change(screen.getByLabelText("Rascunho para Ana"), {
    target: { value: "Privado de Ana" },
  });
  bruno();
  expect((screen.getByLabelText("Rascunho para Bruno") as HTMLTextAreaElement).value).toBe("");
  fireEvent.click(screen.getByRole("button", { name: /Ana Olá/ }));
  expect((screen.getByLabelText("Rascunho para Ana") as HTMLTextAreaElement).value).toBe("");
});
it("resultado tardio da IA não contamina o novo atendimento", async () => {
  let resolver!: (data: unknown) => void;
  mocks.analisar.mockImplementation(
    () =>
      new Promise((r) => {
        resolver = r;
      }),
  );
  render(<GhlInbox />);
  fireEvent.click(screen.getByText("Analisar mensagens carregadas"));
  bruno();
  await act(async () =>
    resolver({
      ok: true,
      analise: { resumo: "Resumo privado de Ana", sugestoes: [], revisao_humana: false },
    }),
  );
  expect(screen.queryByText("Resumo privado de Ana")).toBeNull();
  expect((screen.getByLabelText("Rascunho para Bruno") as HTMLTextAreaElement).value).toBe("");
});
it("mudança de conta limpa seleção e rascunhos", () => {
  const { rerender } = render(<GhlInbox />);
  bruno();
  fireEvent.change(screen.getByLabelText("Rascunho para Bruno"), {
    target: { value: "Outra conta" },
  });
  mocks.escopo = "conta-b";
  rerender(<GhlInbox />);
  expect((screen.getByLabelText("Rascunho para Ana") as HTMLTextAreaElement).value).toBe("");
});
it("mensagem SIM exibe fuso e estado sem confirmar consulta ou liberar envio", () => {
  render(<GhlInbox />);
  expect(screen.getByText("Texto recebido: SIM")).toBeTruthy();
  expect(screen.getByText(/Estado no GHL: delivered/).textContent).toContain("13:00");
  expect(screen.queryByRole("button", { name: /Enviar/ })).toBeNull();
  expect(screen.getByRole("link", { name: /Abrir atendimento/ }).getAttribute("href")).toContain(
    "/locA/contacts/detail/Ana",
  );
});
it("erro de leitura oculta conteúdo antigo e bloqueia nova análise", () => {
  mocks.error = true;
  render(<GhlInbox />);
  expect(screen.getByRole("alert").textContent).toContain("Token sem escopo");
  expect(screen.queryByText("Texto recebido: SIM")).toBeNull();
  expect((screen.getByText("Analisar mensagens carregadas") as HTMLButtonElement).disabled).toBe(
    true,
  );
});
