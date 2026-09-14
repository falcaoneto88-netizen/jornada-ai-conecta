import { ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { useWorkflowsGhl } from "@/lib/ghl-observation";
import { useOrganizacao } from "@/lib/organization";
import { formatarDataHora } from "@/lib/clinic-time";
import { ErroLeitura } from "./ghl-inbox";

export function GhlWorkflows() {
  const result = useWorkflowsGhl();
  const contexto = useOrganizacao();
  const fuso = contexto.data?.organizacao.timezone;
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
          Passo atual, esperas, timeout e motivos de Skipped ainda não são recebidos pelo app. Use
          “Ver execução no GHL” para conferir esses registros. O estado publicado não comprova que
          uma mensagem foi entregue.
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
              <Button variant="outline" size="sm" asChild>
                <a href={w.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="size-4" /> Ver execução no GHL
                </a>
              </Button>
            </article>
          ))}
          {result.data?.workflows.length === 0 && (
            <p className="surface-card p-6">O GHL não devolveu workflows para esta subconta.</p>
          )}
        </div>
      )}
    </div>
  );
}
