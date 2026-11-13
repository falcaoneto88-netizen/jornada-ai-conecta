// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { InboxBookingPanel, type InboxBookingPanelProps } from "./inbox-booking-panel";
import { chaveDia } from "@/lib/clinic-time";
const mocks = vi.hoisted(() => ({
  options: vi.fn(),
  create: vi.fn(),
  read: vi.fn(),
  abandon: vi.fn(),
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/chat-booking.functions", () => ({
  getChatBookingOptions: mocks.options,
  createChatBooking: mocks.create,
  readChatBookingRequest: mocks.read,
  abandonChatBookingRequest: mocks.abandon,
}));
const requestId = "12345678-1234-4234-8234-123456789012";
const today = chaveDia(new Date(), "Europe/Lisbon");
const options = {
  contactName: "Ana Sintética",
  calendarId: "calendar",
  calendarName: "Consulta Inicial",
  timezone: "Europe/Lisbon",
  durationMinutes: 60,
  meetingLabel: "Clínica de teste",
  slots: [{ startAt: `${today}T11:00:00+00:00`, endAt: `${today}T12:00:00+00:00`, label: "11:00" }],
  canBook: true,
  checkedAt: "2030-01-15T12:00:00Z",
};
const confirmed = {
  state: "confirmed",
  requestId,
  appointmentId: "appointment",
  startAt: options.slots[0]!.startAt,
  endAt: options.slots[0]!.endAt,
  calendarName: options.calendarName,
  timezone: options.timezone,
  message: "Agendamento criado no GHL.",
  cacheSynced: true,
};
function props(overrides: Partial<InboxBookingPanelProps> = {}): InboxBookingPanelProps {
  return {
    organizationId: "org",
    contactId: "contact",
    contactName: "Ana Sintética",
    scope: "u:owner",
    timeZone: "Europe/Lisbon",
    open: true,
    onOpenChange: vi.fn(),
    onConfirmed: vi.fn(),
    ...overrides,
  };
}
function setup(input = props()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const wrap = (value: InboxBookingPanelProps) => (
    <QueryClientProvider client={client}>
      <InboxBookingPanel {...value} />
    </QueryClientProvider>
  );
  const view = render(wrap(input));
  return {
    ...view,
    input,
    invalidate,
    rerenderBooking: (next: InboxBookingPanelProps) => view.rerender(wrap(next)),
  };
}
async function choose() {
  const slot = await screen.findByRole("radio", { name: "11:00" });
  fireEvent.click(slot);
}
async function review() {
  await choose();
  fireEvent.click(screen.getByRole("button", { name: "Revisar agendamento" }));
}
function pendingKeys() {
  return Object.keys(localStorage).filter((key) => key.startsWith("jornada:chat-booking:"));
}
beforeEach(() => {
  localStorage.clear();
  mocks.options.mockReset().mockImplementation(({ data }: { data: { date: string } }) =>
    Promise.resolve({
      ok: true,
      data: {
        ...options,
        slots: [
          {
            ...options.slots[0],
            startAt: `${data.date}T11:00:00+00:00`,
            endAt: `${data.date}T12:00:00+00:00`,
          },
        ],
      },
    }),
  );
  mocks.create.mockReset().mockResolvedValue({ ok: true, data: confirmed });
  mocks.read.mockReset().mockResolvedValue({ ok: true, data: confirmed });
  mocks.abandon.mockReset().mockResolvedValue({ ok: true, data: { abandoned: true } });
  vi.spyOn(crypto, "randomUUID").mockReturnValue(requestId);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});
it("consulta só ao abrir e mantém contato existente e fuso da clínica", async () => {
  const input = props({ open: false });
  const view = setup(input);
  expect(mocks.options).not.toHaveBeenCalled();
  view.rerenderBooking({ ...input, open: true });
  await choose();
  expect(mocks.options).toHaveBeenCalledWith({
    data: {
      organizationId: "org",
      ghlContactId: "contact",
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    },
  });
  expect(screen.getByText(/Horários em Europe\/Lisbon/)).toBeTruthy();
  expect(screen.getByText("Ana Sintética")).toBeTruthy();
  expect(mocks.create).not.toHaveBeenCalled();
});
it("exige revisão e clique final, notifica false e atualiza somente caches da organização", async () => {
  const view = setup();
  await review();
  expect(mocks.create).not.toHaveBeenCalled();
  expect(
    (
      screen.getByRole("checkbox", {
        name: "Acionar confirmações e lembretes do calendário",
      }) as HTMLInputElement
    ).checked,
  ).toBe(false);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Criar agendamento" })));
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(mocks.create).toHaveBeenCalledWith({
    data: {
      organizationId: "org",
      ghlContactId: "contact",
      requestId,
      calendarId: "calendar",
      timezone: "Europe/Lisbon",
      startAt: options.slots[0]!.startAt,
      endAt: options.slots[0]!.endAt,
      notify: false,
    },
  });
  expect(view.input.onConfirmed).toHaveBeenCalledTimes(1);
  expect(view.invalidate).toHaveBeenCalledWith({
    queryKey: ["attendance-context", "u:owner", "org", "contact"],
  });
  expect(view.invalidate).toHaveBeenCalledWith({ queryKey: ["marcacoes", "u:owner", "org"] });
  expect(pendingKeys()).toHaveLength(0);
  expect(screen.getByText(/não comprova a confirmação de presença/)).toBeTruthy();
});
it("opção de notificações é opt-in e aparece na revisão", async () => {
  setup();
  await review();
  const notifications = screen.getByRole("checkbox", {
    name: "Acionar confirmações e lembretes do calendário",
  }) as HTMLInputElement;
  expect(notifications.checked).toBe(false);
  fireEvent.click(notifications);
  expect(notifications.checked).toBe(true);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Criar agendamento" })));
  expect(mocks.create.mock.calls[0]?.[0].data.notify).toBe(true);
});
it("timeout persiste só UUID e recarga verifica o mesmo pedido sem outro POST", async () => {
  mocks.create.mockRejectedValue(new Error("network_timeout"));
  const first = setup();
  await review();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Criar agendamento" })));
  expect(pendingKeys()).toHaveLength(1);
  expect(localStorage.getItem(pendingKeys()[0]!)).toBe(requestId);
  expect(JSON.stringify(localStorage)).not.toContain("Ana Sintética");
  expect(screen.queryByRole("button", { name: "Criar agendamento" })).toBeNull();
  first.unmount();
  setup();
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Verificar resultado" })),
  );
  expect(mocks.read).toHaveBeenCalledWith({
    data: { organizationId: "org", ghlContactId: "contact", requestId },
  });
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(pendingKeys()).toHaveLength(0);
});
it("agenda criada com cache pendente pode ser reparada por leitura do mesmo UUID", async () => {
  mocks.create.mockResolvedValue({ ok: true, data: { ...confirmed, cacheSynced: false } });
  const view = setup();
  await review();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Criar agendamento" })));
  expect(screen.getByText(/A atualização da agenda no Jornada AI está pendente/)).toBeTruthy();
  expect(pendingKeys()).toHaveLength(1);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Atualizar agenda" })));
  expect(mocks.read).toHaveBeenCalledWith({
    data: { organizationId: "org", ghlContactId: "contact", requestId },
  });
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(view.input.onConfirmed).toHaveBeenCalledTimes(2);
  expect(pendingKeys()).toHaveLength(0);
  expect(screen.queryByRole("button", { name: "Atualizar agenda" })).toBeNull();
});
it("not_found só libera UUID após abandono seguro; não repete criação automaticamente", async () => {
  mocks.create.mockRejectedValue(new Error("network_timeout"));
  mocks.read.mockResolvedValue({ ok: false, code: "not_found", message: "Pedido sem registro." });
  setup();
  await review();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Criar agendamento" })));
  expect(screen.queryByRole("button", { name: "Encerrar pedido sem registro" })).toBeNull();
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Verificar resultado" })),
  );
  expect(pendingKeys()).toHaveLength(1);
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Encerrar pedido sem registro" })),
  );
  expect(mocks.abandon).toHaveBeenCalledWith({
    data: { organizationId: "org", ghlContactId: "contact", requestId },
  });
  expect(pendingKeys()).toHaveLength(0);
  expect(screen.getByRole("button", { name: "Escolher outro horário" })).toBeTruthy();
  expect(mocks.create).toHaveBeenCalledTimes(1);
});
it("abandono concorrente que encontra claim mantém a referência e recebe o resultado", async () => {
  mocks.create.mockRejectedValue(new Error("network_timeout"));
  mocks.read.mockResolvedValue({ ok: false, code: "not_found", message: "Pedido sem registro." });
  mocks.abandon.mockResolvedValue({
    ok: true,
    data: {
      abandoned: false,
      receipt: { state: "pending", requestId, message: "Pedido já está em processamento." },
    },
  });
  setup();
  await review();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Criar agendamento" })));
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Verificar resultado" })),
  );
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Encerrar pedido sem registro" })),
  );
  expect(pendingKeys()).toHaveLength(1);
  expect(screen.getByText("Pedido já está em processamento.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Encerrar pedido sem registro" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Escolher outro horário" })).toBeNull();
  expect(mocks.create).toHaveBeenCalledTimes(1);
});
it("falha de abandono mantém o pedido e bloqueia nova criação", async () => {
  mocks.create.mockRejectedValue(new Error("network_timeout"));
  mocks.read.mockResolvedValue({ ok: false, code: "not_found", message: "Pedido sem registro." });
  mocks.abandon.mockRejectedValue(new Error("network_timeout"));
  setup();
  await review();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Criar agendamento" })));
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Verificar resultado" })),
  );
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Encerrar pedido sem registro" })),
  );
  expect(pendingKeys()).toHaveLength(1);
  expect(screen.getByText(/Não foi possível encerrar o pedido com segurança/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Criar agendamento" })).toBeNull();
  expect(mocks.create).toHaveBeenCalledTimes(1);
});
it("duplo clique e pedido pending só permitem conferir resultado", async () => {
  let finish!: (result: unknown) => void;
  mocks.create.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  setup();
  await review();
  const button = screen.getByRole("button", { name: "Criar agendamento" });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(mocks.create).toHaveBeenCalledTimes(1);
  await act(async () =>
    finish({
      ok: true,
      data: { state: "pending", requestId, message: "Pedido em processamento." },
    }),
  );
  expect(screen.getByRole("button", { name: "Verificar resultado" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Criar agendamento" })).toBeNull();
});
it("mudar contato durante consulta ignora horários antigos e não contamina o próximo", async () => {
  let finish!: (result: unknown) => void;
  mocks.options.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const input = props();
  const view = setup(input);
  view.rerenderBooking({ ...input, contactId: "other", contactName: "Bruno Sintético" });
  await screen.findByRole("radio", { name: "11:00" });
  await act(async () =>
    finish({
      ok: true,
      data: {
        ...options,
        calendarName: "Agenda antiga",
        slots: [{ ...options.slots[0], label: "15:00" }],
      },
    }),
  );
  expect(screen.queryByText("Agenda antiga")).toBeNull();
  expect(screen.queryByRole("radio", { name: "15:00" })).toBeNull();
  expect(mocks.create).not.toHaveBeenCalled();
});
it("mudar data invalida seleção e resposta antiga de disponibilidade", async () => {
  let finish!: (result: unknown) => void;
  setup();
  await choose();
  mocks.options.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.change(screen.getByLabelText("Data da consulta"), { target: { value: "2030-01-20" } });
  expect(
    (screen.getByRole("button", { name: "Revisar agendamento" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.change(screen.getByLabelText("Data da consulta"), { target: { value: "2030-01-21" } });
  await screen.findByRole("radio", { name: "11:00" });
  await act(async () => finish({ ok: true, data: { ...options, slots: [] } }));
  expect(screen.getByRole("radio", { name: "11:00" })).toBeTruthy();
  expect((screen.getByRole("radio", { name: "11:00" }) as HTMLInputElement).checked).toBe(false);
});
it("bloqueia horários retornados para outro dia, mesmo com resposta de consulta atual", async () => {
  setup();
  await choose();
  mocks.options.mockResolvedValue({ ok: true, data: options });
  fireEvent.change(screen.getByLabelText("Data da consulta"), { target: { value: "2030-01-21" } });
  await screen.findByText(/Os horários recebidos não correspondem à data consultada/);
  expect(screen.queryByRole("radio")).toBeNull();
  expect(
    (screen.getByRole("button", { name: "Revisar agendamento" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(mocks.create).not.toHaveBeenCalled();
});
it.each(["migration_required", "forbidden"])(
  "falha %s não inventa horários nem permite criação",
  async (code) => {
    mocks.options.mockResolvedValue({
      ok: false,
      code,
      message: "Configuração de agenda pendente.",
    });
    setup();
    await screen.findByText("Configuração de agenda pendente.");
    expect(screen.queryByRole("radio")).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Revisar agendamento" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(mocks.create).not.toHaveBeenCalled();
  },
);
it("sem horários é estado vazio; acesso só de leitura mostra o motivo", async () => {
  mocks.options.mockResolvedValue({
    ok: true,
    data: { ...options, slots: [], canBook: false, blockReason: "Seu perfil não pode agendar." },
  });
  setup();
  await screen.findByText("Seu perfil não pode agendar.");
  expect(screen.getByText(/Nenhum horário disponível/)).toBeTruthy();
  expect(mocks.create).not.toHaveBeenCalled();
});
it("falha ao persistir UUID bloqueia POST em vez de arriscar duplicação", async () => {
  setup();
  await review();
  const save = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Criar agendamento" })));
  expect(screen.getByText(/A criação está bloqueada para evitar duplicações/)).toBeTruthy();
  expect(mocks.create).not.toHaveBeenCalled();
  save.mockRestore();
});
it("pedidos recuperados não vazam entre usuário, organização ou contato", async () => {
  localStorage.setItem(
    `jornada:chat-booking:${JSON.stringify(["u:other", "org", "contact"])}:${requestId}`,
    requestId,
  );
  localStorage.setItem(
    `jornada:chat-booking:${JSON.stringify(["u:owner", "other-org", "contact"])}:${requestId}`,
    requestId,
  );
  localStorage.setItem(
    `jornada:chat-booking:${JSON.stringify(["u:owner", "org", "other-contact"])}:${requestId}`,
    requestId,
  );
  setup();
  await choose();
  expect(screen.queryByRole("button", { name: "Verificar resultado" })).toBeNull();
  expect(mocks.read).not.toHaveBeenCalled();
});
it("erro seguro anterior ao POST permite escolher outro horário sem tratar como criação", async () => {
  mocks.create.mockResolvedValue({
    ok: false,
    code: "slot_unavailable",
    message: "O horário deixou de estar disponível.",
  });
  setup();
  await review();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Criar agendamento" })));
  expect(screen.getByText("O horário deixou de estar disponível.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Escolher outro horário" })).toBeTruthy();
  expect(pendingKeys()).toHaveLength(0);
  expect(screen.queryByText("Agendamento criado no GHL.")).toBeNull();
});
