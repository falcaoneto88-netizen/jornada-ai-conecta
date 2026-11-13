// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { getInboxAgentContext } from "@/lib/commercial-agent.functions";
import { InboxAgentPanel, type InboxAgentPanelProps } from "./inbox-agent-panel";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  mode: { demo: false, escopo: "u:synthetic-user" },
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/commercial-agent.functions", () => ({ getInboxAgentContext: mocks.read }));
vi.mock("@/lib/repo", () => ({ useModoDados: () => mocks.mode }));
type View = Extract<Awaited<ReturnType<typeof getInboxAgentContext>>, { ok: true }>["data"];
const props = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  contactId: "synthetic-contact",
  conversationId: "synthetic-conversation",
};
function fixture(): View {
  return {
    enabled: true,
    sendEnabled: false,
    truncated: false,
    errors: [],
    settings: {
      organization_id: props.organizationId,
      location_id: "synthetic-location",
      mode: "supervised",
      allowed_contacts: [props.contactId],
      allowed_channels: ["SMS"],
    },
    session: { contact_id: props.contactId, version: 3, paused: true, opt_out: false },
    items: [
      {
        id: "00000000-0000-4000-8000-000000000002",
        organization_id: props.organizationId,
        location_id: "synthetic-location",
        event_id: "synthetic-event",
        contact_id: props.contactId,
        conversation_id: props.conversationId,
        message_id: "synthetic-message",
        state: "pending",
        version: 1,
        contact_version: 1,
        session_version: 3,
        reply_hash: "synthetic-hash",
        result_message_id: null,
        expires_at: "2099-01-01T00:00:00Z",
        created_at: "2026-01-01T00:00:00Z",
        error_code: null,
        paused: true,
        opt_out: false,
        policyCurrent: true,
        content: {
          snapshot: {
            event: {
              type: "InboundMessage",
              locationId: "synthetic-location",
              contactId: props.contactId,
              conversationId: props.conversationId,
              messageId: "synthetic-message",
            },
            messages: [],
            name: "Contato fictício",
            dnd: false,
            historyHash: "synthetic-history",
          },
          decision: {
            reply: "Resposta fictícia que precisa da equipe.",
            flags: ["clinical"],
            handoff: true,
            optOut: false,
          },
          policyHash: "synthetic-policy",
          model: "synthetic",
          inputTokens: 0,
          outputTokens: 0,
        },
      },
    ],
  };
}
function eligibleFixture(): View {
  const view = fixture();
  view.sendEnabled = true;
  view.session!.paused = false;
  const row = view.items[0]!;
  row.paused = false;
  row.contact_version = 3;
  row.content!.decision = {
    reply: "Olá! Qual dia seria melhor para sua consulta?",
    flags: [],
    handoff: false,
    optOut: false,
  };
  row.content!.snapshot.messages = [
    {
      id: row.message_id,
      at: new Date(Date.now() - 60_000).toISOString(),
      direction: "inbound",
      text: "Gostaria de marcar uma consulta.",
      channel: "SMS",
      attachments: 0,
      provider: null,
    },
  ];
  return view;
}
function mount(input: InboxAgentPanelProps = props) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const tree = (value: InboxAgentPanelProps) => (
    <QueryClientProvider client={client}>
      <InboxAgentPanel {...value} />
    </QueryClientProvider>
  );
  const result = render(tree(input));
  return { ...result, change: (value: InboxAgentPanelProps) => result.rerender(tree(value)) };
}
beforeEach(() => {
  mocks.mode = { demo: false, escopo: "u:synthetic-user" };
  mocks.read.mockReset();
});
afterEach(cleanup);

describe("supervisão embutida no Atendimento", () => {
  it("consulta apenas contato/conversa selecionados e mantém a revisão clínica sem botões de envio/cópia", async () => {
    mocks.read.mockResolvedValue({ ok: true, data: fixture() });
    mount();
    expect(await screen.findByText("Resposta fictícia que precisa da equipe.")).toBeTruthy();
    expect(mocks.read).toHaveBeenCalledWith({ data: props });
    expect(screen.getByText("Com a equipe humana · agente pausado")).toBeTruthy();
    expect(screen.getByText("Avaliação clínica necessária")).toBeTruthy();
    expect(screen.getByText("Envio do agente desativado.")).toBeTruthy();
    expect(screen.getByText(/Base da sugestão: Treinamento V02 vigente/)).toBeTruthy();
    expect(screen.getByText("Izabel · v1.0.0 · em homologação")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /enviar|aprovar|copiar|retomar|assumir/i }),
    ).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Ajustar e revisar resposta" })).toHaveProperty(
      "disabled",
      true,
    );
    const link = screen.getByRole("link", {
      name: "Ver registro na supervisão",
    }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(
      `/agente-supervisionado?contactId=${props.contactId}&conversationId=${props.conversationId}&draftId=00000000-0000-4000-8000-000000000002`,
    );
  });

  it("sem rascunho mostra vazio e nunca pede a fila global ou gera uma resposta", async () => {
    mocks.read.mockResolvedValue({ ok: true, data: { ...fixture(), items: [], session: null } });
    mount();
    expect(await screen.findByText(/Nenhuma sugestão registrada para esta conversa/)).toBeTruthy();
    expect(screen.getByText(/Sem estado de supervisão registrado/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Ver registro na supervisão" })).toBeNull();
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });

  it("a troca de contato não mostra o retorno tardio da conversa anterior", async () => {
    let resolveOld!: (value: unknown) => void;
    mocks.read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    mocks.read.mockResolvedValue({ ok: true, data: { ...fixture(), items: [], session: null } });
    const ui = mount();
    ui.change({ ...props, contactId: "second-contact", conversationId: "second-conversation" });
    expect(await screen.findByText(/Nenhuma sugestão registrada/)).toBeTruthy();
    resolveOld({ ok: true, data: fixture() });
    await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Resposta fictícia que precisa da equipe.")).toBeNull();
  });

  it("mantém o erro visível sem inferir estado ativo ou sem pausa", async () => {
    mocks.read.mockResolvedValue({ ok: false, code: "forbidden" });
    mount();
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Sua sessão não tem permissão para esta ação.",
    );
    expect(screen.queryByText(/sem pausa registrada/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Atualizar supervisão" }));
    await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2));
  });

  it("não consulta dados reais no modo demonstração", () => {
    mocks.mode.demo = true;
    const ui = mount();
    expect(ui.container.textContent).toBe("");
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("preenche apenas após clique e nova leitura, com a referência exata do rascunho", async () => {
    const view = eligibleFixture();
    const useSuggestion = vi.fn().mockReturnValue(true);
    mocks.read.mockResolvedValue({ ok: true, data: view });
    mount({ ...props, onUseSuggestion: useSuggestion, timeZone: "Europe/Lisbon" });
    const button = await screen.findByRole("button", { name: "Ajustar e revisar resposta" });
    expect(button).toHaveProperty("disabled", false);
    expect(useSuggestion).not.toHaveBeenCalled();
    expect(screen.getByText(/Mensagem recebida:/)).toBeTruthy();
    expect(screen.getByText(/Sugestão gerada:/)).toBeTruthy();
    expect(screen.getByText("Fuso: Europe/Lisbon")).toBeTruthy();
    fireEvent.click(button);
    await waitFor(() =>
      expect(useSuggestion).toHaveBeenCalledExactlyOnceWith({
        text: view.items[0]!.content!.decision.reply,
        contactId: props.contactId,
        conversationId: props.conversationId,
        source: { draftId: view.items[0]!.id, version: 1, replyHash: "synthetic-hash" },
      }),
    );
    expect(mocks.read).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("status").textContent).toContain("Sugestão no campo de resposta");
    expect(screen.queryByRole("button", { name: /enviar|aprovar envio/ })).toBeNull();
  });

  const blockedCases: Array<[string, (view: View) => void, RegExp]> = [
    [
      "flag clínica",
      (view) => {
        view.items[0]!.content!.decision.flags = ["clinical"];
      },
      /avaliação humana especializada/,
    ],
    [
      "handoff",
      (view) => {
        view.items[0]!.content!.decision.handoff = true;
      },
      /avaliação humana especializada/,
    ],
    [
      "recusa na sessão",
      (view) => {
        view.session!.opt_out = true;
      },
      /pediu a interrupção/,
    ],
    [
      "recusa na sugestão",
      (view) => {
        view.items[0]!.content!.decision.optOut = true;
      },
      /pediu a interrupção/,
    ],
    [
      "DND",
      (view) => {
        view.items[0]!.content!.snapshot.dnd = true;
      },
      /está com DND/,
    ],
    [
      "expiração",
      (view) => {
        view.items[0]!.expires_at = "2000-01-01T00:00:00Z";
      },
      /sugestão expirou/,
    ],
    [
      "versão da sessão",
      (view) => {
        view.items[0]!.contact_version = 2;
      },
      /conversa mudou/,
    ],
    [
      "política anterior",
      (view) => {
        view.items[0]!.policyCurrent = false;
      },
      /política anterior/,
    ],
    [
      "envio desligado",
      (view) => {
        view.sendEnabled = false;
      },
      /envio supervisionado está desativado/,
    ],
    [
      "agente desligado",
      (view) => {
        view.enabled = false;
      },
      /envio supervisionado está desativado/,
    ],
    [
      "modo desligado",
      (view) => {
        view.settings.mode = "off";
      },
      /envio supervisionado está desativado/,
    ],
    [
      "contato não autorizado",
      (view) => {
        view.settings.allowed_contacts = [];
      },
      /contato ou canal não está autorizado/,
    ],
    [
      "canal não autorizado",
      (view) => {
        view.settings.allowed_channels = [];
      },
      /contato ou canal não está autorizado/,
    ],
    [
      "pausa humana",
      (view) => {
        view.session!.paused = true;
      },
      /agente está pausado/,
    ],
    [
      "janela encerrada",
      (view) => {
        view.items[0]!.content!.snapshot.messages[0]!.at = "2000-01-01T00:00:00Z";
      },
      /janela de revisão/,
    ],
    [
      "envio inconclusivo",
      (view) => {
        view.items.push({ ...view.items[0]!, id: "different-source", state: "unknown" });
      },
      /Há um envio em andamento/,
    ],
  ];
  it.each(blockedCases)(
    "impede reutilizar a sugestão com %s e explica o bloqueio",
    async (_name, mutate, reason) => {
      const view = eligibleFixture();
      mutate(view);
      const useSuggestion = vi.fn();
      mocks.read.mockResolvedValue({ ok: true, data: view });
      mount({ ...props, onUseSuggestion: useSuggestion });
      const button = await screen.findByRole("button", { name: "Ajustar e revisar resposta" });
      expect(button).toHaveProperty("disabled", true);
      expect(screen.getAllByText(reason).length).toBeGreaterThan(0);
      fireEvent.click(button);
      expect(useSuggestion).not.toHaveBeenCalled();
      expect(mocks.read).toHaveBeenCalledTimes(1);
    },
  );

  it("respeita bloqueio do editor e o motivo informado pelo atendimento", async () => {
    mocks.read.mockResolvedValue({ ok: true, data: eligibleFixture() });
    mount({
      ...props,
      disabled: true,
      disabledReason: "Aguarde o envio em andamento.",
      onUseSuggestion: vi.fn(),
    });
    expect(
      await screen.findByRole("button", { name: "Ajustar e revisar resposta" }),
    ).toHaveProperty("disabled", true);
    expect(screen.getByText("Aguarde o envio em andamento.")).toBeTruthy();
  });

  it("não exibe conteúdo nem permite ação se a projeção recebida pertence a outro contato", async () => {
    const view = eligibleFixture();
    view.items[0]!.contact_id = "another-contact";
    mocks.read.mockResolvedValue({ ok: true, data: view });
    const useSuggestion = vi.fn();
    mount({ ...props, onUseSuggestion: useSuggestion });
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText(view.items[0]!.content!.decision.reply)).toBeNull();
    expect(screen.queryByRole("button", { name: "Ajustar e revisar resposta" })).toBeNull();
    expect(useSuggestion).not.toHaveBeenCalled();
  });

  it("mostra a sugestão recente e recolhe históricos sem ignorar envios inconclusivos", async () => {
    const view = eligibleFixture();
    const previous = structuredClone(view.items[0]!);
    previous.id = "previous-suggestion";
    previous.state = "unknown";
    previous.content!.decision.reply = "Resposta anterior de teste.";
    view.items.push(previous);
    mocks.read.mockResolvedValue({ ok: true, data: view });
    mount({ ...props, onUseSuggestion: vi.fn() });
    const button = await screen.findByRole("button", { name: "Ajustar e revisar resposta" });
    expect(button).toHaveProperty("disabled", true);
    const summary = screen.getByText("Histórico da supervisão (1)");
    expect(summary.closest("details")).toHaveProperty("open", false);
    expect(screen.getByText("Resposta anterior de teste.").closest("details")).toBe(
      summary.closest("details"),
    );
    expect(screen.getByRole("list", { name: "Sugestões desta conversa" }).textContent).toContain(
      view.items[0]!.content!.decision.reply,
    );
  });

  it("prioriza resposta e ação antes dos metadados, com base recolhida e bloqueios visíveis", async () => {
    const view = eligibleFixture();
    view.items[0]!.content!.snapshot.dnd = true;
    mocks.read.mockResolvedValue({ ok: true, data: view });
    mount({ ...props, onUseSuggestion: vi.fn() });
    const action = await screen.findByRole("button", { name: "Ajustar e revisar resposta" });
    const proposal = screen.getByText(view.items[0]!.content!.decision.reply);
    const timestamp = screen.getByText(/Sugestão gerada:/);
    expect(
      proposal.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      action.compareDocumentPosition(timestamp) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const base = screen.getByText("Base e auditoria").closest("details")!;
    expect(base.open).toBe(false);
    expect(screen.getByText("Izabel · v1.0.0 · em homologação").closest("details")).toBe(base);
    expect(screen.getByText(/O contato está com DND/).closest("details")).toBeNull();
    expect(screen.getByRole("heading", { name: "Resposta proposta" })).toBeTruthy();
  });

  it("pede confirmação para substituir texto existente, e cancelar preserva o rascunho", async () => {
    const useSuggestion = vi.fn().mockReturnValue(true);
    mocks.read.mockResolvedValue({ ok: true, data: eligibleFixture() });
    mount({ ...props, hasDraft: true, onUseSuggestion: useSuggestion });
    fireEvent.click(await screen.findByRole("button", { name: "Ajustar e revisar resposta" }));
    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    expect(useSuggestion).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Manter meu rascunho" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(useSuggestion).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Ajustar e revisar resposta" }));
    fireEvent.click(await screen.findByRole("button", { name: "Substituir pela sugestão" }));
    await waitFor(() => expect(useSuggestion).toHaveBeenCalledTimes(1));
    expect(mocks.read).toHaveBeenCalledTimes(4);
  });

  it("não aplica referência antiga se a sugestão mudar na leitura de confirmação", async () => {
    const view = eligibleFixture();
    const changed = structuredClone(view);
    changed.items[0]!.version = 2;
    const useSuggestion = vi.fn();
    mocks.read
      .mockResolvedValueOnce({ ok: true, data: view })
      .mockResolvedValue({ ok: true, data: changed });
    mount({ ...props, onUseSuggestion: useSuggestion });
    fireEvent.click(await screen.findByRole("button", { name: "Ajustar e revisar resposta" }));
    expect(
      await screen.findByText("A sugestão mudou. Confira a versão atual antes de continuar."),
    ).toBeTruthy();
    expect(useSuggestion).not.toHaveBeenCalled();
  });

  it("não usa conteúdo em cache quando a leitura atual falha", async () => {
    const useSuggestion = vi.fn();
    mocks.read
      .mockResolvedValueOnce({ ok: true, data: eligibleFixture() })
      .mockRejectedValue(new Error("unavailable"));
    mount({ ...props, onUseSuggestion: useSuggestion });
    fireEvent.click(await screen.findByRole("button", { name: "Ajustar e revisar resposta" }));
    expect(
      await screen.findByText(
        "Não foi possível conferir esta sugestão. Atualize a supervisão antes de continuar.",
      ),
    ).toBeTruthy();
    expect(useSuggestion).not.toHaveBeenCalled();
  });

  it("não transfere sugestão de contato anterior se a seleção mudar durante a conferência", async () => {
    let resolveOld!: (value: unknown) => void;
    const useSuggestion = vi.fn().mockReturnValue(true);
    mocks.read.mockResolvedValueOnce({ ok: true, data: eligibleFixture() });
    mocks.read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    mocks.read.mockResolvedValue({ ok: true, data: { ...fixture(), items: [], session: null } });
    const ui = mount({ ...props, onUseSuggestion: useSuggestion });
    fireEvent.click(await screen.findByRole("button", { name: "Ajustar e revisar resposta" }));
    await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2));
    ui.change({
      ...props,
      contactId: "second-contact",
      conversationId: "second-conversation",
      onUseSuggestion: useSuggestion,
    });
    expect(await screen.findByText(/Nenhuma sugestão registrada/)).toBeTruthy();
    resolveOld({ ok: true, data: eligibleFixture() });
    await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(3));
    expect(useSuggestion).not.toHaveBeenCalled();
  });

  it("não informa sucesso se o editor recusar a seleção por escopo ou rascunho alterado", async () => {
    mocks.read.mockResolvedValue({ ok: true, data: eligibleFixture() });
    mount({ ...props, onUseSuggestion: vi.fn().mockReturnValue(false) });
    fireEvent.click(await screen.findByRole("button", { name: "Ajustar e revisar resposta" }));
    expect(
      await screen.findByText(
        "A conversa ou o rascunho mudou. Confira o atendimento antes de usar a sugestão.",
      ),
    ).toBeTruthy();
  });
});
