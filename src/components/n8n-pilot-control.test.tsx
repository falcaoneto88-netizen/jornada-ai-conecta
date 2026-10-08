// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EstadoPonteN8n } from "@/lib/n8n-bridge.admin.server";
const mocked = vi.hoisted(() => ({ save: vi.fn(), read: vi.fn(), config: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (f: unknown) => f }));
vi.mock("@/lib/n8n-bridge.functions", () => ({
  guardarPilotoN8n: mocked.save,
  estadoPonteN8n: mocked.read,
  guardarPonteN8n: mocked.config,
}));
vi.mock("@/components/n8n-bridge-key", () => ({ ChaveN8nSetup: () => null }));
import { N8nBridgeCard } from "./n8n-bridge-card";
import { N8nPilotControl } from "./n8n-pilot-control";
const state = (): EstadoPonteN8n => ({
  autorizado: true,
  tokenPresente: true,
  podeCriarChave: false,
  credentialSchemaAvailable: true,
  schemaDisponivel: true,
  bindingOk: true,
  writeEnabled: true,
  bridgeEnabled: true,
  liveSendEnabled: false,
  simulation: true,
  calendarId: "calendar01",
  channel: "whatsapp_zaptos",
  clinicAddress: "Rua Teste",
  fallbackUserId: null,
  zaptosProviderId: "provider01",
  channelVerified: false,
  smsRouteConfigured: false,
  pilot: {
    status: "off",
    contactId: null,
    appointmentId: null,
    expectedStartTime: null,
    expiresAt: null,
    allowedKinds: [],
  },
  pilotCheckedAt: "2026-10-08T12:00:00.000Z",
});
const active = () => ({
  ...state(),
  pilot: {
    status: "active" as const,
    contactId: "contact01",
    appointmentId: "appoint01",
    expectedStartTime: "2026-10-09T10:00:00.000Z",
    expiresAt: "2026-10-08T14:00:00.000Z",
    allowedKinds: ["booking" as const],
  },
});
const fill = () => {
  for (const [label, value] of [
    ["ID exato do contato de teste", "contact01"],
    ["ID exato do compromisso", "appoint01"],
    ["Início da consulta (ISO com fuso)", "2026-10-09T11:00:00+01:00"],
    ["Expiração (ISO com fuso)", "2026-10-08T15:00:00+01:00"],
  ]) {
    fireEvent.change(screen.getByLabelText(label!), { target: { value } });
  }
};
const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
describe("pilot administration in existing n8n card", () => {
  it("mount does not create grants or call mutation; off and flags remain visibly separate", () => {
    render(<N8nPilotControl state={state()} refreshing={false} refresh={vi.fn()} />);
    expect(screen.getByText("Sem autorização ativa")).toBeTruthy();
    expect(screen.getByText(/Bloqueios para envio:/).textContent).toContain(
      "modo de simulação; envio real desligado; canal não verificado",
    );
    expect(screen.getAllByRole("checkbox").every((el) => !(el as HTMLInputElement).checked)).toBe(
      true,
    );
    expect(mocked.save).not.toHaveBeenCalled();
    expect(button("Revogar autorização").disabled).toBe(true);
  });
  it("sends only explicit exact fields/actions through the authenticated server function", async () => {
    const refresh = vi.fn(async () => {});
    mocked.save.mockResolvedValue({ ok: true });
    render(<N8nPilotControl state={state()} refreshing={false} refresh={refresh} />);
    fill();
    fireEvent.click(screen.getByLabelText("Mensagem inicial (booking)"));
    fireEvent.click(button("Guardar autorização do piloto"));
    await waitFor(() => expect(mocked.save).toHaveBeenCalledTimes(1));
    expect(mocked.save).toHaveBeenCalledWith({
      data: {
        enabled: true,
        contactId: "contact01",
        appointmentId: "appoint01",
        expectedStartTime: "2026-10-09T11:00:00+01:00",
        expiresAt: "2026-10-08T15:00:00+01:00",
        allowedKinds: ["booking"],
      },
    });
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Sem autorização ativa")).toBeTruthy();
    expect(screen.queryByText("Autorização ativa")).toBeNull();
    await screen.findByRole("status");
  });
  it.each(["missing-kind", "missing-offset"])(
    "rejects %s without a server mutation",
    async (reason) => {
      render(<N8nPilotControl state={state()} refreshing={false} refresh={vi.fn()} />);
      fill();
      if (reason === "missing-offset") {
        fireEvent.click(screen.getByLabelText("Mensagem inicial (booking)"));
        fireEvent.change(screen.getByLabelText("Início da consulta (ISO com fuso)"), {
          target: { value: "2026-10-09T11:00:00" },
        });
      }
      fireEvent.click(button("Guardar autorização do piloto"));
      expect(await screen.findByRole("alert")).toBeTruthy();
      expect(mocked.save).not.toHaveBeenCalled();
    },
  );
  it("revokes persisted authority using only enabled=false, ignoring unsaved form changes", async () => {
    const refresh = vi.fn(async () => {});
    mocked.save.mockResolvedValue({ ok: true });
    render(<N8nPilotControl state={active()} refreshing={false} refresh={refresh} />);
    fireEvent.change(screen.getByLabelText("ID exato do contato de teste"), {
      target: { value: "other001" },
    });
    fireEvent.click(button("Revogar autorização"));
    await waitFor(() => expect(mocked.save).toHaveBeenCalledWith({ data: { enabled: false } }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  });
  it("does not claim success when persistence/readback fails", async () => {
    mocked.save.mockResolvedValue({ ok: false, code: "persist_failed" });
    render(<N8nPilotControl state={active()} refreshing={false} refresh={vi.fn()} />);
    fireEvent.click(button("Revogar autorização"));
    expect((await screen.findByRole("alert")).textContent).toContain("gravação não foi comprovada");
    expect(screen.queryByRole("status")).toBeNull();
  });
  it("unavailable schema blocks setup and revoke; retry only refreshes state", () => {
    const refresh = vi.fn(async () => {});
    const data = state();
    data.pilot.status = "unavailable";
    render(<N8nPilotControl state={data} refreshing={false} refresh={refresh} />);
    expect(screen.getByText("Estado indisponível")).toBeTruthy();
    expect(
      (button("Guardar autorização do piloto").closest("fieldset") as HTMLFieldSetElement).disabled,
    ).toBe(true);
    expect(button("Revogar autorização").disabled).toBe(true);
    fireEvent.click(button("Atualizar estado do piloto"));
    expect(refresh).toHaveBeenCalledOnce();
    expect(mocked.save).not.toHaveBeenCalled();
  });
  it("an older cached server state without pilot metadata fails closed", () => {
    const data = { ...state(), pilot: undefined } as unknown as EstadoPonteN8n;
    render(<N8nPilotControl state={data} refreshing={false} refresh={vi.fn()} />);
    expect(screen.getByText("Estado indisponível")).toBeTruthy();
    expect(
      (button("Guardar autorização do piloto").closest("fieldset") as HTMLFieldSetElement).disabled,
    ).toBe(true);
    expect(mocked.save).not.toHaveBeenCalled();
  });
  it("keeps typed values during a refreshed persisted snapshot", () => {
    const data = active();
    const refresh = vi.fn(async () => {});
    const ui = render(<N8nPilotControl state={data} refreshing={false} refresh={refresh} />);
    fireEvent.change(screen.getByLabelText("ID exato do contato de teste"), {
      target: { value: "other001" },
    });
    ui.rerender(
      <N8nPilotControl
        state={{ ...data, pilot: { ...data.pilot } }}
        refreshing={false}
        refresh={refresh}
      />,
    );
    expect((screen.getByLabelText("ID exato do contato de teste") as HTMLInputElement).value).toBe(
      "other001",
    );
    expect(screen.getByText("contact01")).toBeTruthy();
  });
  it("expired grant remains visible and revocable", () => {
    const data: EstadoPonteN8n = active();
    data.pilot.status = "expired";
    render(<N8nPilotControl state={data} refreshing={false} refresh={vi.fn()} />);
    expect(screen.getByText("Autorização expirada")).toBeTruthy();
    expect(button("Revogar autorização").disabled).toBe(false);
  });
  it("no controls or mutations for a non-admin", () => {
    render(
      <N8nPilotControl
        state={{ ...state(), autorizado: false }}
        refreshing={false}
        refresh={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(mocked.save).not.toHaveBeenCalled();
  });
});

describe("existing integration card wiring", () => {
  it("shows pilot controls from authenticated card state without calling mutation", async () => {
    mocked.read.mockResolvedValue(state());
    const query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={query}>
        <N8nBridgeCard allowed />
      </QueryClientProvider>,
    );
    await screen.findByText("Piloto de um agendamento");
    expect(mocked.read).toHaveBeenCalledTimes(1);
    expect(mocked.save).not.toHaveBeenCalled();
    expect(button("Guardar autorização do piloto")).toBeTruthy();
    query.clear();
  });
  it("does not query or expose pilot for forbidden/demo route", () => {
    const query = new QueryClient();
    render(
      <QueryClientProvider client={query}>
        <N8nBridgeCard allowed={false} />
      </QueryClientProvider>,
    );
    expect(screen.queryByText("Piloto de um agendamento")).toBeNull();
    expect(mocked.read).not.toHaveBeenCalled();
    expect(mocked.save).not.toHaveBeenCalled();
    query.clear();
  });
  it("failed read has visible recovery and no editable stale grant", async () => {
    mocked.read.mockRejectedValue(new Error("synthetic read failure"));
    const query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={query}>
        <N8nBridgeCard allowed />
      </QueryClientProvider>,
    );
    expect((await screen.findByRole("alert")).textContent).toContain("Não foi possível verificar");
    expect(button("Atualizar estado")).toBeTruthy();
    expect(screen.queryByText("Guardar autorização do piloto")).toBeNull();
    query.clear();
  });
});
