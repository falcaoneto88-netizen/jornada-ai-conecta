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

  async function flag(scope: "remote_write" | "welcome_channel", enabled: boolean) {
    setPending(true);
    try {
      const r = await definirFlag({ data: { confirm: true, scope, enabled } });
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
      await queryClient.invalidateQueries({ queryKey: ["integracao-experiencia-falcao"] });
    } catch {
      toast.error("Não foi possível falar com o servidor. Tente novamente.");
    } finally {
      setPending(false);
    }
  }

  const podeHabilitarEscrita = data?.escritaGlobalAtiva === true && data.configurada;

  return (
    <section className="surface-card space-y-4 p-6" aria-labelledby="falcao-site-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="falcao-site-title" className="text-lg font-semibold">
            Experiência Falcão (site)
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Recebe pedidos de contacto consentidos do site e cria o lead na etapa Novo Lead. A
            escrita no GoHighLevel e o acolhimento têm interruptores próprios, desligados por
            omissão.
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
              <dt className="text-muted-foreground">Escrita da conta no GoHighLevel</dt>
              <dd className="font-medium">
                {data.escritaGlobalAtiva === null
                  ? "Indisponível"
                  : data.escritaGlobalAtiva
                    ? "Ativa"
                    : "Desativada"}
              </dd>
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

          <div className="space-y-2 rounded-md border p-4">
            <p className="text-sm font-medium">1. Recebimento de pedidos do site</p>
            <p className="text-sm text-muted-foreground">
              Guarda o pedido consentido nesta conta. Com o recebimento ligado, cada pedido novo é
              processado logo a seguir ao registo, conforme os dois interruptores abaixo.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button disabled={pending || !data.segredoPresente} onClick={() => void guardar(true)}>
                {pending ? "A guardar…" : "Ligar recebimento"}
              </Button>
              <Button variant="outline" disabled={pending} onClick={() => void guardar(false)}>
                Desligar recebimento
              </Button>
            </div>
          </div>

          <div className="space-y-2 rounded-md border p-4">
            <p className="text-sm font-medium">2. Escrita no GoHighLevel (contacto e oportunidade)</p>
            <p className="text-sm text-muted-foreground">
              Ao ligar, os pedidos novos passam a criar contacto e oportunidade no funil fixo desta
              conta, uma única vez por pessoa. Só é possível ligar com o destino confirmado e a
              escrita da conta ativa. Desligar não repõe nem repete nada do que já ficou em curso.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={pending || !podeHabilitarEscrita || data.escritaGhl === "habilitado"}
                onClick={() => void flag("remote_write", true)}
              >
                Ligar escrita
              </Button>
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => void flag("remote_write", false)}
              >
                Desligar escrita
              </Button>
              {data.escritaGhl === "habilitado" && (
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() => {
                    executar(() => processar({ data: undefined }));
                  }}
                >
                  Processar pedidos anteriores
                </Button>
              )}
            </div>
          </div>

          <div className="space-y-2 rounded-md border p-4">
            <p className="text-sm font-medium">3. Acolhimento por mensagem</p>
            <p className="text-sm text-muted-foreground">
              Canal: mensagem do tipo SMS na conta do GoHighLevel, encaminhada pelo provedor
              predefinido desta location (ZaptosWPP V2 — WhatsApp like SMS). Sem credencial nova. Ao
              ligar, os pedidos novos com contacto confirmado recebem a mensagem uma única vez.
              Depende da escrita no GoHighLevel estar ligada. A aceitação pela API não é entrega: só
              há entrega com recibo do provedor.
            </p>
            <p className="rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">
              {data.acolhimento}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={
                  pending ||
                  !podeHabilitarEscrita ||
                  data.escritaGhl !== "habilitado" ||
                  data.canalAcolhimento === "configurado"
                }
                onClick={() => void flag("welcome_channel", true)}
              >
                Ligar acolhimento
              </Button>
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => void flag("welcome_channel", false)}
              >
                Desligar acolhimento
              </Button>
              {data.canalAcolhimento === "configurado" && (
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() => {
                    executar(() => acolher({ data: undefined }));
                  }}
                >
                  Acolher pedidos anteriores
                </Button>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

