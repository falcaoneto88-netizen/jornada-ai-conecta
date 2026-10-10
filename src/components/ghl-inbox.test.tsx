// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent, act } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  analisar: vi.fn(),
  corrigir: vi.fn(),
  enviar: vi.fn(),
  contexto: vi.fn(),
  conferir: vi.fn(),
  refetch: vi.fn(),
  escopo: "conta-a",
  error: false,
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (f: unknown) => f }));
vi.mock("@/lib/ai.functions", () => ({ aiSupport: mocks.analisar }));
vi.mock("@/lib/correcao-texto.functions", () => ({ corrigirRascunho: mocks.corrigir }));
vi.mock("@/lib/commercial-agent.functions", () => ({
  getInboxSendContext: mocks.contexto,
  sendInboxMessage: mocks.enviar,
  reconcileManualAgentMessage: mocks.conferir,
}));
vi.mock("@/lib/jev-pedidos.functions", () => ({ classificarPedido: vi.fn() }));
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
    refetch: mocks.refetch,
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
  for (const f of [mocks.analisar, mocks.corrigir, mocks.enviar, mocks.conferir, mocks.refetch])
    f.mockReset();
  mocks.contexto.mockReset().mockResolvedValue({
    ok: true,
    data: { name: "Ana", channel: "SMS", sendAllowed: true, blockedReason: null, lastDispatch: null },
  });
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
  expect(mocks.enviar).not.toHaveBeenCalled();
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

const campo = (n = "Ana") => screen.getByLabelText(`Rascunho para ${n}`) as HTMLTextAreaElement;
const escrever = (t: string, n = "Ana") => fireEvent.change(campo(n), { target: { value: t } });
const flush = () => act(async () => {});
it("Corrigir aplica a correção real no mesmo campo, sem enviar", async () => {
  mocks.corrigir.mockResolvedValue({ ok: true, texto: "Olá, tudo bem?" });
  render(<GhlInbox />);
  escrever("Ola, tudo bem?");
  await act(async () => fireEvent.click(screen.getByRole("button", { name: /Corrigir/ })));
  expect(mocks.corrigir).toHaveBeenCalledWith({ data: { texto: "Ola, tudo bem?" } });
  expect(campo().value).toBe("Olá, tudo bem?");
  expect(mocks.enviar).not.toHaveBeenCalled();
});
it("edição durante a correção (mesmo voltando ao original) descarta a resposta", async () => {
  let r!: (v: unknown) => void;
  mocks.corrigir.mockImplementation(() => new Promise((x) => (r = x)));
  render(<GhlInbox />);
  escrever("Ola");
  fireEvent.click(screen.getByRole("button", { name: /Corrigir/ }));
  escrever("Ola mudado");
  escrever("Ola");
  await act(async () => r({ ok: true, texto: "Olá" }));
  expect(campo().value).toBe("Ola");
  expect(screen.getByText(/descartada/)).toBeTruthy();
});
it("erro da correção mantém o texto e mostra a mensagem", async () => {
  mocks.corrigir.mockResolvedValue({ ok: false, code: "sem_creditos", message: "Sem créditos de IA disponíveis. O texto foi mantido." });
  render(<GhlInbox />);
  escrever("Ola");
  await act(async () => fireEvent.click(screen.getByRole("button", { name: /Corrigir/ })));
  expect(campo().value).toBe("Ola");
  expect(screen.getByText(/Sem créditos/)).toBeTruthy();
});
it("correção tardia não contamina outra conversa", async () => {
  let r!: (v: unknown) => void;
  mocks.corrigir.mockImplementation(() => new Promise((x) => (r = x)));
  render(<GhlInbox />);
  escrever("Ola");
  fireEvent.click(screen.getByRole("button", { name: /Corrigir/ }));
  bruno();
  await act(async () => r({ ok: true, texto: "Olá" }));
  expect(campo("Bruno").value).toBe("");
});
it("Enviar: um clique envia o texto visível atual; duplo clique não duplica", async () => {
  let r!: (v: unknown) => void;
  mocks.enviar.mockImplementation(() => new Promise((x) => (r = x)));
  render(<GhlInbox />);
  await flush();
  escrever("Texto final  ");
  const b = screen.getByRole("button", { name: /Enviar para Ana/ });
  fireEvent.click(b);
  fireEvent.click(b);
  expect(mocks.enviar).toHaveBeenCalledTimes(1);
  const arg = mocks.enviar.mock.calls[0]![0].data;
  expect(arg).toMatchObject({ organizationId: "orgA", contactId: "Ana", conversationId: "Ana", text: "Texto final" });
  expect(campo().readOnly).toBe(true);
  await act(async () => r({ ok: true, data: { state: "sent", messageId: "m1", code: null, manualId: "x" } }));
  expect(screen.getByText(/aceite pelo GHL \(ID m1\)/)).toBeTruthy();
  expect(mocks.refetch).toHaveBeenCalled();
  expect(campo().value).toBe("");
});
it("falha de rede = incerto, mantém texto e não reenvia automaticamente", async () => {
  mocks.enviar.mockRejectedValue(new Error("timeout"));
  render(<GhlInbox />);
  await flush();
  escrever("Mensagem");
  await act(async () => fireEvent.click(screen.getByRole("button", { name: /Enviar para Ana/ })));
  expect(mocks.enviar).toHaveBeenCalledTimes(1);
  expect(campo().value).toBe("Mensagem");
  expect(screen.getByText(/não confirmado/)).toBeTruthy();
});
it("repetição manual da mesma revisão reutiliza a chave de idempotência", async () => {
  mocks.enviar.mockResolvedValue({ ok: false, code: "storage_unavailable" });
  render(<GhlInbox />);
  await flush();
  escrever("Mensagem");
  const b = () => screen.getByRole("button", { name: /Enviar para Ana/ });
  await act(async () => fireEvent.click(b()));
  await act(async () => fireEvent.click(b()));
  const [a, c] = mocks.enviar.mock.calls.map((x) => x[0].data.requestId);
  expect(a).toBe(c);
  escrever("Outra");
  await act(async () => fireEvent.click(b()));
  expect(mocks.enviar.mock.calls[2]![0].data.requestId).not.toBe(a);
});
it("bloqueio do servidor (DND/canal/escopo) desativa Enviar com motivo", async () => {
  mocks.contexto.mockResolvedValue({
    ok: true,
    data: { name: "Ana", channel: "SMS", sendAllowed: false, blockedReason: "do_not_contact", lastDispatch: null },
  });
  render(<GhlInbox />);
  await flush();
  escrever("Mensagem");
  expect((screen.getByRole("button", { name: /Enviar para Ana/ }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/DND ativo/)).toBeTruthy();
});
