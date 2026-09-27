import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ShieldAlert, Tags } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { classificarPedido } from "@/lib/jev-pedidos.functions";
import { ROTULO_ACAO, ROTULO_CATEGORIA, type Classificacao } from "@/lib/jev-pedidos.core";
import { previsualizarModelo } from "@/lib/message-library.core";

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** Classificação manual do pedido do paciente. Apenas sugestão; nada é enviado nem gravado no GHL. */
export function JevPedido({
  texto,
  nome,
  usarRascunho,
}: {
  texto: string;
  nome: string;
  usarRascunho: (t: string) => void;
}) {
  const classificar = useServerFn(classificarPedido);
  const [pendente, setPendente] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [res, setRes] = useState<{ c: Classificacao; para: string } | null>(null);

  async function executar() {
    setPendente(true);
    setErro(null);
    try {
      const r = await classificar({ data: { texto } });
      if (r.ok) setRes({ c: r.classificacao, para: texto });
      else setErro(r.message);
    } catch {
      setErro("Não foi possível classificar o pedido.");
    } finally {
      setPendente(false);
    }
  }

  const c = res?.c;
  const rascunho = c?.modelo_sugerido
    ? previsualizarModelo(c.modelo_sugerido.body, {
        "contact.name": nome,
        "contact.first_name": nome.split(" ")[0],
      }).texto
    : null;

  return (
    <div className="surface-card space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold">Classificação do pedido (Jev)</h3>
        <Button size="sm" variant="outline" disabled={pendente || !texto} onClick={() => void executar()}>
          <Tags className="size-4" /> {pendente ? "A classificar…" : "Classificar"}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Classifica as últimas mensagens recebidas do paciente e sugere a próxima ação. Não altera o
        contacto, a oportunidade nem o funil no GoHighLevel.
      </p>
      {!texto && <p className="text-sm text-muted-foreground">Não há mensagens recebidas com texto.</p>}
      {erro && (
        <p role="alert" className="text-sm text-destructive">
          {erro}
        </p>
      )}
      {c && (
        <div className="space-y-3">
          {res.para !== texto && (
            <p className="text-sm text-destructive">Chegaram novas mensagens. Classifique novamente.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">
              {ROTULO_CATEGORIA[c.categoria]} · {pct(c.confianca_categoria)}
            </Badge>
            <Badge variant={c.revisao_humana ? "destructive" : "outline"}>
              Ação: {ROTULO_ACAO[c.acao]}
            </Badge>
          </div>
          {c.revisao_humana && (
            <p className="flex items-start gap-2 rounded-lg border border-primary/40 bg-primary/10 p-3 text-sm">
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              Possível sintoma ou urgência: encaminhe a um profissional de saúde antes de responder.
              Não é sugerido rascunho automático.
            </p>
          )}
          {c.modelo_sugerido && rascunho && (
            <article className="rounded-xl border border-border p-3">
              <p className="text-xs text-muted-foreground">
                Rascunho da biblioteca: {c.modelo_sugerido.name}
              </p>
              <p className="my-2 whitespace-pre-wrap text-sm">{rascunho}</p>
              <Button size="sm" variant="outline" onClick={() => usarRascunho(rascunho)}>
                Usar rascunho
              </Button>
            </article>
          )}
          {!c.revisao_humana && !c.modelo_sugerido && (
            <p className="text-sm text-muted-foreground">Nenhuma mensagem da biblioteca se adequa.</p>
          )}
        </div>
      )}
    </div>
  );
}
