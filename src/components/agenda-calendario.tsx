import {
  addDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  isSameDay,
  isSameMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { rotuloEstadoMarcacao, type Marcacao } from "@/lib/repo";

export type VistaAgenda = "dia" | "semana" | "mes";

const VARIANTE: Record<string, "default" | "outline" | "destructive"> = {
  confirmada: "default",
  realizada: "default",
  faltou: "destructive",
  cancelada: "destructive",
};

export function hora(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
}

export function diaCurto(d: Date) {
  return d.toLocaleDateString("pt-PT", { weekday: "short" });
}

export function inicioPeriodo(vista: VistaAgenda, ref: Date) {
  if (vista === "dia") return startOfDay(ref);
  if (vista === "semana") return startOfWeek(ref, { weekStartsOn: 1 });
  return startOfMonth(ref);
}

export function rotuloPeriodo(vista: VistaAgenda, ref: Date) {
  if (vista === "dia") {
    return ref.toLocaleDateString("pt-PT", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
  }
  if (vista === "semana") {
    const ini = startOfWeek(ref, { weekStartsOn: 1 });
    const fim = endOfWeek(ref, { weekStartsOn: 1 });
    const f = (d: Date) => d.toLocaleDateString("pt-PT", { day: "2-digit", month: "short" });
    return `${f(ini)} – ${f(fim)} de ${fim.toLocaleDateString("pt-PT", { year: "numeric" })}`;
  }
  return ref.toLocaleDateString("pt-PT", { month: "long", year: "numeric" });
}

function diasDaVista(vista: VistaAgenda, ref: Date) {
  if (vista === "dia") return [startOfDay(ref)];
  if (vista === "semana") {
    return eachDayOfInterval({ start: startOfWeek(ref, { weekStartsOn: 1 }), end: endOfWeek(ref, { weekStartsOn: 1 }) });
  }
  return eachDayOfInterval({
    start: startOfWeek(startOfMonth(ref), { weekStartsOn: 1 }),
    end: endOfWeek(endOfMonth(ref), { weekStartsOn: 1 }),
  });
}

type Props = {
  vista: VistaAgenda;
  dataReferencia: Date;
  marcacoes: Marcacao[];
  onSelecionar: (m: Marcacao) => void;
  onAbrirDia: (d: Date) => void;
};

function Cartao({ m, onSelecionar }: { m: Marcacao; onSelecionar: (m: Marcacao) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelecionar(m)}
      className="w-full rounded-lg border border-border bg-card px-2.5 py-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex items-center gap-2">
        <span className="font-mono text-xs text-muted-foreground">{hora(m.inicioIso)}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{m.cliente}</span>
      </span>
      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
        {m.titulo}
        {m.responsavel ? ` · ${m.responsavel}` : ""}
      </span>
    </button>
  );
}

export function AgendaCalendario({ vista, dataReferencia, marcacoes, onSelecionar, onAbrirDia }: Props) {
  const isMobile = useIsMobile();
  const dias = useMemo(() => diasDaVista(vista, dataReferencia), [vista, dataReferencia]);

  const porDia = useMemo(() => {
    const mapa = new Map<string, Marcacao[]>();
    for (const m of marcacoes) {
      const chave = new Date(m.inicioIso).toDateString();
      mapa.set(chave, [...(mapa.get(chave) ?? []), m]);
    }
    for (const lista of mapa.values()) lista.sort((a, b) => a.inicioIso.localeCompare(b.inicioIso));
    return mapa;
  }, [marcacoes]);

  const doDia = (d: Date) => porDia.get(d.toDateString()) ?? [];
  const hoje = new Date();

  if (vista === "dia") {
    const lista = doDia(dias[0] ?? startOfDay(dataReferencia));
    return (
      <div className="surface-card p-5">
        {lista.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem marcações neste dia.</p>
        ) : (
          <ul className="divide-y divide-border">
            {lista.map((m) => (
              <li key={m.id} className="py-2 first:pt-0 last:pb-0">
                <button
                  type="button"
                  onClick={() => onSelecionar(m)}
                  className="flex w-full flex-wrap items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent"
                >
                  <span className="w-14 shrink-0 font-mono text-sm">{hora(m.inicioIso)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{m.cliente}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {m.titulo}
                      {m.responsavel ? ` · ${m.responsavel}` : ""}
                    </span>
                  </span>
                  <Badge variant={VARIANTE[m.estado] ?? "outline"}>{rotuloEstadoMarcacao(m.estado)}</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  // Em ecrã pequeno, semana e mês ficam em lista compacta por dia.
  if (isMobile) {
    const comMarcacoes = dias.filter((d) => doDia(d).length > 0);
    if (comMarcacoes.length === 0) {
      return <div className="surface-card p-5 text-sm text-muted-foreground">Sem marcações neste período.</div>;
    }
    return (
      <div className="space-y-4">
        {comMarcacoes.map((d) => (
          <div key={d.toISOString()} className="surface-card p-4">
            <button
              type="button"
              onClick={() => onAbrirDia(d)}
              className="text-sm font-semibold capitalize hover:underline"
            >
              {d.toLocaleDateString("pt-PT", { weekday: "long", day: "2-digit", month: "2-digit" })}
            </button>
            <div className="mt-3 space-y-2">
              {doDia(d).map((m) => (
                <Cartao key={m.id} m={m} onSelecionar={onSelecionar} />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (vista === "semana") {
    return (
      <div className="surface-card overflow-hidden">
        <div className="grid grid-cols-7 divide-x divide-border">
          {dias.map((d) => (
            <div key={d.toISOString()} className="min-h-[28rem]">
              <button
                type="button"
                onClick={() => onAbrirDia(d)}
                className={cn(
                  "w-full border-b border-border px-2 py-2 text-left text-xs font-medium capitalize hover:bg-accent",
                  isSameDay(d, hoje) && "bg-primary/10 text-primary",
                )}
              >
                <span className="font-mono text-sm">{d.getDate()}</span> {diaCurto(d)}
              </button>
              <div className="space-y-2 p-2">
                {doDia(d).map((m) => (
                  <Cartao key={m.id} m={m} onSelecionar={onSelecionar} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const primeiro = dias[0] ?? startOfDay(dataReferencia);
  const cabecalho = eachDayOfInterval({ start: primeiro, end: addDays(primeiro, 6) });
  return (
    <div className="surface-card overflow-hidden">
      <div className="grid grid-cols-7 border-b border-border">
        {cabecalho.map((d) => (
          <div key={d.toISOString()} className="px-2 py-2 text-center text-xs font-medium capitalize text-muted-foreground">
            {diaCurto(d)}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 divide-x divide-y divide-border">
        {dias.map((d) => {
          const lista = doDia(d);
          return (
            <div
              key={d.toISOString()}
              className={cn("min-h-28 p-1.5", !isSameMonth(d, dataReferencia) && "bg-muted/30")}
            >
              <button
                type="button"
                onClick={() => onAbrirDia(d)}
                className={cn(
                  "mb-1 rounded-md px-1.5 py-0.5 font-mono text-xs hover:bg-accent",
                  isSameDay(d, hoje) && "bg-primary text-primary-foreground",
                  !isSameMonth(d, dataReferencia) && "text-muted-foreground",
                )}
              >
                {d.getDate()}
              </button>
              <div className="space-y-1">
                {lista.slice(0, 3).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => onSelecionar(m)}
                    className="block w-full truncate rounded px-1.5 py-1 text-left text-[11px] hover:bg-accent"
                  >
                    <span className="font-mono text-muted-foreground">{hora(m.inicioIso)}</span> {m.cliente}
                  </button>
                ))}
                {lista.length > 3 && (
                  <button
                    type="button"
                    onClick={() => onAbrirDia(d)}
                    className="px-1.5 text-[11px] text-primary hover:underline"
                  >
                    +{lista.length - 3} mais
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export { VARIANTE as varianteEstadoMarcacao };
