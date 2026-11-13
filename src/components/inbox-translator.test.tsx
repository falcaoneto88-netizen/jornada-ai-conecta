// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InboxTranslator, type InboxTranslatorProps } from "./inbox-translator";
import type { TranslationResult } from "@/lib/translation.core";

const { translate } = vi.hoisted(() => ({ translate: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: () => translate }));
vi.mock("@/lib/translation.functions", () => ({ traduzirInbox: vi.fn() }));
const base: InboxTranslatorProps = {
  workspaceKey: "user/org/contact-a/conversation-a",
  currentDraft: "Olá, Ana. Podemos falar às 14h?",
  draftVersion: 1,
  messages: [{ id: "message-a", text: "Bonjour Ana, rendez-vous à 14h ?" }],
  onApply: vi.fn(),
};
const value = (name: string) =>
  (screen.getByRole("textbox", { name }) as HTMLTextAreaElement).value;
const changeMode = (mode = "reply") =>
  fireEvent.change(screen.getByLabelText("O que traduzir"), { target: { value: mode } });
const deferred = () => {
  let resolve!: (result: TranslationResult) => void;
  return {
    promise: new Promise<TranslationResult>((done) => {
      resolve = done;
    }),
    resolve: (result: TranslationResult) => resolve(result),
  };
};
beforeEach(() => {
  translate.mockReset();
  vi.mocked(base.onApply).mockClear();
});
afterEach(cleanup);

describe("one translator panel", () => {
  it("requires an explicit click, exposes four languages and never applies an incoming translation", async () => {
    translate.mockResolvedValue({ ok: true, texto: "Olá Ana, consulta às 14h?" });
    render(<InboxTranslator {...base} />);
    expect(translate).not.toHaveBeenCalled();
    expect(screen.getAllByRole("button", { name: "Traduzir" })).toHaveLength(1);
    const languageSelect = screen.getByLabelText("Idioma de origem") as HTMLSelectElement;
    expect(Array.from(languageSelect.options).map((option) => option.value)).toEqual([
      "pt",
      "fr",
      "en",
      "es",
    ]);
    fireEvent.change(screen.getByLabelText("Mensagem da conversa"), {
      target: { value: "message-a" },
    });
    expect(translate).not.toHaveBeenCalled();
    expect(value("Texto original recebido")).toBe(base.messages[0]!.text);
    fireEvent.click(screen.getByRole("button", { name: "Traduzir" }));
    await waitFor(() => expect(value("Tradução para revisão")).toBe("Olá Ana, consulta às 14h?"));
    expect(translate).toHaveBeenCalledWith({
      data: { texto: base.messages[0]!.text, sourceLanguage: "fr", targetLanguage: "pt" },
    });
    expect(screen.queryByRole("button", { name: "Usar na resposta" })).toBeNull();
    expect(base.onApply).not.toHaveBeenCalled();
  });

  it("preserves the original and applies only the explicitly reviewed editable reply", async () => {
    translate.mockResolvedValue({ ok: true, texto: "Bonjour, Ana. Pouvons-nous parler à 14h ?" });
    render(<InboxTranslator {...base} />);
    changeMode();
    const source = screen.getByRole("textbox", {
      name: "Original da minha resposta",
    }) as HTMLTextAreaElement;
    expect(source.readOnly).toBe(true);
    expect(translate).not.toHaveBeenCalled();
    const button = screen.getByRole("button", { name: "Traduzir" });
    button.focus();
    fireEvent.click(button);
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "Tradução para revisão" })).not.toBeNull(),
    );
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: "Tradução para revisão" }),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Tradução para revisão" }), {
      target: { value: "Bonjour Ana, disponible à 14h ?" },
    });
    expect(source.value).toBe(base.currentDraft);
    expect(base.onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Usar na resposta" }));
    expect(base.onApply).toHaveBeenCalledExactlyOnceWith("Bonjour Ana, disponible à 14h ?");
  });

  it("marks a previous result stale on draft version or language change and requires retranslating", async () => {
    translate.mockResolvedValue({ ok: true, texto: "Bonjour Ana" });
    const { rerender } = render(<InboxTranslator {...base} />);
    changeMode();
    fireEvent.click(screen.getByRole("button", { name: "Traduzir" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Usar na resposta" })).not.toBeNull(),
    );
    rerender(<InboxTranslator {...base} draftVersion={2} />);
    expect(screen.getByText(/Resultado desatualizado/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Usar na resposta" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Usar na resposta" }));
    expect(base.onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Traduzir" }));
    await waitFor(() => expect(screen.queryByText(/Resultado desatualizado/)).toBeNull());
    fireEvent.change(screen.getByLabelText("Traduzir para"), { target: { value: "en" } });
    expect(screen.getByText(/Resultado desatualizado/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Traduzir para"), { target: { value: "fr" } });
    expect(screen.getByText(/Resultado desatualizado/)).toBeTruthy();
  });

  it.each(["draft", "language", "mode", "disabled", "message"])(
    "discards an in-flight result when %s changes",
    async (change) => {
      const request = deferred();
      translate.mockReturnValue(request.promise);
      const { rerender } = render(<InboxTranslator {...base} />);
      if (change === "message")
        fireEvent.change(screen.getByLabelText("Mensagem da conversa"), {
          target: { value: "message-a" },
        });
      else changeMode();
      fireEvent.click(screen.getByRole("button", { name: "Traduzir" }));
      expect(screen.getByRole("button", { name: "Traduzindo…" })).toBeTruthy();
      if (change === "draft")
        rerender(<InboxTranslator {...base} currentDraft="Nova edição" draftVersion={2} />);
      if (change === "language")
        fireEvent.change(screen.getByLabelText("Traduzir para"), { target: { value: "en" } });
      if (change === "mode") changeMode("received");
      if (change === "disabled") rerender(<InboxTranslator {...base} disabled />);
      if (change === "message")
        rerender(
          <InboxTranslator {...base} messages={[{ id: "message-a", text: "Texte corrigé" }]} />,
        );
      await act(async () => request.resolve({ ok: true, texto: "Resultado obsoleto" }));
      expect(screen.queryByRole("textbox", { name: "Tradução para revisão" })).toBeNull();
      expect(base.onApply).not.toHaveBeenCalled();
    },
  );

  it("does not mix contacts even if the operator returns before the old request completes", async () => {
    const request = deferred();
    translate.mockReturnValue(request.promise);
    const { rerender } = render(<InboxTranslator {...base} />);
    changeMode();
    fireEvent.click(screen.getByRole("button", { name: "Traduzir" }));
    rerender(
      <InboxTranslator
        {...base}
        workspaceKey="user/org/contact-b/conversation-b"
        currentDraft="Texto B"
      />,
    );
    expect(screen.queryByRole("textbox", { name: "Tradução para revisão" })).toBeNull();
    rerender(<InboxTranslator {...base} />);
    await act(async () => request.resolve({ ok: true, texto: "Resposta antiga de A" }));
    expect(screen.queryByRole("textbox", { name: "Tradução para revisão" })).toBeNull();
    expect(value("Original da minha resposta")).toBe(base.currentDraft);
  });

  it("keeps the result stale after an incoming source changes and returns to its old text", async () => {
    translate.mockResolvedValue({ ok: true, texto: "Olá Ana" });
    const { rerender } = render(<InboxTranslator {...base} />);
    fireEvent.change(screen.getByLabelText("Mensagem da conversa"), {
      target: { value: "message-a" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Traduzir" }));
    await waitFor(() => expect(value("Tradução para revisão")).toBe("Olá Ana"));
    rerender(<InboxTranslator {...base} messages={[{ id: "message-a", text: "Texte modifié" }]} />);
    expect(screen.getByText(/Resultado desatualizado/)).toBeTruthy();
    rerender(<InboxTranslator {...base} />);
    expect(screen.getByText(/Resultado desatualizado/)).toBeTruthy();
  });

  it("keeps edits per workspace while mounted and does not write browser storage", async () => {
    const storage = vi.spyOn(Storage.prototype, "setItem");
    const { rerender } = render(<InboxTranslator {...base} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Texto original recebido" }), {
      target: { value: "Texte de Ana" },
    });
    rerender(<InboxTranslator {...base} workspaceKey="user/org/contact-b/conversation-b" />);
    expect(value("Texto original recebido")).toBe("");
    fireEvent.change(screen.getByRole("textbox", { name: "Texto original recebido" }), {
      target: { value: "Texte de Bruno" },
    });
    rerender(<InboxTranslator {...base} />);
    expect(value("Texto original recebido")).toBe("Texte de Ana");
    expect(storage).not.toHaveBeenCalled();
    storage.mockRestore();
  });

  it("keeps a manual result edit while a replacement translation is in flight", async () => {
    translate.mockResolvedValueOnce({ ok: true, texto: "Bonjour Ana" });
    render(<InboxTranslator {...base} />);
    changeMode();
    fireEvent.click(screen.getByRole("button", { name: "Traduzir" }));
    await waitFor(() => expect(value("Tradução para revisão")).toBe("Bonjour Ana"));
    const request = deferred();
    translate.mockReturnValueOnce(request.promise);
    fireEvent.click(screen.getByRole("button", { name: "Traduzir" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Tradução para revisão" }), {
      target: { value: "Edição manual preservada" },
    });
    await act(async () => request.resolve({ ok: true, texto: "Resultado tardio" }));
    expect(value("Tradução para revisão")).toBe("Edição manual preservada");
  });

  it("retains source and previous result on unavailable/error and allows a manual retry", async () => {
    translate.mockResolvedValueOnce({ ok: true, texto: "Bonjour Ana" });
    render(<InboxTranslator {...base} />);
    changeMode();
    fireEvent.click(screen.getByRole("button", { name: "Traduzir" }));
    await waitFor(() => expect(value("Tradução para revisão")).toBe("Bonjour Ana"));
    translate.mockResolvedValueOnce({
      ok: false,
      code: "ia_nao_configurada",
      message: "Tradutor indisponível: IA não configurada.",
    });
    fireEvent.click(screen.getByRole("button", { name: "Traduzir" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("indisponível"));
    expect(value("Tradução para revisão")).toBe("Bonjour Ana");
    expect(value("Original da minha resposta")).toBe(base.currentDraft);
    expect((screen.getByRole("button", { name: "Traduzir" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    translate.mockRejectedValueOnce(new Error("mock network failure"));
    fireEvent.click(screen.getByRole("button", { name: "Traduzir" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Não foi possível traduzir"),
    );
  });
});
