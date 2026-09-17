import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { estadoMetaCapiFalcao, testarMetaCapiFalcao } from "@/lib/meta-capi.functions";

const ESTADO_CREDENCIAL: Record<string, string> = {
  presente: "Registada no servidor",
  ausente: "Em falta",
  malformada: "Registada com formato inutilizável",
};

const ESTADO_TENTATIVA: Record<string, string> = {
  in_progress: "Em curso",
  api_accepted: "Aceite pela API",
  rejected: "Recusada",
  uncertain: "Por confirmar",
};

/** Bloco do teste controlado da API de Conversões da Meta (evento sintético). */
export function FalcaoMetaCapi({ allowed }: { allowed: boolean }) {
  const ler = useServerFn(estadoMetaCapiFalcao);
  const testar = useServerFn(testarMetaCapiFalcao);
  const queryClient = useQueryClient();
  const [codigo, setCodigo] = useState("");
  const [pending, setPending] = useState(false);

  const { data, isError } = useQuery({
    queryKey: ["meta-capi-falcao"],
    enabled: allowed,
    queryFn: () => ler({ data: undefined }),
  });

  async function enviar() {
    setPending(true);
    try {
      const r = await testar({ data: { confirm: true, testEventCode: codigo.trim() } });
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
    } catch {
      toast.error(
        "Não foi possível confirmar o resultado no servidor. Não repita: consulte o estado abaixo e verifique no Gestor de Eventos da Meta.",
      );
    } finally {
      setPending(false);
      await queryClient.invalidateQueries({ queryKey: ["meta-capi-falcao"] });
    }
  }

  if (!allowed) return null;

  if (isError || (data && !data.autorizado)) {
    return (
      <div className="space-y-2 rounded-md border p-4">
        <p className="text-sm font-medium">4. Teste da API de Conversões da Meta</p>
        <p className="text-sm text-muted-foreground">
          Estado indisponível. Esta área é reservada ao administrador da organização com a
          integração Experiência Falcão ligada a esta conta do GoHighLevel.
        </p>
      </div>
    );
  }
  if (!data) return null;

  const t = data.ultimaTentativa;
  const codigoLimpo = codigo.trim();
  const codigoJaUsado = data.codigosUsados.includes(codigoLimpo);
  const podeTestar =
    data.leituraOk &&
    data.credencial === "presente" &&
    !codigoJaUsado &&
    /^TEST[0-9A-Z]{1,16}$/.test(codigoLimpo);

  return (
    <div className="space-y-3 rounded-md border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm font-medium">4. Teste da API de Conversões da Meta</p>
        <Badge variant={data.credencial === "presente" ? "default" : "outline"}>
          {data.credencial ? (ESTADO_CREDENCIAL[data.credencial] ?? "Desconhecida") : "Desconhecida"}
        </Badge>
      </div>

      <p className="text-sm text-muted-foreground">
        Envia um único evento de teste sintético (visita de página) para o conjunto de dados do site.
        Não representa lead nem venda, não usa dados de nenhuma pessoa e não toca nos contactos, nas
        oportunidades nem no acolhimento. A aceitação pela interface da Meta não prova que o evento
        aparece no Gestor de Eventos.
      </p>

      <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
        Aviso conforme a documentação da Meta: eventos enviados com código de teste não são
        necessariamente descartados e podem participar em mensuração e segmentação. Por isso só é
        permitido um único evento sintético de visita de página, sem qualquer pessoa associada.
      </p>

      <dl className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Conjunto de dados</dt>
          <dd className="font-medium">{data.datasetId}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Portfólio empresarial</dt>
          <dd className="font-medium">{data.businessId}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Conta de anúncios</dt>
          <dd className="font-medium">{data.adAccountId}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Origem do evento</dt>
          <dd className="font-medium break-all">{data.eventSourceUrl}</dd>
        </div>
      </dl>

      <div className="rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">
        {!data.leituraOk ? (
          "Estado indisponível: não foi possível ler o registo das tentativas. O botão de teste fica bloqueado até a leitura funcionar."
        ) : t ? (
          <>
            Última tentativa: {ESTADO_TENTATIVA[t.status] ?? t.status} · código {t.testEventCode} ·{" "}
            {new Date(t.criadoEm).toLocaleString("pt-PT")}
            {t.eventsReceived !== null ? ` · eventos recebidos: ${t.eventsReceived}` : ""}
            {t.fbtraceId ? ` · diagnóstico ${t.fbtraceId}` : ""}
            {t.diagnostic ? ` · ${t.diagnostic}` : ""}
            <br />
            Identificador do evento para conferir no Gestor de Eventos:{" "}
            <span className="font-mono break-all">{t.eventId}</span>
          </>
        ) : (
          "Ainda não houve nenhuma tentativa. Cada código de teste só pode ser usado uma vez."
        )}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="meta-test-code">Código de teste do Gestor de Eventos</Label>
          <Input
            id="meta-test-code"
            value={codigo}
            placeholder="TEST00000"
            onChange={(e) => setCodigo(e.target.value.toUpperCase())}
            className="w-48"
          />
        </div>
        <Button disabled={pending || !podeTestar} onClick={() => void enviar()}>
          {pending ? "A enviar…" : "Testar"}
        </Button>
      </div>
      {codigoJaUsado && (
        <p className="text-xs text-muted-foreground">
          Este código já foi usado nesta conta. Gere outro no Gestor de Eventos.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Sem repetição automática: se o resultado ficar por confirmar, nada é reenviado e o registo
        fica marcado para revisão.
      </p>
    </div>
  );
}
