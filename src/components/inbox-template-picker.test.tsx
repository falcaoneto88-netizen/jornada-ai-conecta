// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { InboxTemplatePicker } from "./inbox-template-picker";
const mocks = vi.hoisted(() => ({ library: vi.fn(), context: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (f: unknown) => f }));
vi.mock("@/lib/message-library.functions", () => ({ getMessageLibrary: mocks.library }));
vi.mock("@/lib/attendance-context.functions", () => ({ readAttendanceContext: mocks.context }));
const model = (id: string, body: string, lifecycle = "draft") => ({
  id,
  name: id,
  body,
  lifecycle,
  revision: 2,
  channel: "sms",
  language: "PT-PT",
  usage_note: "",
});
beforeEach(() => {
  mocks.library.mockReset().mockResolvedValue({
    modelos: [
      model("Saudação", "Olá, {{contact.first_name}}!"),
      model("Agenda", "Consulta às {{appointment.only_start_time}}"),
      model("Arquivo", "Não mostrar", "archived"),
      model("Neutro", "Obrigada pela mensagem."),
    ],
  });
  mocks.context.mockReset().mockResolvedValue({
    ok: true,
    data: { contact: { name: "Ana Exemplo" }, nextAppointment: null, timezone: "Europe/Lisbon" },
  });
});
afterEach(cleanup);
function mount({ hasDraft = false, disabled = false, onInsert = vi.fn(() => true) } = {}) {
  const query = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={query}>
      <InboxTemplatePicker
        organizationId="org-a"
        contactId="contact-a"
        scope="user-a"
        clinicName="Clínica Exemplo"
        hasDraft={hasDraft}
        draftVersion={1}
        disabled={disabled}
        onInsert={onInsert}
      />
    </QueryClientProvider>,
  );
  return onInsert;
}
async function choose(id: string) {
  await waitFor(() => expect(screen.getByRole("option", { name: `${id} · PT-PT` })).toBeTruthy());
  fireEvent.change(screen.getByRole("combobox", { name: "Modelo" }), { target: { value: id } });
}
const insert = () =>
  screen.getByRole("button", { name: "Inserir no rascunho" }) as HTMLButtonElement;
it("consulta fontes existentes com escopo, omite arquivos e só insere após prévia e clique", async () => {
  const onInsert = mount();
  await choose("Saudação");
  expect(mocks.library).toHaveBeenCalledWith({ data: { organizationId: "org-a" } });
  expect(mocks.context).toHaveBeenCalledWith({
    data: { organizationId: "org-a", ghlContactId: "contact-a" },
  });
  expect(screen.queryByRole("option", { name: /Arquivo/ })).toBeNull();
  await waitFor(() =>
    expect(screen.getByLabelText("Prévia do texto-base").textContent).toBe("Olá, Ana!"),
  );
  expect(onInsert).not.toHaveBeenCalled();
  fireEvent.click(insert());
  expect(onInsert).toHaveBeenCalledWith("Olá, Ana!", "append");
});
it("dados ausentes não viram texto fictício", async () => {
  const onInsert = mount();
  await choose("Agenda");
  expect(insert().disabled).toBe(true);
  expect(onInsert).not.toHaveBeenCalled();
});
it("exige confirmação para substituir, preserva texto se compositor recusar e respeita bloqueio", async () => {
  const onInsert = vi.fn(() => false);
  mount({ hasDraft: true, onInsert });
  await choose("Neutro");
  fireEvent.change(screen.getByRole("combobox", { name: "Como inserir" }), {
    target: { value: "replace" },
  });
  expect(insert().disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox"));
  expect(insert().disabled).toBe(false);
  fireEvent.click(insert());
  expect(onInsert).toHaveBeenCalledWith("Obrigada pela mensagem.", "replace");
  expect(screen.getByRole("status").textContent).toContain("texto atual foi preservado");
  expect(insert().disabled).toBe(true);
});
it("não habilita inserção durante envio e não inventa cadastro quando contexto falha", async () => {
  mocks.context.mockResolvedValue({ ok: false, code: "contact_not_synced" });
  mount({ disabled: true });
  await choose("Saudação");
  expect(insert().disabled).toBe(true);
  expect(screen.getByLabelText("Prévia do texto-base").textContent).toContain("PENDENTE");
});

it("mudança de rascunho revoga confirmação anterior de substituição", async () => {
  const query = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const onInsert = vi.fn(() => true);
  const tree = (version: number) => (
    <QueryClientProvider client={query}>
      <InboxTemplatePicker
        organizationId="org-a"
        contactId="contact-a"
        scope="user-a"
        clinicName="Clínica Exemplo"
        hasDraft
        draftVersion={version}
        disabled={false}
        onInsert={onInsert}
      />
    </QueryClientProvider>
  );
  const { rerender } = render(tree(1));
  await choose("Neutro");
  fireEvent.change(screen.getByRole("combobox", { name: "Como inserir" }), {
    target: { value: "replace" },
  });
  fireEvent.click(screen.getByRole("checkbox"));
  expect(insert().disabled).toBe(false);
  rerender(tree(2));
  expect(insert().disabled).toBe(true);
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  expect(onInsert).not.toHaveBeenCalled();
});

it("falha na atualização torna indisponível modelo anteriormente carregado", async () => {
  const query = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={query}>
      <InboxTemplatePicker
        organizationId="org-a"
        contactId="contact-a"
        scope="user-a"
        clinicName="Clínica Exemplo"
        hasDraft={false}
        draftVersion={1}
        disabled={false}
        onInsert={vi.fn(() => true)}
      />
    </QueryClientProvider>,
  );
  await choose("Neutro");
  expect(insert().disabled).toBe(false);
  mocks.library.mockRejectedValue(new Error("synthetic failure"));
  await query.refetchQueries({ queryKey: ["message-library", "user-a", "org-a"] });
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Não foi possível"));
  expect(screen.queryByRole("button", { name: "Inserir no rascunho" })).toBeNull();
});
