// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommercialAgentManual, type ManualActions } from "./commercial-agent-manual";
import type {
  ManualContext,
  ManualConversation,
  ManualPrepared,
} from "@/lib/commercial-agent/core";
import type { ManualQueuePage } from "@/lib/commercial-agent/queue-read";

function fixture(paused = true) {
  const conversation: ManualConversation = {
    locationId: "loc-test",
    contactId: "c-test",
    conversationId: "v-test",
    sessionVersion: 1,
    paused,
    optOut: false,
    lastMessageAt: new Date().toISOString(),
  };
  let context: ManualContext = {
    snapshot: {
      event: {
        type: "InboundMessage",
        locationId: "loc-test",
        contactId: "c-test",
        conversationId: "v-test",
        messageId: "inbound-test",
      },
      messages: [
        {
          id: "inbound-test",
          at: new Date().toISOString(),
          direction: "inbound",
          text: "Como funciona a consulta?",
          channel: "SMS",
          attachments: 0,
          provider: "provider-test",
        },
      ],
      dnd: false,
      name: "Ana Fictícia",
      historyHash: "a".repeat(64),
    },
    sessionVersion: 1,
    paused,
    optOut: false,
    sendAllowed: true,
    blockedReason: null,
  };
  let prepared: ManualPrepared;
  const actions: ManualActions = {
    context: vi.fn(async () => structuredClone(context)),
    pause: vi.fn(async (_c, _v, p) => {
      context.paused = p;
      conversation.paused = p;
      conversation.sessionVersion++;
      context.sessionVersion = conversation.sessionVersion;
    }),
    prepare: vi.fn(async (input) => {
      conversation.sessionVersion++;
      context.sessionVersion = conversation.sessionVersion;
      prepared = {
        id: "manual-test",
        replyHash: "b".repeat(64),
        text: input.text,
        snapshot: structuredClone(context.snapshot),
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        sessionVersion: context.sessionVersion,
      };
      return prepared;
    }),
    send: vi.fn(async () => ({ state: "sent", code: null, messageId: "sent-test" })),
    reconcile: vi.fn(async () => {
      delete context.lastDispatch;
      context.sendAllowed = true;
      context.blockedReason = null;
    }),
    refresh: vi.fn(async () => {}),
  };
  const props = { conversations: [conversation], actions };
  return {
    props,
    actions,
    conversation,
    get context() {
      return context;
    },
    setContext(value: ManualContext) {
      context = value;
    },
  };
}
async function selectContact(value = "c-test:v-test") {
  const change = screen.queryByRole("button", { name: "Trocar conversa" });
  if (change) fireEvent.click(change);
  const conversationId = value.split(":")[1]!;
  fireEvent.click(
    await screen.findByRole("button", {
      name: new RegExp(`Abrir conversa de .* · ${conversationId.slice(-8)}$`),
    }),
  );
  await screen.findByLabelText(/Sua mensagem para/);
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Atualizar histórico" }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
}
async function compose(text = "Mensagem escrita pela equipe.") {
  fireEvent.change(screen.getByLabelText(/Sua mensagem para/), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Revisar mensagem manual" }));
  await screen.findByRole("dialog");
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Confirmar e enviar mensagem manual",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function searchPage(
  f: ReturnType<typeof fixture>,
  overrides: Partial<ManualQueuePage> = {},
): ManualQueuePage {
  return {
    items: [{ ...f.conversation, contactName: "Ana Canônica", channel: "SMS" }],
    page: 1,
    pageSize: 25,
    total: 1,
    totalPages: 1,
    hasMore: false,
    asOf: "2026-11-12T12:00:00.000Z",
    query: "",
    ...overrides,
  };
}
describe("busca paginada de conversas", () => {
  it("usa o nome canônico e busca apenas a primeira página sem abrir histórico nem executar comandos", async () => {
    const f = fixture();
    f.actions.search = vi.fn(async () => searchPage(f));
    render(<CommercialAgentManual {...f.props} names={{ "c-test": "Nome de rascunho antigo" }} />);
    await act(async () => {});
    await screen.findByText("Ana Canônica");
    expect(f.actions.search).toHaveBeenCalledWith({ query: "", page: 1, pageSize: 25 });
    expect(screen.queryByText("Nome de rascunho antigo")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    for (const action of [
      f.actions.context,
      f.actions.pause,
      f.actions.prepare,
      f.actions.send,
      f.actions.reconcile,
    ])
      expect(action).not.toHaveBeenCalled();
    await selectContact();
    expect(screen.queryByRole("list", { name: "Conversas encontradas" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Ana Canônica" }));
    fireEvent.click(screen.getByRole("button", { name: "Trocar conversa" }));
    expect(document.activeElement).toBe(screen.getByLabelText("Nome ou ID do contato"));
    expect(f.actions.context).toHaveBeenCalledTimes(1);
    expect(f.actions.pause).not.toHaveBeenCalled();
  });
  it("página seguinte preserva o snapshot e uma nova busca reinicia a paginação", async () => {
    const f = fixture();
    f.actions.search = vi.fn(async (request) =>
      searchPage(f, {
        page: request.page,
        query: request.query,
        hasMore: request.page === 1,
        total: 30,
        totalPages: 2,
      }),
    );
    render(<CommercialAgentManual {...f.props} />);
    await act(async () => {});
    fireEvent.click(await screen.findByRole("button", { name: "Próximas conversas" }));
    await waitFor(() =>
      expect(f.actions.search).toHaveBeenLastCalledWith({
        query: "",
        page: 2,
        pageSize: 25,
        asOf: "2026-11-12T12:00:00.000Z",
      }),
    );
    await screen.findByText("Página 2");
    fireEvent.change(screen.getByLabelText("Nome ou ID do contato"), {
      target: { value: " Ana " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Buscar conversa" }));
    await waitFor(() =>
      expect(f.actions.search).toHaveBeenLastCalledWith({ query: "Ana", page: 1, pageSize: 25 }),
    );
    expect(f.actions.context).not.toHaveBeenCalled();
  });
  it("descarta a resposta atrasada de uma busca anterior", async () => {
    const f = fixture();
    let finishOld!: (value: ManualQueuePage) => void;
    f.actions.search = vi.fn((request) =>
      request.query
        ? Promise.resolve(searchPage(f, { query: request.query }))
        : new Promise<ManualQueuePage>((resolve) => {
            finishOld = resolve;
          }),
    );
    render(<CommercialAgentManual {...f.props} />);
    await act(async () => {});
    await waitFor(() => expect(f.actions.search).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("Nome ou ID do contato"), { target: { value: "Ana" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar conversa" }));
    await screen.findByText("Ana Canônica");
    await act(async () =>
      finishOld(
        searchPage(f, {
          items: [{ ...f.conversation, contactName: "Resposta antiga", channel: null }],
        }),
      ),
    );
    expect(screen.queryByText("Resposta antiga")).toBeNull();
    expect(screen.getByText("Resultados para “Ana”")).toBeTruthy();
  });
  it("retira resultados antigos na falha e só repete a leitura mediante ação explícita", async () => {
    const f = fixture();
    f.actions.search = vi
      .fn()
      .mockResolvedValueOnce(searchPage(f))
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce(searchPage(f, { items: [], total: 0, totalPages: 0, query: "Bruno" }));
    render(<CommercialAgentManual {...f.props} />);
    await act(async () => {});
    await screen.findByText("Ana Canônica");
    fireEvent.change(screen.getByLabelText("Nome ou ID do contato"), {
      target: { value: "Bruno" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Buscar conversa" }));
    await screen.findByText("A busca não foi concluída. Tente novamente.");
    expect(screen.queryByText("Ana Canônica")).toBeNull();
    expect(f.actions.search).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Tentar busca novamente" }));
    await screen.findByText(/Nenhuma conversa encontrada/);
    expect(f.actions.context).not.toHaveBeenCalled();
  });
  it("expõe ID e canal desconhecido sem inventar nome ou canal", async () => {
    const f = fixture();
    f.actions.search = vi.fn(async () =>
      searchPage(f, { items: [{ ...f.conversation, contactName: null, channel: null }] }),
    );
    render(<CommercialAgentManual {...f.props} names={{ "c-test": "Nome de outro histórico" }} />);
    await act(async () => {});
    await screen.findByText("Contato sem nome · c-test");
    expect(screen.getByText(/Canal a conferir/)).toBeTruthy();
    expect(screen.queryByText("Nome de outro histórico")).toBeNull();
  });
  it("preserva o contato selecionado e o rascunho quando a pesquisa muda de página", async () => {
    const f = fixture();
    f.props.conversations = [];
    f.actions.search = vi.fn(async (request) =>
      searchPage(f, {
        query: request.query,
        items: request.query
          ? []
          : [{ ...f.conversation, contactName: "Ana Canônica", channel: "SMS" }],
      }),
    );
    render(<CommercialAgentManual {...f.props} />);
    await act(async () => {});
    await selectContact();
    fireEvent.change(screen.getByLabelText(/Sua mensagem para/), {
      target: { value: "Rascunho exclusivo da Ana" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Trocar conversa" }));
    fireEvent.change(screen.getByLabelText("Nome ou ID do contato"), {
      target: { value: "Ausente" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Buscar conversa" }));
    await screen.findByText(/Nenhuma conversa encontrada/);
    expect((screen.getByLabelText(/Sua mensagem para/) as HTMLTextAreaElement).value).toBe(
      "Rascunho exclusivo da Ana",
    );
    expect(f.actions.context).toHaveBeenCalledTimes(1);
    expect(f.actions.prepare).not.toHaveBeenCalled();
    expect(f.actions.send).not.toHaveBeenCalled();
  });
  it("bloqueia uma revisão já aberta quando a fila perde disponibilidade", async () => {
    const f = fixture();
    const view = render(<CommercialAgentManual {...f.props} />);
    await act(async () => {});
    await selectContact();
    await compose("Revisão preservada, envio bloqueado.");
    view.rerender(<CommercialAgentManual {...f.props} disabled />);
    const send = screen.getByRole("button", {
      name: "Confirmar e enviar mensagem manual",
    }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.click(send);
    expect(f.actions.send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Voltar à edição" }));
    expect((screen.getByLabelText(/Sua mensagem para/) as HTMLTextAreaElement).value).toBe(
      "Revisão preservada, envio bloqueado.",
    );
    expect(
      (screen.getByRole("button", { name: "Devolver ao agente" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
  it("atualiza a versão do selecionado após assumir quando a lista completa não está carregada", async () => {
    const f = fixture(false);
    f.props.conversations = [];
    f.actions.search = vi.fn(async () => searchPage(f));
    render(<CommercialAgentManual {...f.props} />);
    await act(async () => {});
    await selectContact();
    fireEvent.click(screen.getByRole("button", { name: "Assumir conversa para escrever" }));
    await waitFor(() =>
      expect((screen.getByLabelText(/Sua mensagem para/) as HTMLTextAreaElement).disabled).toBe(
        false,
      ),
    );
    await compose("Mensagem depois de assumir.");
    expect(f.actions.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedVersion: 2,
        contactId: "c-test",
        conversationId: "v-test",
      }),
    );
    expect(f.actions.send).not.toHaveBeenCalled();
  });
});
describe("barra de atendimento manual", () => {
  it("exige escolher contato e assumir, sem enviar ao abrir ou escrever", async () => {
    const f = fixture(false);
    render(<CommercialAgentManual {...f.props} />);
    expect(f.actions.context).not.toHaveBeenCalled();
    await selectContact();
    expect((screen.getByLabelText(/Sua mensagem para/) as HTMLTextAreaElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Assumir conversa para escrever" }));
    await waitFor(() =>
      expect((screen.getByLabelText(/Sua mensagem para/) as HTMLTextAreaElement).disabled).toBe(
        false,
      ),
    );
    expect(f.actions.pause).toHaveBeenCalledWith(f.conversation, 1, true);
    fireEvent.change(screen.getByLabelText(/Sua mensagem para/), {
      target: { value: "Estou acompanhando seu atendimento." },
    });
    expect(f.actions.prepare).not.toHaveBeenCalled();
    expect(f.actions.send).not.toHaveBeenCalled();
  });
  it("confirma o texto exato e usa somente o destinatário da revisão", async () => {
    const f = fixture();
    render(<CommercialAgentManual {...f.props} />);
    await selectContact();
    await compose("Texto humano revisado.");
    expect(f.actions.send).not.toHaveBeenCalled();
    expect(f.actions.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: "c-test",
        conversationId: "v-test",
        historyHash: "a".repeat(64),
        text: "Texto humano revisado.",
        expectedVersion: 1,
        requestId: expect.any(String),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirmar e enviar mensagem manual" }));
    await screen.findByText(/Mensagem manual aceita pelo HighLevel/);
    expect(f.actions.send).toHaveBeenCalledTimes(1);
    expect(f.actions.send).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Texto humano revisado.",
        snapshot: expect.objectContaining({
          event: expect.objectContaining({ contactId: "c-test", conversationId: "v-test" }),
        }),
      }),
    );
    expect((screen.getByLabelText(/Sua mensagem para/) as HTMLTextAreaElement).value).toBe("");
    expect(f.actions.pause).not.toHaveBeenCalled();
  });
  it("cancelar revisão não envia e preserva o texto", async () => {
    const f = fixture();
    render(<CommercialAgentManual {...f.props} />);
    await selectContact();
    await compose();
    fireEvent.click(screen.getByRole("button", { name: "Voltar à edição" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(f.actions.send).not.toHaveBeenCalled();
    expect((screen.getByLabelText(/Sua mensagem para/) as HTMLTextAreaElement).value).toBe(
      "Mensagem escrita pela equipe.",
    );
  });
  it.each(["do_not_contact", "channel_window", "unsupported_channel", "send_disabled"])(
    "explica e bloqueia %s",
    async (code) => {
      const f = fixture();
      f.context.sendAllowed = false;
      f.context.blockedReason = code;
      render(<CommercialAgentManual {...f.props} />);
      await selectContact();
      expect((screen.getByLabelText(/Sua mensagem para/) as HTMLTextAreaElement).disabled).toBe(
        true,
      );
      expect(
        (screen.getByRole("button", { name: "Revisar mensagem manual" }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
      expect(screen.getByRole("alert")).toBeTruthy();
      expect(f.actions.send).not.toHaveBeenCalled();
    },
  );
  it("alteração de versão enquanto a pessoa revisa desabilita a confirmação", async () => {
    const f = fixture();
    const r = render(<CommercialAgentManual {...f.props} />);
    await selectContact();
    await compose();
    f.conversation.sessionVersion++;
    r.rerender(<CommercialAgentManual {...f.props} />);
    expect(
      (
        screen.getByRole("button", {
          name: "Confirmar e enviar mensagem manual",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(f.actions.send).not.toHaveBeenCalled();
  });
  it("não repete resultado incerto e permite conferir recibo", async () => {
    const f = fixture();
    vi.mocked(f.actions.send).mockImplementation(async () => {
      f.context.lastDispatch = {
        id: "manual-test",
        state: "unknown",
        replyHash: "b".repeat(64),
        messageId: null,
        errorCode: "send_unknown",
      };
      f.context.sendAllowed = false;
      f.context.blockedReason = "reconciliation_required";
      return { state: "unknown", code: "send_unknown", messageId: null };
    });
    render(<CommercialAgentManual {...f.props} />);
    await selectContact();
    await compose();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar e enviar mensagem manual" }));
    await screen.findByText(/Não foi possível confirmar o envio/);
    expect(f.actions.send).toHaveBeenCalledTimes(1);
    expect(
      (screen.getByRole("button", { name: "Revisar mensagem manual" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.change(screen.getByLabelText("ID da mensagem encontrada no HighLevel"), {
      target: { value: "receipt-test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Conferir envio manual" }));
    await screen.findByText(/Mensagem conferida/);
    expect(f.actions.reconcile).toHaveBeenCalledWith("manual-test", "receipt-test");
    expect(f.actions.send).toHaveBeenCalledTimes(1);
  });
  it("falha de rede no envio fecha a confirmação e mostra o estado canônico sem repetir", async () => {
    const f = fixture();
    vi.mocked(f.actions.send).mockImplementation(async () => {
      f.context.lastDispatch = {
        id: "manual-test",
        state: "unknown",
        replyHash: "b".repeat(64),
        messageId: null,
        errorCode: "send_unknown",
      };
      f.context.sendAllowed = false;
      f.context.blockedReason = "reconciliation_required";
      throw new Error("send_unknown");
    });
    render(<CommercialAgentManual {...f.props} />);
    await selectContact();
    await compose();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar e enviar mensagem manual" }));
    await screen.findByText(/Não foi possível confirmar o envio/);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(f.actions.send).toHaveBeenCalledTimes(1);
  });
  it("não transforma falha de atualização em falha do envio aceito", async () => {
    const f = fixture();
    render(<CommercialAgentManual {...f.props} />);
    await selectContact();
    await compose();
    vi.mocked(f.actions.context).mockRejectedValueOnce(new Error("history_unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar e enviar mensagem manual" }));
    await screen.findByText(/Mensagem manual aceita pelo HighLevel.*Não foi possível atualizar/);
    expect(f.actions.send).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText(/Sua mensagem para/) as HTMLTextAreaElement).value).toBe("");
  });
  it("não mistura o texto de contatos ao trocar de conversa", async () => {
    const f = fixture();
    const second = { ...f.conversation, contactId: "c-second", conversationId: "v-second" };
    f.props.conversations.push(second);
    vi.mocked(f.actions.context).mockImplementation(async (c) => ({
      ...structuredClone(f.context),
      snapshot: {
        ...structuredClone(f.context.snapshot),
        name: c.contactId,
        event: {
          ...f.context.snapshot.event,
          contactId: c.contactId,
          conversationId: c.conversationId,
        },
      },
    }));
    render(<CommercialAgentManual {...f.props} />);
    await selectContact();
    fireEvent.change(screen.getByLabelText(/Sua mensagem para/), {
      target: { value: "Texto somente para o primeiro." },
    });
    await selectContact("c-second:v-second");
    expect((screen.getByLabelText(/Sua mensagem para/) as HTMLTextAreaElement).value).toBe("");
    await selectContact();
    expect((screen.getByLabelText(/Sua mensagem para/) as HTMLTextAreaElement).value).toBe(
      "Texto somente para o primeiro.",
    );
    expect(f.actions.send).not.toHaveBeenCalled();
  });
});
