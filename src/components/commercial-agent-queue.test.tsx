// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    session_version: 1,
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
  it("revisão específica não abre um segundo atendimento manual nem descreve recebimento global", () => {
    const { view, actions } = fixture();
    actions.manual = {
      refresh: vi.fn(),
      context: vi.fn(),
      pause: vi.fn(),
      prepare: vi.fn(),
      send: vi.fn(),
      reconcile: vi.fn(),
    };
    render(<CommercialAgentQueue view={view} actions={actions} focused />);
    expect(screen.queryByText(/Recebimento geral ativo/)).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(actions.manual.context).not.toHaveBeenCalled();
    expect(approvalButton().disabled).toBe(false);
    expect(actions.approve).not.toHaveBeenCalled();
  });

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

  it("histórico com rascunho pending de outra versão não permite aprovar", () => {
    const { view, actions } = fixture();
    view.items[0].category = "history";
    view.items[0].session_version = 2;
    render(<CommercialAgentQueue view={view} actions={actions} />);
    expect(approvalButton().disabled).toBe(true);
    expect(screen.getByText(/A conversa mudou desde esta sugestão/)).toBeTruthy();
    fireEvent.click(approvalButton());
    expect(actions.approve).not.toHaveBeenCalled();
  });

  it("mudança da versão da conversa bloqueia a confirmação que já estava aberta", () => {
    const { view, actions } = fixture();
    const { rerender } = render(<CommercialAgentQueue view={view} actions={actions} />);
    fireEvent.click(approvalButton());
    const changed = { ...view.items[0], session_version: 2 };
    rerender(<CommercialAgentQueue view={{ ...view, items: [changed] }} actions={actions} />);
    const confirm = screen.getByRole("button", {
      name: "Confirmar aprovação e enviar",
    }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(actions.approve).not.toHaveBeenCalled();
  });

  it.each([
    "paused",
    "opt_out",
    "dnd",
    "expired",
    "invalid_expiry",
    "flags",
    "disabled",
    "send_disabled",
    "policy",
  ])("estar na lista permitida preserva o bloqueio %s", (guard) => {
    const { view, actions } = fixture();
    const row = view.items[0];
    if (guard === "paused") row.paused = true;
    if (guard === "opt_out") row.opt_out = true;
    if (guard === "dnd") row.content!.snapshot.dnd = true;
    if (guard === "expired") row.expires_at = new Date(Date.now() - 1000).toISOString();
    if (guard === "invalid_expiry") row.expires_at = "invalid";
    if (guard === "policy") row.policyCurrent = false;
    if (guard === "flags") row.content!.decision.flags = ["clinical"];
    if (guard === "disabled") view.enabled = false;
    if (guard === "send_disabled") view.sendEnabled = false;
    render(<CommercialAgentQueue view={view} actions={actions} />);

    expect(approvalButton().disabled).toBe(true);
    fireEvent.click(approvalButton());
    expect(actions.approve).not.toHaveBeenCalled();
  });
});

function paginatedFixture() {
  const result = fixture();
  result.view.pagination = {
    category: "review",
    query: "",
    page: 1,
    pageSize: 25,
    total: 74,
    totalPages: 3,
    hasMore: true,
    asOf: "2026-11-12T15:00:00.000Z",
  };
  result.view.counts = { review: 74, team: 8, uncertain: 2, history: 250 };
  result.actions.navigate = vi.fn().mockResolvedValue(undefined);
  return result;
}

describe("fila operacional paginada", () => {
  it("usa totais do servidor e não chama o tamanho da página de pendências", () => {
    const { view, actions } = paginatedFixture();
    render(<CommercialAgentQueue view={view} actions={actions} />);
    expect(screen.getByRole("button", { name: "Revisar (74)" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByText("74 registros encontrados")).toBeTruthy();
    expect(screen.queryByText("Respostas para revisar (1)")).toBeNull();
    expect(actions.navigate).not.toHaveBeenCalled();
    expect(actions.approve).not.toHaveBeenCalled();
  });

  it("busca no servidor e troca categoria reiniciando a página sem congelar outra consulta", async () => {
    const { view, actions } = paginatedFixture();
    view.pagination!.page = 2;
    render(<CommercialAgentQueue view={view} actions={actions} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: " Ana " } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    await waitFor(() =>
      expect(actions.navigate).toHaveBeenCalledWith({
        category: "review",
        query: "Ana",
        page: 1,
        pageSize: 25,
      }),
    );
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Com a equipe (8)" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Com a equipe (8)" }));
    await waitFor(() =>
      expect(actions.navigate).toHaveBeenLastCalledWith({
        category: "team",
        query: "",
        page: 1,
        pageSize: 25,
      }),
    );
  });

  it("pagina com o mesmo recorte do servidor e preserva a pesquisa", async () => {
    const { view, actions } = paginatedFixture();
    view.pagination!.query = "Ana";
    render(<CommercialAgentQueue view={view} actions={actions} />);
    expect((screen.getByRole("button", { name: "Anterior" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    await waitFor(() =>
      expect(actions.navigate).toHaveBeenCalledExactlyOnceWith({
        category: "review",
        query: "Ana",
        page: 2,
        pageSize: 25,
        asOf: view.pagination!.asOf,
      }),
    );
  });

  it("abre revisão no lugar da lista estreita e volta ao mesmo item com foco", () => {
    const { view, actions } = paginatedFixture();
    render(<CommercialAgentQueue view={view} actions={actions} />);
    const list = screen.getByRole("region", { name: "Fila de respostas" });
    const row = within(list).getByRole("button", { name: /Contato fictício/ });
    fireEvent.click(row);
    expect(list.className).toContain("hidden lg:block");
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Contato fictício" }));
    fireEvent.click(screen.getByRole("button", { name: "Voltar à fila" }));
    expect(list.className).not.toContain("hidden lg:block");
    expect(document.activeElement).toBe(row);
    expect(row.getAttribute("aria-pressed")).toBe("true");
    expect(actions.navigate).not.toHaveBeenCalled();
  });

  it("se a resposta selecionada sair da consulta não substitui a revisão por outro contato", () => {
    const { view, actions } = fixture();
    const { rerender } = render(<CommercialAgentQueue view={view} actions={actions} />);
    fireEvent.click(
      within(screen.getByRole("region", { name: "Fila de respostas" })).getByRole("button"),
    );
    const other = { ...view.items[0], id: "outro-item", contactName: "Outro contato" };
    rerender(<CommercialAgentQueue view={{ ...view, items: [other] }} actions={actions} />);
    expect(screen.getByText(/Este item saiu da consulta atual/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Revisar e aprovar envio" })).toBeNull();
  });

  it("registros sem conteúdo conservam identificação e oferecem só conferência", () => {
    const { view, actions } = fixture();
    view.items[0].content = null;
    view.items[0].contactName = "Ana — cadastro de teste";
    render(<CommercialAgentQueue view={view} actions={actions} />);
    fireEvent.click(
      within(screen.getByRole("region", { name: "Fila de respostas" })).getByRole("button"),
    );
    expect(screen.getByRole("heading", { name: "Ana — cadastro de teste" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Conferir registro no HighLevel" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Revisar e aprovar envio" })).toBeNull();
    expect(actions.approve).not.toHaveBeenCalled();
  });

  it("uma mensagem substituída vai a eventos ignorados, não a falhas", () => {
    const { view, actions } = fixture();
    view.errors = [
      {
        id: "evento-ignorado",
        state: "ignored",
        error_code: "newer_message_exists",
        attempts: 1,
        created_at: "2026-11-12T15:00:00Z",
      },
    ];
    render(<CommercialAgentQueue view={view} actions={actions} />);
    expect(screen.queryByText(/Falhas que exigem análise/)).toBeNull();
    expect(screen.getByText("Eventos ignorados (1)")).toBeTruthy();
    expect(screen.getByText(/Ignorada porque chegou uma mensagem mais recente/)).toBeTruthy();
  });

  it("envio incerto sem conteúdo mantém o aviso de conferência sem criar reenvio", () => {
    const { view, actions } = fixture();
    view.items[0].state = "unknown";
    view.items[0].content = null;
    render(<CommercialAgentQueue view={view} actions={actions} focused />);
    expect(screen.getByRole("alert").textContent).toContain("Este envio precisa de conferência");
    expect(screen.queryByRole("button", { name: "Revisar e aprovar envio" })).toBeNull();
    expect(actions.approve).not.toHaveBeenCalled();
  });

  it("atualizar fila faz somente uma consulta", async () => {
    const { view, actions } = fixture();
    render(<CommercialAgentQueue view={view} actions={actions} />);
    fireEvent.click(screen.getByRole("button", { name: "Atualizar fila" }));
    await waitFor(() => expect(actions.refresh).toHaveBeenCalledTimes(1));
  });

  it.each(["loading", "unavailable"] as const)(
    "%s bloqueia aprovação já aberta e outras mutações",
    (guard) => {
      const { view, actions } = fixture();
      const { rerender } = render(<CommercialAgentQueue view={view} actions={actions} />);
      fireEvent.click(approvalButton());
      rerender(<CommercialAgentQueue view={view} actions={actions} {...{ [guard]: true }} />);
      const confirm = screen.getByRole("button", {
        name: "Confirmar aprovação e enviar",
      }) as HTMLButtonElement;
      expect(confirm.disabled).toBe(true);
      fireEvent.click(confirm);
      expect(actions.approve).not.toHaveBeenCalled();
    },
  );

  it("falha de consulta mantém a fila e oferece nova tentativa sem autorizar ação automática", async () => {
    const { view, actions } = paginatedFixture();
    actions.navigate = vi.fn().mockRejectedValue(new Error("queue_read_unavailable"));
    render(<CommercialAgentQueue view={view} actions={actions} />);
    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    expect(await screen.findByText(/A nova fila aguarda atualização do serviço/)).toBeTruthy();
    expect(screen.getByText("74 registros encontrados")).toBeTruthy();
    expect(approvalButton().disabled).toBe(true);
    expect(actions.approve).not.toHaveBeenCalled();
  });

  it("uma nova leitura externa libera a fila após falha sem perder a seleção", async () => {
    const initial = paginatedFixture();
    const actions = initial.actions;
    actions.navigate = vi.fn().mockRejectedValue(new Error("queue_read_unavailable"));
    const second = {
      ...initial.view.items[0],
      id: "draft-segundo",
      contactName: "Segundo contato fictício",
    };
    const view: QueueView = { ...initial.view, items: [...initial.view.items, second] };
    const { rerender } = render(<CommercialAgentQueue view={view} actions={actions} />);
    fireEvent.click(
      within(screen.getByRole("region", { name: "Fila de respostas" })).getByRole("button", {
        name: /Segundo contato fictício/,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    await screen.findByText(/A nova fila aguarda atualização do serviço/);
    expect(approvalButton().disabled).toBe(true);

    rerender(<CommercialAgentQueue view={view} actions={actions} unavailable />);
    rerender(<CommercialAgentQueue view={view} actions={actions} />);
    expect(approvalButton().disabled).toBe(true);

    rerender(<CommercialAgentQueue view={{ ...view }} actions={actions} />);
    await waitFor(() => expect(approvalButton().disabled).toBe(false));
    expect(screen.getByRole("heading", { name: "Segundo contato fictício" })).toBeTruthy();
    expect(actions.approve).not.toHaveBeenCalled();
  });
});

describe("acesso da triagem ao atendimento da conversa", () => {
  it("abre o contato e a conversa exatos do registro selecionado sem executar ações", () => {
    const { view, actions } = fixture();
    const other: QueueItem = {
      ...view.items[0],
      id: "draft-segundo",
      contact_id: "contato-B +/&?",
      conversation_id: "conversa-B +/&?",
      contactName: "Outro contato fictício",
    };
    render(
      <CommercialAgentQueue view={{ ...view, items: [...view.items, other] }} actions={actions} />,
    );
    const first = screen.getByRole("link", { name: "Ajustar no Meu Chat" });
    expect(first.getAttribute("href")).toBe(
      "/caixa-de-entrada?contact=contato-ficticio&conversation=conversa-ficticia",
    );
    fireEvent.click(
      within(screen.getByRole("region", { name: "Fila de respostas" })).getByRole("button", {
        name: /Outro contato fictício/,
      }),
    );
    const selected = screen.getByRole("link", { name: "Ajustar no Meu Chat" });
    expect(selected.getAttribute("href")).toBe(
      "/caixa-de-entrada?contact=contato-B+%2B%2F%26%3F&conversation=conversa-B+%2B%2F%26%3F",
    );
    expect(selected.getAttribute("target")).toBeNull();
    expect(screen.getByRole("link", { name: "Conferir no HighLevel" })).toBeTruthy();
    expect(actions.approve).not.toHaveBeenCalled();
    expect(actions.pause).not.toHaveBeenCalled();
    expect(actions.reject).not.toHaveBeenCalled();
  });

  it("registros sem conteúdo mantêm acesso ao atendimento e aviso de envio incerto", () => {
    const { view, actions } = fixture();
    view.items[0].content = null;
    view.items[0].state = "unknown";
    render(<CommercialAgentQueue view={view} actions={actions} focused />);
    expect(screen.getByRole("link", { name: "Abrir no Meu Chat" }).getAttribute("href")).toBe(
      "/caixa-de-entrada?contact=contato-ficticio&conversation=conversa-ficticia",
    );
    expect(screen.getByRole("alert").textContent).toContain("Este envio precisa de conferência");
    expect(actions.approve).not.toHaveBeenCalled();
  });

  it.each(["organization_id", "location_id"] as const)(
    "não oferece acesso interno para registro de outra %s",
    (field) => {
      const { view, actions } = fixture();
      view.items[0][field] = "outro-escopo";
      render(<CommercialAgentQueue view={view} actions={actions} focused />);
      expect(screen.queryByRole("link", { name: /no Meu Chat/ })).toBeNull();
      expect(actions.approve).not.toHaveBeenCalled();
    },
  );

  it("a demonstração não liga registros fictícios ao atendimento real", () => {
    const { view, actions } = fixture();
    render(<CommercialAgentQueue view={view} actions={actions} demo focused />);
    expect(screen.queryByRole("link", { name: /no Meu Chat/ })).toBeNull();
  });
});
