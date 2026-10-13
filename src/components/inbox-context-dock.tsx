import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./ui/sheet";

/** Keeps one editor alive while its visible host changes; no form data is copied or persisted. */
export function InboxContextDock({
  wide,
  open,
  onOpenChange,
  title,
  children,
}: {
  wide: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
}) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    setContainer(document.createElement("div"));
  }, []);
  const parking = useRef<HTMLDivElement | null>(null);
  const park = useCallback(
    (node: HTMLDivElement | null) => {
      parking.current = node;
      if (node && container && !container.parentNode) node.appendChild(container);
    },
    [container],
  );
  const dock = useCallback(
    (node: HTMLElement | null) => {
      if (!container) return;
      const host = node ?? parking.current;
      if (host && container.parentNode !== host) host.appendChild(container);
    },
    [container],
  );
  return (
    <>
      <div ref={park} hidden aria-hidden="true" />
      {container && createPortal(children, container)}
      {wide ? (
        <aside
          ref={dock}
          className="surface-card min-h-0 overflow-y-auto overscroll-contain"
          aria-label="Painel lateral do atendimento"
        />
      ) : (
        <Sheet open={open} onOpenChange={onOpenChange}>
          <SheetContent
            onOpenAutoFocus={() => {
              previousFocus.current =
                document.activeElement instanceof HTMLElement ? document.activeElement : null;
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              const target = previousFocus.current;
              if (
                target?.isConnected &&
                !target.closest("[hidden]") &&
                window.getComputedStyle(target).display !== "none"
              )
                target.focus();
            }}
            className="w-full overflow-y-auto p-0 pt-6 sm:max-w-md motion-reduce:animate-none motion-reduce:transition-none"
          >
            <SheetHeader className="px-4 pb-3 pr-10">
              <SheetTitle>{title}</SheetTitle>
              <SheetDescription>Próximo passo, contexto e sugestões para revisão.</SheetDescription>
            </SheetHeader>
            <div ref={dock} />
          </SheetContent>
        </Sheet>
      )}
    </>
  );
}
