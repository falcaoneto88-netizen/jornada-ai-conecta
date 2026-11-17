// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IzabelTakeoverControl } from "./izabel-takeover-control";
import type { getInboxAgentContext } from "@/lib/commercial-agent.functions";

const api = vi.hoisted(() => ({
  read: vi.fn(),
  pause: vi.fn(),
  mode: { demo: false, escopo: "user-a" },
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/commercial-agent.functions", () => ({
  getInboxAgentContext: api.read,
  pauseAgentContact: api.pause,
}));
vi.mock("@/lib/repo", () => ({ useModoDados: () => api.mode }));
type View = Extract<Awaited<ReturnType<typeof getInboxAgentContext>>, { ok: true }>["data"];
const props = { organizationId: "org-a", contactId: "contact-a", conversationId: "conversation-a" };
const initial = (): View => ({
  enabled: true,
  sendEnabled: true,
  truncated: false,
  errors: [],
  items: [],
  settings: {
    organization_id: "org-a",
    location_id: "location-a",
    mode: "supervised",
    allowed_channels: ["SMS"],
    allowed_contacts: [],
  },
  session: { contact_id: "contact-a", version: 3, paused: false, opt_out: false },
});
let current: View;
const ok = (data: View) => ({ ok: true as const, data });
const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;
function mount(input = props) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const tree = (value: typeof props) => (
    <QueryClientProvider client={client}>
      <IzabelTakeoverControl {...value} />
    </QueryClientProvider>
  );
  const result = render(tree(input));
  return { ...result, change: (value: typeof props) => result.rerender(tree(value)) };
}
beforeEach(() => {
  current = initial();
  api.mode = { demo: false, escopo: "user-a" };
  api.read.mockReset().mockImplementation(async () => ok(current));
  api.pause.mockReset().mockImplementation(async () => {
    current = { ...current, session: { ...current.session!, paused: true, version: 4 } };
    return { ok: true, data: current.session };
  });
});
afterEach(cleanup);

describe("Izabel human takeover", () => {
  it("opening a conversation only reads its exact scope", async () => {
    mount();
    await waitFor(() => expect(button("Assumir atendimento").disabled).toBe(false));
    expect(api.read).toHaveBeenCalledWith({ data: props });
    expect(api.pause).not.toHaveBeenCalled();
  });

  it("pauses with the current session version and shows the verified result", async () => {
    mount();
    await waitFor(() => expect(button("Assumir atendimento").disabled).toBe(false));
    fireEvent.click(button("Assumir atendimento"));
    await waitFor(() =>
      expect(api.pause).toHaveBeenCalledWith({
        data: {
          organizationId: "org-a",
          contactId: "contact-a",
          expectedVersion: 3,
          paused: true,
        },
      }),
    );
    await screen.findByRole("button", { name: "Com a equipe · Izabel pausada" });
    expect(api.read).toHaveBeenCalledTimes(2);
  });

  it("does not claim a pause while the command is pending or after it fails", async () => {
    let finish!: (value: { ok: false; code: string }) => void;
    api.pause.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    mount();
    await waitFor(() => expect(button("Assumir atendimento").disabled).toBe(false));
    fireEvent.click(button("Assumir atendimento"));
    expect(button("A confirmar pausa…").disabled).toBe(true);
    expect(screen.queryByText("Com a equipe · Izabel pausada")).toBeNull();
    await act(async () => finish({ ok: false, code: "version_conflict" }));
    expect((await screen.findByRole("alert")).textContent).toContain("O atendimento mudou");
    expect(api.pause).toHaveBeenCalledOnce();
    expect(screen.queryByText("Com a equipe · Izabel pausada")).toBeNull();
  });

  it("never invents a session or enables pause when no session exists", async () => {
    current = { ...initial(), session: null };
    mount();
    await screen.findByText("Sem sessão da Izabel registrada para este contato.");
    expect(button("Assumir atendimento").disabled).toBe(true);
    expect(api.pause).not.toHaveBeenCalled();
  });

  it("does not enable pause for a mismatched tenant or contact", async () => {
    current = { ...initial(), session: { ...initial().session!, contact_id: "other-contact" } };
    mount();
    await screen.findByText("Não foi possível verificar o controle deste atendimento.");
    expect(button("Assumir atendimento").disabled).toBe(true);
    expect(api.pause).not.toHaveBeenCalled();
  });

  it("does not silently resume a paused or opted-out contact", async () => {
    current = { ...initial(), session: { ...initial().session!, paused: true, opt_out: true } };
    mount();
    await screen.findByText("Contato comercial interrompido.");
    expect(button("Com a equipe · Izabel pausada").disabled).toBe(true);
    expect(screen.queryByText("Devolver à Izabel")).toBeNull();
    expect(api.pause).not.toHaveBeenCalled();
  });

  it("does not carry a pending takeover result to a newly opened contact", async () => {
    let finish!: (value: { ok: true; data: View["session"] }) => void;
    api.pause.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const ui = mount();
    await waitFor(() => expect(button("Assumir atendimento").disabled).toBe(false));
    fireEvent.click(button("Assumir atendimento"));
    current = { ...initial(), session: { ...initial().session!, contact_id: "contact-b" } };
    ui.change({ ...props, contactId: "contact-b", conversationId: "conversation-b" });
    await waitFor(() => expect(button("Assumir atendimento").disabled).toBe(false));
    await act(async () => finish({ ok: true, data: { ...initial().session!, paused: true } }));
    expect(screen.queryByText("Com a equipe · Izabel pausada")).toBeNull();
    expect(api.pause).toHaveBeenCalledOnce();
  });

  it("does not call real functions in the demo", () => {
    api.mode.demo = true;
    mount();
    expect(screen.queryByRole("button")).toBeNull();
    expect(api.read).not.toHaveBeenCalled();
    expect(api.pause).not.toHaveBeenCalled();
  });
});
