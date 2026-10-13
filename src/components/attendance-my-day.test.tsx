// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AttendanceWorkspace } from "@/lib/attendance-workspace.core";
const m = vi.hoisted(() => ({ read: vi.fn(), scope: "userA", org: "orgA", demo: false }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    search,
    children,
    ...props
  }: {
    search?: { contact?: string };
    children: React.ReactNode;
  }) => (
    <a {...props} href={`/caixa-de-entrada?contact=${search?.contact ?? ""}`}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/attendance-workspace.functions", () => ({ readAttendanceWorkspace: m.read }));
vi.mock("@/lib/repo", () => ({ useModoDados: () => ({ escopo: m.scope, demo: m.demo }) }));
vi.mock("@/lib/organization", () => ({
  useOrganizacao: () => ({ data: { organizacao: { id: m.org } } }),
}));
import { AttendanceMyDay } from "./attendance-my-day";
const data: AttendanceWorkspace = {
  organizationId: "orgA",
  timezone: "Europe/Lisbon",
  checkedAt: "2026-10-13T10:00:00Z",
  day: { date: "2026-10-13", startAt: "2026-10-12T23:00:00Z", endAt: "2026-10-13T23:00:00Z" },
  source: { kind: "local", lastContactSyncAt: null, coverage: "linked_contacts" },
  counts: { awaitingResponse: null, returnsToday: 3, returnsOverdue: 2, appointmentsToday: 1 },
  awaitingResponseUnavailableReason: "message_coverage_unavailable",
  page: { index: 0, size: 25, totalItems: 1, hasMore: false },
  rows: [
    {
      id: "return-1",
      kind: "return",
      reason: "return_overdue",
      contact: { id: "localA", ghlContactId: "ghlA", name: "Ana sintética" },
      owner: { id: "ownerA", name: "Operador A" },
      dueAt: "2026-10-13T09:00:00Z",
      nextAction: "Confirmar disponibilidade",
      appointment: null,
      evidence: { source: "jornada", updatedAt: "2026-10-12T09:00:00Z" },
    },
  ],
};
let client: QueryClient;
function app() {
  return (
    <QueryClientProvider client={client}>
      <AttendanceMyDay />
    </QueryClientProvider>
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  m.scope = "userA";
  m.org = "orgA";
  m.demo = false;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  m.read.mockResolvedValue({ ok: true, data });
});
afterEach(() => {
  cleanup();
  client.clear();
});
it("default Meus usa dados reais e não infere resposta a partir de não lidas", async () => {
  render(app());
  await screen.findByText("Ana sintética");
  expect(m.read).toHaveBeenCalledWith({
    data: { organizationId: "orgA", ownerFilter: "mine", view: "all", page: 0, pageSize: 25 },
  });
  expect(screen.getByText("Indisponível")).toBeTruthy();
  expect(screen.getByText(/Não lida no GHL não significa/)).toBeTruthy();
  expect(screen.getByRole("link", { name: /Abrir atendimento/ }).getAttribute("href")).toBe(
    "/caixa-de-entrada?contact=ghlA",
  );
  expect(screen.getByText(/Fonte: registro no Jornada/)).toBeTruthy();
});
it("cartão e responsável alteram a consulta de cards e fila, sem somar contagens", async () => {
  render(app());
  await screen.findByText("Ana sintética");
  fireEvent.click(screen.getByRole("button", { name: /Pendências vencidas/ }));
  await waitFor(() =>
    expect(m.read).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ view: "overdue", ownerFilter: "mine" }),
    }),
  );
  fireEvent.change(screen.getByLabelText("Filtrar por responsável"), { target: { value: "all" } });
  await waitFor(() =>
    expect(m.read).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ view: "overdue", ownerFilter: "all", page: 0 }),
    }),
  );
});
it("vazio Meus oferece fila sem responsável e não declara ausência de mensagens", async () => {
  m.read.mockResolvedValue({
    ok: true,
    data: { ...data, rows: [], page: { ...data.page, totalItems: 0 } },
  });
  render(app());
  await screen.findByText(/Nenhum item atribuído a você/);
  fireEvent.click(screen.getByRole("button", { name: "Ver sem responsável" }));
  await waitFor(() =>
    expect(m.read).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ ownerFilter: "unassigned", page: 0 }),
    }),
  );
});
it("paginação vazia mantém próximo e troca de filtro reinicia a página", async () => {
  m.read.mockResolvedValue({
    ok: true,
    data: { ...data, rows: [], page: { ...data.page, totalItems: 26, hasMore: true } },
  });
  render(app());
  await screen.findByRole("button", { name: "Próxima página" });
  fireEvent.click(screen.getByRole("button", { name: "Próxima página" }));
  await waitFor(() =>
    expect(m.read).toHaveBeenLastCalledWith({ data: expect.objectContaining({ page: 1 }) }),
  );
  fireEvent.click(screen.getByRole("button", { name: /Retornos hoje/ }));
  await waitFor(() =>
    expect(m.read).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ page: 0, view: "returns_today" }),
    }),
  );
});
it.each(["migration_required", "forbidden", "unavailable"])(
  "erro %s é explícito e não vira zero",
  async (code) => {
    m.read.mockResolvedValue({ ok: false, code, message: "Falha controlada" });
    render(app());
    expect((await screen.findByRole("alert")).textContent).toContain("Falha controlada");
    expect(screen.queryByText("Ana sintética")).toBeNull();
    expect(screen.getByRole("button", { name: /Retornos hoje/ }).textContent).toContain("—");
  },
);
it("mudança de identidade e organização nunca reapresenta dados de outro escopo", async () => {
  const { rerender } = render(app());
  await screen.findByText("Ana sintética");
  m.scope = "userB";
  m.org = "orgB";
  m.read.mockImplementation(() => new Promise(() => {}));
  rerender(app());
  expect(screen.queryByText("Ana sintética")).toBeNull();
  await waitFor(() =>
    expect(m.read).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ organizationId: "orgB" }),
    }),
  );
});
it("demo não consulta serviços reais", () => {
  m.demo = true;
  render(app());
  expect(m.read).not.toHaveBeenCalled();
});
