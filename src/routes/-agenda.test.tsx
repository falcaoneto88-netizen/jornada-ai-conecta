// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Marcacao } from "@/lib/repo";

const m = vi.hoisted(() => ({
  demo: false,
  scope: "user-a:org-a",
  orgId: "org-a",
  connectionOrgId: "org-a",
  connectionError: false,
  timezone: "Europe/Lisbon",
  operate: true,
  manage: true,
  organizationError: false,
  appointmentsError: false,
  appointmentsLoading: false,
  appointments: [] as Marcacao[],
  readFinance: vi.fn(),
  saveFinance: vi.fn(),
  syncAgenda: vi.fn(),
  refetchAgenda: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
  Link: ({
    children,
    to,
    search,
    ...rest
  }: {
    children: ReactNode;
    to: string;
    search?: Record<string, string>;
  }) => (
    <a href={`${to}${search ? `?${new URLSearchParams(search).toString()}` : ""}`} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (f: unknown) => f }));
vi.mock("@/lib/appointment-finance.functions", () => ({
  getAppointmentFinance: m.readFinance,
  saveAppointmentFinance: m.saveFinance,
}));
vi.mock("@/lib/ghl-agenda.functions", () => ({ sincronizarAgendaGhl: m.syncAgenda }));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({
    children,
    actions,
    title,
  }: {
    children: ReactNode;
    actions: ReactNode;
    title: string;
  }) => (
    <main>
      <h1>{title}</h1>
      {actions}
      {children}
    </main>
  ),
}));
vi.mock("@/components/appointment-tracking", () => ({ AppointmentTracking: () => null }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/lib/repo", () => ({
  useModoDados: () => ({ demo: m.demo, escopo: m.scope }),
  usePermissoes: () => ({ operar: m.operate, gerirJornada: m.manage }),
  useLigacaoGhl: () => ({
    data: {
      organization_id: m.connectionOrgId,
      location_id: "ghl-location-a",
      calendar_id: "ghl-calendar-a",
    },
    isPending: false,
    isError: m.connectionError,
    refetch: vi.fn(),
  }),
  useMarcacoes: () => ({
    data: m.appointments,
    isLoading: m.appointmentsLoading,
    isError: m.appointmentsError,
    dataUpdatedAt: Date.parse("2026-09-14T23:40:00Z"),
    refetch: m.refetchAgenda,
  }),
}));
vi.mock("@/lib/organization", () => ({
  useOrganizacao: () => ({
    data: { organizacao: { id: m.orgId, timezone: m.timezone } },
    isError: m.organizationError,
  }),
}));
import { Agenda } from "./agenda";

const appointment: Marcacao = {
  id: "appointment-local-a",
  ghlAppointmentId: "appointment-ghl-a",
  clienteId: "contact-local-a",
  clienteGhlId: "contact-ghl-a",
  cliente: "Paciente sintética A",
  titulo: "Consulta inicial",
  inicio: "15/09/2026, 00:30",
  inicioIso: "2026-09-14T23:30:00Z",
  fim: null,
  fimIso: null,
  atualizadaIso: "2026-09-14T23:35:00Z",
  estado: "confirmada",
  responsavel: "Equipa A",
};
const financeEntry = {
  appointmentId: appointment.id,
  totalCents: 12345,
  depositCents: 4500,
  currency: "EUR" as const,
  revision: 2,
  updatedAt: "2026-09-14T23:40:00Z",
  updatedBy: "operator-a",
};
function financeResponse() {
  return { available: true, canEdit: true, entries: [financeEntry] };
}
let client: QueryClient;
function app() {
  return (
    <QueryClientProvider client={client}>
      <Agenda />
    </QueryClientProvider>
  );
}
async function loaded() {
  await waitFor(() => expect(m.readFinance).toHaveBeenCalled());
  await waitFor(() => expect(client.isFetching()).toBe(0));
}
function openAppointment() {
  fireEvent.click(screen.getByRole("button", { name: /Paciente sintética A/ }));
  return screen.getByRole("dialog");
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-14T23:45:00Z"));
  m.demo = false;
  m.scope = "user-a:org-a";
  m.orgId = "org-a";
  m.connectionOrgId = "org-a";
  m.connectionError = false;
  m.timezone = "Europe/Lisbon";
  m.operate = true;
  m.manage = true;
  m.organizationError = false;
  m.appointmentsError = false;
  m.appointmentsLoading = false;
  m.appointments = [{ ...appointment }];
  m.readFinance.mockResolvedValue(financeResponse());
  m.saveFinance.mockResolvedValue({ ok: true, entry: { ...financeEntry, revision: 3 } });
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.useRealTimers();
});

it("does not call the finance API for a read-only profile or show a financial editor", () => {
  m.operate = false;
  m.manage = false;
  render(app());
  const detail = openAppointment();
  expect(m.readFinance).not.toHaveBeenCalled();
  expect(within(detail).getByText(/valores administrativos são restritos/)).toBeTruthy();
  expect(within(detail).queryByLabelText("Valor total do procedimento (EUR)")).toBeNull();
  expect(within(detail).queryByRole("button", { name: "Gerar prévia" })).toBeNull();
});

it("uses local appointment IDs for finance and the distinct GHL contact ID for Meu Chat", async () => {
  render(app());
  await loaded();
  expect(m.readFinance).toHaveBeenCalledWith({ data: { appointmentIds: ["appointment-local-a"] } });
  const detail = openAppointment();
  expect(within(detail).getByRole("link", { name: "Abrir Meu Chat" }).getAttribute("href")).toBe(
    "/caixa-de-entrada?contact=contact-ghl-a",
  );
  expect(within(detail).getByRole("link", { name: "Gerir no GHL" }).getAttribute("href")).toBe(
    "https://app.gohighlevel.com/v2/location/ghl-location-a/calendars/view?calendar_ids=ghl-calendar-a",
  );
});

it("does not invent a conversation link from the local contact ID", async () => {
  m.appointments = [{ ...appointment, clienteGhlId: null }];
  render(app());
  await loaded();
  const detail = openAppointment();
  expect(within(detail).queryByRole("link", { name: "Abrir Meu Chat" })).toBeNull();
  expect(within(detail).getByText(/ainda não tem contacto GHL associado/)).toBeTruthy();
});

it.each(["failed-read", "different-organization"])(
  "hides GHL calendar links when the cached connection is not valid: %s",
  async (state) => {
    if (state === "failed-read") m.connectionError = true;
    else m.connectionOrgId = "org-other";
    render(app());
    await loaded();
    expect(screen.queryByRole("link", { name: "Nova consulta no GHL" })).toBeNull();
    const detail = openAppointment();
    expect(within(detail).queryByRole("link", { name: "Gerir no GHL" })).toBeNull();
  },
);

it("uses clinic day/time after midnight and prepares an editable draft with no writes", async () => {
  render(app());
  await loaded();
  expect((screen.getByLabelText("Ir para data") as HTMLInputElement).value).toBe("2026-09-15");
  expect(screen.getByText("00:30")).toBeTruthy();
  const detail = openAppointment();
  expect(within(detail).getByText(/Data e hora · Europe\/Lisbon/)).toBeTruthy();
  fireEvent.click(within(detail).getByRole("button", { name: "Gerar prévia" }));
  const draft = within(detail).getByLabelText(
    "Mensagem para revisão · não enviada",
  ) as HTMLTextAreaElement;
  expect(draft.value).toContain("15/09/26, 00:30");
  expect(draft.value).toContain("Europe/Lisbon");
  expect(draft.value).not.toContain("123,45");
  fireEvent.change(draft, { target: { value: "Texto revisto pela equipa." } });
  expect(draft.value).toBe("Texto revisto pela equipa.");
  expect(m.saveFinance).not.toHaveBeenCalled();
  expect(m.syncAgenda).not.toHaveBeenCalled();
});

it("includes financial amounts only by explicit preview selection, without persistence", async () => {
  render(app());
  await loaded();
  const detail = openAppointment();
  fireEvent.click(
    within(detail).getByRole("checkbox", { name: "Incluir valores administrativos" }),
  );
  fireEvent.click(within(detail).getByRole("button", { name: "Gerar prévia" }));
  expect(
    (within(detail).getByLabelText("Mensagem para revisão · não enviada") as HTMLTextAreaElement)
      .value,
  ).toContain("total 123,45");
  expect(m.saveFinance).not.toHaveBeenCalled();
  expect(m.syncAgenda).not.toHaveBeenCalled();
});

it("does not show stale financial cache after the finance read fails", async () => {
  render(app());
  await loaded();
  m.readFinance.mockRejectedValue(new Error("read-failed"));
  await act(async () => {
    await client.refetchQueries({ queryKey: ["appointment-finance"] });
  });
  expect(await screen.findByText(/Não foi possível consultar os valores/)).toBeTruthy();
  expect(screen.queryByText(/123,45/)).toBeNull();
  const detail = openAppointment();
  expect(within(detail).queryByLabelText("Valores registrados")).toBeNull();
  expect(within(detail).getByRole("alert").textContent).toContain(
    "Não foi possível ler os valores",
  );
});

it("removes cached financial values immediately if the profile loses permission", async () => {
  const { rerender } = render(app());
  await loaded();
  expect(screen.getAllByText(/123,45/).length).toBeGreaterThan(0);
  const reads = m.readFinance.mock.calls.length;
  m.operate = false;
  rerender(app());
  expect(screen.queryByText(/123,45/)).toBeNull();
  expect(m.readFinance.mock.calls.length).toBe(reads);
});

it("hides the open detail and financial amounts when appointments fail to load", async () => {
  const { rerender } = render(app());
  await loaded();
  openAppointment();
  m.appointmentsError = true;
  rerender(app());
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByText(/123,45/)).toBeNull();
  expect(screen.getByText("Não foi possível ler as consultas.")).toBeTruthy();
});

it("does not reuse another organization's finance cache while a new scope is loading", async () => {
  const { rerender } = render(app());
  await loaded();
  m.scope = "user-b:org-b";
  m.orgId = "org-b";
  m.readFinance.mockImplementation(() => new Promise(() => {}));
  rerender(app());
  expect(screen.queryByText(/123,45/)).toBeNull();
  expect(
    client.getQueryData(["appointment-finance", "user-a:org-a", "org-a", [appointment.id]]),
  ).toBeTruthy();
});

it("applies text filtering to both the displayed appointments and financial query scope", async () => {
  m.appointments.push({
    ...appointment,
    id: "appointment-local-b",
    cliente: "Paciente sintética B",
    titulo: "Retorno",
    responsavel: null,
  });
  render(app());
  await loaded();
  fireEvent.change(screen.getByLabelText("Pesquisar consulta"), { target: { value: "RETORNO" } });
  expect(screen.queryByRole("button", { name: /Paciente sintética A/ })).toBeNull();
  expect(screen.getByRole("button", { name: /Paciente sintética B/ })).toBeTruthy();
  await waitFor(() =>
    expect(m.readFinance).toHaveBeenLastCalledWith({
      data: { appointmentIds: ["appointment-local-b"] },
    }),
  );
});
