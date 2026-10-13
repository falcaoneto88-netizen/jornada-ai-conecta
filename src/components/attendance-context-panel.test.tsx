// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AttendanceContext } from "@/lib/attendance-context.core";
const m = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), scope: "userA", demo: false }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/attendance-context.functions", () => ({
  readAttendanceContext: m.read,
  saveAttendanceContext: m.save,
}));
vi.mock("@/lib/repo", () => ({ useModoDados: () => ({ escopo: m.scope, demo: m.demo }) }));
import { AttendanceContextPanel } from "./attendance-context-panel";

const org = "00000000-0000-4000-8000-000000000001";
const owner = "00000000-0000-4000-8000-000000000002";
const context: AttendanceContext = {
  organizationId: org,
  timezone: "Europe/Lisbon",
  canEdit: true,
  checkedAt: "2026-10-13T11:00:00Z",
  contact: {
    id: "00000000-0000-4000-8000-000000000003",
    ghlContactId: "contactA",
    name: "Ana Sintética",
    phone: "+351200000000",
    email: null,
    updatedAt: "2026-10-13T10:00:00Z",
  },
  stage: { key: "novo_lead", name: "Novo contato" },
  nextAppointment: {
    id: "00000000-0000-4000-8000-000000000004",
    title: "Consulta de exemplo",
    startAt: "2026-10-14T13:00:00Z",
    endAt: null,
    status: "agendada",
    updatedAt: "2026-10-13T10:30:00Z",
  },
  team: [{ id: owner, name: "Operadora sintética" }],
  attendance: { version: 0, ownerId: null, nextAction: null, nextActionAt: null },
};
let client: QueryClient;
function response(data = context) {
  return { ok: true as const, data };
}
function app(contact = "contactA", organizationId = org) {
  return (
    <QueryClientProvider client={client}>
      <AttendanceContextPanel
        organizationId={organizationId}
        ghlContactId={contact}
        conversationId={`conversation-${contact}`}
        fuso="America/Bahia"
      />
    </QueryClientProvider>
  );
}
async function loaded() {
  await screen.findByRole("button", { name: "Salvar acompanhamento" });
}
function change(label: string | RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
function saveButton() {
  return screen.getByRole("button", { name: "Salvar acompanhamento" }) as HTMLButtonElement;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetAllMocks();
  m.scope = "userA";
  m.demo = false;
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  m.read.mockResolvedValue(response());
  m.save.mockResolvedValue(
    response({ ...context, attendance: { ...context.attendance, version: 1, ownerId: owner } }),
  );
});
afterEach(() => {
  cleanup();
  client.clear();
});

it("carrega por escopo, mostra fonte local e usa fuso do servidor sem gravação automática", async () => {
  render(app());
  await loaded();
  expect(m.read).toHaveBeenCalledWith({ data: { organizationId: org, ghlContactId: "contactA" } });
  expect(screen.getByText("Ana Sintética")).toBeTruthy();
  expect(screen.getByText("Novo contato")).toBeTruthy();
  expect(screen.getByText(/14:00/)).toBeTruthy();
  expect(screen.getByText(/não são uma consulta ao GHL em tempo real/)).toBeTruthy();
  expect(screen.getByText("Horários: Europe/Lisbon")).toBeTruthy();
  expect(screen.getByLabelText("Prazo (Europe/Lisbon)")).toBeTruthy();
  expect(saveButton().disabled).toBe(true);
  expect(m.save).not.toHaveBeenCalled();
});
it("carregamento e falha de leitura não oferecem edição de contexto antigo", async () => {
  const d = deferred<ReturnType<typeof response>>();
  m.read.mockReturnValue(d.promise);
  render(app());
  expect(screen.getByRole("status").textContent).toContain("A carregar");
  expect(screen.queryByRole("button", { name: "Salvar acompanhamento" })).toBeNull();
  await act(async () => {
    d.resolve(response());
  });
  await loaded();
  m.read.mockRejectedValue(new Error("private raw error"));
  fireEvent.click(screen.getByRole("button", { name: "Atualizar contexto" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Não foi possível consultar");
  expect(screen.queryByText("Ana Sintética")).toBeNull();
  expect(screen.queryByText(/private raw error/)).toBeNull();
});
it.each(["contact_not_synced", "forbidden", "migration_required"])(
  "estado %s não cria contato, tarefa ou formulário",
  async (code) => {
    m.read.mockResolvedValue({
      ok: false,
      code,
      message: "Informação não disponível nesta sessão.",
    });
    render(app());
    await screen.findByText("Informação não disponível nesta sessão.");
    expect(screen.queryByLabelText("Próxima ação interna")).toBeNull();
    expect(screen.queryByRole("button", { name: "Salvar acompanhamento" })).toBeNull();
    expect(m.save).not.toHaveBeenCalled();
  },
);
it("visualizador vê responsável e retorno mas não pode editar ou concluir", async () => {
  m.read.mockResolvedValue(
    response({
      ...context,
      canEdit: false,
      attendance: {
        version: 2,
        ownerId: owner,
        nextAction: "Verificar horários",
        nextActionAt: "2026-10-15T08:00:00Z",
      },
    }),
  );
  render(app());
  await screen.findByText("Verificar horários");
  expect(screen.getByText(/Responsável no Jornada: Operadora/)).toBeTruthy();
  expect(screen.getByText(/apenas consultar/)).toBeTruthy();
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(screen.queryByRole("button", { name: "Concluir retorno" })).toBeNull();
});
it("salvar só responsável mantém o prazo UTC existente, sem reconversão de hora ambígua", async () => {
  const dayKey = ["attendance-workspace", "userA", org, "mine", "all", 0];
  const otherUserKey = ["attendance-workspace", "userB", org, "mine", "all", 0];
  client.setQueryData(dayKey, { count: 0 });
  client.setQueryData(otherUserKey, { count: 0 });
  m.read.mockResolvedValue(
    response({
      ...context,
      attendance: {
        version: 3,
        ownerId: null,
        nextAction: "Verificar horários",
        nextActionAt: "2026-10-25T00:30:00Z",
      },
    }),
  );
  render(app());
  await loaded();
  expect((screen.getByLabelText("Prazo (Europe/Lisbon)") as HTMLInputElement).value).toBe(
    "2026-10-25T01:30",
  );
  change("Responsável no Jornada", owner);
  fireEvent.click(saveButton());
  await waitFor(() => expect(m.save).toHaveBeenCalledTimes(1));
  expect(m.save).toHaveBeenCalledWith({
    data: {
      organizationId: org,
      ghlContactId: "contactA",
      expectedVersion: 3,
      expectedTimezone: "Europe/Lisbon",
      ownerId: owner,
      returnAction: "keep",
    },
  });
  await waitFor(() => expect(client.getQueryState(dayKey)?.isInvalidated).toBe(true));
  expect(client.getQueryState(otherUserKey)?.isInvalidated).toBe(false);
});
it("nova ação exige prazo e só envia a hora civil no clique explícito, sem duplicar", async () => {
  const d = deferred<ReturnType<typeof response>>();
  m.save.mockReturnValue(d.promise);
  render(app());
  await loaded();
  change("Próxima ação interna", " Verificar horários ");
  fireEvent.click(saveButton());
  expect(screen.getByRole("alert").textContent).toContain("prazo");
  expect(m.save).not.toHaveBeenCalled();
  change("Prazo (Europe/Lisbon)", "2026-10-15T09:30");
  expect(m.save).not.toHaveBeenCalled();
  const button = saveButton();
  act(() => {
    fireEvent.click(button);
    fireEvent.click(button);
  });
  expect(m.save).toHaveBeenCalledTimes(1);
  expect(m.save).toHaveBeenCalledWith({
    data: {
      organizationId: org,
      ghlContactId: "contactA",
      expectedVersion: 0,
      expectedTimezone: "Europe/Lisbon",
      ownerId: null,
      returnAction: "set",
      returnText: "Verificar horários",
      dueLocal: "2026-10-15T09:30",
    },
  });
  await act(async () =>
    d.resolve(
      response({
        ...context,
        attendance: {
          version: 1,
          ownerId: null,
          nextAction: "Verificar horários",
          nextActionAt: "2026-10-15T08:30:00Z",
        },
      }),
    ),
  );
  expect(screen.getByRole("status").textContent).toContain("salvo");
});
it("concluir exige uma ação persistida e não conclui sobre edição não salva", async () => {
  m.read.mockResolvedValue(
    response({
      ...context,
      attendance: {
        version: 4,
        ownerId: owner,
        nextAction: "Verificar horários",
        nextActionAt: "2026-10-15T08:00:00Z",
      },
    }),
  );
  m.save.mockResolvedValue(
    response({
      ...context,
      attendance: { version: 5, ownerId: owner, nextAction: null, nextActionAt: null },
    }),
  );
  render(app());
  await loaded();
  change("Próxima ação interna", "Alteração ainda não salva");
  expect(
    (screen.getByRole("button", { name: "Concluir retorno" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Descartar edição" }));
  fireEvent.click(screen.getByRole("button", { name: "Concluir retorno" }));
  await screen.findByText("Retorno concluído no Jornada AI.");
  expect(m.save).toHaveBeenCalledWith({
    data: {
      organizationId: org,
      ghlContactId: "contactA",
      expectedVersion: 4,
      expectedTimezone: "Europe/Lisbon",
      ownerId: owner,
      returnAction: "complete",
    },
  });
  expect(screen.queryByRole("button", { name: "Concluir retorno" })).toBeNull();
});
it("conflito preserva edição e impede outro save até usar dados atuais", async () => {
  m.save.mockResolvedValue({
    ok: false,
    code: "conflict",
    message: "Outro operador atualizou o acompanhamento.",
  });
  render(app());
  await loaded();
  change("Responsável no Jornada", owner);
  change("Próxima ação interna", "Minha edição");
  change("Prazo (Europe/Lisbon)", "2026-10-15T09:00");
  m.read.mockResolvedValue(
    response({
      ...context,
      attendance: {
        version: 2,
        ownerId: owner,
        nextAction: "Ação da outra pessoa",
        nextActionAt: "2026-10-16T08:00:00Z",
      },
    }),
  );
  fireEvent.click(saveButton());
  await screen.findByText("Outro operador atualizou o acompanhamento.");
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Usar dados atuais" }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  expect((screen.getByLabelText("Próxima ação interna") as HTMLTextAreaElement).value).toBe(
    "Minha edição",
  );
  expect(saveButton().disabled).toBe(true);
  fireEvent.click(saveButton());
  expect(m.save).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Usar dados atuais" }));
  expect((screen.getByLabelText("Próxima ação interna") as HTMLTextAreaElement).value).toBe(
    "Ação da outra pessoa",
  );
});
it("erro de prazo conserva ação e permite corrigir sem declarar sucesso", async () => {
  m.save.mockResolvedValue({
    ok: false,
    code: "ambiguous_datetime",
    message: "Esta hora ocorre duas vezes. Escolha outra hora.",
  });
  render(app());
  await loaded();
  change("Próxima ação interna", "Verificar horários");
  change("Prazo (Europe/Lisbon)", "2026-10-25T01:30");
  fireEvent.click(saveButton());
  await screen.findByText(/Esta hora ocorre duas vezes/);
  expect((screen.getByLabelText("Próxima ação interna") as HTMLTextAreaElement).value).toBe(
    "Verificar horários",
  );
  expect(screen.queryByText(/Acompanhamento salvo/)).toBeNull();
});
it("troca de contato/identidade isola edição e resposta tardia do contato anterior", async () => {
  const d = deferred<ReturnType<typeof response>>();
  m.save.mockReturnValue(d.promise);
  const rendered = render(app());
  await loaded();
  change("Responsável no Jornada", owner);
  fireEvent.click(saveButton());
  m.read.mockResolvedValue(
    response({
      ...context,
      contact: {
        ...context.contact,
        id: "00000000-0000-4000-8000-000000000005",
        ghlContactId: "contactB",
        name: "Bruno Sintético",
      },
    }),
  );
  m.scope = "userB";
  rendered.rerender(app("contactB"));
  await screen.findByText("Bruno Sintético");
  await act(async () =>
    d.resolve(
      response({ ...context, attendance: { ...context.attendance, version: 1, ownerId: owner } }),
    ),
  );
  expect(screen.queryByText("Ana Sintética")).toBeNull();
  expect((screen.getByLabelText("Responsável no Jornada") as HTMLSelectElement).value).toBe("");
  expect(screen.queryByText(/Acompanhamento salvo/)).toBeNull();
  expect(m.save).toHaveBeenCalledTimes(1);
});
it("painéis desktop/mobile usam labels únicos e compartilham dados sem vazar edição", async () => {
  render(
    <QueryClientProvider client={client}>
      <AttendanceContextPanel organizationId={org} ghlContactId="contactA" fuso="Europe/Lisbon" />
      <AttendanceContextPanel organizationId={org} ghlContactId="contactA" fuso="Europe/Lisbon" />
    </QueryClientProvider>,
  );
  const owners = await screen.findAllByLabelText("Responsável no Jornada");
  expect(owners).toHaveLength(2);
  expect(owners[0]!.id).not.toBe(owners[1]!.id);
  expect(m.read).toHaveBeenCalledTimes(1);
  fireEvent.change(owners[0]!, { target: { value: owner } });
  expect((owners[1] as HTMLSelectElement).value).toBe("");
});
it("modo demonstração não consulta nem grava contexto real", () => {
  m.demo = true;
  render(app());
  expect(m.read).not.toHaveBeenCalled();
  expect(m.save).not.toHaveBeenCalled();
});

it("troca de fuso durante edição bloqueia save e só atualiza a hora após revisão explícita", async () => {
  m.read.mockResolvedValue(
    response({
      ...context,
      attendance: {
        version: 2,
        ownerId: owner,
        nextAction: "Verificar horários",
        nextActionAt: "2026-10-15T08:00:00Z",
      },
    }),
  );
  render(app());
  await loaded();
  change("Próxima ação interna", "Minha edição local");
  m.read.mockResolvedValue(
    response({
      ...context,
      timezone: "UTC",
      attendance: {
        version: 2,
        ownerId: owner,
        nextAction: "Verificar horários",
        nextActionAt: "2026-10-15T08:00:00Z",
      },
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Atualizar contexto" }));
  await screen.findByText("Horários: UTC");
  expect(saveButton().disabled).toBe(true);
  expect((screen.getByLabelText("Próxima ação interna") as HTMLTextAreaElement).value).toBe(
    "Minha edição local",
  );
  fireEvent.click(screen.getByRole("button", { name: "Usar dados atuais" }));
  expect((screen.getByLabelText("Prazo (UTC)") as HTMLInputElement).value).toBe("2026-10-15T08:00");
  expect((screen.getByLabelText("Próxima ação interna") as HTMLTextAreaElement).value).toBe(
    "Verificar horários",
  );
  expect(m.save).not.toHaveBeenCalled();
});
it("uma instância sem edição acompanha save confirmado da outra, mantendo IDs distintos", async () => {
  render(
    <QueryClientProvider client={client}>
      <AttendanceContextPanel organizationId={org} ghlContactId="contactA" fuso="Europe/Lisbon" />
      <AttendanceContextPanel organizationId={org} ghlContactId="contactA" fuso="Europe/Lisbon" />
    </QueryClientProvider>,
  );
  const owners = await screen.findAllByLabelText("Responsável no Jornada");
  fireEvent.change(owners[0]!, { target: { value: owner } });
  fireEvent.click(screen.getAllByRole("button", { name: "Salvar acompanhamento" })[0]!);
  await waitFor(() => expect((owners[1] as HTMLSelectElement).value).toBe(owner));
  expect(m.save).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("button", { name: "Usar dados atuais" })).toBeNull();
});
it("save tardio não rebaixa revisão mais nova já presente no cache compartilhado", async () => {
  const d = deferred<ReturnType<typeof response>>();
  m.save.mockReturnValue(d.promise);
  render(app());
  await loaded();
  change("Próxima ação interna", "Primeiro retorno");
  change("Prazo (Europe/Lisbon)", "2026-10-15T09:00");
  fireEvent.click(saveButton());
  const newer = response({
    ...context,
    attendance: {
      version: 2,
      ownerId: owner,
      nextAction: "Retorno mais recente",
      nextActionAt: "2026-10-16T08:00:00Z",
    },
  });
  act(() => {
    client.setQueryData(["attendance-context", "userA", org, "contactA"], newer);
  });
  await act(async () =>
    d.resolve(
      response({
        ...context,
        attendance: {
          version: 1,
          ownerId: null,
          nextAction: "Primeiro retorno",
          nextActionAt: "2026-10-15T08:00:00Z",
        },
      }),
    ),
  );
  await waitFor(() =>
    expect((screen.getByLabelText("Próxima ação interna") as HTMLTextAreaElement).value).toBe(
      "Retorno mais recente",
    ),
  );
  expect(client.getQueryData(["attendance-context", "userA", org, "contactA"])).toEqual(newer);
  expect(m.save).toHaveBeenCalledTimes(1);
});
