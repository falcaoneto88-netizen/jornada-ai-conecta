// @vitest-environment jsdom
import type { ComponentType, ReactNode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "./agente-supervisionado";

const mocks = vi.hoisted(() => ({
  search: {} as Record<string, unknown>,
  identity: "u:synthetic-user",
  list: vi.fn(),
  legacyList: vi.fn(),
  manualSearch: vi.fn(),
  read: vi.fn(),
  queue: vi.fn(),
  command: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options, useSearch: () => mocks.search }),
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/lib/repo", () => ({ useModoDados: () => ({ escopo: mocks.identity }) }));
vi.mock("@/lib/organization", () => ({
  useOrganizacao: () => ({ data: { organizacao: { id: "00000000-0000-4000-8000-000000000001" } } }),
}));
vi.mock("@/components/commercial-agent-queue", () => ({
  friendlyError: {},
  CommercialAgentQueue: (props: unknown) => {
    mocks.queue(props);
    return <p>Fila de revisão</p>;
  },
}));
vi.mock("@/lib/commercial-agent.functions", () => ({
  listAgentDrafts: mocks.legacyList,
  getInboxAgentContext: mocks.read,
  approveAgentDraft: mocks.command,
  rejectAgentDraft: mocks.command,
  pauseAgentContact: mocks.command,
  reconcileAgentDraft: mocks.command,
  getManualAgentContext: mocks.command,
  prepareManualAgentMessage: mocks.command,
  sendManualAgentMessage: mocks.command,
  reconcileManualAgentMessage: mocks.command,
}));
vi.mock("@/lib/commercial-agent-queue.functions", () => ({
  listAgentQueuePage: mocks.list,
  searchManualAgentConversations: mocks.manualSearch,
}));
const route = Route as unknown as {
  options: { component: ComponentType; validateSearch: (search: unknown) => unknown };
};
const Page = route.options.component;
const target = {
  contactId: "synthetic-contact",
  conversationId: "synthetic-conversation",
  draftId: "00000000-0000-4000-8000-000000000002",
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.search = {};
  mocks.identity = "u:synthetic-user";
});
afterEach(cleanup);

describe("link específico de supervisão", () => {
  it("rejeita destino parcial ou inválido em vez de abrir a fila global", () => {
    expect(() => route.options.validateSearch({ contactId: target.contactId })).toThrow();
    expect(() => route.options.validateSearch({ draftId: target.draftId })).toThrow();
    expect(() => route.options.validateSearch({ ...target, draftId: "invalid" })).toThrow();
    expect(route.options.validateSearch(target)).toEqual(target);
  });

  it("busca a revisão exata e não usa fallback global quando ela está ausente", async () => {
    mocks.search = target;
    const view = { enabled: true, sendEnabled: false, items: [], errors: [] };
    mocks.read.mockResolvedValue({ ok: true, data: view });
    render(<Page />);
    await screen.findByText("Fila de revisão");
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith({
      data: { organizationId: "00000000-0000-4000-8000-000000000001", ...target },
    });
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.queue).toHaveBeenCalledWith(expect.objectContaining({ view, focused: true }));
    expect(mocks.command).not.toHaveBeenCalled();
    expect(screen.queryByText(/A Izabel prepara respostas/)).toBeNull();
  });

  it("distingue a redação com V02 do pacote novo ainda em homologação", async () => {
    mocks.list.mockResolvedValue({
      ok: true,
      data: { enabled: true, sendEnabled: false, items: [], errors: [] },
    });
    render(<Page />);
    expect(screen.getByText(/A Izabel prepara respostas com a base V02 no Meu Chat/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Executar ensaio" })).toBeNull();
    await screen.findByText("Fila de revisão");
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith({
      data: {
        organizationId: "00000000-0000-4000-8000-000000000001",
        category: "review",
        query: "",
        page: 1,
        pageSize: 20,
      },
    });
    expect(mocks.legacyList).not.toHaveBeenCalled();
  });

  it("uma falha na leitura específica não aciona comandos nem lista geral", async () => {
    mocks.search = target;
    mocks.read.mockResolvedValue({ ok: false, code: "forbidden" });
    render(<Page />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(1));
    expect(mocks.queue).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.command).not.toHaveBeenCalled();
  });
});

type QueueProps = {
  view: { label?: string };
  loading: boolean;
  unavailable: boolean;
  actions: {
    navigate: (request: {
      category: "review";
      query: string;
      page: number;
      pageSize: number;
    }) => Promise<void>;
    refresh: () => Promise<void>;
    manual: {
      search: (request: { query: string; page: number; pageSize: number }) => Promise<unknown>;
    };
  };
};
const lastQueue = () => mocks.queue.mock.calls.at(-1)![0] as QueueProps;
const response = (label: string) => ({
  ok: true,
  data: { label, enabled: true, sendEnabled: false, items: [], errors: [] },
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("leituras paginadas da supervisão", () => {
  it("descarta respostas antigas quando a busca muda", async () => {
    mocks.list.mockResolvedValueOnce(response("initial"));
    render(<Page />);
    await screen.findByText("Fila de revisão");
    const oldRead = deferred<ReturnType<typeof response>>();
    const newRead = deferred<ReturnType<typeof response>>();
    mocks.list.mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(newRead.promise);
    let oldRequest!: Promise<void>, newRequest!: Promise<void>;
    act(() => {
      oldRequest = lastQueue().actions.navigate({
        category: "review",
        query: "Ana",
        page: 1,
        pageSize: 20,
      });
    });
    expect(lastQueue().loading).toBe(true);
    act(() => {
      newRequest = lastQueue().actions.navigate({
        category: "review",
        query: "Bruno",
        page: 1,
        pageSize: 20,
      });
    });
    await act(async () => {
      newRead.resolve(response("Bruno"));
      await newRequest;
    });
    await act(async () => {
      oldRead.resolve(response("Ana"));
      await oldRequest;
    });
    expect(lastQueue().view.label).toBe("Bruno");
    expect(lastQueue().loading).toBe(false);
    expect(mocks.command).not.toHaveBeenCalled();
  });

  it("preserva o contexto mas bloqueia ações se atualizar falhar; não usa lista legada", async () => {
    mocks.list.mockResolvedValueOnce(response("existing"));
    render(<Page />);
    await screen.findByText("Fila de revisão");
    mocks.list.mockResolvedValueOnce({ ok: false, code: "queue_read_unavailable" });
    await act(async () => {
      await lastQueue()
        .actions.refresh()
        .catch(() => undefined);
    });
    expect(lastQueue().view.label).toBe("existing");
    expect(lastQueue().unavailable).toBe(true);
    expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeTruthy();
    expect(mocks.legacyList).not.toHaveBeenCalled();
    mocks.list.mockResolvedValueOnce(response("fresh"));
    await act(async () => {
      await lastQueue().actions.refresh();
    });
    expect(lastQueue().unavailable).toBe(false);
    expect(lastQueue().view.label).toBe("fresh");
  });

  it("trocar usuário da mesma organização descarta resultado da sessão anterior", async () => {
    const oldRead = deferred<ReturnType<typeof response>>();
    mocks.list.mockReturnValueOnce(oldRead.promise).mockResolvedValueOnce(response("new user"));
    const mounted = render(<Page />);
    mocks.identity = "u:another-synthetic-user";
    mounted.rerender(<Page />);
    await screen.findByText("Fila de revisão");
    await act(async () => {
      oldRead.resolve(response("old user"));
      await oldRead.promise;
    });
    expect(lastQueue().view.label).toBe("new user");
    expect(mocks.list).toHaveBeenCalledTimes(2);
  });

  it("busca manual envia somente paginação e escopo autenticado, sem comandos", async () => {
    mocks.list.mockResolvedValueOnce(response("initial"));
    mocks.manualSearch.mockResolvedValue({ ok: true, data: { items: [], page: 1 } });
    render(<Page />);
    await screen.findByText("Fila de revisão");
    await lastQueue().actions.manual.search({ query: "Ana", page: 1, pageSize: 20 });
    expect(mocks.manualSearch).toHaveBeenCalledExactlyOnceWith({
      data: {
        query: "Ana",
        page: 1,
        pageSize: 20,
        organizationId: "00000000-0000-4000-8000-000000000001",
      },
    });
    expect(mocks.command).not.toHaveBeenCalled();
  });
});
