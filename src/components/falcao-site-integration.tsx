import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { enviarAcolhimentoFalcao, processarLeadsFalcao } from "@/lib/falcao-remote.functions";
import { configurarIntegracaoFalcao, estadoIntegracaoFalcao } from "@/lib/falcao-site.functions";

export function FalcaoSiteIntegration({ allowed }: { allowed: boolean }) {
  const ler = useServerFn(estadoIntegracaoFalcao);
  const configurar = useServerFn(configurarIntegracaoFalcao);
  const processar = useServerFn(processarLeadsFalcao);
  const acolher = useServerFn(enviarAcolhimentoFalcao);

  function executar(accao: () => Promise<{ ok: boolean; message: string }>) {
    setPending(true);
    void accao()
      .then((r) => (r.ok ? toast.success(r.message) : toast.error(r.message)))
      .catch(() => toast.error("Não foi possível executar agora."))
      .finally(() => {
        setPending(false);
        void queryClient.invalidateQueries({ queryKey: ["integracao-experiencia-falcao"] });
      });
  }
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);

  const { data } = useQuery({
    queryKey: ["integracao-experiencia-falcao"],
    enabled: allowed,
    queryFn: () => ler({ data: undefined }),
  });

  async function guardar(enabled: boolean) {
    setPending(true);
    try {
      const r = await configurar({ data: { confirm: true, enabled } });
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
      await queryClient.invalidateQueries({ queryKey: ["integracao-experiencia-falcao"] });
    } catch {
      toast.error("Não foi possível falar com o servidor. Tente novamente.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="surface-card space-y-4 p-6" aria-labelledby="falcao-site-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="falcao-site-title" className="text-lg font-semibold">
            Experiência Falcão (site)
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Recebe pedidos de contacto consentidos do site e cria o lead na etapa Novo Lead. Não
            envia mensagens nem escreve no GoHighLevel.
          </p>
        </div>
        <Badge variant={data?.ativa ? "default" : "outline"}>
          {data?.ativa ? "Ligada" : "Desligada"}
        </Badge>
      </div>

      {!allowed && <p className="text-sm">Acesso restrito aos administradores da conta real.</p>}

      {allowed && data && (
        <>
          <dl className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Origem aceite</dt>
              <dd className="font-medium">{data.source}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Etapa local</dt>
              <dd className="font-medium">{data.etapaLocal}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Segredo do site</dt>
              <dd className="font-medium">
                {data.segredoPresente ? "Registado no servidor" : "Em falta"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Escrita no GoHighLevel</dt>
              <dd className="font-medium">{data.escritaGhl}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Canal do acolhimento</dt>
              <dd className="font-medium">{data.canalAcolhimento}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Pedidos recebidos</dt>
              <dd className="font-medium">{data.leads.total ?? "Indisponível"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Em revisão</dt>
              <dd className="font-medium">{data.leads.emRevisao ?? "Indisponível"}</dd>
            </div>
          </dl>

          <div>
            <p className="text-sm font-medium">Por resolver</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {data.pendencias.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-sm font-medium">
              Mensagem de acolhimento (envio manual, desligado por omissão)
            </p>
            <p className="mt-1 rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">
              {data.acolhimento}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button disabled={pending || !data.segredoPresente} onClick={() => void guardar(true)}>
              {pending ? "A guardar…" : "Ligar recebimento"}
            </Button>
            <Button variant="outline" disabled={pending} onClick={() => void guardar(false)}>
              Desligar
            </Button>
            {data.escritaGhl === "habilitado" && (
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => {
                  executar(() => processar({ data: undefined }));
                }}
              >
                Processar leads no GoHighLevel
              </Button>
            )}
            {data.canalAcolhimento === "configurado" && (
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => {
                  executar(() => acolher({ data: undefined }));
                }}
              >
                Enviar acolhimento pendente
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
