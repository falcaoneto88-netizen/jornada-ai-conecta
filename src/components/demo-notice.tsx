import { Info } from "lucide-react";

import { useAppMode } from "@/lib/app-mode";

export function DemoNotice({ texto }: { texto: string }) {
  const modo = useAppMode();
  if (modo === "conectado") return null;
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-primary/35 bg-primary/8 px-4 py-3 text-sm text-foreground">
      <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
      <p>{texto}</p>
    </div>
  );
}
