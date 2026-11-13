import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, addMonths, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from "date-fns";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  ExternalLink,
  MessageSquareText,
  Search,
  Copy,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AppointmentTracking } from "@/components/appointment-tracking";
import { AppointmentFinancePanel } from "@/components/appointment-finance-panel";
import { AgendaCalendario, rotuloPeriodo, type VistaAgenda } from "@/components/agenda-calendario";
import { AppShell } from "@/components/app-shell";
import { DemoNotice } from "@/components/demo-notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { sincronizarAgendaGhl } from "@/lib/ghl-agenda.functions";
import { getAppointmentFinance, saveAppointmentFinance } from "@/lib/appointment-finance.functions";
import { useLigacaoGhl, useMarcacoes, useModoDados, usePermissoes } from "@/lib/repo";
import { useOrganizacao } from "@/lib/organization";
import { diaCivil, chaveDia, chaveCelula, FUSO_DEMO, formatarDataHora } from "@/lib/clinic-time";
import {
  agendaGhlUrl,
  estadoAdministrativo,
  euros,
  filtrarAgenda,
  previaConfirmacao,
  resumoValores,
} from "@/lib/agenda-workspace";

export const Route = createFileRoute("/agenda")({
  head: () => ({
    meta: [
      { title: "Agenda — Jornada AI | Dr. João Falcão" },
      {
        name: "description",
        content:
          "Consultas do GoHighLevel, valores administrativos e acesso à conversa, no horário da clínica.",
      },
      { property: "og:title", content: "Agenda — Jornada AI" },
    ],
  }),
  component: Agenda,
});

const VISTAS: { valor: VistaAgenda; rotulo: string }[] = [
  { valor: "dia", rotulo: "Dia" },
  { valor: "semana", rotulo: "Semana" },
  { valor: "mes", rotulo: "Mês" },
];
const ESTADOS = ["confirmada", "realizada", "cancelada", "faltou"];

export function Agenda() {
  const { demo, escopo } = useModoDados();
  const organizacao = useOrganizacao();
  const orgId = organizacao.data?.organizacao.id;
  const fuso = organizacao.data?.organizacao.timezone ?? FUSO_DEMO;
  const permissoes = usePermissoes();
  const ligacao = useLigacaoGhl();
  const { data: marcacoes = [], isLoading, isError, dataUpdatedAt, refetch } = useMarcacoes();
  const sincronizar = useServerFn(sincronizarAgendaGhl);
  const lerValores = useServerFn(getAppointmentFinance);
  const guardarValores = useServerFn(saveAppointmentFinance);
  const qc = useQueryClient();
  const [aSincronizar, setASincronizar] = useState(false);
  const [ocorrencias, setOcorrencias] = useState<string[]>([]);
  const [vista, setVista] = useState<VistaAgenda>("semana");
  const [referenciaEscolhida, setDataReferencia] = useState<Date | null>(null);
  const dataReferencia = referenciaEscolhida ?? diaCivil(new Date(), fuso);
  const [selecionadaId, setSelecionadaId] = useState<string | null>(null);
  const origemDoDetalhe = useRef<HTMLElement | null>(null);
  const podeLerAgenda = !demo && !!orgId && !organizacao.isError && !isError && !isLoading;
  const selecionada = podeLerAgenda
    ? (marcacoes.find((m) => m.id === selecionadaId) ?? null)
    : null;
  const [responsavel, setResponsavel] = useState("todos");
  const [estado, setEstado] = useState("todos");
  const [busca, setBusca] = useState("");
  const [rascunho, setRascunho] = useState<string | null>(null);
  const [incluirValores, setIncluirValores] = useState(false);
  const responsaveis = useMemo(
    () => [...new Set(marcacoes.map((m) => m.responsavel).filter((r): r is string => !!r))].sort(),
    [marcacoes],
  );
  const visiveis = useMemo(
    () => filtrarAgenda(marcacoes, busca, estado, responsavel),
    [marcacoes, busca, estado, responsavel],
  );
  const periodoInicio =
    vista === "dia"
      ? dataReferencia
      : vista === "semana"
        ? startOfWeek(dataReferencia, { weekStartsOn: 1 })
        : startOfWeek(startOfMonth(dataReferencia), { weekStartsOn: 1 });
  const periodoFim =
    vista === "dia"
      ? dataReferencia
      : vista === "semana"
        ? endOfWeek(dataReferencia, { weekStartsOn: 1 })
        : endOfWeek(endOfMonth(dataReferencia), { weekStartsOn: 1 });
  const acompanhamentoVisivel = visiveis.filter((m) => {
    const dia = chaveDia(m.inicioIso, fuso);
    return dia >= chaveCelula(periodoInicio) && dia <= chaveCelula(periodoFim);
  });
  const ids = acompanhamentoVisivel.map((m) => m.id).sort();
  const valoresKey = ["appointment-finance", escopo, orgId, ids];
  const valores = useQuery({
    queryKey: valoresKey,
    enabled: podeLerAgenda && permissoes.operar && ids.length > 0,
    queryFn: async () => {
      const resultados = [];
      for (let offset = 0; offset < ids.length; offset += 200) {
        const result = await lerValores({
          data: { appointmentIds: ids.slice(offset, offset + 200) },
        });
        if (!result.available) return result;
        resultados.push(result);
      }
      return {
        available: true,
        canEdit: resultados.every((r) => r.canEdit),
        entries: resultados.flatMap((r) => r.entries),
        message: undefined,
      };
    },
    retry: false,
  });
  const podeLerValores = podeLerAgenda && permissoes.operar;
  const entries =
    podeLerValores && valores.data?.available && !valores.isError ? valores.data.entries : [];
  const resumo = resumoValores(acompanhamentoVisivel, entries);
  const valoresConhecidos =
    podeLerValores && valores.data?.available && !valores.isError && resumo.known > 0;
  const entrada = selecionada
    ? (entries.find((e) => e.appointmentId === selecionada.id) ?? null)
    : null;
  const semAgenda = !demo && !ligacao.isPending && !ligacao.isError && !ligacao.data?.calendar_id;
  const urlGhl =
    !demo && !organizacao.isError && !ligacao.isError && ligacao.data?.organization_id === orgId
      ? agendaGhlUrl(ligacao.data?.location_id, ligacao.data?.calendar_id)
      : null;
  const filtrosAtivos = busca !== "" || estado !== "todos" || responsavel !== "todos";

  function navegar(direcao: -1 | 1) {
    setDataReferencia((ref) => {
      const data = ref ?? diaCivil(new Date(), fuso);
      return vista === "dia"
        ? addDays(data, direcao)
        : vista === "semana"
          ? addDays(data, 7 * direcao)
          : addMonths(data, direcao);
    });
  }
  async function atualizar() {
    if (demo) return;
    setASincronizar(true);
    try {
      const res = await sincronizar();
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setOcorrencias(res.resultado.conflitos);
      await Promise.all(
        ["marcacoes", "contactos", "ligacao-ghl"].map((key) =>
          qc.invalidateQueries({ queryKey: [key] }),
        ),
      );
      const texto = `${res.resultado.inseridas} nova(s), ${res.resultado.atualizadas} atualizada(s)`;
      if (res.resultado.completo) toast.success(`Agenda atualizada: ${texto}.`);
      else toast.warning(`Agenda atualizada com ocorrências: ${texto}.`);
    } catch {
      toast.error("Não foi possível atualizar a agenda. Tente novamente.");
    } finally {
      setASincronizar(false);
    }
  }

  return (
    <AppShell
      title="Agenda"
      description="Consultas, valores e próximo contacto, no mesmo lugar"
      actions={
        <div className="flex flex-wrap gap-2">
          {permissoes.gerirJornada && !demo && (
            <Button
              variant="outline"
              onClick={() => void atualizar()}
              disabled={aSincronizar || semAgenda || ligacao.isPending || ligacao.isError}
            >
              <RefreshCw
                className={`size-4 ${aSincronizar ? "motion-safe:animate-spin" : ""}`}
                aria-hidden
              />
              {aSincronizar ? "A atualizar…" : "Atualizar agenda"}
            </Button>
          )}
          {urlGhl && permissoes.operar && !demo && (
            <Button asChild>
              <a href={urlGhl} target="_blank" rel="noopener noreferrer">
                <CalendarDays className="size-4" aria-hidden />
                Nova consulta no GHL
                <ExternalLink className="size-3.5" aria-hidden />
              </a>
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <p>
            Horário da clínica: <strong>{organizacao.data ? fuso : "A consultar…"}</strong>
          </p>
          <p>
            {dataUpdatedAt
              ? `Dados consultados às ${new Date(dataUpdatedAt).toLocaleTimeString("pt-PT", { timeZone: fuso, hour: "2-digit", minute: "2-digit" })}`
              : "A consultar agenda…"}{" "}
            · Origem: GoHighLevel
          </p>
        </div>
        {demo && (
          <DemoNotice texto="A agenda real e os valores estão disponíveis apenas com sessão iniciada." />
        )}
        {organizacao.isError && !demo && (
          <p role="alert">Não foi possível consultar o fuso da clínica. Atualize a página.</p>
        )}
        {ligacao.isError && (
          <p role="alert" className="text-sm text-destructive">
            Não foi possível consultar a ligação GHL.{" "}
            <button className="underline" onClick={() => void ligacao.refetch()}>
              Tentar novamente
            </button>
          </p>
        )}
        {semAgenda && (
          <section className="surface-card p-5">
            <h2 className="font-semibold">Escolha a agenda da clínica</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Selecione a agenda em Integrações e atualize as consultas aqui.
            </p>
            <Button asChild variant="outline" className="mt-3">
              <Link to="/integracoes">Abrir Integrações</Link>
            </Button>
          </section>
        )}
        {ocorrencias.length > 0 && (
          <details className="rounded-xl border border-warning/30 bg-warning/5 p-4 text-sm">
            <summary className="cursor-pointer font-medium">
              Ocorrências da atualização ({ocorrencias.length})
            </summary>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {ocorrencias.slice(0, 12).map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </details>
        )}

        {!isError && !demo && organizacao.data && !organizacao.isError && (
          <section
            aria-label="Resumo do período"
            className="grid grid-cols-2 divide-x divide-y divide-border overflow-hidden rounded-xl border border-border bg-card lg:grid-cols-4 lg:divide-y-0"
          >
            <Resumo
              label="Consultas no período"
              value={isLoading ? "…" : String(acompanhamentoVisivel.length)}
              detail="Inclui os filtros selecionados"
            />
            <Resumo
              label="Valor registado"
              value={valoresConhecidos ? euros(resumo.totalCents) : "—"}
              detail="Procedimentos com valor informado"
            />
            <Resumo
              label="Sinais informados"
              value={valoresConhecidos ? euros(resumo.depositCents) : "—"}
              detail="Registo administrativo da equipa"
            />
            <Resumo
              label="Saldo calculado"
              value={valoresConhecidos ? euros(resumo.remainingCents) : "—"}
              detail="Valor menos sinal informado"
            />
          </section>
        )}
        {valoresConhecidos && (
          <p className="text-xs text-muted-foreground">
            Valores de {resumo.known} de {resumo.eligible} consultas não canceladas no período
            visível. Ausência de valor não significa saldo zero. Não representa conciliação
            bancária.
          </p>
        )}
        {!demo &&
          permissoes.operar &&
          ids.length > 0 &&
          !valores.isPending &&
          !valoresConhecidos && (
            <p className="text-xs text-muted-foreground">
              {valores.isError
                ? "Não foi possível consultar os valores."
                : !valores.data?.available
                  ? (valores.data?.message ?? "Registo de valores a preparar.")
                  : "Ainda não há valores registados neste período. Abra uma consulta para informar total e sinal."}{" "}
              {(valores.isError || !valores.data?.available) && (
                <button className="underline" onClick={() => void valores.refetch()}>
                  Tentar novamente
                </button>
              )}
            </p>
          )}

        <section aria-label="Navegar e filtrar agenda" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                aria-label="Período anterior"
                onClick={() => navegar(-1)}
              >
                <ChevronLeft className="size-4" aria-hidden />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDataReferencia(diaCivil(new Date(), fuso))}
              >
                Hoje
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="Período seguinte"
                onClick={() => navegar(1)}
              >
                <ChevronRight className="size-4" aria-hidden />
              </Button>
              <p className="text-sm font-semibold capitalize" aria-live="polite">
                {rotuloPeriodo(vista, dataReferencia)}
              </p>
            </div>
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
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-48 flex-1">
              <Label htmlFor="agenda-busca">Pesquisar consulta</Label>
              <div className="relative mt-1">
                <Search
                  className="absolute left-3 top-3 size-4 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  id="agenda-busca"
                  className="pl-9"
                  placeholder="Cliente, procedimento ou responsável"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="agenda-data">Ir para data</Label>
              <Input
                id="agenda-data"
                className="mt-1 w-40"
                type="date"
                value={chaveCelula(dataReferencia)}
                onChange={(e) => {
                  if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) {
                    const [y, m, d] = e.target.value.split("-").map(Number);
                    setDataReferencia(new Date(y!, m! - 1, d!, 12));
                  }
                }}
              />
            </div>
            <div>
              <Label>Estado administrativo</Label>
              <Select value={estado} onValueChange={setEstado}>
                <SelectTrigger className="mt-1 w-44" aria-label="Filtrar por estado">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os estados</SelectItem>
                  {ESTADOS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {estadoAdministrativo(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Responsável</Label>
              <Select value={responsavel} onValueChange={setResponsavel}>
                <SelectTrigger className="mt-1 w-48" aria-label="Filtrar por responsável">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os responsáveis</SelectItem>
                  <SelectItem value="sem-responsavel">Sem responsável</SelectItem>
                  {responsaveis.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {filtrosAtivos && (
              <Button
                variant="ghost"
                onClick={() => {
                  setBusca("");
                  setEstado("todos");
                  setResponsavel("todos");
                }}
              >
                Limpar filtros
              </Button>
            )}
          </div>
        </section>
        {isLoading && (
          <div
            role="status"
            className="rounded-xl border border-border p-8 text-sm text-muted-foreground"
          >
            A carregar consultas…
          </div>
        )}
        {isError && (
          <div role="alert" className="rounded-xl border border-destructive/30 p-5 text-sm">
            <p>Não foi possível ler as consultas.</p>
            <Button variant="outline" className="mt-3" onClick={() => void refetch()}>
              Tentar novamente
            </Button>
          </div>
        )}
        {podeLerAgenda && (
          <>
            <AgendaCalendario
              vista={vista}
              fuso={fuso}
              dataReferencia={dataReferencia}
              marcacoes={visiveis}
              valores={entries}
              onSelecionar={(m) => {
                origemDoDetalhe.current =
                  document.activeElement instanceof HTMLElement ? document.activeElement : null;
                setSelecionadaId(m.id);
                setRascunho(null);
                setIncluirValores(false);
              }}
              onAbrirDia={(d) => {
                setDataReferencia(d);
                setVista("dia");
              }}
            />
            {acompanhamentoVisivel.length === 0 && (
              <p role="status" className="text-sm text-muted-foreground">
                {filtrosAtivos
                  ? "Nenhuma consulta corresponde aos filtros neste período. Limpe os filtros ou escolha outra data."
                  : "Não há consultas importadas neste período. Escolha outra data ou atualize a agenda do GHL."}
              </p>
            )}
            <details className="rounded-xl border border-border bg-card p-4">
              <summary className="cursor-pointer text-sm font-semibold">
                Confirmações e acompanhamento por evidência
              </summary>
              <div className="mt-4">
                <AppointmentTracking marcacoes={acompanhamentoVisivel} />
              </div>
            </details>
          </>
        )}
        <p className="text-xs text-muted-foreground">
          A agenda vem do GHL. Para criar uma consulta, abra o contato no Meu Chat e use “Agendar
          agora”. Remarcações e cancelamentos continuam no GHL. “Agendada” é o estado administrativo
          e não comprova uma resposta SIM.
        </p>
      </div>
      <Sheet
        open={!!selecionada}
        onOpenChange={(open) => {
          if (!open) {
            setSelecionadaId(null);
            setRascunho(null);
          }
        }}
      >
        <SheetContent
          className="w-full overflow-y-auto sm:max-w-lg"
          onCloseAutoFocus={(event) => {
            if (origemDoDetalhe.current?.isConnected) {
              event.preventDefault();
              origemDoDetalhe.current.focus();
            }
          }}
        >
          {selecionada && (
            <div className="space-y-6">
              <SheetHeader className="pr-7 text-left">
                <SheetTitle>{selecionada.cliente}</SheetTitle>
                <SheetDescription>{selecionada.titulo}</SheetDescription>
              </SheetHeader>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <div className="col-span-2">
                  <dt className="text-muted-foreground">Data e hora · {fuso}</dt>
                  <dd className="mt-1 font-semibold">
                    {formatarDataHora(selecionada.inicioIso, fuso)}
                    {selecionada.fim && ` — ${selecionada.fim}`}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Estado administrativo</dt>
                  <dd className="mt-1">
                    <Badge variant="outline">{estadoAdministrativo(selecionada.estado)}</Badge>
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Responsável</dt>
                  <dd className="mt-1">{selecionada.responsavel ?? "Sem responsável"}</dd>
                </div>
                {selecionada.atualizadaIso && (
                  <div className="col-span-2 text-xs text-muted-foreground">
                    <dt>Registo local atualizado em</dt>
                    <dd>{formatarDataHora(selecionada.atualizadaIso, fuso)}</dd>
                  </div>
                )}
              </dl>
              <div className="flex flex-wrap gap-2">
                {selecionada.clienteGhlId ? (
                  <Button asChild>
                    <Link to="/caixa-de-entrada" search={{ contact: selecionada.clienteGhlId }}>
                      <MessageSquareText className="size-4" aria-hidden />
                      Abrir Meu Chat
                    </Link>
                  </Button>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Conversa indisponível: este registo ainda não tem contacto GHL associado.
                  </p>
                )}
                {urlGhl && (
                  <Button asChild variant="outline">
                    <a href={urlGhl} target="_blank" rel="noopener noreferrer">
                      Gerir no GHL
                      <ExternalLink className="size-3.5" aria-hidden />
                    </a>
                  </Button>
                )}
              </div>
              {permissoes.operar ? (
                <AppointmentFinancePanel
                  key={`${escopo}:${orgId}:${selecionada.id}`}
                  entry={entrada}
                  available={Boolean(valores.data?.available)}
                  canEdit={Boolean(valores.data?.canEdit)}
                  loading={valores.isPending || valores.isFetching}
                  error={
                    valores.isError
                      ? "Não foi possível ler os valores. Tente novamente."
                      : (valores.data?.message ?? null)
                  }
                  fuso={fuso}
                  onRetry={() => void valores.refetch()}
                  onSave={async (input) => {
                    const result = await guardarValores({
                      data: { ...input, appointmentId: selecionada.id },
                    });
                    if (!result.ok) {
                      if (result.code === "conflict") await valores.refetch();
                      throw new Error(result.message);
                    }
                    qc.setQueryData(valoresKey, (previous: typeof valores.data) =>
                      previous
                        ? {
                            ...previous,
                            entries: [
                              ...previous.entries.filter(
                                (e) => e.appointmentId !== result.entry.appointmentId,
                              ),
                              result.entry,
                            ],
                          }
                        : previous,
                    );
                    toast.success("Valores administrativos guardados.");
                  }}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  O seu perfil permite consultar a agenda. Os valores administrativos são restritos
                  à equipa autorizada.
                </p>
              )}
              {permissoes.operar &&
                selecionada.estado !== "cancelada" &&
                selecionada.estado !== "realizada" && (
                  <section
                    className="space-y-3 border-t border-border pt-5"
                    aria-label="Rascunho de confirmação"
                  >
                    <h3 className="font-semibold">Preparar confirmação</h3>
                    <p className="text-sm text-muted-foreground">
                      Prévia editável para rever com a equipa. Nada é enviado e o estado da consulta
                      não muda.
                    </p>
                    {entrada && (
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={incluirValores}
                          onChange={(e) => setIncluirValores(e.target.checked)}
                        />
                        Incluir valores administrativos
                      </label>
                    )}
                    <Button
                      variant="outline"
                      onClick={() =>
                        setRascunho(
                          previaConfirmacao(selecionada, fuso, incluirValores ? entrada : null),
                        )
                      }
                    >
                      Gerar prévia
                    </Button>
                    {rascunho !== null && (
                      <>
                        <Label htmlFor="agenda-rascunho">Mensagem para revisão · não enviada</Label>
                        <Textarea
                          id="agenda-rascunho"
                          value={rascunho}
                          rows={7}
                          onChange={(e) => setRascunho(e.target.value)}
                        />
                        <Button
                          variant="outline"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(rascunho);
                              toast.success("Rascunho copiado. Nenhuma mensagem enviada.");
                            } catch {
                              toast.error(
                                "Não foi possível copiar. Selecione e copie o texto manualmente.",
                              );
                            }
                          }}
                        >
                          <Copy className="size-4" aria-hidden />
                          Copiar rascunho
                        </Button>
                      </>
                    )}
                  </section>
                )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </AppShell>
  );
}

function Resumo({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="min-w-0 p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="my-1 text-xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}
