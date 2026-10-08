import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { N8nPilotControl } from "@/components/n8n-pilot-control";
import { ChaveN8nSetup } from "@/components/n8n-bridge-key";
import { estadoPonteN8n, guardarPonteN8n } from "@/lib/n8n-bridge.functions";

type Canal = "" | "sms" | "whatsapp_zaptos";

function Linha({ rotulo, ok, texto }: { rotulo: string; ok: boolean; texto: string }) {
  return (
    <li className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{rotulo}</span>
      <Badge variant={ok ? "default" : "outline"}>{texto}</Badge>
    </li>
  );
}

/** Cartão compacto, só para administradores. Não expõe segredos nem dados de pacientes. */
export function N8nBridgeCard({ allowed }: { allowed: boolean }) {
  const ler = useServerFn(estadoPonteN8n);
  const guardar = useServerFn(guardarPonteN8n);
  const qc = useQueryClient();
  const { data, isError, isFetching, refetch } = useQuery({
    queryKey: ["n8n-bridge"],
    enabled: allowed,
    queryFn: () => ler(),
  });
  const [cal, setCal] = useState("");
  const [canal, setCanal] = useState<Canal>("");
  const [morada, setMorada] = useState("");
  const [reserva, setReserva] = useState("");
  const [provedor, setProvedor] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!data?.autorizado) return;
    setCal(data.calendarId ?? "");
    setCanal(data.channel ?? "");
    setMorada(data.clinicAddress);
    setReserva(data.fallbackUserId ?? "");
    setProvedor(data.zaptosProviderId ?? "");
  }, [data]);

  if (!allowed || (data && !data.autorizado)) return null;
  if (isError)
    return (
      <div className="surface-card space-y-3 p-6">
        <p className="font-medium">n8n — Confirmação de consultas</p>
        <p role="alert" className="text-sm text-destructive">
          Não foi possível verificar o estado da ponte e do piloto. Atualize a leitura antes de
          configurar.
        </p>
        <Button size="sm" disabled={isFetching} onClick={() => void refetch()}>
          Atualizar estado
        </Button>
      </div>
    );

  async function gravar() {
    setPending(true);
    try {
      const r = await guardar({
        data: {
          calendarId: cal.trim() || null,
          channel: canal || null,
          clinicAddress: morada,
          fallbackUserId: reserva.trim() || null,
          zaptosProviderId: provedor.trim() || null,
        },
      });
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
    } catch {
      toast.error("Dados inválidos ou servidor indisponível.");
    } finally {
      setPending(false);
      await qc.invalidateQueries({ queryKey: ["n8n-bridge"] });
    }
  }

  return (
    <div className="surface-card space-y-4 p-6">
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium">n8n — Confirmação de consultas</p>
        <Badge variant="outline">{data?.bridgeEnabled ? "Ponte ligada" : "Ponte desligada"}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        O estado da ponte mostra a configuração disponível. A execução de ponta a ponta depende de
        um teste com o contato e o agendamento autorizados. Ativação é manual e feita no servidor.
      </p>
      {data && (
        <ChaveN8nSetup
          configurada={data.tokenPresente}
          podeCriar={data.podeCriarChave}
          schemaDisponivel={data.credentialSchemaAvailable}
        />
      )}
      {data && (
        <ul className="space-y-1.5">
          <Linha
            rotulo="Migração da ponte"
            ok={data.schemaDisponivel}
            texto={data.schemaDisponivel ? "Disponível" : "Pendente"}
          />
          <Linha
            rotulo="Vínculo GoHighLevel"
            ok={data.bindingOk}
            texto={data.bindingOk ? "Confirmado" : "Por confirmar"}
          />
          <Linha
            rotulo="Escrita GoHighLevel"
            ok={data.writeEnabled}
            texto={data.writeEnabled ? "Habilitada" : "Desativada"}
          />
          <Linha
            rotulo="Modo"
            ok={!data.simulation}
            texto={data.simulation ? "Simulação" : "Real"}
          />
          <Linha
            rotulo="Envio real"
            ok={data.liveSendEnabled}
            texto={data.liveSendEnabled ? "Ligado" : "Desligado"}
          />
          <Linha
            rotulo="Agenda"
            ok={!!data.calendarId}
            texto={data.calendarId ? "Definida" : "Por definir"}
          />
          <Linha rotulo="Canal" ok={!!data.channel} texto={data.channel ?? "Por definir"} />
          <Linha
            rotulo="Morada"
            ok={data.clinicAddress.trim() !== ""}
            texto={data.clinicAddress.trim() ? "Definida" : "Vazia"}
          />
          <Linha
            rotulo="Vendedor de reserva"
            ok={!!data.fallbackUserId}
            texto={data.fallbackUserId ? "Definido" : "Nenhum"}
          />
        </ul>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="n8n-cal">ID da agenda GHL</Label>
          <Input
            id="n8n-cal"
            value={cal}
            onChange={(e) => setCal(e.target.value)}
            placeholder="ID da agenda"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="n8n-canal">Canal</Label>
          <select
            id="n8n-canal"
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            value={canal}
            onChange={(e) => setCanal(e.target.value as Canal)}
          >
            <option value="">Por definir</option>
            <option value="sms">SMS de operadora (indisponível na v1)</option>
            <option value="whatsapp_zaptos">WhatsApp (ZaptosWPP, via tipo SMS)</option>
          </select>
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="n8n-morada">Morada verificada da clínica</Label>
          <Input
            id="n8n-morada"
            value={morada}
            maxLength={240}
            onChange={(e) => setMorada(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="n8n-reserva">ID do vendedor de reserva (opcional)</Label>
          <Input id="n8n-reserva" value={reserva} onChange={(e) => setReserva(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="n8n-provedor">ID do provedor ZaptosWPP (não secreto)</Label>
          <Input id="n8n-provedor" value={provedor} onChange={(e) => setProvedor(e.target.value)} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Guardar não altera o estado de ativação. Mudar canal ou provedor anula a verificação do
        canal, que só é feita na implantação administrativa. Nenhum canal está escolhido por
        omissão. O estado “aceite” da API não comprova entrega.
      </p>
      <Button onClick={gravar} disabled={pending} size="sm">
        {pending ? "A guardar…" : "Guardar configuração"}
      </Button>
      {data && (
        <N8nPilotControl
          state={data}
          refreshing={isFetching}
          refresh={async () => {
            await qc.invalidateQueries({ queryKey: ["n8n-bridge"] });
          }}
        />
      )}
    </div>
  );
}
