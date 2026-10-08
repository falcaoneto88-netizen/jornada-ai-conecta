// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommercialAgentManual, type ManualActions } from "./commercial-agent-manual";
import type {
  ManualContext,
  ManualConversation,
  ManualPrepared,
} from "@/lib/commercial-agent/core";

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
  fireEvent.change(screen.getByLabelText("Conversa para atendimento"), { target: { value } });
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
