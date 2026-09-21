import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { verificarCatalogoMcp } from "@/lib/integration-diagnostics.functions";

export function McpDiagnostics({ allowed }: { allowed: boolean }) {
  const verificar = useServerFn(verificarCatalogoMcp);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    status: number;
    tools: string[];
    checked_at: string;
  } | null>(null);
  if (!allowed) return null;
  async function conferir() {
    setPending(true);
    try {
      setResult(await verificar());
    } catch {
      setResult({ ok: false, status: 503, tools: [], checked_at: new Date().toISOString() });
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
      <Button variant="outline" disabled={pending} onClick={() => void conferir()}>
        {pending ? "A verificar…" : "Verificar catálogo MCP"}
      </Button>
      {result && (
        <div role="status" className="text-sm space-y-2">
          <p>
            {result.ok
              ? `${result.tools.length} ferramentas disponíveis no servidor.`
              : `Não foi possível verificar o catálogo (HTTP ${result.status}). Isso não comprova ausência de ferramentas.`}
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
