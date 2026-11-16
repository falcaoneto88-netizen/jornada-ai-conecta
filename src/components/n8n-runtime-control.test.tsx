// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { N8nRuntimeControl, type N8nRuntimeControlState } from "./n8n-runtime-control";

const initial = (): N8nRuntimeControlState => ({
  available: true,
  mode: "off",
  revision: 3,
  allowedKinds: [],
  locationId: "location-test",
  calendarId: "calendar-test",
  channel: "whatsapp_zaptos",
  zaptosProviderId: "provider-test",
  verifiedAt: null,
  updatedAt: "2026-11-16T12:00:00.000Z",
});
const props = () => ({
  authorized: true,
  state: initial(),
  calendarId: "calendar-test",
  channel: "whatsapp_zaptos",
  zaptosProviderId: "provider-test",
  channelVerified: true,
  refreshing: false,
  save: vi.fn(async () => ({ ok: true as const, revision: 4 })),
  refresh: vi.fn(async () => {}),
});
const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;
function chooseProduction() {
  fireEvent.change(screen.getByLabelText("Modo desejado"), { target: { value: "production" } });
  fireEvent.click(screen.getByLabelText("Mensagem inicial do agendamento"));
}
afterEach(cleanup);

describe("n8n runtime administrative control", () => {
  it("mount and refresh never mutate; the existing GHL transport stays explicit", async () => {
    const p = props();
    render(<N8nRuntimeControl {...p} />);
    expect(screen.getByText("Envios desligados")).toBeTruthy();
    expect(screen.getByText("GHL → Zaptos/WhatsApp")).toBeTruthy();
    fireEvent.click(button("Atualizar estado da operação"));
    await waitFor(() => expect(p.refresh).toHaveBeenCalledOnce());
    expect(p.save).not.toHaveBeenCalled();
  });

  it("activates selected actions only on an explicit click with the read revision", async () => {
    const p = props();
    render(<N8nRuntimeControl {...p} />);
    chooseProduction();
    expect(p.save).not.toHaveBeenCalled();
    fireEvent.click(button("Verificar e ativar produção"));
    await waitFor(() =>
      expect(p.save).toHaveBeenCalledWith({
        mode: "production",
        expectedRevision: 3,
        allowedKinds: ["booking"],
      }),
    );
    await waitFor(() => expect(p.refresh).toHaveBeenCalledOnce());
    expect((await screen.findByRole("status")).textContent).toContain(
      "ainda precisam ser comprovadas",
    );
    // No optimistic activation badge: the last persisted read still says off.
    expect(screen.getByText("Envios desligados")).toBeTruthy();
  });

  it("does not activate production with no allowed actions", async () => {
    const p = props();
    render(<N8nRuntimeControl {...p} />);
    fireEvent.change(screen.getByLabelText("Modo desejado"), { target: { value: "production" } });
    fireEvent.click(button("Verificar e ativar produção"));
    expect((await screen.findByRole("alert")).textContent).toContain("pelo menos uma ação");
    expect(p.save).not.toHaveBeenCalled();
  });

  it("disables live operation with empty allowed actions, ignoring pending form edits", async () => {
    const p = props();
    p.state = { ...initial(), mode: "production", allowedKinds: ["booking"] };
    render(<N8nRuntimeControl {...p} />);
    fireEvent.click(screen.getByLabelText("Pedido de confirmação — 24 horas antes"));
    fireEvent.click(button("Desligar envios"));
    await waitFor(() =>
      expect(p.save).toHaveBeenCalledWith({
        mode: "off",
        expectedRevision: 3,
        allowedKinds: [],
      }),
    );
    expect((await screen.findByRole("status")).textContent).toContain("Desativação guardada");
  });

  it("locks duplicate clicks and changes while a mutation is pending", async () => {
    const p = props();
    let finish!: (value: { ok: true; revision: number }) => void;
    p.save = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<N8nRuntimeControl {...p} />);
    chooseProduction();
    fireEvent.click(button("Verificar e ativar produção"));
    fireEvent.click(button("A verificar…"));
    expect(p.save).toHaveBeenCalledOnce();
    expect(button("A verificar…").disabled).toBe(true);
    expect(button("Desligar envios").disabled).toBe(true);
    expect(button("Carregar configuração atual").disabled).toBe(true);
    finish({ ok: true, revision: 4 });
    await screen.findByRole("status");
  });

  it("does not overwrite a newer revision; a CAS conflict requires an explicit fresh read", async () => {
    const p = props();
    const save = vi.fn(async () => ({ ok: false as const, code: "revision_conflict" }));
    const ui = render(<N8nRuntimeControl {...p} save={save} />);
    chooseProduction();
    fireEvent.click(button("Verificar e ativar produção"));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "alterada desde a sua leitura",
    );
    expect(button("Verificar e ativar produção").disabled).toBe(true);
    expect(screen.queryByRole("status")).toBeNull();
    ui.rerender(<N8nRuntimeControl {...p} save={save} state={{ ...initial(), revision: 4 }} />);
    expect(button("Verificar e ativar produção").disabled).toBe(true);
    fireEvent.click(button("Carregar configuração atual"));
    await waitFor(() =>
      expect((screen.getByLabelText("Modo desejado") as HTMLSelectElement).value).toBe("off"),
    );
    chooseProduction();
    fireEvent.click(button("Verificar e ativar produção"));
    await waitFor(() =>
      expect(save).toHaveBeenLastCalledWith({
        mode: "production",
        expectedRevision: 4,
        allowedKinds: ["booking"],
      }),
    );
  });

  it("does not silently replace the revision behind an edited form on background refresh", () => {
    const p = props();
    const ui = render(<N8nRuntimeControl {...p} />);
    chooseProduction();
    ui.rerender(<N8nRuntimeControl {...p} state={{ ...initial(), revision: 4 }} />);
    expect(
      (screen.getByLabelText("Mensagem inicial do agendamento") as HTMLInputElement).checked,
    ).toBe(true);
    expect(button("Verificar e ativar produção").disabled).toBe(true);
    expect(p.save).not.toHaveBeenCalled();
  });

  it.each(["persist_failed", "channel_not_verified", "calendar_not_verified"])(
    "reports %s without claiming a completed activation",
    async (code) => {
      const p = props();
      const save = vi.fn(async () => ({ ok: false as const, code }));
      render(<N8nRuntimeControl {...p} save={save} />);
      chooseProduction();
      fireEvent.click(button("Verificar e ativar produção"));
      expect(await screen.findByRole("alert")).toBeTruthy();
      expect(screen.queryByRole("status")).toBeNull();
      expect(screen.getByText("Envios desligados")).toBeTruthy();
      expect(p.refresh).not.toHaveBeenCalled();
    },
  );

  it("unknown failure messages do not expose raw server information", async () => {
    const p = props();
    const save = vi.fn(async () => ({ ok: false as const, code: "sensitive-server-details" }));
    render(<N8nRuntimeControl {...p} save={save} />);
    fireEvent.click(button("Desligar envios"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Atualize o estado");
    expect(alert.textContent).not.toContain("sensitive");
  });

  it("explains a missing clinic address without claiming production was activated", async () => {
    const p = props();
    const save = vi.fn(async () => ({ ok: false as const, code: "address_not_configured" }));
    render(<N8nRuntimeControl {...p} save={save} />);
    chooseProduction();
    fireEvent.click(button("Verificar e ativar produção"));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Guarde a morada da clínica antes de ativar o agradecimento da confirmação.",
    );
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("Envios desligados")).toBeTruthy();
  });

  it("does not claim success when the post-save read fails", async () => {
    const p = props();
    p.refresh.mockRejectedValue(new Error("synthetic failure"));
    render(<N8nRuntimeControl {...p} />);
    fireEvent.click(button("Desligar envios"));
    expect((await screen.findByRole("alert")).textContent).toContain("comprovar o estado final");
    expect(screen.queryByRole("status")).toBeNull();
    expect(button("Desligar envios").disabled).toBe(true);
  });

  it("unavailable metadata never assumes a mode or grants authority", () => {
    const p = props();
    render(<N8nRuntimeControl {...p} state={undefined} />);
    expect(screen.getByText("Estado indisponível")).toBeTruthy();
    expect(button("Desligar envios").disabled).toBe(true);
    expect(p.save).not.toHaveBeenCalled();
  });

  it("does not expose actions to a non-administrator", () => {
    const p = props();
    render(<N8nRuntimeControl {...p} authorized={false} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(p.save).not.toHaveBeenCalled();
  });

  it("offers only booking and confirmation requests in production; reply handling remains supervised", () => {
    const p = props();
    render(<N8nRuntimeControl {...p} />);
    chooseProduction();
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    expect(screen.queryByLabelText("Agradecer a confirmação comprovada")).toBeNull();
    expect(screen.queryByLabelText("Confirmar a consulta após resposta SIM comprovada")).toBeNull();
    expect(screen.getByText(/confirmação após a resposta continua supervisionada/)).toBeTruthy();
    expect(p.save).not.toHaveBeenCalled();
  });

  it("does not carry hidden supervised actions into a production request", async () => {
    const p = props();
    p.state = { ...initial(), mode: "pilot", allowedKinds: ["confirm", "appointment.confirm"] };
    render(<N8nRuntimeControl {...p} />);
    chooseProduction();
    fireEvent.click(button("Verificar e ativar produção"));
    await waitFor(() =>
      expect(p.save).toHaveBeenCalledWith({
        mode: "production",
        expectedRevision: 3,
        allowedKinds: ["booking"],
      }),
    );
    expect(p.state.allowedKinds).toEqual(["confirm", "appointment.confirm"]);
  });

  it.each([
    ["calendarId", "changed-calendar", "agenda"],
    ["zaptosProviderId", "changed-provider", "provedor"],
    ["channel", "", "canal"],
  ])(
    "shows stale production authority when %s no longer matches and offers revalidation",
    async (field, value, label) => {
      const p = props();
      p.state = { ...initial(), mode: "production", allowedKinds: ["booking"] };
      render(<N8nRuntimeControl {...p} {...{ [field!]: value }} />);
      expect(screen.getByText("Produção precisa de revisão")).toBeTruthy();
      expect(screen.getByRole("alert").textContent).toContain(`Configuração alterada: ${label}`);
      expect(screen.getByRole("alert").textContent).toContain("envios ficam bloqueados");
      expect(p.save).not.toHaveBeenCalled();
      fireEvent.click(button("Verificar e reativar produção"));
      await waitFor(() =>
        expect(p.save).toHaveBeenCalledWith({
          mode: "production",
          expectedRevision: 3,
          allowedKinds: ["booking"],
        }),
      );
    },
  );

  it("shows channel verification loss even when the stored IDs still match", () => {
    const p = props();
    p.state = { ...initial(), mode: "production", allowedKinds: ["booking"] };
    render(<N8nRuntimeControl {...p} channelVerified={false} />);
    expect(screen.getByRole("alert").textContent).toContain("canal deixou de estar verificado");
    expect(screen.getByText("Produção precisa de revisão")).toBeTruthy();
    expect(button("Desligar envios").disabled).toBe(false);
  });

  it("labels a matching persisted policy as configured without claiming delivery", () => {
    const p = props();
    p.state = {
      ...initial(),
      mode: "production",
      allowedKinds: ["booking"],
      verifiedAt: "2026-11-16T12:00:00.000Z",
    };
    render(<N8nRuntimeControl {...p} />);
    expect(screen.getByText("Produção configurada")).toBeTruthy();
    expect(screen.getByText(/Isso não comprova entrega/)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(p.save).not.toHaveBeenCalled();
  });
});
