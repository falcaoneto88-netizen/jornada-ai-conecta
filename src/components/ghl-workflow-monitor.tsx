import { ExternalLink, LoaderCircle, RefreshCw } from "lucide-react";
import { useId, useState } from "react";
import { formatarDataHora } from "@/lib/clinic-time";
import type { WorkflowMonitoringResult } from "@/lib/ghl-workflow-monitoring.core";
import { useWorkflowMonitoring, WorkflowMonitoringReadError } from "@/lib/ghl-workflow-monitoring";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

type AvailablePage = Extract<WorkflowMonitoringResult, { state: "available" }>;

const failures: Record<string, { title: string; detail: string }> = {
  beta_unavailable: {
    title: "Aguardando liberação do GHL",
    detail:
      "Solicite ao suporte do GHL a habilitação da Workflows API para esta subconta. Após a liberação, confirme as permissões workflows.readonly e workflows.logs da integração.",
  },
  forbidden: {
    title: "Leitura recusada pelo GHL",
    detail:
      "O GHL recusou esta leitura. O administrador deve conferir as permissões da integração e a subconta autorizada.",
  },
  unauthorized: {
    title: "Autenticação não aceita pela nova API",
    detail:
      "A nova API do GHL recusou esta consulta. Isso não invalida o catálogo ou a conexão existentes. O administrador deve verificar a liberação da API e suas permissões antes de alterar credenciais.",
  },
  missing_secrets: {
    title: "Conexão GHL incompleta",
    detail: "O administrador deve conferir a configuração da conexão em Integrações.",
  },
  contract_error: {
    title: "Resposta do GHL incompatível",
    detail:
      "Os registros não puderam ser interpretados com segurança. Consulte os detalhes diretamente no GHL e encaminhe a falha para revisão técnica.",
  },
  temporary_error: {
    title: "Consulta temporariamente indisponível",
    detail: "Não foi possível concluir a leitura. Tente novamente ou consulte os registros no GHL.",
  },
};

function MonitoringFailure({ state, partial = false }: { state: string; partial?: boolean }) {
  const failure = failures[state] ?? failures["temporary_error"]!;
  return (
    <div
      role="alert"
      className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4"
    >
      <p className="font-medium">{failure.title}</p>
      <p className="text-sm text-muted-foreground">{failure.detail}</p>
      <p className="text-sm">
        {partial
          ? "A consulta está incompleta. Os registros já carregados continuam abaixo."
          : "Esta falha não comprova ausência de execuções."}
      </p>
    </div>
  );
}

export function GhlWorkflowMonitor({
  workflowId,
  workflowUrl,
  timezone,
}: {
  workflowId: string;
  workflowUrl: string;
  timezone: string;
}) {
  const [days, setDays] = useState<7 | 30>(7);
  const periodId = useId();
  const result = useWorkflowMonitoring(workflowId, days);
  const pages = result.data?.pages ?? [];
  const first = pages[0];
  const available = pages.filter((page): page is AvailablePage => page.state === "available");
  const evidence = available[0];
  // Keep the provider's order, while protecting against repeated cursor boundaries.
  const logs = [
    ...new Map(available.flatMap((page) => page.logs).map((log) => [log.id, log])).values(),
  ];
  const errorState =
    first && first.state !== "available"
      ? first.state
      : result.isError
        ? result.error instanceof WorkflowMonitoringReadError
          ? result.error.state
          : "temporary_error"
        : null;

  if (!result.allowed) {
    return (
      <p role="alert">
        A consulta de execuções está disponível para administradores e gestores com sessão iniciada.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label htmlFor={periodId} className="block text-sm font-medium">
            Período dos registros
          </label>
          <select
            id={periodId}
            value={days}
            onChange={(event) => setDays(event.target.value === "30" ? 30 : 7)}
            className="h-9 rounded-md border bg-background px-3 text-sm"
          >
            <option value="7">Últimos 7 dias</option>
            <option value="30">Últimos 30 dias</option>
          </select>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={result.isFetching}
          onClick={() => void result.refetch()}
        >
          <RefreshCw className="size-4" aria-hidden="true" />
          {errorState && !evidence ? "Tentar novamente" : "Atualizar registros"}
        </Button>
        <Button variant="outline" size="sm" asChild>
          <a href={workflowUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="size-4" aria-hidden="true" /> Abrir registros no GHL
          </a>
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        Horários da clínica: {timezone}. Cada linha representa um registro de execução, não uma
        pessoa. Uma ação executada ou um workflow publicado não comprova entrega de mensagem.
      </p>

      {result.isPending && (
        <p role="status" className="flex items-center gap-2">
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> A consultar os
          registros no GHL…
        </p>
      )}
      {errorState && <MonitoringFailure state={errorState} partial={Boolean(evidence)} />}

      {evidence && (
        <>
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>Fonte: GHL · Consulta: {formatarDataHora(evidence.checkedAt, timezone)}</p>
            <p>
              Janela: {formatarDataHora(evidence.period.startDate, timezone)} até{" "}
              {formatarDataHora(evidence.period.endDate, timezone)}
            </p>
          </div>
          {evidence.statistics?.state === "available" ? (
            <section
              aria-label="Registros por estado no período"
              className="space-y-2 rounded-lg border p-3"
            >
              <p className="text-sm font-medium">
                Registros no período, segundo o GHL: {evidence.statistics.records}
              </p>
              <div className="flex flex-wrap gap-2">
                {evidence.statistics.byStatus.map((item) => (
                  <Badge key={item.status} variant="outline">
                    {item.status}: {item.count}
                  </Badge>
                ))}
              </div>
            </section>
          ) : (
            <p className="text-sm text-muted-foreground">
              Resumo por estado indisponível. Os registros consultados continuam disponíveis abaixo.
            </p>
          )}
          {logs.length > 0 ? (
            <ol aria-label="Registros de execução" className="space-y-3">
              {logs.map((log) => (
                <li key={log.id} className="space-y-2 rounded-lg border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 break-words font-medium">
                      {log.stepName ?? "Etapa não informada"}
                    </span>
                    <Badge variant="outline">{log.status}</Badge>
                  </div>
                  <p className="text-sm">{formatarDataHora(log.createdAt, timezone)}</p>
                  <dl className="grid gap-1 text-xs text-muted-foreground">
                    <div className="break-all">
                      <dt className="inline">Contato GHL: </dt>
                      <dd className="inline">{log.contactId ?? "não informado"}</dd>
                    </div>
                    <div className="break-all">
                      <dt className="inline">Registro: </dt>
                      <dd className="inline">{log.id}</dd>
                    </div>
                    {log.executionId && (
                      <div className="break-all">
                        <dt className="inline">Execução: </dt>
                        <dd className="inline">{log.executionId}</dd>
                      </div>
                    )}
                  </dl>
                  <Button variant="link" size="sm" className="h-auto px-0" asChild>
                    <a href={log.url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="size-4" aria-hidden="true" /> Abrir esta execução no
                      GHL
                    </a>
                  </Button>
                </li>
              ))}
            </ol>
          ) : !result.hasNextPage && !errorState ? (
            <p className="rounded-lg border p-4">
              O GHL não devolveu registros de execução para este workflow no período consultado.
            </p>
          ) : (
            <p className="text-sm">
              Nenhum registro nesta página. A consulta ainda não está completa.
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
            <p className="text-xs text-muted-foreground">
              {logs.length} registros carregados ·{" "}
              {result.hasNextPage || errorState
                ? "Consulta parcial"
                : "Fim da paginação informada pelo GHL"}
            </p>
            {result.hasNextPage && (
              <Button
                variant="outline"
                size="sm"
                disabled={result.isFetching}
                onClick={() => void result.fetchNextPage()}
              >
                {result.isFetchingNextPage
                  ? "A carregar…"
                  : result.isFetchNextPageError
                    ? "Tentar próxima página novamente"
                    : "Carregar mais registros"}
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
