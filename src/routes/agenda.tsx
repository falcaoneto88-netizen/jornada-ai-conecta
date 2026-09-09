import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { addDays, addMonths, startOfDay } from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { AgendaCalendario, rotuloPeriodo, varianteEstadoMarcacao, type VistaAgenda } from "@/components/agenda-calendario";
import { AppShell } from "@/components/app-shell";
import { DemoNotice } from "@/components/demo-notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { sincronizarAgendaGhl } from "@/lib/ghl-agenda.functions";
import { rotuloEstadoMarcacao, useLigacaoGhl, useMarcacoes, useModoDados, usePermissoes, type Marcacao } from "@/lib/repo";

export const Route = createFileRoute("/agenda")({
  head: () => ({
    meta: [
      { title: "Agenda — Jornada AI | Dr. João Falcão" },
      {
        name: "description",
        content:
          "Agenda do GoHighLevel em vista de dia, semana ou mês: hora, cliente associado, estado e responsável, em modo leitura.",
      },
      { property: "og:title", content: "Agenda — Jornada AI" },
      { property: "og:description", content: "Marcações da clínica sincronizadas do GoHighLevel, em leitura." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Agenda,
});

const VISTAS: { valor: VistaAgenda; rotulo: string }[] = [
  { valor: "dia", rotulo: "Dia" },
  { valor: "semana", rotulo: "Semana" },
  { valor: "mes", rotulo: "Mês" },
];

function Agenda() {
  const { demo } = useModoDados();
  const permissoes = usePermissoes();
  const { data: ligacao } = useLigacaoGhl();
  const { data: marcacoes = [], isLoading, isError } = useMarcacoes();
  const sincronizar = useServerFn(sincronizarAgendaGhl);
  const qc = useQueryClient();

  const [aSincronizar, setASincronizar] = useState(false);
  const [ocorrencias, setOcorrencias] = useState<string[]>([]);
  const [vista, setVista] = useState<VistaAgenda>("semana");
  const [dataReferencia, setDataReferencia] = useState<Date>(() => startOfDay(new Date()));
  const [selecionada, setSelecionada] = useState<Marcacao | null>(null);
  const [responsavel, setResponsavel] = useState("todos");

  const responsaveis = useMemo(
    () => [...new Set(marcacoes.map((m) => m.responsavel).filter((r): r is string => !!r))].sort(),
    [marcacoes],
  );

  const visiveis = useMemo(
    () => (responsavel === "todos" ? marcacoes : marcacoes.filter((m) => m.responsavel === responsavel)),
    [marcacoes, responsavel],
  );

  function navegar(direcao: -1 | 1) {
    setDataReferencia((ref) => {
      if (vista === "dia") return addDays(ref, direcao);
      if (vista === "semana") return addDays(ref, 7 * direcao);
      return addMonths(ref, direcao);
    });
  }

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

        <section className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => setDataReferencia(startOfDay(new Date()))}>
            Hoje
          </Button>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" aria-label="Período anterior" onClick={() => navegar(-1)}>
              <ChevronLeft className="size-4" aria-hidden />
            </Button>
            <Button variant="outline" size="icon" aria-label="Período seguinte" onClick={() => navegar(1)}>
              <ChevronRight className="size-4" aria-hidden />
            </Button>
          </div>
          <p className="text-sm font-medium capitalize" aria-live="polite">
            {rotuloPeriodo(vista, dataReferencia)}
          </p>

          <div className="ms-auto flex flex-wrap items-center gap-3">
            {responsaveis.length > 0 && (
              <Select value={responsavel} onValueChange={setResponsavel}>
                <SelectTrigger className="w-48" aria-label="Filtrar por responsável">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os responsáveis</SelectItem>
                  {responsaveis.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <ToggleGroup
              type="single"
              value={vista}
              onValueChange={(v) => v && setVista(v as VistaAgenda)}
              variant="outline"
            >
              {VISTAS.map((v) => (
                <ToggleGroupItem key={v.valor} value={v.valor} aria-label={`Vista ${v.rotulo}`}>
                  {v.rotulo}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        </section>

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

        {!isLoading && !isError && marcacoes.length > 0 && (
          <AgendaCalendario
            vista={vista}
            dataReferencia={dataReferencia}
            marcacoes={visiveis}
            onSelecionar={setSelecionada}
            onAbrirDia={(d) => {
              setDataReferencia(d);
              setVista("dia");
            }}
          />
        )}

        <p className="text-xs text-muted-foreground">
          Leitura apenas: nada é criado, remarcado ou cancelado no GoHighLevel a partir daqui.
        </p>
      </div>

      <Sheet open={!!selecionada} onOpenChange={(aberto) => !aberto && setSelecionada(null)}>
        <SheetContent>
          {selecionada && (
            <>
              <SheetHeader>
                <SheetTitle>{selecionada.cliente}</SheetTitle>
                <SheetDescription>{selecionada.titulo}</SheetDescription>
              </SheetHeader>
              <div className="space-y-3 px-4 text-sm">
                <p>
                  <span className="text-muted-foreground">Início: </span>
                  {selecionada.inicio}
                </p>
                {selecionada.fim && (
                  <p>
                    <span className="text-muted-foreground">Fim: </span>
                    {selecionada.fim}
                  </p>
                )}
                <p className="flex items-center gap-2">
                  <span className="text-muted-foreground">Estado:</span>
                  <Badge variant={varianteEstadoMarcacao[selecionada.estado] ?? "outline"}>
                    {rotuloEstadoMarcacao(selecionada.estado)}
                  </Badge>
                </p>
                <p>
                  <span className="text-muted-foreground">Responsável: </span>
                  {selecionada.responsavel ?? "—"}
                </p>
                {selecionada.clienteId && (
                  <Button asChild variant="outline" size="sm">
                    <Link to="/clientes">Ver ficha do cliente</Link>
                  </Button>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </AppShell>
  );
}
