import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { verificarCatalogoMcp } from "@/lib/integration-diagnostics.functions";
import type { MotivoCatalogo } from "@/lib/integration-diagnostics.core";

type Resultado = {
  ok: boolean;
  status: number;
  reason: MotivoCatalogo;
  tools: string[];
  checked_at: string;
};

const MENSAGENS: Record<MotivoCatalogo, string> = {
  ok: "Catálogo lido no servidor publicado.",
  sem_sessao: "Sessão não disponível nesta verificação. O catálogo continua não verificado.",
  sem_permissao: "Esta verificação é reservada ao administrador da organização.",
  oauth_client_required:
    "O servidor exigiu autorização OAuth própria do cliente MCP: a sessão do app não substitui essa autorização. O catálogo continua não verificado e a autenticação MCP não foi alterada.",
  unauthorized:
    "O servidor recusou a credencial (HTTP 401), sem indicar exigência de cliente OAuth. O catálogo continua não verificado.",
  http_error: "O servidor respondeu com erro. O catálogo continua não verificado.",
  resposta_invalida: "A resposta não corresponde ao formato esperado. Catálogo não verificado.",
  indisponivel: "Não foi possível falar com o servidor publicado. Catálogo não verificado.",
};

export function McpDiagnostics({ allowed }: { allowed: boolean }) {
  const verificar = useServerFn(verificarCatalogoMcp);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Resultado | null>(null);
  if (!allowed) return null;
  async function conferir() {
    setPending(true);
    try {
      setResult((await verificar()) as Resultado);
    } catch {
      setResult({
        ok: false,
        status: 503,
        reason: "indisponivel",
        tools: [],
        checked_at: new Date().toISOString(),
      });
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="surface-card space-y-3 p-6" aria-label="Diagnóstico MCP">
      <h2 className="text-lg font-semibold">Catálogo MCP publicado</h2>
      <p className="text-sm text-muted-foreground">
        Consulta o servidor publicado com a sua sessão, sem executar ferramentas. O catálogo
        disponível no Codex depende também da atualização do conector.
      </p>
      <p className="text-sm text-muted-foreground">
        Limitação conhecida: o servidor MCP exige autorização OAuth do próprio cliente. A sessão
        deste app não a substitui, por isso esta consulta pode terminar sem verificar o catálogo.
        Isso não altera nem enfraquece a autenticação MCP.
      </p>
      <Button variant="outline" disabled={pending} onClick={() => void conferir()}>
        {pending ? "A verificar…" : "Verificar catálogo MCP"}
      </Button>
      {result && (
        <div role="status" className="text-sm space-y-2">
          <p>
            {result.ok
              ? `${result.tools.length} ferramentas disponíveis no servidor.`
              : `${MENSAGENS[result.reason]} (HTTP ${result.status}). Isso não comprova ausência de ferramentas.`}
          </p>
          {result.ok && (
            <ul>
              {result.tools.map((name) => (
                <li key={name} className="font-mono text-xs">
                  {name}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">Verificado em {result.checked_at}</p>
        </div>
      )}
    </section>
  );
}
