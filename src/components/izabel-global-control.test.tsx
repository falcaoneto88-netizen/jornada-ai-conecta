// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IzabelGlobalControl } from "./izabel-global-control";
import type { AutomationState } from "@/lib/commercial-agent/automation";

const api = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/commercial-agent-automation.functions", () => ({
  getIzabelAutomation: api.read,
  setIzabelAutomation: api.save,
}));
const initial = (overrides: Partial<AutomationState> = {}): AutomationState => ({
  enabled: false,
  version: 4,
  since: null,
  channels: ["SMS"],
  canManage: true,
  activationBlock: null,
  policyCurrent: true,
  ...overrides,
});
const ok = (data: AutomationState) => ({ ok: true as const, data });
const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;
async function openActivation() {
  await screen.findByText("Izabel automática desligada");
  fireEvent.click(button("Ativar em todo o Meu Chat"));
  await screen.findByRole("dialog");
}
beforeEach(() => {
  api.read.mockReset().mockResolvedValue(ok(initial()));
  api.save.mockReset().mockResolvedValue(ok(initial({ enabled: true, version: 5 })));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("global Izabel control", () => {
  it("revalidates a changed policy only after explicit confirmation with the current version", async () => {
    api.read.mockResolvedValue(ok(initial({ enabled: true, policyCurrent: false })));
    render(<IzabelGlobalControl organizationId="org-a" />);
    await screen.findByText("Izabel ativada · ação necessária");
    expect(api.save).not.toHaveBeenCalled();
    fireEvent.click(button("Revalidar versão da Izabel"));
    await screen.findByRole("dialog");
    expect(
      screen.getByText(/Atendimentos pausados e mensagens anteriores não serão retomados/),
    ).toBeTruthy();
    expect(api.save).not.toHaveBeenCalled();
    fireEvent.click(button("Confirmar nova versão"));
    await waitFor(() =>
      expect(api.save).toHaveBeenCalledExactlyOnceWith({
        data: { organizationId: "org-a", enabled: true, expectedVersion: 4 },
      }),
    );
    await screen.findByText("Izabel automática ativada no Meu Chat");
  });

  it("canceling policy revalidation restores focus without authorizing anything", async () => {
    api.read.mockResolvedValue(ok(initial({ enabled: true, policyCurrent: false })));
    render(<IzabelGlobalControl organizationId="org-a" />);
    await screen.findByText("Izabel ativada · ação necessária");
    fireEvent.click(button("Revalidar versão da Izabel"));
    fireEvent.keyDown(await screen.findByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(button("Revalidar versão da Izabel")));
    expect(api.save).not.toHaveBeenCalled();
  });

  it.each([{ activationBlock: "write_disabled" }, { channels: [] }])(
    "blocks policy revalidation when activation prerequisites fail: %j",
    async (overrides) => {
      api.read.mockResolvedValue(
        ok(initial({ enabled: true, policyCurrent: false, ...overrides })),
      );
      render(<IzabelGlobalControl organizationId="org-a" />);
      await screen.findByText("Izabel ativada · ação necessária");
      expect(button("Revalidar versão da Izabel").disabled).toBe(true);
      expect(button("Pausar em todo o chat").disabled).toBe(false);
      expect(api.save).not.toHaveBeenCalled();
    },
  );

  it("does not expose revalidation to a non-manager", async () => {
    api.read.mockResolvedValue(
      ok(initial({ enabled: true, policyCurrent: false, canManage: false })),
    );
    render(<IzabelGlobalControl organizationId="org-a" />);
    await screen.findByText("Izabel ativada · ação necessária");
    expect(screen.queryByRole("button", { name: "Revalidar versão da Izabel" })).toBeNull();
    expect(api.save).not.toHaveBeenCalled();
  });

  it("reads the organization without enabling any operation on mount or refresh", async () => {
    render(<IzabelGlobalControl organizationId="org-a" />);
    expect(screen.getByText("Estado da Izabel por verificar")).toBeTruthy();
    await screen.findByText("Izabel automática desligada");
    expect(api.read).toHaveBeenCalledWith({ data: { organizationId: "org-a" } });
    fireEvent.click(button("Atualizar estado"));
    await waitFor(() => expect(api.read).toHaveBeenCalledTimes(2));
    expect(api.save).not.toHaveBeenCalled();
  });

  it("explains the real channel and only authorizes after the final activation click", async () => {
    render(<IzabelGlobalControl organizationId="org-a" />);
    await openActivation();
    expect(api.save).not.toHaveBeenCalled();
    expect(screen.getByText(/Canal SMS do GHL/)).toBeTruthy();
    expect(screen.getByText(/Não responde retroativamente/)).toBeTruthy();
    expect(screen.getByText(/Questões clínicas e dados não verificados/)).toBeTruthy();
    fireEvent.click(button("Ativar atendimento automático"));
    await waitFor(() =>
      expect(api.save).toHaveBeenCalledWith({
        data: { organizationId: "org-a", enabled: true, expectedVersion: 4 },
      }),
    );
    await screen.findByText("Izabel automática ativada no Meu Chat");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("cancel closes the confirmation without changing any setting", async () => {
    render(<IzabelGlobalControl organizationId="org-a" />);
    await openActivation();
    fireEvent.click(button("Cancelar"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.save).not.toHaveBeenCalled();
  });

  it("Escape closes the confirmation and restores keyboard focus", async () => {
    render(<IzabelGlobalControl organizationId="org-a" />);
    await openActivation();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(button("Ativar em todo o Meu Chat")));
    expect(api.save).not.toHaveBeenCalled();
  });

  it("does not claim activation until persistence returns", async () => {
    let resolve!: (response: ReturnType<typeof ok>) => void;
    api.save.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    render(<IzabelGlobalControl organizationId="org-a" />);
    await openActivation();
    fireEvent.click(button("Ativar atendimento automático"));
    expect(screen.queryByText("Izabel automática ativada no Meu Chat")).toBeNull();
    expect(button("A guardar ativação…").disabled).toBe(true);
    fireEvent.click(button("A guardar ativação…"));
    expect(api.save).toHaveBeenCalledOnce();
    await act(async () => resolve(ok(initial({ enabled: true, version: 5 }))));
    await screen.findByText("Izabel automática ativada no Meu Chat");
  });

  it("reports activation failure without exposing raw errors or showing success", async () => {
    api.save.mockResolvedValue({ ok: false, code: "sensitive-provider-token-value" });
    render(<IzabelGlobalControl organizationId="org-a" />);
    await openActivation();
    fireEvent.click(button("Ativar atendimento automático"));
    expect((await screen.findByRole("alert")).textContent).toContain("Não foi possível confirmar");
    expect(screen.queryByText(/sensitive-provider/)).toBeNull();
    expect(screen.queryByText("Izabel automática ativada no Meu Chat")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("refreshes a CAS conflict and requires a new explicit decision", async () => {
    api.save.mockResolvedValueOnce({ ok: false, code: "version_conflict" });
    render(<IzabelGlobalControl organizationId="org-a" />);
    await openActivation();
    api.read.mockResolvedValue(ok(initial({ version: 6 })));
    fireEvent.click(button("Ativar atendimento automático"));
    await waitFor(() => expect(api.read).toHaveBeenCalledTimes(2));
    expect(api.save).toHaveBeenCalledOnce();
    expect((await screen.findByRole("alert")).textContent).toContain("Outra pessoa alterou");
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(button("Ativar em todo o Meu Chat"));
    fireEvent.click(button("Ativar atendimento automático"));
    await waitFor(() =>
      expect(api.save).toHaveBeenLastCalledWith({
        data: { organizationId: "org-a", enabled: true, expectedVersion: 6 },
      }),
    );
  });

  it("allows global pause even when the active policy or activation preconditions changed", async () => {
    api.read.mockResolvedValue(
      ok(initial({ enabled: true, activationBlock: "write_disabled", policyCurrent: false })),
    );
    api.save.mockResolvedValue(ok(initial({ version: 5, activationBlock: "write_disabled" })));
    render(<IzabelGlobalControl organizationId="org-a" />);
    await screen.findByText("Izabel ativada · ação necessária");
    expect(button("Pausar em todo o chat").disabled).toBe(false);
    fireEvent.click(button("Pausar em todo o chat"));
    await waitFor(() =>
      expect(api.save).toHaveBeenCalledWith({
        data: { organizationId: "org-a", enabled: false, expectedVersion: 4 },
      }),
    );
    await screen.findByText("Izabel automática desligada");
    expect((await screen.findByRole("status")).textContent).toContain("já aceito pelo canal");
  });

  it("does not claim a pause after the network result becomes unknown", async () => {
    api.read.mockResolvedValue(ok(initial({ enabled: true })));
    api.save.mockRejectedValue(new Error("network failure"));
    render(<IzabelGlobalControl organizationId="org-a" />);
    await screen.findByText("Izabel automática ativada no Meu Chat");
    fireEvent.click(button("Pausar em todo o chat"));
    await screen.findByText("Estado da Izabel por verificar");
    expect(screen.queryByText("Izabel automática desligada")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText(/resultado da alteração não foi confirmado/)).toBeTruthy();
  });

  it("ignores an older refresh that resolves after a persisted global pause", async () => {
    let finishRead!: (response: ReturnType<typeof ok>) => void;
    api.read.mockResolvedValueOnce(ok(initial({ enabled: true }))).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRead = resolve;
        }),
    );
    api.save.mockResolvedValue(ok(initial({ version: 5 })));
    render(<IzabelGlobalControl organizationId="org-a" />);
    await screen.findByText("Izabel automática ativada no Meu Chat");
    fireEvent.click(button("Atualizar estado"));
    fireEvent.click(button("Pausar em todo o chat"));
    await screen.findByText("Izabel automática desligada");
    await act(async () => finishRead(ok(initial({ enabled: true }))));
    expect(screen.queryByText("Izabel automática ativada no Meu Chat")).toBeNull();
    expect(screen.getByText("Izabel automática desligada")).toBeTruthy();
  });

  it("never guesses an off state after an initial read failure", async () => {
    api.read.mockRejectedValue(new Error("read failure"));
    render(<IzabelGlobalControl organizationId="org-a" />);
    await screen.findByRole("alert");
    expect(screen.getByText("Estado da Izabel por verificar")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ativar em todo o Meu Chat" })).toBeNull();
    expect(api.save).not.toHaveBeenCalled();
  });

  it("removes a stale active indicator if refreshing fails but preserves a safe pause action", async () => {
    api.read
      .mockResolvedValueOnce(ok(initial({ enabled: true })))
      .mockRejectedValue(new Error("offline"));
    render(<IzabelGlobalControl organizationId="org-a" />);
    await screen.findByText("Izabel automática ativada no Meu Chat");
    fireEvent.click(button("Atualizar estado"));
    await screen.findByRole("alert");
    expect(screen.queryByText("Izabel automática ativada no Meu Chat")).toBeNull();
    expect(button("Pausar em todo o chat").disabled).toBe(false);
    expect(api.save).not.toHaveBeenCalled();
  });

  it.each([{ activationBlock: "send_disabled" }, { policyCurrent: false }, { channels: [] }])(
    "blocks activation when prerequisites are missing: %j",
    async (overrides) => {
      api.read.mockResolvedValue(ok(initial(overrides)));
      render(<IzabelGlobalControl organizationId="org-a" />);
      await screen.findByText("Izabel automática desligada");
      expect(button("Ativar em todo o Meu Chat").disabled).toBe(true);
      expect(api.save).not.toHaveBeenCalled();
    },
  );

  it("keeps non-managers in read-only mode", async () => {
    api.read.mockResolvedValue(ok(initial({ canManage: false, enabled: true })));
    render(<IzabelGlobalControl organizationId="org-a" />);
    await screen.findByText("Izabel automática ativada no Meu Chat");
    expect(screen.queryByRole("button", { name: "Pausar em todo o chat" })).toBeNull();
    expect(screen.getByText(/reservadas a administradores e gestores/)).toBeTruthy();
    expect(api.save).not.toHaveBeenCalled();
  });

  it("discards the previous organization's in-flight state on an organization change", async () => {
    let finishOld!: (response: ReturnType<typeof ok>) => void;
    api.read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        }),
    );
    const view = render(<IzabelGlobalControl organizationId="org-a" />);
    view.rerender(<IzabelGlobalControl organizationId="org-b" />);
    await screen.findByText("Izabel automática desligada");
    await act(async () => finishOld(ok(initial({ enabled: true }))));
    expect(screen.queryByText("Izabel automática ativada no Meu Chat")).toBeNull();
    await openActivation();
    fireEvent.click(button("Ativar atendimento automático"));
    await waitFor(() =>
      expect(api.save).toHaveBeenCalledWith({
        data: { organizationId: "org-b", enabled: true, expectedVersion: 4 },
      }),
    );
  });
});
