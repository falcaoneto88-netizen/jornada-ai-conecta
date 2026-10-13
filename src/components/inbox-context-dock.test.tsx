// @vitest-environment jsdom
import { useEffect, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { InboxContextDock } from "./inbox-context-dock";
afterEach(cleanup);

function Fixture({
  wide = false,
  contact = "Ana",
  mounted = () => {},
}: {
  wide?: boolean;
  contact?: string;
  mounted?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Abrir contexto</button>
      <InboxContextDock
        key={contact}
        wide={wide}
        open={open}
        onOpenChange={setOpen}
        title={`Atendimento de ${contact}`}
      >
        <Editor mounted={mounted} />
      </InboxContextDock>
    </>
  );
}
function Editor({ mounted }: { mounted: () => void }) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  useEffect(() => {
    mounted();
  }, [mounted]);
  return (
    <>
      <label>
        Próximo passo
        <input value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <button disabled={pending} onClick={() => setPending(true)}>
        Salvar
      </button>
    </>
  );
}
it("Sheet fechado não prende foco nem expõe controles; reabrir preserva texto e estado pendente", async () => {
  const mounted = vi.fn();
  render(<Fixture mounted={mounted} />);
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
  screen.getByRole("button", { name: "Abrir contexto" }).focus();
  fireEvent.click(screen.getByRole("button", { name: "Abrir contexto" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Próximo passo" }), {
    target: { value: "Confirmar disponibilidade" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(
    screen.getByRole("button", { name: "Abrir contexto" }).closest('[aria-hidden="true"]'),
  ).toBeNull();
  expect(document.body.style.pointerEvents).not.toBe("none");
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Abrir contexto" }));
  fireEvent.click(screen.getByRole("button", { name: "Abrir contexto" }));
  expect((screen.getByRole("textbox", { name: "Próximo passo" }) as HTMLInputElement).value).toBe(
    "Confirmar disponibilidade",
  );
  expect((screen.getByRole("button", { name: "Salvar" }) as HTMLButtonElement).disabled).toBe(true);
  expect(mounted).toHaveBeenCalledTimes(1);
});
it("trocar desktop/mobile conserva a única instância; novo contato descarta o contexto anterior", async () => {
  const mounted = vi.fn();
  const { rerender } = render(<Fixture wide mounted={mounted} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Rascunho de Ana" } });
  rerender(<Fixture wide={false} mounted={mounted} />);
  expect(screen.queryByRole("textbox")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Abrir contexto" }));
  expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("Rascunho de Ana");
  rerender(<Fixture wide mounted={mounted} />);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("Rascunho de Ana");
  expect(mounted).toHaveBeenCalledTimes(1);
  rerender(<Fixture wide mounted={mounted} contact="Bruno" />);
  expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("");
  expect(mounted).toHaveBeenCalledTimes(2);
});

it("renderização no servidor e hidratação mantêm a mesma estrutura antes de montar o portal", async () => {
  const mounted = vi.fn();
  const html = renderToString(<Fixture wide mounted={mounted} />);
  expect(html).not.toContain("Próximo passo");
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.appendChild(host);
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  let root: Root | undefined;
  try {
    await act(async () => {
      root = hydrateRoot(host, <Fixture wide mounted={mounted} />);
    });
    expect(host.querySelectorAll("input")).toHaveLength(1);
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(errors).not.toHaveBeenCalled();
  } finally {
    await act(async () => root?.unmount());
    host.remove();
    errors.mockRestore();
  }
});
