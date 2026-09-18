import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  estadoAdNavigator,
  gerarCodigoAdNavigator,
  revogarAcessoAdNavigator,
} from "@/lib/ad-navigator.functions";

function dataCurta(valor: string | null | undefined) {
  if (!valor) return "—";
  const d = new Date(valor);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

/** Cartão "Ad Navigator — indicadores": pareamento e revogação, sem segredos externos. */
export function AdNavigatorCard({ allowed }: { allowed: boolean }) {
  const ler = useServerFn(estadoAdNavigator);
  const gerar = useServerFn(gerarCodigoAdNavigator);
  const revogar = useServerFn(revogarAcessoAdNavigator);
  const queryClient = useQueryClient();
  const [codigo, setCodigo] = useState<string | null>(null);
  const [pendente, setPendente] = useState(false);

  const { data, isError } = useQuery({
    queryKey: ["ad-navigator"],
    enabled: allowed,
    queryFn: () => ler({ data: undefined }),
  });

  if (!allowed) return null;

  if (isError || (data && !data.autorizado)) {
    return (
      <div className="surface-card space-y-2 p-6">
        <p className="text-sm font-medium">Ad Navigator — indicadores</p>
        <p className="text-sm text-muted-foreground">
          Estado indisponível. Esta área é reservada ao administrador da organização com a ligação
          ao GoHighLevel validada.
        </p>
      </div>
    );
  }
  if (!data) return null;
  if (!data.leituraOk) {
    return (
      <div className="surface-card space-y-2 p-6">
        <p className="text-sm font-medium">Ad Navigator — indicadores</p>
        <p className="text-sm text-muted-foreground">
          Estado indisponível de momento. Não é possível gerar código sem confirmar o estado atual.
        </p>
      </div>
    );
  }

  const e = data.estado;
  const ativos = e.grants.filter((g) => !g.revoked_at);
  const podeGerar =
    e.binding_ok && e.connection_ok && Boolean(e.location_id) && Boolean(e.pipeline_id);

  async function gerarCodigo() {
    setPendente(true);
    try {
      const r = (await gerar({ data: { confirm: true } })) as
        { ok: true; code: string } | { ok: false; message: string };
      if (r.ok) {
        setCodigo(r.code);
        toast.success("Código gerado. Copie agora: não volta a ser mostrado.");
      } else {
        toast.error(r.message);
      }
    } catch {
      toast.error(
        "Não foi possível confirmar o resultado. Consulte o estado abaixo antes de repetir.",
      );
    } finally {
      setPendente(false);
      await queryClient.invalidateQueries({ queryKey: ["ad-navigator"] });
    }
  }

  async function revogarTudo() {
    setPendente(true);
    try {
      const r = (await revogar({ data: { confirm: true } })) as
        { ok: true } | { ok: false; message: string };
      if (r.ok) {
        setCodigo(null);
        toast.success("Acesso revogado.");
      } else {
        toast.error(r.message);
      }
    } catch {
      toast.error("Não foi possível confirmar a revogação. Consulte o estado abaixo.");
    } finally {
      setPendente(false);
      await queryClient.invalidateQueries({ queryKey: ["ad-navigator"] });
    }
  }

  return (
    <div className="surface-card space-y-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Ad Navigator — indicadores</p>
          <p className="text-sm text-muted-foreground">
            Partilha apenas o resumo agregado local desta clínica: contagens de oportunidades por
            estado e por etapa. Sem nomes, telefones, emails, conversas ou dados clínicos.
          </p>
        </div>
        <Badge variant={ativos.length > 0 ? "default" : "outline"}>
          {ativos.length > 0 ? "Ligado" : "Sem acesso ativo"}
        </Badge>
      </div>

      <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Clínica autorizada</dt>
          <dd className="font-medium">{e.organization_name ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Escopo</dt>
          <dd className="font-medium">Resumo agregado local, sem dados pessoais</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Conta do GoHighLevel</dt>
          <dd className="font-mono text-xs">{e.location_id ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Funil</dt>
          <dd className="font-mono text-xs">{e.pipeline_id ?? "—"}</dd>
        </div>
      </dl>

      {!podeGerar && (
        <p className="text-sm text-muted-foreground">
          Confirme primeiro a ligação ao GoHighLevel desta conta: sem vínculo validado não é
          possível gerar código.
        </p>
      )}

      {codigo && (
        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm font-medium">Código de uso único (válido 10 minutos)</p>
          <p className="break-all rounded bg-muted p-2 font-mono text-xs">{codigo}</p>
          <p className="text-xs text-muted-foreground">
            Cole no Ad Navigator já autenticado. É mostrado uma única vez e serve apenas uma troca.
            Não introduza aqui nenhuma credencial da Meta nem do GoHighLevel.
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button onClick={gerarCodigo} disabled={!podeGerar || pendente}>
          Gerar código de pareamento
        </Button>
        <Button variant="outline" onClick={revogarTudo} disabled={pendente}>
          Revogar acesso
        </Button>
      </div>

      <div className="space-y-1 text-sm">
        <p className="font-medium">Acessos concedidos</p>
        {e.grants.length === 0 ? (
          <p className="text-muted-foreground">Nenhum até agora.</p>
        ) : (
          <ul className="space-y-1 text-xs text-muted-foreground">
            {e.grants.map((g) => (
              <li key={g.grant_id} className="flex flex-wrap gap-x-3">
                <span className="font-mono">{g.grant_id.slice(0, 8)}…</span>
                <span>criado {dataCurta(g.created_at)}</span>
                <span>expira {dataCurta(g.expires_at)}</span>
                <span>leituras {g.use_count}</span>
                <span>{g.revoked_at ? "revogado" : "ativo"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Esta ponte é só de leitura agregada: não envia mensagens, não escreve no GoHighLevel, não
        toca em campanhas nem no Pixel e não altera a captação do site.
      </p>
    </div>
  );
}
