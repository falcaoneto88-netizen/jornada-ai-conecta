import { ExternalLink, ListChecks, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { useWorkflowsGhl } from "@/lib/ghl-observation";
import { useOrganizacao } from "@/lib/organization";
import { formatarDataHora } from "@/lib/clinic-time";
import { ErroLeitura } from "./ghl-inbox";
import { usePermissoes } from "@/lib/repo";
import { GhlWorkflowMonitor } from "./ghl-workflow-monitor";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";

export function GhlWorkflows() {
  const result = useWorkflowsGhl();
  const contexto = useOrganizacao();
  const permissoes = usePermissoes();
  const [selected, setSelected] = useState<{
    id: string;
    nome: string;
    url: string;
    organizationId: string;
  } | null>(null);
  const fuso = contexto.data?.organizacao.timezone;
  const monitor =
    selected?.organizationId === contexto.data?.organizacao.id && permissoes.gerirJornada
      ? selected
      : null;
  if (contexto.isError) return <p role="alert">Não foi possível identificar a clínica.</p>;
  return (
    <div className="space-y-4">
      <section className="surface-card space-y-3 p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">Workflows reais do GHL</h2>
          <Button
            variant="outline"
            size="sm"
            disabled={result.isFetching || !fuso}
            onClick={() => void result.refetch()}
          >
            <RefreshCw className="size-4" /> Atualizar catálogo
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          O GoHighLevel executa os workflows. Este catálogo consulta o nome, a versão e o estado que
          a API informa para a subconta da clínica.
        </p>
        <p className="text-sm text-muted-foreground">
          Administradores e gestores podem consultar os registros de execução quando a nova API
          estiver habilitada pelo GHL. O catálogo continua disponível independentemente dessa
          liberação. O estado publicado não comprova que uma mensagem foi entregue.
        </p>
        {result.data && !result.isError && fuso && (
          <p className="text-xs text-muted-foreground">
            Consulta: {formatarDataHora(result.data.consultadoEm, fuso)} ·{" "}
            {result.data.workflows.length} workflows
          </p>
        )}
      </section>
      {result.isError ? (
        <ErroLeitura erro={result.error} repetir={() => void result.refetch()} />
      ) : !fuso || result.isPending ? (
        <p>A consultar os workflows…</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {result.data?.workflows.map((w) => (
            <article key={w.id} className="surface-card space-y-3 p-5">
              <h3 className="font-semibold">{w.nome}</h3>
              <Badge variant={w.estado === "published" ? "default" : "outline"}>
                GHL:{" "}
                {w.estado === "published"
                  ? "Publicado"
                  : w.estado === "draft"
                    ? "Rascunho"
                    : w.estado}
              </Badge>
              <p className="text-sm text-muted-foreground">
                Versão: {w.versao ?? "não informada"} · Atualizado:{" "}
                {w.atualizadoEm ? formatarDataHora(w.atualizadoEm, fuso) : "não informado"}
              </p>
              <p className="break-all text-xs text-muted-foreground">ID: {w.id}</p>
              <div className="flex flex-wrap gap-2">
                {permissoes.gerirJornada && contexto.data && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setSelected({ ...w, organizationId: contexto.data.organizacao.id })
                    }
                    aria-label={`Consultar execuções de ${w.nome}`}
                  >
                    <ListChecks className="size-4" aria-hidden="true" /> Consultar execuções
                  </Button>
                )}
                <Button variant="outline" size="sm" asChild>
                  <a href={w.url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="size-4" /> Ver execução no GHL
                  </a>
                </Button>
              </div>
            </article>
          ))}
          {result.data?.workflows.length === 0 && (
            <p className="surface-card p-6">O GHL não devolveu workflows para esta subconta.</p>
          )}
        </div>
      )}
      <Dialog
        open={Boolean(monitor)}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        {monitor && fuso && (
          <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-4xl">
            <DialogHeader>
              <DialogTitle className="break-words pr-6">Execuções — {monitor.nome}</DialogTitle>
              <DialogDescription>
                Consulta de registros do GHL. Nenhuma ação neste painel altera ou inicia workflows.
              </DialogDescription>
            </DialogHeader>
            <GhlWorkflowMonitor
              key={`${monitor.organizationId}:${monitor.id}`}
              workflowId={monitor.id}
              workflowUrl={monitor.url}
              timezone={fuso}
            />
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
