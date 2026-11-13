// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { InboxIzabelPanel, type InboxIzabelPanelProps } from "./inbox-izabel-panel";
const mocks = vi.hoisted(() => ({ prepare: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/izabel-reply.functions", () => ({ prepareIzabelReply: mocks.prepare }));
const reply = {
  text: "Bonjour, quel jour vous convient ?",
  language: "FR",
  summary: "O paciente perguntou sobre a agenda.",
  checkedAt: "2026-11-13T12:00:00Z",
  warnings: ["Confira o horário da consulta."],
  sources: [{ label: "Conversa no GHL" }],
  handover: false,
};
function props(overrides: Partial<InboxIzabelPanelProps> = {}): InboxIzabelPanelProps {
  return {
    organizationId: "org",
    contactId: "Ana",
    conversationId: "conv",
    workspaceKey: "org-Ana-conv",
    fingerprint: "messages-v1",
    draftVersion: 0,
    currentDraft: "",
    timeZone: "Europe/Lisbon",
    disabled: false,
    onApply: vi.fn(() => 1),
    ...overrides,
  };
}
afterEach(cleanup);
beforeEach(() => {
  mocks.prepare.mockReset().mockResolvedValue({ ok: true, data: reply });
});
it("prepara só por pedido e inclui apenas identidade e opção de idioma", async () => {
  const input = props();
  render(<InboxIzabelPanel {...input} />);
  expect(mocks.prepare).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Idioma da resposta"), { target: { value: "ES" } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Preparar resposta" })));
  expect(mocks.prepare).toHaveBeenCalledWith({
    data: { organizationId: "org", contactId: "Ana", conversationId: "conv", language: "ES" },
  });
  expect(input.onApply).toHaveBeenCalledWith(
    reply.text,
    expect.objectContaining({ fingerprint: "messages-v1", draftVersion: 0 }),
  );
  expect(screen.getByText(/Francês · Consultado em/)).toBeTruthy();
  expect(screen.getByText("Confira o horário da consulta.")).toBeTruthy();
  expect(screen.getByText("Conversa no GHL")).toBeTruthy();
});
it("preserva texto existente e exige substituição explícita", async () => {
  const input = props({ currentDraft: "Minha resposta", draftVersion: 5 });
  render(<InboxIzabelPanel {...input} />);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Preparar resposta" })));
  expect(input.onApply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Substituir meu rascunho" }));
  expect(input.onApply).toHaveBeenCalledWith(
    reply.text,
    expect.objectContaining({ draftVersion: 5 }),
  );
});
it("digitação durante pedido impede aplicação tardia e cliques repetidos não geram outro pedido", async () => {
  let finish!: (value: unknown) => void;
  mocks.prepare.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const input = props();
  const view = render(<InboxIzabelPanel {...input} />);
  fireEvent.click(screen.getByRole("button", { name: "Preparar resposta" }));
  fireEvent.click(screen.getByRole("button", { name: "A preparar resposta…" }));
  expect(mocks.prepare).toHaveBeenCalledTimes(1);
  view.rerender(
    <InboxIzabelPanel {...input} currentDraft="Já comecei a resposta" draftVersion={1} />,
  );
  await act(async () => finish({ ok: true, data: reply }));
  expect(input.onApply).not.toHaveBeenCalled();
  expect(
    (screen.getByRole("button", { name: "Substituir meu rascunho" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(screen.getByText(/seu texto foi preservado/)).toBeTruthy();
});
it("trocar idioma invalida prévia e falha permite tentar novamente sem alterar texto", async () => {
  const input = props({ currentDraft: "Meu texto" });
  render(<InboxIzabelPanel {...input} />);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Preparar resposta" })));
  fireEvent.change(screen.getByLabelText("Idioma da resposta"), { target: { value: "EN" } });
  expect(
    (screen.getByRole("button", { name: "Substituir meu rascunho" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  mocks.prepare.mockResolvedValue({
    ok: false,
    code: "ia_nao_configurada",
    message: "IA indisponível. Tente novamente.",
  });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Preparar resposta" })));
  expect(screen.getByRole("alert").textContent).toBe("IA indisponível. Tente novamente.");
  expect(
    (screen.getByRole("button", { name: "Preparar resposta" }) as HTMLButtonElement).disabled,
  ).toBe(false);
  expect(input.onApply).not.toHaveBeenCalled();
});

it("não afirma que a sugestão continua no editor depois de o rascunho ser limpo", async () => {
  const input = props();
  const view = render(<InboxIzabelPanel {...input} />);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Preparar resposta" })));
  view.rerender(<InboxIzabelPanel {...input} currentDraft={reply.text} draftVersion={1} />);
  expect(screen.getByText("Resposta no rascunho. Revise o texto antes de enviar.")).toBeTruthy();
  view.rerender(<InboxIzabelPanel {...input} currentDraft="" draftVersion={2} />);
  expect(screen.queryByText("Resposta no rascunho. Revise o texto antes de enviar.")).toBeNull();
  expect(screen.getByText(/O rascunho está vazio/)).toBeTruthy();
});
