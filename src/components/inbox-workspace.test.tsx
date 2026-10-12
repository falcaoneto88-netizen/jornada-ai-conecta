// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createInboxDraftStore, inboxDraftKey, useInboxHistoryScroll } from "./inbox-workspace";
import type { MensagemGhl } from "@/lib/ghl-observation.core";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("cache é por instância e escopo, contém texto e confirmação usa versão exata", () => {
  const store = createInboxDraftStore();
  const first = inboxDraftKey("userA", "orgA", "contactA", "conversationA");
  store.set(first, "Meu texto");
  store.submitted("request", first);
  store.set(first, "Editado");
  store.set(first, "Meu texto");
  store.confirmed("request");
  expect(store.get(first).text).toBe("Meu texto");
  for (const key of [
    inboxDraftKey("userB", "orgA", "contactA", "conversationA"),
    inboxDraftKey("userA", "orgB", "contactA", "conversationA"),
    inboxDraftKey("userA", "orgA", "contactB", "conversationA"),
    inboxDraftKey("userA", "orgA", "contactA", "conversationB"),
  ])
    expect(store.get(key).text).toBe("");
  expect(createInboxDraftStore().get(first).text).toBe("");
  store.submitted("final", first);
  store.confirmed("final");
  expect(store.get(first).text).toBe("");
});

function message(id: string): MensagemGhl {
  return {
    id,
    texto: id,
    data: "2026-10-12T12:00:00Z",
    tipo: "SMS",
    direcao: "inbound",
    estado: "delivered",
    origem: null,
    erro: null,
    anexos: 0,
    html: false,
    provedor: null,
  };
}
function History({ messages }: { messages: MensagemGhl[] }) {
  const scroll = useInboxHistoryScroll(messages);
  return (
    <>
      <div data-testid="history" ref={scroll.ref} onScroll={scroll.onScroll}>
        {messages.map((m) => (
          <p key={m.id}>{m.texto}</p>
        ))}
      </div>
      {scroll.hasNewMessages && <button onClick={scroll.toLatest}>Novas mensagens</button>}
    </>
  );
}

it("abre na última mensagem; novas mensagens não arrastam quem está lendo; clique vai ao fim", () => {
  const { rerender } = render(<History messages={[]} />);
  const element = screen.getByTestId("history");
  let height = 1000;
  Object.defineProperty(element, "scrollHeight", { get: () => height });
  Object.defineProperty(element, "clientHeight", { value: 200, configurable: true });
  rerender(<History messages={[message("a"), message("b")]} />);
  expect(element.scrollTop).toBe(1000);
  element.scrollTop = 300;
  fireEvent.scroll(element);
  height = 1100;
  rerender(<History messages={[message("a"), message("b"), message("c")]} />);
  expect(element.scrollTop).toBe(300);
  expect(screen.getByText("Novas mensagens")).toBeTruthy();
  fireEvent.click(screen.getByText("Novas mensagens"));
  expect(element.scrollTop).toBe(1100);
  expect(screen.queryByText("Novas mensagens")).toBeNull();
});

it("carregar histórico anterior mantém offset do trecho que estava sendo lido", () => {
  const { rerender } = render(<History messages={[]} />);
  const element = screen.getByTestId("history");
  let height = 1000;
  Object.defineProperty(element, "scrollHeight", { get: () => height });
  Object.defineProperty(element, "clientHeight", { value: 200 });
  rerender(<History messages={[message("b"), message("c")]} />);
  element.scrollTop = 200;
  fireEvent.scroll(element);
  height = 1300;
  rerender(<History messages={[message("a"), message("b"), message("c")]} />);
  expect(element.scrollTop).toBe(500);
  expect(screen.queryByText("Novas mensagens")).toBeNull();
});

it("ResizeObserver segue fim ao abrir painel móvel oculto, mas respeita quem rolou para cima", () => {
  let resize!: () => void;
  const disconnect = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  const { rerender, unmount } = render(<History messages={[]} />);
  const element = screen.getByTestId("history");
  let height = 0;
  let viewport = 0;
  Object.defineProperty(element, "scrollHeight", { get: () => height });
  Object.defineProperty(element, "clientHeight", { get: () => viewport });
  rerender(<History messages={[message("a"), message("b")]} />);
  height = 1000;
  viewport = 200;
  fireEvent.scroll(element);
  act(() => resize());
  expect(element.scrollTop).toBe(1000);
  element.scrollTop = 250;
  fireEvent.scroll(element);
  viewport = 100;
  fireEvent.scroll(element);
  act(() => resize());
  expect(element.scrollTop).toBe(250);
  unmount();
  expect(disconnect).toHaveBeenCalledTimes(1);
});
