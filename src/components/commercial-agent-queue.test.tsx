// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CommercialAgentQueue,
  type QueueActions,
  type QueueItem,
  type QueueView,
} from "./commercial-agent-queue";

function fixture(): { view: QueueView & { items: [QueueItem] }; actions: QueueActions } {
  const item: QueueItem = {
    id: "draft-ficticio",
    organization_id: "clinica-ficticia",
    event_id: "evento-ficticio",
    contact_id: "contato-ficticio",
    conversation_id: "conversa-ficticia",
    location_id: "unidade-ficticia",
    message_id: "mensagem-ficticia",
    state: "pending",
    version: 1,
    contact_version: 1,
    reply_hash: "hash-ficticio",
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    created_at: new Date().toISOString(),
    result_message_id: null,
    error_code: null,
    paused: false,
    opt_out: false,
    content: {
      snapshot: {
        event: {
          type: "InboundMessage",
          locationId: "unidade-ficticia",
          contactId: "contato-ficticio",
          conversationId: "conversa-ficticia",
          messageId: "mensagem-ficticia",
        },
        messages: [
          {
            id: "mensagem-ficticia",
            at: new Date().toISOString(),
            direction: "inbound",
            text: "Como funciona a consulta?",
            channel: "SMS",
            attachments: 0,
            provider: null,
          },
        ],
        dnd: false,
        name: "Contato fictício",
        historyHash: "historico-ficticio",
      },
      decision: {
        reply: "Na consulta, o médico avalia seu caso individualmente.",
        flags: [],
        handoff: false,
        optOut: false,
      },
      policyHash: "politica-ficticia",
      model: "modelo-ficticio",
      inputTokens: 10,
      outputTokens: 10,
    },
  };
  return {
    view: {
      enabled: true,
      sendEnabled: true,
      items: [item],
      errors: [],
      settings: {
        organization_id: item.organization_id,
        location_id: item.location_id,
        mode: "supervised",
        allowed_contacts: [item.contact_id],
        allowed_channels: ["SMS"],
        receive_all_contacts: true,
      },
    },
    actions: {
      refresh: vi.fn().mockResolvedValue(undefined),
      approve: vi.fn().mockResolvedValue("sent"),
      reject: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn().mockResolvedValue(undefined),
    },
  };
}

function approvalButton(demo = false) {
  return screen.getByRole("button", {
    name: demo ? "Aprovar envio simulado" : "Revisar e aprovar envio",
  }) as HTMLButtonElement;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("autorização de envio na fila supervisionada", () => {
  it.each(["contato", "canal"])(
    "receber todos não permite aprovar fora da lista de %s",
    (scope) => {
      const { view, actions } = fixture();
      if (scope === "contato") view.settings!.allowed_contacts = [];
      else view.settings!.allowed_channels = ["WhatsApp"];
      render(<CommercialAgentQueue view={view} actions={actions} />);

      expect(approvalButton().disabled).toBe(true);
      fireEvent.click(approvalButton());
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(actions.approve).not.toHaveBeenCalled();
      expect(screen.getByText(/Esta entrada está em revisão/)).toBeTruthy();
      expect(screen.getByText(/Recebimento geral ativo/)).toBeTruthy();
    },
  );

  it("sem configuração de escopo, a fila real não permite aprovação", () => {
    const { view, actions } = fixture();
    delete view.settings;
    render(<CommercialAgentQueue view={view} actions={actions} />);

    expect(approvalButton().disabled).toBe(true);
    fireEvent.click(approvalButton());
    expect(actions.approve).not.toHaveBeenCalled();
    expect(screen.getByText(/Não foi possível verificar quais destinatários/)).toBeTruthy();
  });

  it("demo sem configuração mantém a confirmação simulada", async () => {
    const { view, actions } = fixture();
    delete view.settings;
    render(<CommercialAgentQueue view={view} actions={actions} demo />);

    expect(approvalButton(true).disabled).toBe(false);
    fireEvent.click(approvalButton(true));
    expect(actions.approve).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar aprovação e enviar simulação" }));
    await waitFor(() => expect(actions.approve).toHaveBeenCalledExactlyOnceWith(view.items[0]));
    expect(await screen.findByText(/Envio simulado registrado/)).toBeTruthy();
  });

  it("destinatário e canal autorizados ainda exigem confirmação explícita", async () => {
    const { view, actions } = fixture();
    render(<CommercialAgentQueue view={view} actions={actions} />);

    expect(approvalButton().disabled).toBe(false);
    fireEvent.click(approvalButton());
    expect(actions.approve).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar aprovação e enviar" }));
    await waitFor(() => expect(actions.approve).toHaveBeenCalledExactlyOnceWith(view.items[0]));
    expect(await screen.findByText(/Mensagem aceita pelo HighLevel/)).toBeTruthy();
  });

  it.each(["contato", "canal", "ausente"])(
    "revogação de escopo (%s) também bloqueia a confirmação já aberta",
    (scope) => {
      const { view, actions } = fixture();
      const { rerender } = render(<CommercialAgentQueue view={view} actions={actions} />);
      fireEvent.click(approvalButton());
      expect(screen.getByRole("dialog")).toBeTruthy();

      const next: QueueView = { ...view };
      if (scope === "ausente") delete next.settings;
      else
        next.settings = {
          ...view.settings!,
          allowed_contacts: scope === "contato" ? [] : view.settings!.allowed_contacts,
          allowed_channels: scope === "canal" ? [] : view.settings!.allowed_channels,
        };
      rerender(<CommercialAgentQueue view={next} actions={actions} />);
      const confirm = screen.getByRole("button", {
        name: "Confirmar aprovação e enviar",
      }) as HTMLButtonElement;
      expect(confirm.disabled).toBe(true);
      fireEvent.click(confirm);
      expect(actions.approve).not.toHaveBeenCalled();
    },
  );

  it.each(["organization_id", "location_id"] as const)(
    "uma lista de outra %s não autoriza este rascunho",
    (key) => {
      const { view, actions } = fixture();
      view.settings![key] = "outro-escopo-ficticio";
      render(<CommercialAgentQueue view={view} actions={actions} />);
      expect(approvalButton().disabled).toBe(true);
    },
  );

  it("retomar um rascunho invalidado não permite enviá-lo", () => {
    const { view, actions } = fixture();
    view.items[0].state = "invalidated";
    render(<CommercialAgentQueue view={view} actions={actions} />);
    expect(approvalButton().disabled).toBe(true);
    expect(screen.getByText(/Retomar o agente não reativa respostas antigas/)).toBeTruthy();
  });

  it.each(["paused", "opt_out", "expired", "flags", "disabled", "send_disabled"])(
    "estar na lista permitida preserva o bloqueio %s",
    (guard) => {
      const { view, actions } = fixture();
      const row = view.items[0];
      if (guard === "paused") row.paused = true;
      if (guard === "opt_out") row.opt_out = true;
      if (guard === "expired") row.expires_at = new Date(Date.now() - 1000).toISOString();
      if (guard === "flags") row.content!.decision.flags = ["clinical"];
      if (guard === "disabled") view.enabled = false;
      if (guard === "send_disabled") view.sendEnabled = false;
      render(<CommercialAgentQueue view={view} actions={actions} />);

      expect(approvalButton().disabled).toBe(true);
      fireEvent.click(approvalButton());
      expect(actions.approve).not.toHaveBeenCalled();
    },
  );
});
