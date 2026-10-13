import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowUpRight,
  CalendarDays,
  Clock3,
  MessageSquare,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { useOrganizacao } from "@/lib/organization";
import { useModoDados } from "@/lib/repo";
import { formatarDataHora } from "@/lib/clinic-time";
import { readAttendanceWorkspace } from "@/lib/attendance-workspace.functions";
import type { AttendanceWorkspaceInput } from "@/lib/attendance-workspace.core";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";

export function AttendanceMyDay() {
  const { demo, escopo } = useModoDados();
  const organization = useOrganizacao();
  if (demo) return null;
  if (organization.isError)
    return <p role="alert">Não foi possível identificar a clínica para consultar Meu dia.</p>;
  if (!organization.data) return <p role="status">A carregar Meu dia…</p>;
  return (
    <MyDay
      key={`${escopo}:${organization.data.organizacao.id}`}
      scope={escopo}
      organizationId={organization.data.organizacao.id}
    />
  );
}

function MyDay({ scope, organizationId }: { scope: string; organizationId: string }) {
  const read = useServerFn(readAttendanceWorkspace);
  const [ownerFilter, setOwnerFilter] = useState<AttendanceWorkspaceInput["ownerFilter"]>("mine");
  const [view, setView] = useState<AttendanceWorkspaceInput["view"]>("all");
  const [page, setPage] = useState(0);
  const query = useQuery({
    queryKey: ["attendance-workspace", scope, organizationId, ownerFilter, view, page],
    queryFn: () => read({ data: { organizationId, ownerFilter, view, page, pageSize: 25 } }),
    retry: false,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
  });
  const data = query.data?.ok ? query.data.data : null;
  const failure = query.data && !query.data.ok ? query.data : null;
  const ownership =
    ownerFilter === "mine"
      ? "Sob sua responsabilidade"
      : ownerFilter === "all"
        ? "Toda a equipe"
        : "Sem responsável no Jornada";
  const pick = (next: AttendanceWorkspaceInput["view"]) => {
    setView(next);
    setPage(0);
  };
  return (
    <section className="space-y-5" aria-label="Meu dia no atendimento">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Organize o próximo passo
          </p>
          <h2 className="mt-1 text-xl font-semibold text-heading">Atendimento de hoje</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {ownership}
            {data ? ` · Horários: ${data.timezone}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-muted-foreground">
            Responsabilidade{" "}
            <select
              aria-label="Filtrar por responsável"
              className="ml-2 h-9 rounded-md border border-input bg-card px-2 text-sm text-foreground"
              value={ownerFilter}
              onChange={(event) => {
                setOwnerFilter(event.target.value as AttendanceWorkspaceInput["ownerFilter"]);
                setPage(0);
              }}
            >
              <option value="mine">Meus atendimentos</option>
              <option value="all">Toda a equipe</option>
              <option value="unassigned">Sem responsável</option>
            </select>
          </label>
          <Button
            variant="outline"
            size="sm"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
            aria-label="Atualizar Meu dia"
          >
            <RefreshCw className="size-4" />
          </Button>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <article className="surface-card p-5">
          <MessageSquare className="size-4 text-muted-foreground" />
          <h3 className="mt-3 text-sm font-medium">Aguardam minha resposta</h3>
          <p className="mt-2 text-xl font-semibold">Indisponível</p>
          <p className="mt-2 text-xs text-muted-foreground">
            A cobertura das mensagens ainda não permite calcular esta fila. Não lida no GHL não
            significa resposta pendente.
          </p>
        </article>
        {(
          [
            {
              key: "returns_today",
              label: "Retornos hoje",
              value: data?.counts.returnsToday,
              icon: Clock3,
              note: "Prazo interno para hoje, incluindo os já vencidos.",
            },
            {
              key: "overdue",
              label: "Pendências vencidas",
              value: data?.counts.returnsOverdue,
              icon: TriangleAlert,
              note: "Retornos com prazo ultrapassado, inclusive de outros dias.",
            },
            {
              key: "appointments_today",
              label: "Consultas hoje",
              value: data?.counts.appointmentsToday,
              icon: CalendarDays,
              note: "Consultas elegíveis na agenda local vinculada ao contato.",
            },
          ] as const
        ).map(({ key, label, value, icon: Icon, note }) => (
          <button
            key={key}
            type="button"
            aria-pressed={view === key}
            onClick={() => pick(key)}
            className={`surface-card p-5 text-left transition-colors motion-reduce:transition-none hover:border-primary/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${view === key ? "border-primary/60 bg-primary/5" : ""}`}
          >
            <div className="flex items-center justify-between">
              <Icon className="size-4 text-primary" />
              <ArrowUpRight className="size-4 text-muted-foreground" />
            </div>
            <h3 className="mt-3 text-sm font-medium">{label}</h3>
            <p className="mt-2 text-3xl font-semibold tabular-nums">{value ?? "—"}</p>
            <p className="mt-2 text-xs text-muted-foreground">{note}</p>
          </button>
        ))}
      </div>
      <section className="surface-card overflow-hidden" aria-label="Fila administrativa">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h3 className="font-semibold">Próximas ações</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {ownership} · por prazo, do mais antigo ao mais recente
            </p>
          </div>
          <Button
            size="sm"
            variant={view === "all" ? "secondary" : "outline"}
            onClick={() => pick("all")}
          >
            Ver todos os itens
          </Button>
        </div>
        {query.isPending ? (
          <p role="status" className="p-5 text-sm">
            A consultar retornos e agenda…
          </p>
        ) : query.isError || failure ? (
          <div role="alert" className="space-y-2 p-5">
            <p className="font-medium">
              {failure?.code === "migration_required"
                ? "Atualização do banco pendente"
                : failure?.code === "forbidden"
                  ? "Acesso indisponível"
                  : "Meu dia indisponível"}
            </p>
            <p className="text-sm text-muted-foreground">
              {failure?.message ??
                "Não foi possível consultar os dados. Isso não significa ausência de pendências."}
            </p>
            <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
              Tentar novamente
            </Button>
          </div>
        ) : data ? (
          <>
            {data.rows.length ? (
              <ul className="divide-y divide-border">
                {data.rows.map((row) => (
                  <li
                    key={row.id}
                    className="flex flex-wrap items-start justify-between gap-3 px-5 py-4"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{row.contact.name}</p>
                        <Badge
                          variant={row.reason === "return_overdue" ? "destructive" : "outline"}
                        >
                          {row.reason === "return_overdue"
                            ? "Retorno vencido"
                            : row.reason === "return_today"
                              ? "Retorno hoje"
                              : "Consulta hoje"}
                        </Badge>
                      </div>
                      <p className="mt-1 break-words text-sm">
                        {row.kind === "return"
                          ? row.nextAction
                          : row.appointment?.title || "Consulta"}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatarDataHora(row.dueAt, data.timezone)} ·{" "}
                        {row.owner?.name ?? "Sem responsável"}
                        {row.appointment ? ` · Estado na agenda: ${row.appointment.status}` : ""}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Fonte:{" "}
                        {row.evidence.source === "ghl_cache"
                          ? "agenda importada do GHL"
                          : "registro no Jornada"}{" "}
                        · atualizado {formatarDataHora(row.evidence.updatedAt, data.timezone)}
                      </p>
                    </div>
                    <Button variant="outline" size="sm" asChild>
                      <Link to="/caixa-de-entrada" search={{ contact: row.contact.ghlContactId }}>
                        Abrir atendimento <ArrowUpRight className="size-4" />
                      </Link>
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="space-y-3 p-5 text-sm text-muted-foreground">
                <p>
                  {ownerFilter === "mine"
                    ? "Nenhum item atribuído a você neste filtro."
                    : "Nenhum item encontrado neste filtro."}{" "}
                  Isso não comprova ausência de mensagens por responder.
                </p>
                {ownerFilter === "mine" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setOwnerFilter("unassigned");
                      setPage(0);
                    }}
                  >
                    Ver sem responsável
                  </Button>
                )}
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3">
              <p className="text-xs text-muted-foreground">
                Página {data.page.index + 1} · {data.page.totalItems} itens neste filtro
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page === 0 || query.isFetching}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  Anterior
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!data.page.hasMore || query.isFetching}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Próxima página
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </section>
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">Fontes e limites deste painel</summary>
        <p className="mt-2">
          Atualização a cada minuto enquanto a página está visível. Retornos internos e agenda da
          base local de contatos vinculados ao GHL. Os cartões podem compartilhar itens; não some as
          contagens. Esta fila não altera oportunidades, agenda, mensagens ou automações.
        </p>
        {data && (
          <>
            <p className="mt-1">
              Consultado: {formatarDataHora(data.checkedAt, data.timezone)} · Dia: {data.day.date} ·{" "}
              {data.timezone}
            </p>
            <p>
              Última sincronização de contatos:{" "}
              {data.source.lastContactSyncAt
                ? formatarDataHora(data.source.lastContactSyncAt, data.timezone)
                : "não disponível"}
              . Não representa atualização da agenda. A ordem pode mudar ao atualizar ou trocar de
              página.
            </p>
          </>
        )}
      </details>
    </section>
  );
}
