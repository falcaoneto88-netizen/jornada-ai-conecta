import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Tags } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { classificarPedido } from "@/lib/jev-pedidos.functions";
import { ROTULO_ACAO, ROTULO_CATEGORIA, type Classificacao } from "@/lib/jev-pedidos.core";

/** Classificação de uma única mensagem recebida. Só leitura: nada é gravado no GHL. */
export function JevMensagem({ texto }: { texto: string }) {
  const classificar = useServerFn(classificarPedido);
  const [pendente, setPendente] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [c, setC] = useState<Classificacao | null>(null);

  async function executar() {
    setPendente(true);
    setErro(null);
    try {
      const r = await classificar({ data: { texto: texto.slice(0, 4000) } });
      if (r.ok) setC(r.classificacao);
      else setErro(r.message);
    } catch {
      setErro("Não foi possível classificar.");
    } finally {
      setPendente(false);
    }
  }

  if (c)
    return (
      <div className="mt-3 flex flex-wrap gap-2">
        <Badge variant="secondary">
          {ROTULO_CATEGORIA[c.categoria]} · {Math.round(c.confianca_categoria * 100)}%
        </Badge>
        <Badge variant={c.revisao_humana ? "destructive" : "outline"}>Ação: {ROTULO_ACAO[c.acao]}</Badge>
      </div>
    );
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <Button size="sm" variant="ghost" disabled={pendente} onClick={() => void executar()}>
        <Tags className="size-3.5" /> {pendente ? "A classificar…" : "Classificar mensagem"}
      </Button>
      {erro && (
        <span role="alert" className="text-xs text-destructive">
          {erro}
        </span>
      )}
    </div>
  );
}
