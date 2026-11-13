// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AppointmentFinancePanel,
  type AppointmentFinanceEntry,
  type AppointmentFinancePanelProps,
} from "./appointment-finance-panel";

const entry: AppointmentFinanceEntry = {
  appointmentId: "appointment-test",
  totalCents: 25000,
  depositCents: 5000,
  currency: "EUR",
  revision: 3,
  updatedAt: "2026-07-13T10:00:00Z",
  updatedBy: "operator-test",
};

let props: AppointmentFinancePanelProps;

beforeEach(() => {
  props = {
    entry: null,
    available: true,
    canEdit: true,
    loading: false,
    error: null,
    onRetry: vi.fn(),
    onSave: vi.fn().mockResolvedValue(undefined),
    fuso: "Europe/Lisbon",
  };
});
afterEach(() => cleanup());

function totalField() {
  return screen.getByLabelText("Valor total do procedimento (EUR)") as HTMLInputElement;
}
function depositField() {
  return screen.getByLabelText("Sinal informado (EUR)") as HTMLInputElement;
}
function values(total: string, deposit: string) {
  fireEvent.change(totalField(), { target: { value: total } });
  fireEvent.change(depositField(), { target: { value: deposit } });
}
function save() {
  fireEvent.click(screen.getByRole("button", { name: "Salvar valores" }));
}

it("keeps missing amounts unknown and does not assume an unpaid balance", () => {
  render(<AppointmentFinancePanel {...props} />);
  expect(totalField().value).toBe("");
  expect(depositField().value).toBe("");
  expect(screen.getByText(/Valores ainda não informados/)).toBeTruthy();
  expect(screen.queryByText(/Saldo após salvar:/)).toBeNull();
  expect(
    (screen.getByRole("button", { name: "Salvar valores" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  values("250,00", "");
  save();
  expect(screen.getByText(/Informe o sinal/)).toBeTruthy();
  expect(props.onSave).not.toHaveBeenCalled();
});

it("converts comma and point decimals to exact cents and uses revision zero for first entry", async () => {
  render(<AppointmentFinancePanel {...props} />);
  values("1,01", "0.29");
  expect(screen.getByText(/Saldo após salvar:/).textContent).toContain("0,72");
  save();
  await waitFor(() => expect(props.onSave).toHaveBeenCalledTimes(1));
  expect(props.onSave).toHaveBeenCalledWith({
    totalCents: 101,
    depositCents: 29,
    expectedRevision: 0,
    requestId: expect.stringMatching(
      /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i,
    ),
  });
  await waitFor(() => expect(props.onRetry).toHaveBeenCalledTimes(1));
});

describe("input validation", () => {
  it.each([
    ["-2", "0", /Use um valor de 0/],
    ["1,001", "0", /duas casas decimais/],
    ["1.000,00", "0", /sem separador de milhar/],
    ["1000000,01", "0", /Use um valor de 0/],
    ["10", "-1", /positivo ou zero/],
    ["10", "10.01", /sinal não pode ser maior/],
  ])("rejects total %s and deposit %s without requesting a save", (total, deposit, error) => {
    render(<AppointmentFinancePanel {...props} />);
    values(total as string, deposit as string);
    save();
    expect(screen.getByText(error as RegExp)).toBeTruthy();
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it("accepts explicit zero and the exact maximum permitted total", async () => {
    render(<AppointmentFinancePanel {...props} />);
    values("1000000,00", "0,00");
    save();
    await waitFor(() =>
      expect(props.onSave).toHaveBeenCalledWith(
        expect.objectContaining({ totalCents: 100_000_000, depositCents: 0 }),
      ),
    );
  });
});

it("shows the saved balance, source, actor and update time in the supplied timezone", () => {
  render(<AppointmentFinancePanel {...props} entry={entry} />);
  expect(screen.getByText(/O sinal informado não confirma pagamento/)).toBeTruthy();
  const identity = screen.getByText("Identificação do registro");
  const disclosure = identity.closest("details");
  expect(disclosure?.open).toBe(false);
  expect(screen.getByText("operator-test").closest("details")).toBe(disclosure);
  fireEvent.click(identity);
  expect(disclosure?.open).toBe(true);
  expect(screen.getByText(/Atualizado em/).textContent).toContain("11:00");
  expect(screen.getByText(/Atualizado em/).textContent).toContain("Europe/Lisbon");
  expect(screen.getByText(/Atualizado em/).closest("details")).toBeNull();
  expect(screen.getByLabelText("Valores registrados").textContent).toContain("200,00");
  expect(totalField().value).toBe("250,00");
  expect(depositField().value).toBe("50,00");
});

it.each([
  { canEdit: false },
  { available: false },
  { loading: true },
  { error: "A leitura está indisponível." },
])("prevents editing when access or persistence is unavailable: %j", (state) => {
  render(<AppointmentFinancePanel {...props} entry={entry} {...state} />);
  const input = screen.queryByLabelText(
    "Valor total do procedimento (EUR)",
  ) as HTMLInputElement | null;
  if (input) {
    expect(input.matches(":disabled")).toBe(true);
    fireEvent.change(input, { target: { value: "999,00" } });
    expect(input.value).toBe("250,00");
    fireEvent.submit(input.closest("form")!);
  }
  expect(props.onSave).not.toHaveBeenCalled();
});

it("explains unavailable storage and lets the user retry the read", () => {
  render(<AppointmentFinancePanel {...props} available={false} />);
  expect(screen.getByText(/preparação do banco precisa/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Atualizar valores" }));
  expect(props.onRetry).toHaveBeenCalledTimes(1);
});

it("preserves failed edits and reuses the request identity until the user changes the intention", async () => {
  const onSave = vi.fn().mockRejectedValue(new Error("private database detail"));
  render(<AppointmentFinancePanel {...props} entry={entry} onSave={onSave} />);
  values("299,99", "50");
  save();
  await screen.findByText(/Seu rascunho foi preservado/);
  expect(totalField().value).toBe("299,99");
  expect(screen.queryByText(/private database detail/)).toBeNull();
  const first = onSave.mock.calls[0]![0];
  expect(first.expectedRevision).toBe(3);
  fireEvent.click(screen.getByRole("button", { name: "Tentar salvar novamente" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
  expect(onSave.mock.calls[1]![0]).toEqual(first);
  await screen.findByRole("button", { name: "Tentar salvar novamente" });
  fireEvent.change(totalField(), { target: { value: "300" } });
  save();
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(3));
  expect(onSave.mock.calls[2]![0].requestId).not.toBe(first.requestId);
});

it("blocks duplicate submissions and editing while the write is pending", async () => {
  let resolve!: () => void;
  const onSave = vi.fn(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  render(<AppointmentFinancePanel {...props} onSave={onSave} />);
  values("250", "50");
  save();
  fireEvent.submit(totalField().closest("form")!);
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(totalField().matches(":disabled")).toBe(true);
  expect(
    (screen.getByRole("button", { name: "Atualizar valores" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  await act(async () => resolve());
});

it("preserves a dirty draft and blocks saving after a concurrent entry update", async () => {
  const { rerender } = render(<AppointmentFinancePanel {...props} entry={entry} />);
  values("300", "60");
  rerender(
    <AppointmentFinancePanel {...props} entry={{ ...entry, revision: 4, totalCents: 27000 }} />,
  );
  expect(totalField().value).toBe("300");
  expect(screen.getByRole("alert").textContent).toContain("mudaram durante sua edição");
  expect(
    (screen.getByRole("button", { name: "Salvar valores" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.submit(totalField().closest("form")!);
  expect(props.onSave).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Descartar rascunho e usar valores atualizados" }),
  );
  expect(totalField().value).toBe("270,00");
  values("280", "50");
  save();
  await waitFor(() =>
    expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 4 })),
  );
});

it("absorbs a newer entry only when the user has no unsaved edit", async () => {
  const { rerender } = render(<AppointmentFinancePanel {...props} />);
  rerender(<AppointmentFinancePanel {...props} entry={entry} />);
  await waitFor(() => expect(totalField().value).toBe("250,00"));
  expect(props.onSave).not.toHaveBeenCalled();
});

it("requires authoritative readback after save and uses the returned revision for the next change", async () => {
  const { rerender } = render(<AppointmentFinancePanel {...props} entry={entry} />);
  values("300", "60");
  save();
  await screen.findByText(/Gravação concluída/);
  expect(totalField().matches(":disabled")).toBe(true);
  expect(screen.queryByText("Valores salvos e registro atualizado.")).toBeNull();
  rerender(
    <AppointmentFinancePanel
      {...props}
      entry={{ ...entry, revision: 5, totalCents: 30000, depositCents: 6000 }}
    />,
  );
  await screen.findByText("Valores salvos e registro atualizado.");
  expect(totalField().matches(":disabled")).toBe(false);
  values("320", "60");
  save();
  await waitFor(() =>
    expect(props.onSave).toHaveBeenLastCalledWith(expect.objectContaining({ expectedRevision: 5 })),
  );
});

it("resets the draft when the parent changes the appointment key, including unknown entries", () => {
  const { rerender } = render(<AppointmentFinancePanel key="first-appointment" {...props} />);
  values("300", "20");
  rerender(<AppointmentFinancePanel key="second-appointment" {...props} />);
  expect(totalField().value).toBe("");
  expect(depositField().value).toBe("");
});
