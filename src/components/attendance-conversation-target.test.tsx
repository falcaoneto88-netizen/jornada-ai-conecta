// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/attendance-workspace.functions", () => ({
  resolveAttendanceConversations: m.resolve,
}));
import { AttendanceConversationTarget } from "./attendance-conversation-target";
const candidate = {
  id: "conversationA",
  contactId: "contactA",
  locationId: "locationA",
  name: "Pessoa certa",
  channel: "TYPE_SMS",
  lastMessageAt: "2026-10-13T10:00:00Z",
};
const data = {
  organizationId: "orgA",
  ghlContactId: "contactA",
  locationId: "locationA",
  checkedAt: "2026-10-13T10:00:00Z",
  complete: true,
  resolution: "single",
  conversations: [candidate],
};
let client: QueryClient;
function app(conversationId?: string, contact = "contactA") {
  return (
    <QueryClientProvider client={client}>
      <AttendanceConversationTarget
        key={contact}
        organizationId="orgA"
        ghlContactId={contact}
        conversationId={conversationId}
        scope="scopeA"
        fuso="Europe/Lisbon"
      >
        {(c) => (
          <p>
            Atendimento aberto: {c.nome} · {c.id}
          </p>
        )}
      </AttendanceConversationTarget>
    </QueryClientProvider>
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  m.resolve.mockResolvedValue({ ok: true, data });
});
afterEach(() => {
  cleanup();
  client.clear();
});
it("conversa única completa é aberta pelo contato e ID conferidos", async () => {
  render(app());
  await screen.findByText("Atendimento aberto: Pessoa certa · conversationA");
  expect(m.resolve).toHaveBeenCalledWith({
    data: { organizationId: "orgA", ghlContactId: "contactA" },
  });
});
it.each(["multiple", "incomplete"])("resolução %s exige escolha explícita", async (resolution) => {
  m.resolve.mockResolvedValue({
    ok: true,
    data: {
      ...data,
      resolution,
      complete: resolution !== "incomplete",
      conversations:
        resolution === "multiple"
          ? [candidate, { ...candidate, id: "conversationB" }]
          : [candidate],
    },
  });
  render(app());
  await screen.findByText(/Escolha|mais de uma conversa/);
  expect(screen.queryByText(/Atendimento aberto/)).toBeNull();
  fireEvent.click(screen.getAllByRole("button", { name: /Pessoa certa/ })[0]!);
  await screen.findByText("Atendimento aberto: Pessoa certa · conversationA");
});
it("ID ausente não abre primeira conversa automaticamente", async () => {
  render(app("other"));
  await screen.findByRole("alert");
  expect(screen.queryByText(/Atendimento aberto/)).toBeNull();
});
it.each(["contact", "location", "org"])("resposta fora do escopo %s é rejeitada", async (field) => {
  m.resolve.mockResolvedValue({
    ok: true,
    data: {
      ...data,
      ...(field === "org" ? { organizationId: "other" } : {}),
      conversations: [
        {
          ...candidate,
          ...(field === "contact"
            ? { contactId: "other" }
            : field === "location"
              ? { locationId: "other" }
              : {}),
        },
      ],
    },
  });
  render(app());
  await screen.findByRole("alert");
  expect(screen.queryByText(/Atendimento aberto/)).toBeNull();
});
it("sem conversa não cria contato nem escolhe outro; erro não mostra conteúdo antigo", async () => {
  m.resolve.mockResolvedValue({
    ok: true,
    data: { ...data, resolution: "none", conversations: [] },
  });
  const { rerender } = render(app());
  await screen.findByText(/Nenhuma conversa foi localizada/);
  m.resolve.mockResolvedValue({ ok: false, code: "forbidden", message: "Acesso recusado" });
  rerender(app(undefined, "contactB"));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Acesso recusado"));
  expect(screen.queryByText(/Atendimento aberto/)).toBeNull();
});
