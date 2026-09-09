import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarDays, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { DemoNotice } from "@/components/demo-notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { sincronizarAgendaGhl } from "@/lib/ghl-agenda.functions";
import { rotuloEstadoMarcacao, useLigacaoGhl, useMarcacoes, useModoDados, usePermissoes } from "@/lib/repo";

export const Route = createFileRoute("/agenda")({
  head: () => ({
    meta: [
      { title: "Agenda — Jornada AI | Dr. João Falcão" },
      {
        name: "description",
        content:
          "Marcações reais da agenda do GoHighLevel: dia, hora, cliente associado, estado e responsável, em modo leitura.",
      },
      { property: "og:title", content: "Agenda — Jornada AI" },
      { property: "og:description", content: "Marcações da clínica sincronizadas do GoHighLevel, em leitura." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Agenda,
});

const VARIANTE: Record<string, "default" | "outline" | "destructive"> = {
  confirmada: "default",
  realizada: "default",
  faltou: "destructive",
  cancelada: "destructive",
};

function diaLegivel(iso: string) {
  return new Date(iso).toLocaleDateString("pt-PT", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function hora(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
}

function Agenda() {
  const { demo } = useModoDados();
  const permissoes = usePermissoes();
  const { data: ligacao } = useLigacaoGhl();
  const { data: marcacoes = [], isLoading, isError } = useMarcacoes();
  const sincronizar = useServerFn(sincronizarAgendaGhl);
  const qc = useQueryClient();
  const [aSincronizar, setASincronizar] = useState(false);
  const [ocorrencias, setOcorrencias] = useState<string[]>([]);

  const agora = Date.now();
  const { proximas, passadas } = useMemo(() => {
    const futuras = marcacoes.filter((m) => new Date(m.inicioIso).getTime() >= agora);
    const antigas = marcacoes
      .filter((m) => new Date(m.inicioIso).getTime() < agora)
      .sort((a, b) => b.inicioIso.localeCompare(a.inicioIso));
    return { proximas: futuras, passadas: antigas };
  }, [marcacoes, agora]);

  const porDia = useMemo(() => {
    const grupos = new Map<string, typeof proximas>();
    for (const m of proximas) {
      const dia = m.inicioIso.slice(0, 10);
      grupos.set(dia, [...(grupos.get(dia) ?? []), m]);
    }
    return [...grupos.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [proximas]);

  async function atualizar() {
    if (demo) {
      toast.error("Agenda real indisponível em modo demonstração.");
      return;
    }
    setASincronizar(true);
    try {
      const res = await sincronizar();
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      const r = res.resultado;
      setOcorrencias(r.conflitos);
      await Promise.all(
        ["marcacoes", "contactos", "ligacao-ghl"].map((k) => qc.invalidateQueries({ queryKey: [k] })),
      );
      const resumo = `${r.inseridas} nova(s), ${r.atualizadas} atualizada(s)`;
      if (r.completo) toast.success(`Agenda atualizada: ${resumo}.`);
      else toast.warning(`Agenda atualizada com ${r.conflitos.length} ocorrência(s): ${resumo}.`);
    } catch {
      toast.error("Não foi possível atualizar a agenda.");
    } finally {
      setASincronizar(false);
    }
  }

  const semAgenda = !demo && !ligacao?.calendar_id;

  return (
    <AppShell
      title="Agenda"
      description="Marcações da clínica sincronizadas do GoHighLevel (só leitura)"
      actions={
        permissoes.gerirJornada && !demo ? (
          <Button onClick={() => void atualizar()} disabled={aSincronizar || semAgenda}>
            <RefreshCw className="size-4" aria-hidden /> {aSincronizar ? "A atualizar…" : "Atualizar agenda"}
          </Button>
        ) : null
      }
    >
      <div className="space-y-6">
        {demo && <DemoNotice texto="Modo demonstração: a agenda real só aparece com conta iniciada." />}

        {semAgenda && (
          <section className="surface-card flex items-start gap-3 p-6">
            <CalendarDays className="mt-0.5 size-5 text-primary" aria-hidden />
            <div>
              <h2 className="text-base font-semibold">Agenda por escolher</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Vá a Integrações › Mapeamento e escolha a agenda a acompanhar. Depois volte aqui e clique em «Atualizar
                agenda».
              </p>
            </div>
          </section>
        )}

        {ocorrencias.length > 0 && (
          <section className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
            <h3 className="text-sm font-semibold">Ocorrências da última atualização ({ocorrencias.length})</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              {ocorrencias.slice(0, 12).map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </section>
        )}

        {isLoading && (
          <p className="text-sm text-muted-foreground" role="status">
            A carregar marcações…
          </p>
        )}
        {isError && (
          <p className="rounded-xl border border-destructive/40 p-4 text-sm text-destructive">
            Não foi possível ler as marcações.
          </p>
        )}

        {!isLoading && !isError && marcacoes.length === 0 && !semAgenda && (
          <div className="surface-card p-6 text-sm text-muted-foreground">
            Ainda não há marcações importadas. Clique em «Atualizar agenda» para as trazer do GoHighLevel.
          </div>
        )}

        {porDia.length > 0 && (
          <section className="space-y-4">
            <h2 className="text-base font-semibold">Próximas marcações</h2>
            {porDia.map(([dia, lista]) => (
              <div key={dia} className="surface-card p-5">
                <h3 className="text-sm font-semibold capitalize">{diaLegivel(dia)}</h3>
                <ul className="mt-3 divide-y divide-border">
                  {lista.map((m) => (
                    <li key={m.id} className="flex flex-wrap items-center gap-3 py-3">
                      <span className="w-14 shrink-0 font-mono text-sm">{hora(m.inicioIso)}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{m.cliente}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {m.titulo}
                          {m.responsavel ? ` · ${m.responsavel}` : ""}
                        </p>
                      </div>
                      <Badge variant={VARIANTE[m.estado] ?? "outline"}>{rotuloEstadoMarcacao(m.estado)}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        )}

        {passadas.length > 0 && (
          <section className="surface-card p-5">
            <h2 className="text-base font-semibold">Histórico recente</h2>
            <ul className="mt-3 divide-y divide-border">
              {passadas.slice(0, 30).map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-3 py-3">
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">{m.inicio}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{m.cliente}</p>
                    <p className="truncate text-xs text-muted-foreground">{m.titulo}</p>
                  </div>
                  <Badge variant={VARIANTE[m.estado] ?? "outline"}>{rotuloEstadoMarcacao(m.estado)}</Badge>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="text-xs text-muted-foreground">
          Leitura apenas: nada é criado, remarcado ou cancelado no GoHighLevel a partir daqui.
        </p>
      </div>
    </AppShell>
  );
}
