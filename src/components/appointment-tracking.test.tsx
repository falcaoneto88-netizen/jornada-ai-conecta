// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  ler: vi.fn(),
  buscar: vi.fn(),
  gravar: vi.fn(),
  operar: true,
  escopo: "userA",
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (f: unknown) => f }));
vi.mock("@/lib/appointment-tracking.functions", () => ({
  getAppointmentTracking: m.ler,
  getAppointmentEvidence: m.buscar,
  recordAppointmentEvidence: m.gravar,
}));
vi.mock("@/lib/repo", () => ({
  useModoDados: () => ({ escopo: m.escopo, demo: false }),
  usePermissoes: () => ({ operar: m.operar }),
}));
vi.mock("@/lib/organization", () => ({
  useOrganizacao: () => ({ data: { organizacao: { id: "orgA", timezone: "Europe/Lisbon" } } }),
}));
import { AppointmentTracking } from "./appointment-tracking";
import type { Marcacao } from "@/lib/repo";
const marcacoes = [
  {
    id: "apptA",
    titulo: "Avaliação",
    cliente: "Sintético",
    clienteId: "contactA",
    inicio: "15/09/2026, 14:00",
    inicioIso: "2026-09-15T13:00:00Z",
    fim: null,
    estado: "confirmada",
    responsavel: null,
  },
] as Marcacao[];
const data = {
  locationId: "locA",
  consultadoEm: "2026-09-14T13:00:00Z",
  consultas: [
    {
      appointmentId: "apptA",
      estado: "sem_evidencia",
      motivo: "Nenhuma evidência vinculada.",
      evidencia: null,
      historico: [],
    },
  ],
};
let client: QueryClient;
beforeEach(() => {
  vi.resetAllMocks();
  m.operar = true;
  m.escopo = "userA";
  m.ler.mockResolvedValue(data);
  m.buscar.mockImplementation(async ({ data: p }) =>
    p.conversationId
      ? {
          tipo: "mensagens",
          mensagens: [
            {
              id: "msgA",
              texto: "Confirma sua consulta?",
              data: "2026-09-14T13:00:00Z",
              tipo: "SMS",
              direcao: "outbound",
              estado: "delivered",
            },
          ],
          proximoCursor: null,
        }
      : {
          tipo: "conversas",
          conversas: [
            { id: "convA", nome: "Sintético", tipo: "SMS", ultimaData: "2026-09-14T13:00:00Z" },
          ],
        },
  );
  m.gravar.mockResolvedValue({ id: "receipt" });
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});
afterEach(() => {
  cleanup();
  client.clear();
});
function app() {
  return (
    <QueryClientProvider client={client}>
      <AppointmentTracking marcacoes={marcacoes} />
    </QueryClientProvider>
  );
}
async function abrir() {
  render(app());
  fireEvent.click(await screen.findByRole("button", { name: "Ver acompanhamento" }));
}
it("agenda confirmada ainda aparece sem evidência de presença", async () => {
  render(app());
  await screen.findByRole("button", { name: "Ver acompanhamento" });
  expect(screen.getByRole("row", { name: /Sintético/ }).textContent).toContain("Sem evidência");
  expect(screen.getByRole("row", { name: /Sintético/ }).textContent).not.toContain(
    "Presença confirmada",
  );
});
it("erro de leitura não apresenta contadores zerados ou sucesso", async () => {
  m.ler.mockRejectedValue(new Error("Evidências indisponíveis"));
  render(app());
  expect((await screen.findByRole("alert")).textContent).toContain("indisponíveis");
  expect(screen.queryByText("Sem evidência: 0")).toBeNull();
  expect(screen.queryByRole("button", { name: "Ver acompanhamento" })).toBeNull();
});
it("visualizador lê histórico mas não tem controle de associação", async () => {
  m.operar = false;
  await abrir();
  expect(screen.getByText("Nenhuma evidência registrada.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Associar mensagem como evidência" })).toBeNull();
});
it("só registra após seleção e revisão explícita da mensagem e consulta", async () => {
  await abrir();
  fireEvent.click(screen.getByRole("button", { name: "Associar mensagem como evidência" }));
  fireEvent.change(await screen.findByRole("combobox", { name: "Conversa da evidência" }), {
    target: { value: "convA" },
  });
  fireEvent.click(await screen.findByRole("button", { name: /Confirma sua consulta/ }));
  const save = screen.getByRole("button", { name: "Registrar evidência" }) as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  fireEvent.click(save);
  expect(m.gravar).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox"));
  expect(save.disabled).toBe(false);
  fireEvent.click(save);
  await waitFor(() => expect(m.gravar).toHaveBeenCalledTimes(1));
  expect(m.gravar.mock.calls[0]![0].data).toMatchObject({
    appointmentId: "apptA",
    messageId: "msgA",
    conversationId: "convA",
    estado: "aguardando_resposta",
    confirm: true,
  });
});
it("troca de identidade fecha diálogo e consulta escopo novo", async () => {
  const { rerender } = render(app());
  fireEvent.click(await screen.findByRole("button", { name: "Ver acompanhamento" }));
  expect(screen.getByRole("dialog")).toBeTruthy();
  m.escopo = "userB";
  rerender(app());
  expect(screen.queryByRole("dialog")).toBeNull();
  await waitFor(() => expect(m.ler).toHaveBeenCalledTimes(2));
});
it("histórico mostra texto, autor, horário no fuso e link verificado", async () => {
  m.ler.mockResolvedValue({
    ...data,
    consultas: [
      {
        ...data.consultas[0],
        estado: "presenca_confirmada",
        historico: [
          {
            id: "ev",
            state: "presenca_confirmada",
            message_text: "SIM",
            message_at: "2026-09-14T13:00:00Z",
            message_type: "SMS",
            message_status: "delivered",
            actor_name: "Operador",
            recorded_at: "2026-09-14T13:01:00Z",
            appointment_start_at: "2026-09-15T13:00:00Z",
            message_id: "msgA",
            ghl_contact_id: "contactA",
          },
        ],
      },
    ],
  });
  await abrir();
  expect(screen.getByText("SIM")).toBeTruthy();
  expect(screen.getByText(/Mensagem:/).textContent).toContain("14:00");
  expect(screen.getByText(/Associada por Operador/)).toBeTruthy();
  expect(screen.getByRole("link", { name: "Abrir contato no GHL" }).getAttribute("href")).toBe(
    "https://app.gohighlevel.com/v2/location/locA/contacts/detail/contactA",
  );
});
