// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  read: vi.fn(),
  user: "user-a",
  org: "org-a",
  allowed: true,
  mode: "conta",
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/ghl-workflow-monitoring.functions", () => ({
  consultarMonitoramentoWorkflowGhl: m.read,
}));
vi.mock("@/lib/session", () => ({ useSessao: () => ({ user: { id: m.user }, modo: m.mode }) }));
vi.mock("@/lib/repo", () => ({ usePermissoes: () => ({ gerirJornada: m.allowed }) }));
vi.mock("@/lib/organization", () => ({
  useOrganizacao: () => ({ data: { organizacao: { id: m.org, timezone: "Europe/Lisbon" } } }),
}));
vi.mock("@/lib/ghl-observation", () => ({
  useWorkflowsGhl: () => ({
    data: {
      consultadoEm: "2026-10-15T10:00:00Z",
      workflows: [
        {
          id: "workflow-a",
          nome: "Consulta de teste",
          estado: "published",
          versao: 1,
          atualizadoEm: null,
          url: "https://app.gohighlevel.com/v2/location/location-a/automation/workflow/workflow-a/logs",
        },
      ],
    },
    refetch: vi.fn(),
  }),
}));
vi.mock("./ghl-inbox", () => ({ ErroLeitura: () => <p>Falha no catálogo</p> }));

import { GhlWorkflowMonitor } from "./ghl-workflow-monitor";
import { GhlWorkflows } from "./ghl-workflows";

const cursor = {
  referenceId: "log-a",
  referenceCreatedAt: "2026-10-15T10:00:00Z",
  dateWindowEnd: "2026-10-15T12:00:00Z",
};
function page(overrides: Record<string, unknown> = {}) {
  return {
    state: "available",
    organizationId: "org-a",
    locationId: "location-a",
    workflowId: "workflow-a",
    checkedAt: "2026-10-15T12:00:00Z",
    period: { startDate: "2026-10-08T12:00:00Z", endDate: "2026-10-15T12:00:00Z", days: 7 },
    logs: [
      {
        id: "log-a",
        contactId: "contact-synthetic-a",
        executionId: "run-a",
        stepId: "step-a",
        stepName: "Confirmação de teste",
        status: "executed",
        type: "action",
        createdAt: "2026-10-15T10:00:00Z",
        url: "https://app.gohighlevel.com/v2/location/location-a/automation/workflow/workflow-a/logs?contactId=contact-synthetic-a&executionId=run-a",
      },
    ],
    statistics: { state: "available", records: 12, byStatus: [{ status: "executed", count: 12 }] },
    pagination: { nextCursor: null, hasMore: false },
    workflowUrl: "https://app.gohighlevel.com/logs",
    ...overrides,
  };
}
let client: QueryClient;
function app(catalog = false) {
  return (
    <QueryClientProvider client={client}>
      {catalog ? (
        <GhlWorkflows />
      ) : (
        <GhlWorkflowMonitor
          workflowId="workflow-a"
          workflowUrl="https://app.gohighlevel.com/logs"
          timezone="Europe/Lisbon"
        />
      )}
    </QueryClientProvider>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  m.user = "user-a";
  m.org = "org-a";
  m.allowed = true;
  m.mode = "conta";
  m.read.mockReset().mockResolvedValue(page());
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup();
  client.clear();
});

it("preserva o catálogo e só consulta execuções após o pedido do operador", async () => {
  render(app(true));
  expect(m.read).not.toHaveBeenCalled();
  expect(screen.getByText("GHL: Publicado")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Consultar execuções de Consulta de teste" }));
  await screen.findByText("Confirmação de teste");
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(m.read).toHaveBeenCalledTimes(1);
  expect(m.read).toHaveBeenCalledWith({
    data: { organizationId: "org-a", workflowId: "workflow-a", days: 7 },
  });
  expect(screen.getByText("15/10/26, 11:00")).toBeTruthy();
  expect(screen.getByText(/não comprova entrega de mensagem/)).toBeTruthy();
  expect(screen.getByText(/Registros no período, segundo o GHL: 12/)).toBeTruthy();
  expect(screen.getByText(/1 registros carregados/)).toBeTruthy();
  expect(screen.queryByText(/taxa de sucesso/i)).toBeNull();
  const executionLink = screen.getByRole("link", { name: "Abrir esta execução no GHL" });
  expect(executionLink.getAttribute("href")).toBe(page().logs[0]?.url);
  expect(executionLink.getAttribute("rel")).toBe("noopener noreferrer");
});

it("não oferece leitura de execuções para papel não autorizado", () => {
  m.allowed = false;
  render(app(true));
  expect(screen.queryByRole("button", { name: /Consultar execuções/ })).toBeNull();
  expect(screen.getByRole("link", { name: /Ver execução no GHL/ })).toBeTruthy();
  expect(m.read).not.toHaveBeenCalled();
});

it.each([
  ["beta_unavailable", "Aguardando liberação do GHL"],
  ["forbidden", "Leitura recusada pelo GHL"],
  ["unauthorized", "Autenticação não aceita pela nova API"],
  ["missing_secrets", "Conexão GHL incompleta"],
  ["contract_error", "Resposta do GHL incompatível"],
  ["temporary_error", "Consulta temporariamente indisponível"],
])(
  "expõe %s como falha distinta de zero execuções e permite repetir manualmente",
  async (state, title) => {
    m.read.mockResolvedValue({
      state,
      checkedAt: "2026-10-15T12:00:00Z",
      workflowId: "workflow-a",
      message: "safe backend message",
    });
    render(app());
    expect((await screen.findByRole("alert")).textContent).toContain(title);
    expect(screen.queryByText(/não devolveu registros de execução/)).toBeNull();
    expect(screen.queryByText(/Registros no período/)).toBeNull();
    m.read.mockResolvedValue(page());
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    await screen.findByText("Confirmação de teste");
  },
);

it("só mostra ausência após uma resposta válida sem mais páginas", async () => {
  m.read.mockResolvedValue(
    page({ logs: [], statistics: { state: "available", records: 0, byStatus: [] } }),
  );
  render(app());
  await screen.findByText(/não devolveu registros de execução/);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("mantém cursor e evidência anterior quando a página seguinte falha, e permite tentar novamente", async () => {
  m.read
    .mockResolvedValueOnce(page({ pagination: { nextCursor: cursor, hasMore: true } }))
    .mockResolvedValueOnce({
      state: "temporary_error",
      checkedAt: "2026-10-15T12:00:00Z",
      workflowId: "workflow-a",
      message: "Temporário",
    })
    .mockResolvedValueOnce(
      page({
        logs: [page().logs[0], { ...page().logs[0], id: "log-b", stepName: "Espera de teste" }],
        statistics: null,
      }),
    );
  render(app());
  fireEvent.click(await screen.findByRole("button", { name: "Carregar mais registros" }));
  expect((await screen.findByRole("alert")).textContent).toContain("A consulta está incompleta");
  expect(screen.getByText("Confirmação de teste")).toBeTruthy();
  expect(screen.queryByText(/Fim da paginação/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Tentar próxima página novamente" }));
  await screen.findByText("Espera de teste");
  expect(m.read.mock.calls[1]?.[0]).toEqual(m.read.mock.calls[2]?.[0]);
  expect(m.read).toHaveBeenLastCalledWith({
    data: { organizationId: "org-a", workflowId: "workflow-a", days: 7, cursor },
  });
  expect(screen.getAllByText("Confirmação de teste")).toHaveLength(1);
  expect(screen.getByText(/2 registros carregados/)).toBeTruthy();
});

it("trocar o período reinicia a paginação e remove registros do período anterior", async () => {
  render(app());
  await screen.findByText("Confirmação de teste");
  m.read.mockImplementation(() => new Promise(() => {}));
  fireEvent.change(screen.getByLabelText("Período dos registros"), { target: { value: "30" } });
  expect(screen.queryByText("Confirmação de teste")).toBeNull();
  await waitFor(() =>
    expect(m.read).toHaveBeenLastCalledWith({
      data: { organizationId: "org-a", workflowId: "workflow-a", days: 30 },
    }),
  );
});

it("não reaproveita registros de outra identidade ou organização", async () => {
  const { rerender } = render(app());
  await screen.findByText("contact-synthetic-a");
  m.user = "user-b";
  m.org = "org-b";
  m.read.mockImplementation(() => new Promise(() => {}));
  rerender(app());
  expect(screen.queryByText("contact-synthetic-a")).toBeNull();
  await waitFor(() =>
    expect(m.read).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ organizationId: "org-b" }),
    }),
  );
});

it("um resumo indisponível não impede ver registros nem inventa contagem zero", async () => {
  m.read.mockResolvedValue(
    page({ statistics: { state: "unavailable", message: "Resumo indisponível" } }),
  );
  render(app());
  await screen.findByText("Confirmação de teste");
  expect(screen.getByText(/Resumo por estado indisponível/)).toBeTruthy();
  expect(screen.queryByText(/Registros no período/)).toBeNull();
});

it("bloqueia consulta direta em demo e quando a permissão é retirada", async () => {
  const { rerender } = render(app());
  await screen.findByText("Confirmação de teste");
  m.allowed = false;
  rerender(app());
  expect(screen.queryByText("Confirmação de teste")).toBeNull();
  expect(screen.getByRole("alert").textContent).toContain("administradores e gestores");
  m.allowed = true;
  m.mode = "demo";
  rerender(app());
  expect(screen.queryByText("Confirmação de teste")).toBeNull();
  expect(m.read).toHaveBeenCalledTimes(1);
});
