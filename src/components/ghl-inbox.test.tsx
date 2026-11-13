// @vitest-environment jsdom
import { flushSync } from "react-dom";
import { cleanup, render, screen, fireEvent, act, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AttendanceDraftSnapshot } from "@/lib/attendance-draft.core";
import type { InboxBookingPanelProps } from "./inbox-booking-panel";
import type { InboxAgentPanelProps } from "./inbox-agent-panel";
const mocks = vi.hoisted(() => ({
  analisar: vi.fn(),
  corrigir: vi.fn(),
  enviar: vi.fn(),
  contexto: vi.fn(),
  conferir: vi.fn(),
  estado: vi.fn(),
  loadDraft: vi.fn(),
  saveDraft: vi.fn(),
  clearDraft: vi.fn(),
  refetch: vi.fn(),
  escopo: "conta-a",
  error: false,
  org: "orgA",
  brunoChannel: "SMS",
  brunoUnread: 1,
  hasNextPage: false,
  nextPage: vi.fn(),
  messageText: "SIM",
  extraMessage: false,
  olderMessage: false,
  suggestionResult: vi.fn(),
  sourceAgentDraft: {
    draftId: "77777777-7777-4777-8777-777777777777",
    version: 4,
    replyHash: "c".repeat(64),
  },
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (f: unknown) => f }));
vi.mock("@/lib/izabel-reply.functions", () => ({ prepareIzabelReply: mocks.analisar }));
vi.mock("@/lib/correcao-texto.functions", () => ({ corrigirRascunho: mocks.corrigir }));
vi.mock("@/lib/commercial-agent.functions", () => ({
  getInboxSendContext: mocks.contexto,
  sendInboxMessage: mocks.enviar,
  getInboxSendStatus: mocks.estado,
  reconcileManualAgentMessage: mocks.conferir,
}));
vi.mock("@/lib/jev-pedidos.functions", () => ({ classificarPedido: vi.fn() }));
vi.mock("@/components/inbox-booking-panel", () => ({
  InboxBookingPanel: ({
    open,
    contactId,
    contactName,
    onOpenChange,
    onConfirmed,
  }: InboxBookingPanelProps) =>
    open ? (
      <div role="dialog" aria-label="Agendamento sintético">
        <p>
          Agendar para {contactName} ({contactId})
        </p>
        <button
          onClick={() => {
            onConfirmed();
            onOpenChange(false);
          }}
        >
          Confirmar agendamento sintético
        </button>
        <button onClick={() => onOpenChange(false)}>Voltar sem agendar</button>
      </div>
    ) : null,
}));
vi.mock("@/components/inbox-agent-panel", () => ({
  InboxAgentPanel: ({
    contactId,
    conversationId,
    onUseSuggestion,
    disabled,
  }: InboxAgentPanelProps) => (
    <div>
      <p>
        Supervisão {contactId} {conversationId}
      </p>
      <button
        disabled={disabled}
        onClick={() =>
          mocks.suggestionResult(
            onUseSuggestion?.({
              text: `Sugestão supervisionada para ${contactId}.`,
              contactId,
              conversationId,
              source: mocks.sourceAgentDraft,
            }),
          )
        }
      >
        Ajustar sugestão supervisionada sintética
      </button>
      <button
        onClick={() =>
          mocks.suggestionResult(
            onUseSuggestion?.({
              text: "Texto de outro contato.",
              contactId: "unrelated-contact",
              conversationId: "unrelated-conversation",
              source: mocks.sourceAgentDraft,
            }),
          )
        }
      >
        Tentar sugestão de outro contato
      </button>
    </div>
  ),
}));
vi.mock("@/components/inbox-template-picker", () => ({
  InboxTemplatePicker: ({
    disabled,
    onInsert,
  }: {
    disabled: boolean;
    onInsert: (text: string, mode: string) => boolean;
  }) => (
    <button disabled={disabled} onClick={() => onInsert("Texto de teste", "append")}>
      Inserir modelo sintético
    </button>
  ),
}));
vi.mock("@/components/attendance-context-panel", () => ({
  AttendanceContextPanel: () => <p>Contexto do contato</p>,
}));
vi.mock("@/lib/attendance-draft.functions", () => ({
  loadAttendanceDraft: mocks.loadDraft,
  saveAttendanceDraft: mocks.saveDraft,
  clearAttendanceDraft: mocks.clearDraft,
}));
vi.mock("@/lib/organization", () => ({
  useOrganizacao: () => ({ data: { organizacao: { id: mocks.org, timezone: "Europe/Lisbon" } } }),
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
            tipo: nome === "Bruno" ? mocks.brunoChannel : "SMS",
            ultimaData: "2026-09-14T12:00:00Z",
            naoLidas: nome === "Bruno" ? mocks.brunoUnread : 1,
          })),
        },
      ],
    },
    refetch: vi.fn(),
    hasNextPage: mocks.hasNextPage,
    fetchNextPage: mocks.nextPage,
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
            ...(mocks.olderMessage
              ? [
                  {
                    id: "older",
                    texto: "Mensagem anterior",
                    tipo: "SMS",
                    direcao: "inbound",
                    data: "2026-09-13T12:00:00Z",
                    estado: "delivered",
                    anexos: 0,
                  },
                ]
              : []),
            {
              id: `msg-${id}`,
              texto: mocks.messageText,
              tipo: "SMS",
              direcao: "inbound",
              data: "2026-09-14T12:00:00Z",
              estado: "delivered",
              anexos: 0,
            },
            ...(mocks.extraMessage
              ? [
                  {
                    id: "new",
                    texto: "Outra dúvida",
                    tipo: "SMS",
                    direcao: "inbound",
                    data: "2026-09-14T12:01:00Z",
                    estado: "delivered",
                    anexos: 0,
                  },
                ]
              : []),
          ],
        },
      ],
    },
  }),
}));
vi.mock("@/lib/attendance-workspace.functions", () => ({
  resolveAttendanceConversations: vi.fn(),
  readAttendanceWorkspace: vi.fn(),
}));
function analysisButton() {
  if (!screen.queryByRole("button", { name: "Preparar resposta" }))
    flushSync(() => fireEvent.click(screen.getByRole("button", { name: "Abrir Izabel" })));
  return screen.getByRole("button", { name: "Preparar resposta" });
}
import { GhlInbox, lerIntencao, pendentesEnvio } from "./ghl-inbox";
const REV = {
  historyHash: "a".repeat(64),
  sessionVersion: 1,
  channel: "SMS" as const,
  providerId: "zap",
  defaultId: "zap",
};
function ctx(over: Record<string, unknown> = {}) {
  return {
    name: "Ana",
    channel: "SMS",
    transport: "ZaptosWPP V2",
    sendAllowed: true,
    mediaAllowed: true,
    blockedReason: null,
    revision: REV,
    lastDispatch: null,
    ...over,
  };
}
afterEach(cleanup);
beforeEach(() => {
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:local-preview"),
  });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  for (const f of [
    mocks.analisar,
    mocks.corrigir,
    mocks.enviar,
    mocks.conferir,
    mocks.refetch,
    mocks.estado,
  ])
    f.mockReset();
  mocks.contexto.mockReset().mockResolvedValue({
    ok: true,
    data: ctx(),
  });
  mocks.escopo = "conta-a";
  for (const f of [mocks.loadDraft, mocks.saveDraft, mocks.clearDraft])
    f.mockReset().mockResolvedValue({ ok: false, code: "draft_unavailable" });
  mocks.org = "orgA";
  mocks.brunoChannel = "SMS";
  mocks.brunoUnread = 1;
  mocks.hasNextPage = false;
  mocks.messageText = "SIM";
  mocks.extraMessage = false;
  mocks.olderMessage = false;
  mocks.nextPage.mockReset();
  mocks.suggestionResult.mockReset();
  mocks.error = false;
  pendentesEnvio.clear();
  localStorage.clear();
});

async function attach(file = new File(["local image bytes"], "imagem.png", { type: "image/png" })) {
  openMedia();
  fireEvent.change(screen.getByLabelText("Selecionar imagem ou áudio"), {
    target: { files: [file] },
  });
  await waitFor(() => expect(screen.getByLabelText("Prévia do anexo")).toBeTruthy());
}

function openMedia() {
  const details = screen.getByLabelText("Anexo da resposta") as HTMLDetailsElement;
  if (!details.open) fireEvent.click(details.querySelector("summary")!);
}

function openSuggestion() {
  const summary = screen.getByText("Sugestão supervisionada").closest("summary")!;
  if (!(summary.parentElement as HTMLDetailsElement).open) fireEvent.click(summary);
}

async function useSupervisedSuggestion() {
  openSuggestion();
  fireEvent.click(
    screen.getByRole("button", { name: "Ajustar sugestão supervisionada sintética" }),
  );
  await flush();
}

it("imagem fica local na prévia; clique final envia arquivo e texto exatos uma única vez", async () => {
  let resolve!: (value: unknown) => void;
  mocks.enviar.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  render(<GhlInbox />);
  await flush();
  await attach();
  expect(screen.getByAltText("Prévia de imagem.png").getAttribute("src")).toBe(
    "blob:local-preview",
  );
  expect(mocks.enviar).not.toHaveBeenCalled();
  expect(mocks.analisar).not.toHaveBeenCalled();
  expect(localStorage.length).toBe(0);
  escrever("  Legenda exata\n");
  const send = screen.getByRole("button", { name: /Enviar para Ana/ });
  act(() => {
    send.click();
    send.click();
  });
  await waitFor(() => expect(mocks.enviar).toHaveBeenCalledTimes(1));
  expect(mocks.enviar.mock.calls[0]![0].data).toMatchObject({
    organizationId: "orgA",
    conversationId: "Ana",
    contactId: "Ana",
    text: "  Legenda exata\n",
    attachments: [{ name: "imagem.png", mimeType: "image/png", base64: btoa("local image bytes") }],
    revision: REV,
  });
  expect(
    (screen.getByRole("button", { name: /Remover anexo/ }) as HTMLButtonElement).disabled,
  ).toBe(true);
  const stored = JSON.stringify(Object.fromEntries(Object.entries(localStorage)));
  expect(stored).not.toContain("imagem.png");
  expect(stored).not.toContain(btoa("local image bytes"));
  await act(async () =>
    resolve({
      ok: true,
      data: { state: "sent", messageId: "media1", code: null, manualId: "manual1" },
    }),
  );
  expect(screen.queryByLabelText("Prévia do anexo")).toBeNull();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:local-preview");
  expect(screen.getByText(/aceite pelo GHL \(ID media1\)/)).toBeTruthy();
});

it("áudio sem texto tem controle de reprodução e só envia no clique humano", async () => {
  mocks.enviar.mockResolvedValue({
    ok: true,
    data: { state: "sent", messageId: "audio1", code: null, manualId: "manual1" },
  });
  render(<GhlInbox />);
  await flush();
  await attach(new File(["audio bytes"], "voz.mp3", { type: "audio/mpeg" }));
  expect(screen.getByLabelText("Ouvir áudio antes de enviar").tagName).toBe("AUDIO");
  expect(mocks.enviar).not.toHaveBeenCalled();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: /Enviar para Ana/ })));
  expect(mocks.enviar.mock.calls[0]![0].data).toMatchObject({
    text: "",
    attachments: [{ name: "voz.mp3", mimeType: "audio/mpeg", base64: btoa("audio bytes") }],
  });
});

it("remoção e troca de conversa revogam prévia e não levam anexo para outro destinatário", async () => {
  render(<GhlInbox />);
  await flush();
  await attach();
  fireEvent.click(screen.getByRole("button", { name: /Remover anexo/ }));
  expect(screen.queryByLabelText("Prévia do anexo")).toBeNull();
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  await attach();
  bruno();
  await flush();
  expect(screen.queryByLabelText("Prévia do anexo")).toBeNull();
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  expect(mocks.enviar).not.toHaveBeenCalled();
});

it("arquivo inválido ou maior que 5 MB não chega ao envio", async () => {
  render(<GhlInbox />);
  await flush();
  fireEvent.change(screen.getByLabelText("Selecionar imagem ou áudio"), {
    target: { files: [new File(["<svg>"], "imagem.svg", { type: "image/svg+xml" })] },
  });
  await waitFor(() => expect(screen.getByText(/Use uma imagem JPG/)).toBeTruthy());
  fireEvent.change(screen.getByLabelText("Selecionar imagem ou áudio"), {
    target: {
      files: [new File([new Uint8Array(5 * 1024 * 1024 + 1)], "grande.png", { type: "image/png" })],
    },
  });
  await waitFor(() => expect(screen.getByText(/O anexo deve ter no máximo 5 MB/)).toBeTruthy());
  expect(screen.queryByLabelText("Prévia do anexo")).toBeNull();
  expect(mocks.enviar).not.toHaveBeenCalled();
});

it("mídia com resultado incerto fica preservada e não permite uma segunda tentativa", async () => {
  mocks.enviar.mockRejectedValue(new Error("timeout"));
  render(<GhlInbox />);
  await flush();
  await attach();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: /Enviar para Ana/ })));
  expect(screen.getByLabelText("Prévia do anexo")).toBeTruthy();
  expect(
    (screen.getByRole("button", { name: /Remover anexo/ }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(
    (screen.getByRole("button", { name: /Enviar para Ana/ }) as HTMLButtonElement).disabled,
  ).toBe(true);
  bruno();
  await flush();
  fireEvent.click(screen.getByRole("button", { name: /Ana Olá/ }));
  await flush();
  expect(screen.queryByLabelText("Prévia do anexo")).toBeNull();
  expect(screen.getByText(/Resultado do envio não confirmado/)).toBeTruthy();
  expect(mocks.enviar).toHaveBeenCalledTimes(1);
});

it("mídia rejeitada antes do envio mantém prévia e permite nova intenção explícita", async () => {
  mocks.enviar.mockResolvedValue({ ok: false, code: "media_invalid" });
  render(<GhlInbox />);
  await flush();
  await attach();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: /Enviar para Ana/ })));
  expect(screen.getByLabelText("Prévia do anexo")).toBeTruthy();
  expect(screen.queryByText(/Resultado do envio não confirmado/)).toBeNull();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: /Enviar para Ana/ })));
  expect(mocks.enviar.mock.calls[0]![0].data.requestId).not.toBe(
    mocks.enviar.mock.calls[1]![0].data.requestId,
  );
});

it.each(["IG", "FB", "WhatsApp"])(
  "%s mantém texto mas não promete envio de anexos",
  async (channel) => {
    mocks.contexto.mockResolvedValue({
      ok: true,
      data: ctx({ channel, revision: { ...REV, channel, providerId: null, defaultId: null } }),
    });
    render(<GhlInbox />);
    await flush();
    openMedia();
    expect(
      (screen.getByRole("button", { name: /Anexar imagem ou áudio/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: /Gravar áudio/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    escrever("Resposta textual");
    expect(
      (screen.getByRole("button", { name: /Enviar para Ana/ }) as HTMLButtonElement).disabled,
    ).toBe(false);
  },
);

it("capacidade mediaAllowed=false vinda do servidor mantém só envio de texto", async () => {
  mocks.contexto.mockResolvedValue({ ok: true, data: ctx({ mediaAllowed: false }) });
  render(<GhlInbox />);
  await flush();
  escrever("Resposta de texto");
  openMedia();
  expect(
    (screen.getByRole("button", { name: /Anexar imagem ou áudio/ }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(
    (screen.getByRole("button", { name: /Enviar para Ana/ }) as HTMLButtonElement).disabled,
  ).toBe(false);
});

it("selecionar arquivo e enviar no mesmo frame não envia antes da prévia estar pronta", async () => {
  render(<GhlInbox />);
  await flush();
  escrever("Texto com futura imagem");
  act(() => {
    fireEvent.change(screen.getByLabelText("Selecionar imagem ou áudio"), {
      target: { files: [new File(["imagem"], "foto.png", { type: "image/png" })] },
    });
    screen.getByRole("button", { name: /Enviar para Ana/ }).click();
  });
  expect(mocks.enviar).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.getByLabelText("Prévia do anexo")).toBeTruthy());
  expect(mocks.enviar).not.toHaveBeenCalled();
});

it("recuperação do envio incerto limpa só o anexo que pertence ao pedido confirmado", async () => {
  mocks.enviar.mockRejectedValue(new Error("timeout"));
  mocks.estado.mockResolvedValue({
    ok: true,
    data: { state: "sent", messageId: "media2", manualId: "manual2", code: null },
  });
  render(<GhlInbox />);
  await flush();
  await attach();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: /Enviar para Ana/ })));
  escrever("Novo texto ainda não enviado");
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: /Verificar estado do envio/ })),
  );
  expect(screen.queryByLabelText("Prévia do anexo")).toBeNull();
  expect(campo().value).toBe("Novo texto ainda não enviado");
  expect(mocks.enviar).toHaveBeenCalledTimes(1);
});
function bruno() {
  fireEvent.click(screen.getByRole("button", { name: /Bruno/ }));
}
it("rascunhos de texto são separados por conversa e voltam ao reabrir", () => {
  render(<GhlInbox />);
  fireEvent.change(screen.getByLabelText("Rascunho para Ana"), {
    target: { value: "Privado de Ana" },
  });
  bruno();
  expect((screen.getByLabelText("Rascunho para Bruno") as HTMLTextAreaElement).value).toBe("");
  fireEvent.click(screen.getByRole("button", { name: /Ana Olá/ }));
  expect((screen.getByLabelText("Rascunho para Ana") as HTMLTextAreaElement).value).toBe(
    "Privado de Ana",
  );
  expect(screen.getByText("Rascunho")).toBeTruthy();
  expect(localStorage.length).toBe(0);
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
  fireEvent.click(analysisButton());
  bruno();
  await act(async () =>
    resolver({
      ok: true,
      data: { ...analysis, summary: "Resumo privado de Ana" },
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
  expect((analysisButton() as HTMLButtonElement).disabled).toBe(true);
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
  mocks.corrigir.mockResolvedValue({
    ok: false,
    code: "sem_creditos",
    message: "Sem créditos de IA disponíveis. O texto foi mantido.",
  });
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
  await waitFor(() => expect(mocks.enviar).toHaveBeenCalledTimes(1));
  const arg = mocks.enviar.mock.calls[0]![0].data;
  expect(arg).toMatchObject({
    organizationId: "orgA",
    contactId: "Ana",
    conversationId: "Ana",
    // Texto EXATO visível, com espaços intencionais (sem trim silencioso).
    text: "Texto final  ",
  });
  expect(campo().disabled).toBe(true);
  await act(async () =>
    r({ ok: true, data: { state: "sent", messageId: "m1", code: null, manualId: "x" } }),
  );
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
it("falha definitiva antes do POST liberta; novo clique explícito gera nova chave", async () => {
  mocks.enviar.mockResolvedValue({ ok: false, code: "send_disabled" });
  render(<GhlInbox />);
  await flush();
  escrever("Mensagem");
  const b = () => screen.getByRole("button", { name: /Enviar para Ana/ });
  await act(async () => fireEvent.click(b()));
  await act(async () => fireEvent.click(b()));
  const [a, c] = mocks.enviar.mock.calls.map((x) => x[0].data.requestId);
  expect(c).not.toBe(a);
  escrever("Outra");
  await act(async () => fireEvent.click(b()));
  expect(mocks.enviar.mock.calls[2]![0].data.requestId).not.toBe(a);
});
it("bloqueio do servidor (DND/canal/escopo) desativa Enviar com motivo", async () => {
  mocks.contexto.mockResolvedValue({
    ok: true,
    data: {
      name: "Ana",
      channel: "SMS",
      sendAllowed: false,
      blockedReason: "do_not_contact",
      lastDispatch: null,
    },
  });
  render(<GhlInbox />);
  await flush();
  escrever("Mensagem");
  expect(
    (screen.getByRole("button", { name: /Enviar para Ana/ }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(screen.getByText(/DND ativo/)).toBeTruthy();
});

it("resposta preparada durante envio pendente não substitui o texto nem pode ser reaplicada depois", async () => {
  mocks.analisar.mockResolvedValue({ ok: true, data: analysis });
  let r!: (v: unknown) => void;
  mocks.enviar.mockImplementation(() => new Promise((x) => (r = x)));
  render(<GhlInbox />);
  await flush();
  escrever("Texto enviado");
  await act(async () => fireEvent.click(analysisButton()));
  fireEvent.click(screen.getByRole("button", { name: /Enviar para Ana/ }));
  const usar = screen.getByRole("button", { name: "Substituir meu rascunho" }) as HTMLButtonElement;
  expect(usar.disabled).toBe(true);
  fireEvent.click(usar);
  fireEvent.change(campo(), { target: { value: "edição forçada" } });
  expect(campo().value).toBe("Texto enviado");
  await waitFor(() => expect(mocks.enviar).toHaveBeenCalledTimes(1));
  await act(async () =>
    r({ ok: true, data: { state: "sent", messageId: "m1", code: null, manualId: "x" } }),
  );
  expect(campo().value).toBe("");
  const oldReply = screen.getByRole("button", { name: "Usar no rascunho" }) as HTMLButtonElement;
  expect(oldReply.disabled).toBe(true);
  fireEvent.click(oldReply);
  expect(campo().value).toBe("");
});
it("timeout do navegador: edição posterior não liberta novo POST; só leitura recupera", async () => {
  mocks.enviar.mockRejectedValue(new Error("timeout"));
  mocks.estado.mockResolvedValue({
    ok: true,
    data: { manualId: "m9", state: "sent", messageId: "g9", code: null },
  });
  render(<GhlInbox />);
  await flush();
  escrever("Mensagem");
  await act(async () => fireEvent.click(screen.getByRole("button", { name: /Enviar para Ana/ })));
  const id = mocks.enviar.mock.calls[0]![0].data.requestId;
  escrever("Mensagem editada");
  const b = screen.getByRole("button", { name: /Enviar para Ana/ }) as HTMLButtonElement;
  expect(b.disabled).toBe(true);
  fireEvent.click(b);
  expect(mocks.enviar).toHaveBeenCalledTimes(1);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: /Verificar estado/ })));
  expect(mocks.estado).toHaveBeenCalledWith({ data: { organizationId: "orgA", requestId: id } });
  expect(screen.getByText(/aceite pelo GHL \(ID g9\)/)).toBeTruthy();
  expect(campo().value).toBe("Mensagem editada");
  expect(mocks.enviar).toHaveBeenCalledTimes(1);
});
it("envio incerto persiste ao trocar de conversa e voltar", async () => {
  mocks.enviar.mockRejectedValue(new Error("timeout"));
  render(<GhlInbox />);
  await flush();
  escrever("Mensagem");
  await act(async () => fireEvent.click(screen.getByRole("button", { name: /Enviar para Ana/ })));
  bruno();
  await flush();
  fireEvent.click(screen.getByRole("button", { name: /Ana Olá/ }));
  await flush();
  expect(screen.getByText(/novos envios ficam bloqueados/)).toBeTruthy();
});
it("duplo clique síncrono produz um único pedido", async () => {
  mocks.enviar.mockImplementation(() => new Promise(() => {}));
  render(<GhlInbox />);
  await flush();
  escrever("Mensagem");
  const b = screen.getByRole("button", { name: /Enviar para Ana/ });
  act(() => {
    b.click();
    b.click();
  });
  await waitFor(() => expect(mocks.enviar).toHaveBeenCalledTimes(1));
});
it("capacidade atualizada: conversa mudou desde a revisão bloqueia sem renovar sozinha", async () => {
  render(<GhlInbox />);
  await flush();
  escrever("Mensagem");
  mocks.contexto.mockResolvedValue({
    ok: true,
    data: ctx({ revision: { ...REV, historyHash: "b".repeat(64) } }),
  });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: /Atualizar$/ })));
  expect(screen.getByText(/mudou desde que começou a rever/)).toBeTruthy();
  expect(
    (screen.getByRole("button", { name: /Enviar para Ana/ }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: /Conferi as mensagens novas/ }));
  mocks.enviar.mockResolvedValue({
    ok: true,
    data: { state: "sent", messageId: "m", code: null, manualId: "x" },
  });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: /Enviar para Ana/ })));
  expect(mocks.enviar.mock.calls[0]![0].data.revision.historyHash).toBe("b".repeat(64));
});
it("falha de leitura do contexto torna o envio indisponível", async () => {
  render(<GhlInbox />);
  await flush();
  escrever("Mensagem");
  mocks.contexto.mockResolvedValue({ ok: false, code: "route_unverified" });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: /Atualizar$/ })));
  expect(
    (screen.getByRole("button", { name: /Enviar para Ana/ }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(screen.getByText(/fornecedor real/)).toBeTruthy();
  expect(screen.getByText(/Transporte: não verificado/)).toBeTruthy();
});
it("colar texto acima do limite não corta; mostra contador e bloqueia envio", async () => {
  render(<GhlInbox />);
  await flush();
  escrever("x".repeat(1600));
  expect(campo().value.length).toBe(1600);
  expect(screen.getByText(/1600\/1500/)).toBeTruthy();
  expect(
    (screen.getByRole("button", { name: /Enviar para Ana/ }) as HTMLButtonElement).disabled,
  ).toBe(true);
});

it("quebras de linha e espaços são enviados exatamente como visíveis", async () => {
  mocks.enviar.mockResolvedValue({
    ok: true,
    data: { state: "sent", messageId: "m9", code: null, manualId: "x" },
  });
  render(<GhlInbox />);
  await flush();
  escrever("  Linha 1\n\nLinha 2 ");
  fireEvent.click(screen.getByRole("button", { name: /Enviar para Ana/ }));
  await flush();
  expect(mocks.enviar.mock.calls[0]![0].data.text).toBe("  Linha 1\n\nLinha 2 ");
});
it("timeout antes do prepare + lookup null dentro do prazo: continua bloqueado, zero segundo POST", async () => {
  mocks.enviar.mockRejectedValue(new Error("timeout"));
  mocks.estado.mockResolvedValue({ ok: true, data: null });
  render(<GhlInbox />);
  await flush();
  escrever("Texto A");
  fireEvent.click(screen.getByRole("button", { name: /Enviar para Ana/ }));
  await flush();
  fireEvent.click(screen.getByRole("button", { name: /Verificar estado do envio/ }));
  await flush();
  expect(screen.getByText(/não prova que nada foi enviado/)).toBeTruthy();
  escrever("Texto B");
  const b = screen.getByRole("button", { name: /Enviar para Ana/ }) as HTMLButtonElement;
  expect(b.disabled).toBe(true);
  fireEvent.click(b);
  expect(mocks.enviar).toHaveBeenCalledTimes(1);
});
it("lookup null NUNCA liberta por tempo (entrada HTTP pode chegar >90s depois): zero segundo POST", async () => {
  const agora = Date.now();
  const spy = vi.spyOn(Date, "now").mockReturnValue(agora);
  mocks.enviar.mockRejectedValue(new Error("timeout"));
  mocks.estado.mockResolvedValue({ ok: true, data: null });
  render(<GhlInbox />);
  await flush();
  escrever("Texto A");
  fireEvent.click(screen.getByRole("button", { name: /Enviar para Ana/ }));
  await flush();
  spy.mockReturnValue(agora + 3600_000); // relógio muito adiantado
  fireEvent.click(screen.getByRole("button", { name: /Verificar estado do envio/ }));
  await flush();
  expect(screen.getByText(/não prova que nada foi enviado/)).toBeTruthy();
  expect(screen.queryByText(/Nada foi enviado/)).toBeNull();
  expect(screen.getByText(/Resultado do envio não confirmado/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Enviar para Ana/ }));
  expect(mocks.enviar).toHaveBeenCalledTimes(1);
  spy.mockRestore();
});
it("prepared com relógio do navegador adiantado/expirado continua bloqueado; não há retomada de texto oculto", async () => {
  mocks.enviar.mockRejectedValueOnce(new Error("timeout"));
  mocks.estado.mockResolvedValue({
    ok: true,
    data: {
      state: "prepared",
      manualId: "11111111-1111-4111-8111-111111111111",
      messageId: null,
      code: null,
      expiresAt: new Date(Date.now() - 3600_000).toISOString(),
    },
  });
  render(<GhlInbox />);
  await flush();
  escrever("Texto capturado");
  fireEvent.click(screen.getByRole("button", { name: /Enviar para Ana/ }));
  await flush();
  fireEvent.click(screen.getByRole("button", { name: /Verificar estado do envio/ }));
  await flush();
  expect(
    screen.getByText(/ainda não enviado. O pedido original ainda pode ser processado/),
  ).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Retomar/ })).toBeNull();
  escrever("Texto editado depois");
  fireEvent.click(screen.getByRole("button", { name: /Enviar para Ana/ }));
  await flush();
  expect(mocks.enviar).toHaveBeenCalledTimes(1);
  expect(campo().value).toBe("Texto editado depois");
});
it("rejeição definitiva: novo clique com o MESMO texto gera nova intenção explícita", async () => {
  mocks.enviar
    .mockResolvedValueOnce({
      ok: true,
      data: { state: "rejected", messageId: null, code: "forbidden", manualId: "x" },
    })
    .mockResolvedValueOnce({
      ok: true,
      data: { state: "sent", messageId: "m3", code: null, manualId: "y" },
    });
  render(<GhlInbox />);
  await flush();
  escrever("Mesmo texto");
  fireEvent.click(screen.getByRole("button", { name: /Enviar para Ana/ }));
  await flush();
  expect(campo().value).toBe("Mesmo texto");
  expect(screen.queryByText(/nada foi enviado/i)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Enviar para Ana/ }));
  await flush();
  expect(mocks.enviar).toHaveBeenCalledTimes(2);
  const [a, b] = mocks.enviar.mock.calls.map((c) => c[0].data);
  expect(b.requestId).not.toBe(a.requestId);
  expect(b.text).toBe("Mesmo texto");
});
it("invalidated vira draft_stale: preserva texto e exige leitura atualizada", async () => {
  mocks.enviar.mockResolvedValue({
    ok: true,
    data: { state: "invalidated", messageId: null, code: null, manualId: "x" },
  });
  render(<GhlInbox />);
  await flush();
  const leituras = mocks.contexto.mock.calls.length;
  escrever("Texto mantido");
  fireEvent.click(screen.getByRole("button", { name: /Enviar para Ana/ }));
  await flush();
  expect(
    screen.getByText(/A conversa mudou. Atualize as mensagens; o texto foi mantido/),
  ).toBeTruthy();
  expect(screen.queryByText(/Resultado do envio não confirmado/)).toBeNull();
  expect(campo().value).toBe("Texto mantido");
  expect(mocks.contexto.mock.calls.length).toBeGreaterThan(leituras);
});
it("recarregar a página não contorna envio incerto (intenção mínima persistida, sem texto)", async () => {
  mocks.enviar.mockRejectedValue(new Error("timeout"));
  const { unmount } = render(<GhlInbox />);
  await flush();
  escrever("Texto clínico não persistido");
  fireEvent.click(screen.getByRole("button", { name: /Enviar para Ana/ }));
  await flush();
  const gravado = JSON.stringify(Object.fromEntries(Object.entries(localStorage)));
  expect(gravado).not.toContain("Texto clínico");
  unmount();
  pendentesEnvio.clear(); // simula recarregar: memória perdida
  render(<GhlInbox />);
  await flush();
  expect(screen.getByText(/Resultado do envio não confirmado/)).toBeTruthy();
  escrever("Outro");
  fireEvent.click(screen.getByRole("button", { name: /Enviar para Ana/ }));
  expect(mocks.enviar).toHaveBeenCalledTimes(1);
  expect(lerIntencao("orgA:Ana:Ana")?.requestId).toMatch(/^[0-9a-f-]{36}$/);
});
it("Instagram elegível: informa que a conexão é validada no envio; recusa 403 preserva texto", async () => {
  mocks.contexto.mockResolvedValue({
    ok: true,
    data: ctx({
      channel: "IG",
      transport: "Instagram (integração nativa)",
      connectionVerifiedAtSend: true,
      revision: { ...REV, channel: "IG", providerId: null, defaultId: null },
    }),
  });
  mocks.enviar.mockResolvedValue({
    ok: true,
    data: { state: "rejected", messageId: null, code: "forbidden_provider", manualId: "x" },
  });
  render(<GhlInbox />);
  await flush();
  expect(screen.getByText(/conexão e a permissão serão validadas pelo GHL no envio/)).toBeTruthy();
  escrever("Olá pelo Instagram");
  fireEvent.click(screen.getByRole("button", { name: /Enviar para Ana/ }));
  await flush();
  expect(mocks.enviar.mock.calls[0]![0].data.revision.channel).toBe("IG");
  expect(screen.getByText(/GHL recusou este envio/)).toBeTruthy();
  expect(campo().value).toBe("Olá pelo Instagram");
});
it("canal fora da janela mostra o bloqueio sem presumir prazo igual para envio manual e sugestão", async () => {
  mocks.contexto.mockResolvedValue({
    ok: true,
    data: ctx({ channel: "IG", sendAllowed: false, blockedReason: "channel_window" }),
  });
  render(<GhlInbox />);
  await flush();
  expect(screen.getByText(/janela permitida para responder a esta mensagem encerrou/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Enviar para Ana" })).toHaveProperty("disabled", true);
  expect(mocks.enviar).not.toHaveBeenCalled();
});

it("filtros só usam conversas carregadas e carregar mais continua disponível sem correspondências", async () => {
  mocks.brunoChannel = "TYPE_INSTAGRAM";
  mocks.brunoUnread = 0;
  mocks.hasNextPage = true;
  render(<GhlInbox />);
  await flush();
  escrever("Rascunho de Ana");
  fireEvent.change(screen.getByLabelText("Filtrar por canal"), { target: { value: "Instagram" } });
  expect(screen.queryByRole("button", { name: /Ana Olá/ })).toBeNull();
  expect(screen.getByRole("button", { name: /Bruno Olá/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Não lidas no GHL" }));
  expect(screen.getByText(/0 de 2 · das conversas carregadas/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Carregar mais conversas" }));
  expect(mocks.nextPage).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText("Filtrar por canal"), { target: { value: "all" } });
  fireEvent.click(screen.getByRole("button", { name: "Todas" }));
  expect(campo().value).toBe("Rascunho de Ana");
});

it("trocar organização mantém textos separados, sem conteúdo no armazenamento persistente", async () => {
  const { rerender } = render(<GhlInbox />);
  await flush();
  escrever("Texto da organização A");
  mocks.org = "orgB";
  rerender(<GhlInbox />);
  await flush();
  expect(campo().value).toBe("");
  escrever("Texto da organização B");
  mocks.org = "orgA";
  rerender(<GhlInbox />);
  await flush();
  expect(campo().value).toBe("Texto da organização A");
  expect(localStorage.length).toBe(0);
});

it("voltar à lista mantém texto, descarta anexo e oferece retorno quando seleção desaparece", async () => {
  const { rerender } = render(<GhlInbox />);
  await flush();
  fireEvent.click(screen.getByRole("button", { name: /Ana Olá/ }));
  escrever("Rascunho móvel");
  await attach();
  fireEvent.click(screen.getByRole("button", { name: "Voltar às conversas" }));
  expect(screen.queryByLabelText("Prévia do anexo")).toBeNull();
  expect(campo().value).toBe("Rascunho móvel");
  expect(URL.revokeObjectURL).toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Não lidas no GHL" }));
  bruno();
  mocks.brunoUnread = 0;
  rerender(<GhlInbox />);
  await flush();
  expect(screen.getByRole("button", { name: "Voltar às conversas" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Voltar às conversas" }));
  expect(screen.getByLabelText("Conversas reais").className).not.toContain("hidden lg:flex");
});

const analysis = {
  text: "Sugestão revista",
  language: "PT-PT" as const,
  summary: "Resumo da conversa",
  checkedAt: "2026-11-13T12:00:00Z",
  warnings: [],
  sources: [{ label: "Conversa GHL" }],
  handover: false,
};
it.each(["texto", "histórico anterior", "nova mensagem", "rota", "rascunho"])(
  "resposta Izabel fica bloqueada após mudança de %s e não apaga texto autorado",
  async (change) => {
    mocks.analisar.mockResolvedValue({ ok: true, data: analysis });
    const { rerender } = render(<GhlInbox />);
    await flush();
    escrever("Meu texto autorado");
    await act(async () => fireEvent.click(analysisButton()));
    if (change === "texto") mocks.messageText = "Pergunta editada no mesmo ID";
    if (change === "histórico anterior") mocks.olderMessage = true;
    if (change === "nova mensagem") mocks.extraMessage = true;
    if (change === "rascunho") escrever("Meu texto autorado atualizado");
    if (change === "rota") {
      mocks.contexto.mockResolvedValue({
        ok: true,
        data: ctx({ revision: { ...REV, providerId: "outro" } }),
      });
      await act(async () => fireEvent.click(screen.getByRole("button", { name: /Atualizar$/ })));
    }
    rerender(<GhlInbox />);
    await flush();
    const use = screen.getByRole("button", {
      name: "Substituir meu rascunho",
    }) as HTMLButtonElement;
    expect(use.disabled).toBe(true);
    fireEvent.click(use);
    expect(campo().value).toBe(
      change === "rascunho" ? "Meu texto autorado atualizado" : "Meu texto autorado",
    );
    expect(screen.getByText(/Prepare novamente; seu texto foi preservado/)).toBeTruthy();
    await act(async () => fireEvent.click(analysisButton()));
    expect(
      (screen.getByRole("button", { name: "Substituir meu rascunho" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(campo().value).toBe(
      change === "rascunho" ? "Meu texto autorado atualizado" : "Meu texto autorado",
    );
  },
);

it("mensagem durante preparação mantém resposta antiga desatualizada sem aplicar rascunho", async () => {
  let resolve!: (value: unknown) => void;
  mocks.analisar.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const { rerender } = render(<GhlInbox />);
  await flush();
  fireEvent.click(analysisButton());
  escrever("Não substituir");
  mocks.extraMessage = true;
  rerender(<GhlInbox />);
  await flush();
  await act(async () => resolve({ ok: true, data: analysis }));
  expect(
    (screen.getByRole("button", { name: "Substituir meu rascunho" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(campo().value).toBe("Não substituir");
});

it("Izabel preenche editor vazio com idioma da conversa; humano edita e envia uma única vez", async () => {
  mocks.analisar.mockResolvedValue({
    ok: true,
    data: { ...analysis, language: "FR", text: "Bonjour Ana, quel jour vous convient ?" },
  });
  mocks.enviar.mockResolvedValue({ ok: true, data: { messageId: "one-send" } });
  render(<GhlInbox />);
  await flush();
  expect(mocks.analisar).not.toHaveBeenCalled();
  await act(async () => fireEvent.click(analysisButton()));
  expect(mocks.analisar).toHaveBeenCalledWith({
    data: { organizationId: "orgA", contactId: "Ana", conversationId: "Ana", language: "auto" },
  });
  expect(campo().value).toBe("Bonjour Ana, quel jour vous convient ?");
  expect(mocks.enviar).not.toHaveBeenCalled();
  escrever("Bonjour Ana, préférez-vous le matin ?");
  fireEvent.click(screen.getByRole("button", { name: "Enviar para Ana" }));
  await waitFor(() => expect(mocks.enviar).toHaveBeenCalledTimes(1));
  expect(mocks.enviar.mock.calls[0]?.[0].data.text).toBe("Bonjour Ana, préférez-vous le matin ?");
});

it("substituição pela Izabel é explícita e pode ser desfeita", async () => {
  mocks.analisar.mockResolvedValue({ ok: true, data: analysis });
  render(<GhlInbox />);
  await flush();
  escrever("Meu rascunho");
  await act(async () => fireEvent.click(analysisButton()));
  expect(campo().value).toBe("Meu rascunho");
  fireEvent.click(screen.getByRole("button", { name: "Substituir meu rascunho" }));
  expect(campo().value).toBe(analysis.text);
  fireEvent.click(screen.getByRole("button", { name: "Desfazer alteração do texto" }));
  expect(campo().value).toBe("Meu rascunho");
  expect(mocks.enviar).not.toHaveBeenCalled();
});

it("resposta contextual mantém a proveniência e a aprovação de uma sugestão auditada já em edição", async () => {
  mocks.analisar.mockResolvedValue({ ok: true, data: analysis });
  mocks.enviar.mockResolvedValue({ ok: true, data: { messageId: "audited-send" } });
  render(<GhlInbox />);
  await flush();
  await useSupervisedSuggestion();
  await act(async () => fireEvent.click(analysisButton()));
  expect(campo().value).toBe("Sugestão supervisionada para Ana.");
  fireEvent.click(screen.getByRole("button", { name: "Substituir meu rascunho" }));
  expect(campo().value).toBe(analysis.text);
  expect(screen.queryByRole("button", { name: "Enviar para Ana" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Revisar e aprovar" }));
  fireEvent.click(screen.getByRole("button", { name: "Aprovar e enviar" }));
  await waitFor(() => expect(mocks.enviar).toHaveBeenCalledTimes(1));
  expect(mocks.enviar.mock.calls[0]?.[0].data).toMatchObject({
    text: analysis.text,
    sourceAgentDraft: mocks.sourceAgentDraft,
  });
});

it("sucesso tardio após trocar de conversa limpa só o texto enviado e não reapresenta envio incerto", async () => {
  let resolve!: (value: unknown) => void;
  mocks.enviar.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  render(<GhlInbox />);
  await flush();
  escrever("Texto enviado");
  fireEvent.click(screen.getByRole("button", { name: /Enviar para Ana/ }));
  bruno();
  await flush();
  escrever("Texto privado de Bruno", "Bruno");
  await act(async () =>
    resolve({ ok: true, data: { state: "sent", messageId: "late", code: null, manualId: "m" } }),
  );
  expect(campo("Bruno").value).toBe("Texto privado de Bruno");
  fireEvent.click(screen.getByRole("button", { name: /Ana Olá/ }));
  await flush();
  expect(campo().value).toBe("");
  expect(screen.queryByText(/Resultado do envio não confirmado/)).toBeNull();
  expect(mocks.enviar).toHaveBeenCalledTimes(1);
});

it("sucesso tardio não apaga texto editado ao reabrir conversa; correção tardia não ressuscita envio", async () => {
  let send!: (value: unknown) => void;
  let correct!: (value: unknown) => void;
  mocks.enviar.mockImplementation(
    () =>
      new Promise((r) => {
        send = r;
      }),
  );
  mocks.corrigir.mockImplementation(
    () =>
      new Promise((r) => {
        correct = r;
      }),
  );
  render(<GhlInbox />);
  await flush();
  escrever("Texto enviado");
  fireEvent.click(screen.getByRole("button", { name: /Enviar para Ana/ }));
  bruno();
  await flush();
  fireEvent.click(screen.getByRole("button", { name: /Ana Olá/ }));
  await flush();
  fireEvent.click(screen.getByRole("button", { name: "Corrigir" }));
  await act(async () =>
    send({ ok: true, data: { state: "sent", messageId: "late", code: null, manualId: "m" } }),
  );
  expect(campo().value).toBe("");
  await act(async () => correct({ ok: true, texto: "Texto enviado corrigido" }));
  expect(campo().value).toBe("");
  expect(screen.getByText(/sugestão foi descartada/)).toBeTruthy();
  expect(mocks.enviar).toHaveBeenCalledTimes(1);
});

it("texto restaurado após timeout continua bloqueado; confirmação preserva edição posterior", async () => {
  mocks.enviar.mockRejectedValue(new Error("timeout"));
  mocks.estado.mockResolvedValue({
    ok: true,
    data: { state: "sent", messageId: "verified", manualId: "manual", code: null },
  });
  render(<GhlInbox />);
  await flush();
  escrever("Original");
  await act(async () => fireEvent.click(screen.getByRole("button", { name: /Enviar para Ana/ })));
  bruno();
  await flush();
  fireEvent.click(screen.getByRole("button", { name: /Ana Olá/ }));
  await flush();
  expect(campo().value).toBe("Original");
  expect(
    (screen.getByRole("button", { name: /Enviar para Ana/ }) as HTMLButtonElement).disabled,
  ).toBe(true);
  escrever("Próxima resposta");
  await act(async () => fireEvent.click(screen.getByRole("button", { name: /Verificar estado/ })));
  expect(campo().value).toBe("Próxima resposta");
  expect(mocks.enviar).toHaveBeenCalledTimes(1);
});

it("espera rascunho sem gravar intenção de envio antes de iniciar o POST", async () => {
  let resolveSave!: (value: unknown) => void;
  mocks.loadDraft.mockResolvedValue({ ok: true, data: { revision: null, draft: null } });
  mocks.saveDraft.mockImplementation(
    () =>
      new Promise((r) => {
        resolveSave = r;
      }),
  );
  mocks.enviar.mockRejectedValue(new Error("timeout"));
  render(<GhlInbox />);
  await flush();
  escrever("Texto para conferência");
  fireEvent.click(screen.getByRole("button", { name: /Enviar para Ana/ }));
  await waitFor(() => expect(mocks.saveDraft).toHaveBeenCalledTimes(1));
  expect(mocks.enviar).not.toHaveBeenCalled();
  expect(lerIntencao("orgA:Ana:Ana")).toBeNull();
  const revision = "22222222-2222-4222-8222-222222222222";
  await act(async () =>
    resolveSave({
      ok: true,
      data: {
        revision,
        draft: {
          text: "Texto para conferência",
          updatedAt: "2026-10-13T12:00:00.000Z",
          expiresAt: "2026-10-20T12:00:00.000Z",
        },
      },
    }),
  );
  await waitFor(() => expect(mocks.enviar).toHaveBeenCalledTimes(1));
  expect(lerIntencao("orgA:Ana:Ana")?.draftRevision).toBe(revision);
  expect(mocks.enviar.mock.calls[0]?.[0].data.draftRevision).toBe(revision);
  expect(JSON.stringify(Object.fromEntries(Object.entries(localStorage)))).not.toContain(
    "Texto para conferência",
  );
});

it("reconciliação após recarregar limpa só o rascunho da revisão enviada", async () => {
  const revision = "22222222-2222-4222-8222-222222222222";
  const requestId = "33333333-3333-4333-8333-333333333333";
  const text = "Texto cujo envio será confirmado";
  localStorage.setItem(
    "jornada:envio-pendente:orgA:Ana:Ana",
    JSON.stringify({ requestId, manualId: null, desde: Date.now(), draftRevision: revision }),
  );
  mocks.loadDraft.mockResolvedValue({
    ok: true,
    data: {
      revision,
      draft: { text, updatedAt: "2026-10-13T12:00:00.000Z", expiresAt: "2026-10-20T12:00:00.000Z" },
    },
  });
  mocks.clearDraft.mockResolvedValue({
    ok: true,
    data: { revision: "44444444-4444-4444-8444-444444444444", draft: null },
  });
  mocks.estado.mockResolvedValue({
    ok: true,
    data: { state: "sent", messageId: "verified-message", manualId: "manual-id", code: null },
  });
  render(<GhlInbox />);
  await flush();
  expect(campo().value).toBe(text);
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: /Verificar estado do envio/ })),
  );
  await waitFor(() =>
    expect(mocks.clearDraft).toHaveBeenCalledWith({
      data: {
        organizationId: "orgA",
        contactId: "Ana",
        conversationId: "Ana",
        expectedText: text,
        expectedRevision: revision,
      },
    }),
  );
  expect(campo().value).toBe("");
  expect(mocks.enviar).not.toHaveBeenCalled();
  expect(lerIntencao("orgA:Ana:Ana")).toBeNull();
});

const cleanupEntries = () =>
  Object.keys(localStorage).filter((key) => key.startsWith("jornada:rascunho-limpeza:"));
function privateDraftBackend(initialText = "") {
  const first = "22222222-2222-4222-8222-222222222222";
  let remote: AttendanceDraftSnapshot = {
    revision: initialText ? first : null,
    draft: initialText
      ? { text: initialText, updatedAt: "2026-10-13T12:00:00Z", expiresAt: "2026-10-20T12:00:00Z" }
      : null,
  };
  let next = 3;
  const change = (text: string) => {
    remote = {
      revision: `${String(next++).padStart(8, "0")}-3333-4333-8333-333333333333`,
      draft: text
        ? { text, updatedAt: "2026-10-13T12:00:00Z", expiresAt: "2026-10-20T12:00:00Z" }
        : null,
    };
  };
  mocks.loadDraft.mockImplementation(async () => ({ ok: true, data: remote }));
  mocks.saveDraft.mockImplementation(
    async ({ data }: { data: { text: string; expectedRevision: string | null } }) => {
      if (data.expectedRevision !== remote.revision)
        return { ok: false, code: "draft_conflict", current: remote };
      change(data.text);
      return { ok: true, data: remote };
    },
  );
  mocks.clearDraft.mockImplementation(
    async ({ data }: { data: { expectedText: string; expectedRevision: string | null } }) => {
      if (
        data.expectedRevision !== remote.revision ||
        data.expectedText !== (remote.draft?.text ?? "")
      )
        return { ok: false, code: "draft_conflict", current: remote };
      change("");
      return { ok: true, data: remote };
    },
  );
  return { current: () => remote, change };
}
async function confirmedWithCleanupFailure(text: string) {
  const backend = privateDraftBackend();
  mocks.clearDraft.mockResolvedValueOnce({ ok: false, code: "draft_unavailable" });
  mocks.enviar.mockResolvedValue({
    ok: true,
    data: { state: "sent", messageId: "confirmed-message", manualId: "manual", code: null },
  });
  render(<GhlInbox />);
  await flush();
  escrever(text);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: /Enviar para Ana/ })));
  await waitFor(() => expect(mocks.clearDraft).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Tentar concluir limpeza" })).toBeTruthy(),
  );
  return backend;
}

it("sent e limpeza falha sobrevivem a reload sem reenviar; recuperação explícita conclui o CAS", async () => {
  const text = "Mensagem já aceita, não repetir";
  const backend = await confirmedWithCleanupFailure(text);
  expect(campo().value).toBe("");
  expect(backend.current().draft?.text).toBe(text);
  expect(cleanupEntries()).toHaveLength(1);
  expect(localStorage.getItem(cleanupEntries()[0]!)).not.toContain(text);
  expect(Object.keys(JSON.parse(localStorage.getItem(cleanupEntries()[0]!)!)).sort()).toEqual([
    "confirmedAt",
    "requestId",
    "revision",
  ]);
  expect(lerIntencao("orgA:Ana:Ana")).toBeNull();
  cleanup();
  pendentesEnvio.clear();
  render(<GhlInbox />);
  await flush();
  expect(campo().value).toBe(text);
  expect(screen.getByText("Envio confirmado; limpeza do rascunho pendente.")).toBeTruthy();
  expect(
    (screen.getByRole("button", { name: /Enviar para Ana/ }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(mocks.enviar).toHaveBeenCalledTimes(1);
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Tentar concluir limpeza" })),
  );
  await waitFor(() => expect(cleanupEntries()).toHaveLength(0));
  expect(backend.current().draft).toBeNull();
  expect(campo().value).toBe("");
  expect(mocks.enviar).toHaveBeenCalledTimes(1);
});

it("recuperação offline mantém a pendência e pode ser tentada depois sem repetir mensagem", async () => {
  const backend = await confirmedWithCleanupFailure("Já enviado");
  mocks.loadDraft.mockRejectedValueOnce(new Error("offline"));
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Tentar concluir limpeza" })),
  );
  expect(cleanupEntries()).toHaveLength(1);
  expect(mocks.clearDraft).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Envio confirmado; limpeza do rascunho pendente.")).toBeTruthy();
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Tentar concluir limpeza" })),
  );
  await waitFor(() => expect(cleanupEntries()).toHaveLength(0));
  expect(backend.current().draft).toBeNull();
  expect(mocks.enviar).toHaveBeenCalledTimes(1);
});

it("uma revisão posterior comprovada é preservada e encerra somente a pendência antiga", async () => {
  const backend = await confirmedWithCleanupFailure("Antigo já enviado");
  cleanup();
  backend.change("Novo trabalho salvo em outra aba");
  render(<GhlInbox />);
  await flush();
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Tentar concluir limpeza" })),
  );
  await waitFor(() => expect(cleanupEntries()).toHaveLength(0));
  expect(mocks.clearDraft).toHaveBeenCalledTimes(1);
  expect(campo().value).toBe("Novo trabalho salvo em outra aba");
  expect(backend.current().draft?.text).toBe("Novo trabalho salvo em outra aba");
  expect(mocks.enviar).toHaveBeenCalledTimes(1);
});

it("novo texto digitado após reload é preservado ao limpar a revisão enviada", async () => {
  const backend = await confirmedWithCleanupFailure("Texto enviado");
  cleanup();
  render(<GhlInbox />);
  await flush();
  escrever("Uma resposta nova");
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Tentar concluir limpeza" })),
  );
  await waitFor(() => expect(cleanupEntries()).toHaveLength(0));
  expect(campo().value).toBe("Uma resposta nova");
  await waitFor(() => expect(backend.current().draft?.text).toBe("Uma resposta nova"), {
    timeout: 2500,
  });
  expect(mocks.enviar).toHaveBeenCalledTimes(1);
});

it("a pendência é privada por usuário, organização, contato e conversa", async () => {
  await confirmedWithCleanupFailure("Privado de Ana e da conta a");
  const originalKey = cleanupEntries()[0]!;
  cleanup();
  mocks.escopo = "conta-b";
  mocks.loadDraft.mockResolvedValue({ ok: true, data: { revision: null, draft: null } });
  render(<GhlInbox />);
  await flush();
  expect(screen.queryByText("Envio confirmado; limpeza do rascunho pendente.")).toBeNull();
  expect(mocks.clearDraft).toHaveBeenCalledTimes(1);
  expect(cleanupEntries()).toEqual([originalKey]);
  cleanup();
  mocks.escopo = "conta-a";
  mocks.org = "orgB";
  render(<GhlInbox />);
  await flush();
  expect(screen.queryByText("Envio confirmado; limpeza do rascunho pendente.")).toBeNull();
  cleanup();
  mocks.org = "orgA";
  render(<GhlInbox />);
  await flush();
  bruno();
  await flush();
  expect(screen.queryByText("Envio confirmado; limpeza do rascunho pendente.")).toBeNull();
  expect(mocks.clearDraft).toHaveBeenCalledTimes(1);
  expect(cleanupEntries()).toEqual([originalKey]);
});

it("mídia sem texto e persistência vazia não criam obrigação de limpar rascunho", async () => {
  privateDraftBackend();
  mocks.enviar.mockResolvedValue({
    ok: true,
    data: { state: "sent", messageId: "audio-only", manualId: "manual", code: null },
  });
  render(<GhlInbox />);
  await flush();
  await attach(new File(["audio"], "audio.wav", { type: "audio/wav" }));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: /Enviar para Ana/ })));
  await waitFor(() => expect(mocks.enviar).toHaveBeenCalledTimes(1));
  expect(cleanupEntries()).toHaveLength(0);
  expect(mocks.clearDraft).not.toHaveBeenCalled();
  expect(lerIntencao("orgA:Ana:Ana")).toBeNull();
  expect(mocks.enviar.mock.calls[0]?.[0].data.draftRevision).toBeNull();
});

it.each(["draft_binding_invalid", "draft_binding_conflict", "draft_binding_unavailable"])(
  "%s conserva o pedido e o texto até conferir o ledger, sem repetir o envio",
  async (code) => {
    const backend = privateDraftBackend("Texto privado a revisar");
    mocks.enviar.mockResolvedValue({ ok: false, code });
    mocks.estado.mockResolvedValue({
      ok: true,
      data: { state: "prepared", messageId: null, manualId: "manual", code: null },
    });
    render(<GhlInbox />);
    await flush();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Enviar para Ana/ })));
    await waitFor(() => expect(mocks.enviar).toHaveBeenCalledTimes(1));
    const requestId = mocks.enviar.mock.calls[0]?.[0].data.requestId;
    expect(lerIntencao("orgA:Ana:Ana")?.requestId).toBe(requestId);
    expect((screen.getByLabelText(/Rascunho para Ana/) as HTMLTextAreaElement).value).toBe(
      "Texto privado a revisar",
    );
    expect(backend.current().draft?.text).toBe("Texto privado a revisar");
    expect(mocks.clearDraft).not.toHaveBeenCalled();
    expect(
      (screen.getByRole("button", { name: /Enviar para Ana/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: /Verificar estado/ })),
    );
    expect(mocks.estado).toHaveBeenCalledWith({ data: { organizationId: "orgA", requestId } });
    expect(lerIntencao("orgA:Ana:Ana")?.requestId).toBe(requestId);
    expect(mocks.enviar).toHaveBeenCalledTimes(1);
  },
);

it("limpeza confirmada não apaga nem libera um envio incerto independente", async () => {
  await confirmedWithCleanupFailure("Já enviado antes");
  cleanup();
  const unrelated = "55555555-5555-4555-8555-555555555555";
  localStorage.setItem(
    "jornada:envio-pendente:orgA:Ana:Ana",
    JSON.stringify({ requestId: unrelated, manualId: null, desde: Date.now() }),
  );
  render(<GhlInbox />);
  await flush();
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Tentar concluir limpeza" })),
  );
  await waitFor(() => expect(cleanupEntries()).toHaveLength(0));
  expect(lerIntencao("orgA:Ana:Ana")?.requestId).toBe(unrelated);
  expect(screen.getByRole("button", { name: /Verificar estado do envio/ })).toBeTruthy();
  expect(
    (screen.getByRole("button", { name: /Enviar para Ana/ }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(mocks.enviar).toHaveBeenCalledTimes(1);
});

it("falha ao persistir limpeza conserva a intenção confirmada e avisa para manter a página aberta", async () => {
  const set = Storage.prototype.setItem;
  const failCleanupStorage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
    this: Storage,
    key: string,
    value: string,
  ) {
    if (key.startsWith("jornada:rascunho-limpeza:")) throw new Error("quota");
    return set.call(this, key, value);
  });
  try {
    await confirmedWithCleanupFailure("Texto confirmado");
    expect(cleanupEntries()).toHaveLength(0);
    expect(lerIntencao("orgA:Ana:Ana")?.draftRevision).toBeTruthy();
    expect(screen.getByText(/recuperação da limpeza não foi gravada neste navegador/)).toBeTruthy();
    expect(mocks.enviar).toHaveBeenCalledTimes(1);
  } finally {
    failCleanupStorage.mockRestore();
  }
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Tentar concluir limpeza" })),
  );
  await waitFor(() =>
    expect(screen.queryByText("Envio confirmado; limpeza do rascunho pendente.")).toBeNull(),
  );
  expect(lerIntencao("orgA:Ana:Ana")).toBeNull();
  expect(mocks.enviar).toHaveBeenCalledTimes(1);
});

it("painel da Izabel não tem modelos, texto-base nem tradutor", async () => {
  mocks.enviar.mockResolvedValue({ ok: true, data: { messageId: "one-send" } });
  render(<GhlInbox />);
  await flush();
  escrever("Minha resposta");
  fireEvent.click(screen.getByRole("button", { name: "Abrir Izabel" }));
  expect(screen.queryByText("Modelos de apoio")).toBeNull();
  expect(campo().value).toBe("Minha resposta");
  expect(screen.queryByRole("button", { name: "Abrir tradutor" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Texto-base" })).toBeNull();
  expect(mocks.enviar).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Enviar para Ana" }));
  await waitFor(() => expect(mocks.enviar).toHaveBeenCalledTimes(1));
  expect(mocks.enviar.mock.calls[0]?.[0].data.text).toBe("Minha resposta");
});

it("sugestão supervisionada fica na conversa e só preenche o editor, sem envio ou análise nova", async () => {
  render(<GhlInbox />);
  await flush();
  openSuggestion();
  expect(screen.getByText("Supervisão Ana Ana")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Analisar conversa" })).toBeNull();
  expect(campo().value).toBe("");
  await useSupervisedSuggestion();
  expect(mocks.suggestionResult).toHaveBeenLastCalledWith(true);
  expect(campo().value).toBe("Sugestão supervisionada para Ana.");
  expect(screen.getByRole("button", { name: "Revisar e aprovar" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Enviar para Ana" })).toBeNull();
  expect(mocks.enviar).not.toHaveBeenCalled();
  expect(mocks.analisar).not.toHaveBeenCalled();
  expect(mocks.corrigir).not.toHaveBeenCalled();
});

it("aprovação explícita envia uma vez o texto editado visível e a referência exata da sugestão", async () => {
  let resolve!: (value: unknown) => void;
  mocks.enviar.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  render(<GhlInbox />);
  await flush();
  await useSupervisedSuggestion();
  const text = "  Olá Ana!\nQual dia funciona melhor?  ";
  escrever(text);
  fireEvent.click(screen.getByRole("button", { name: "Revisar e aprovar" }));
  const dialog = await screen.findByRole("dialog", { name: "Aprovar resposta para Ana" });
  expect(
    within(dialog).getByText(
      (_content, node) => node?.tagName === "P" && node.textContent === text,
    ),
  ).toBeTruthy();
  expect(mocks.enviar).not.toHaveBeenCalled();
  const approve = within(dialog).getByRole("button", { name: "Aprovar e enviar" });
  act(() => {
    approve.click();
    approve.click();
  });
  await waitFor(() => expect(mocks.enviar).toHaveBeenCalledTimes(1));
  expect(mocks.enviar.mock.calls[0]?.[0].data).toMatchObject({
    organizationId: "orgA",
    contactId: "Ana",
    conversationId: "Ana",
    text,
    sourceAgentDraft: mocks.sourceAgentDraft,
    revision: REV,
  });
  expect(mocks.enviar.mock.calls[0]?.[0].data).not.toHaveProperty("attachments");
  await act(async () =>
    resolve({
      ok: true,
      data: {
        state: "sent",
        messageId: "supervised-accepted",
        manualId: "manual-review",
        code: null,
      },
    }),
  );
  expect(campo().value).toBe("");
  expect(screen.getByRole("button", { name: "Enviar para Ana" })).toBeTruthy();
});

it("voltar ao texto preserva sugestão e origem sem tratar fechamento como aprovação", async () => {
  mocks.enviar.mockResolvedValue({ ok: false, code: "send_disabled" });
  render(<GhlInbox />);
  await flush();
  await useSupervisedSuggestion();
  fireEvent.click(screen.getByRole("button", { name: "Revisar e aprovar" }));
  fireEvent.click(await screen.findByRole("button", { name: "Voltar ao texto" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(campo().value).toBe("Sugestão supervisionada para Ana.");
  expect(mocks.enviar).not.toHaveBeenCalled();
  escrever("Texto revisto novamente");
  fireEvent.click(screen.getByRole("button", { name: "Revisar e aprovar" }));
  await act(async () =>
    fireEvent.click(await screen.findByRole("button", { name: "Aprovar e enviar" })),
  );
  expect(mocks.enviar.mock.calls[0]?.[0].data).toMatchObject({
    text: "Texto revisto novamente",
    sourceAgentDraft: mocks.sourceAgentDraft,
  });
});

it("nova mensagem durante a aprovação invalida o diálogo sem enviar nem apagar o texto", async () => {
  const ui = render(<GhlInbox />);
  await flush();
  await useSupervisedSuggestion();
  escrever("Texto conferido pela equipe");
  fireEvent.click(screen.getByRole("button", { name: "Revisar e aprovar" }));
  await screen.findByRole("dialog", { name: "Aprovar resposta para Ana" });
  mocks.extraMessage = true;
  ui.rerender(<GhlInbox />);
  await flush();
  expect(screen.getByRole("alert").textContent).toContain("A conversa ou o rascunho mudou");
  const approve = screen.getByRole("button", { name: "Aprovar e enviar" });
  expect(approve).toHaveProperty("disabled", true);
  fireEvent.click(approve);
  expect(mocks.enviar).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Voltar ao texto" }));
  expect(campo().value).toBe("Texto conferido pela equipe");
});

it.each(["próximo atendimento", "seleção na lista"])(
  "%s preserva texto editado e origem da sugestão no contato correto",
  async (navigation) => {
    mocks.enviar.mockResolvedValue({ ok: false, code: "send_disabled" });
    render(<GhlInbox />);
    await flush();
    await useSupervisedSuggestion();
    escrever("Revisão privada de Ana");
    if (navigation === "próximo atendimento")
      fireEvent.click(screen.getByRole("button", { name: "Próximo atendimento" }));
    else bruno();
    await flush();
    expect(campo("Bruno").value).toBe("");
    expect(screen.getByRole("button", { name: "Enviar para Bruno" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Revisar e aprovar" })).toBeNull();
    escrever("Rascunho privado de Bruno", "Bruno");
    fireEvent.click(screen.getByRole("button", { name: /Ana Olá/ }));
    await flush();
    expect(campo().value).toBe("Revisão privada de Ana");
    fireEvent.click(screen.getByRole("button", { name: "Revisar e aprovar" }));
    await act(async () =>
      fireEvent.click(await screen.findByRole("button", { name: "Aprovar e enviar" })),
    );
    expect(mocks.enviar.mock.calls[0]?.[0].data).toMatchObject({
      text: "Revisão privada de Ana",
      contactId: "Ana",
      conversationId: "Ana",
      sourceAgentDraft: mocks.sourceAgentDraft,
    });
    expect(mocks.enviar).toHaveBeenCalledTimes(1);
  },
);

it("recusa callback de sugestão de outro contato sem trocar o rascunho atual", async () => {
  render(<GhlInbox />);
  await flush();
  escrever("Texto autorado para Ana");
  openSuggestion();
  fireEvent.click(screen.getByRole("button", { name: "Tentar sugestão de outro contato" }));
  expect(mocks.suggestionResult).toHaveBeenLastCalledWith(false);
  expect(campo().value).toBe("Texto autorado para Ana");
  expect(screen.getByRole("button", { name: "Enviar para Ana" })).toBeTruthy();
  expect(mocks.enviar).not.toHaveBeenCalled();
});

it("rascunho salvo com origem mantém aprovação obrigatória depois de recarregar", async () => {
  let remote: AttendanceDraftSnapshot = { revision: null, draft: null };
  mocks.loadDraft.mockImplementation(async () => ({ ok: true, data: remote }));
  mocks.saveDraft.mockImplementation(
    async ({
      data,
    }: {
      data: { text: string; sourceAgentDraft?: typeof mocks.sourceAgentDraft };
    }) => {
      remote = {
        revision: "88888888-8888-4888-8888-888888888888",
        draft: {
          text: data.text,
          updatedAt: "2026-11-13T00:00:00Z",
          expiresAt: "2026-11-20T00:00:00Z",
          ...(data.sourceAgentDraft ? { sourceAgentDraft: data.sourceAgentDraft } : {}),
        },
      };
      return { ok: true, data: remote };
    },
  );
  mocks.enviar.mockResolvedValue({ ok: false, code: "send_disabled" });
  const ui = render(<GhlInbox />);
  await flush();
  await useSupervisedSuggestion();
  escrever("Revisão editada e salva");
  await waitFor(
    () =>
      expect(mocks.saveDraft).toHaveBeenCalledWith({
        data: {
          organizationId: "orgA",
          contactId: "Ana",
          conversationId: "Ana",
          text: "Revisão editada e salva",
          expectedRevision: null,
          sourceAgentDraft: mocks.sourceAgentDraft,
        },
      }),
    { timeout: 3000 },
  );
  expect(mocks.enviar).not.toHaveBeenCalled();
  ui.unmount();
  render(<GhlInbox />);
  await flush();
  expect(campo().value).toBe("Revisão editada e salva");
  fireEvent.click(screen.getByRole("button", { name: "Revisar e aprovar" }));
  await act(async () =>
    fireEvent.click(await screen.findByRole("button", { name: "Aprovar e enviar" })),
  );
  expect(mocks.enviar.mock.calls[0]?.[0].data).toMatchObject({
    text: "Revisão editada e salva",
    sourceAgentDraft: mocks.sourceAgentDraft,
    draftRevision: "88888888-8888-4888-8888-888888888888",
  });
});

it("sugestão revisada rejeitada preserva texto e orienta nova revisão humana, sem incentivar repetição", async () => {
  mocks.enviar.mockResolvedValue({
    ok: true,
    data: {
      state: "rejected",
      messageId: null,
      manualId: "rejected-review",
      code: "forbidden_provider",
    },
  });
  render(<GhlInbox />);
  await flush();
  await useSupervisedSuggestion();
  const text = "Texto revisado pela equipe e recusado pelo canal";
  escrever(text);
  fireEvent.click(screen.getByRole("button", { name: "Revisar e aprovar" }));
  await act(async () =>
    fireEvent.click(await screen.findByRole("button", { name: "Aprovar e enviar" })),
  );
  expect(
    await screen.findByText(
      /esta sugestão já foi tratada e precisa de uma nova revisão pelo atendimento humano/,
    ),
  ).toBeTruthy();
  expect(screen.queryByText(/Pode tentar de novo com um novo clique/)).toBeNull();
  expect(screen.queryByText(/Resultado do envio não confirmado/)).toBeNull();
  expect(campo().value).toBe(text);
  expect(screen.getByRole("button", { name: "Revisar e aprovar" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Enviar para Ana" })).toBeNull();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: /Atualizar$/ })));
  expect(mocks.enviar).toHaveBeenCalledTimes(1);
  expect(mocks.enviar.mock.calls[0]?.[0].data).toMatchObject({
    text,
    sourceAgentDraft: mocks.sourceAgentDraft,
  });
  expect(lerIntencao("orgA:Ana:Ana")).toBeNull();
});

it("review_retry_required informa encerramento antes do envio e preserva texto e origem para nova aprovação explícita", async () => {
  mocks.enviar
    .mockResolvedValueOnce({
      ok: true,
      data: {
        state: "invalidated",
        messageId: null,
        manualId: "cancelled-review",
        code: "review_retry_required",
      },
    })
    .mockResolvedValue({ ok: false, code: "send_disabled" });
  render(<GhlInbox />);
  await flush();
  await useSupervisedSuggestion();
  const text = "Texto aprovado cuja preparação foi interrompida";
  escrever(text);
  const readsBefore = mocks.contexto.mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "Revisar e aprovar" }));
  await act(async () =>
    fireEvent.click(await screen.findByRole("button", { name: "Aprovar e enviar" })),
  );
  expect(
    await screen.findByText(
      "A tentativa foi encerrada antes do envio. Atualize o contexto e revise a resposta novamente.",
    ),
  ).toBeTruthy();
  expect(screen.queryByText(/A conversa mudou. Atualize as mensagens/)).toBeNull();
  expect(screen.queryByText(/Resultado do envio não confirmado/)).toBeNull();
  expect(campo().value).toBe(text);
  expect(mocks.contexto.mock.calls.length).toBeGreaterThan(readsBefore);
  expect(mocks.refetch).toHaveBeenCalled();
  expect(mocks.enviar).toHaveBeenCalledTimes(1);
  expect(lerIntencao("orgA:Ana:Ana")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Revisar e aprovar" }));
  const dialog = await screen.findByRole("dialog", { name: "Aprovar resposta para Ana" });
  expect(within(dialog).getByText(text)).toBeTruthy();
  expect(mocks.enviar).toHaveBeenCalledTimes(1);
  await act(async () =>
    fireEvent.click(within(dialog).getByRole("button", { name: "Aprovar e enviar" })),
  );
  expect(mocks.enviar).toHaveBeenCalledTimes(2);
  const first = mocks.enviar.mock.calls[0]?.[0].data;
  const second = mocks.enviar.mock.calls[1]?.[0].data;
  expect(second).toMatchObject({ text, sourceAgentDraft: mocks.sourceAgentDraft });
  expect(second.requestId).not.toBe(first.requestId);
  expect(campo().value).toBe(text);
});

it("Agendar agora mantém rascunho e origem auditada e não envia mensagem", async () => {
  render(<GhlInbox />);
  await flush();
  await useSupervisedSuggestion();
  escrever("Texto em revisão antes de agendar");
  fireEvent.click(screen.getByRole("button", { name: "Agendar agora" }));
  expect(screen.getByText("Agendar para Ana (Ana)")).toBeTruthy();
  expect(campo().value).toBe("Texto em revisão antes de agendar");
  fireEvent.click(screen.getByRole("button", { name: "Confirmar agendamento sintético" }));
  expect(campo().value).toBe("Texto em revisão antes de agendar");
  expect(screen.getByRole("button", { name: "Revisar e aprovar" })).toBeTruthy();
  expect(mocks.enviar).not.toHaveBeenCalled();
});

it("Agendar agora fixa o contato da conversa atual", async () => {
  render(<GhlInbox />);
  await flush();
  bruno();
  await flush();
  fireEvent.click(screen.getByRole("button", { name: "Agendar agora" }));
  expect(screen.getByText("Agendar para Bruno (Bruno)")).toBeTruthy();
  expect(screen.queryByText("Agendar para Ana (Ana)")).toBeNull();
});
