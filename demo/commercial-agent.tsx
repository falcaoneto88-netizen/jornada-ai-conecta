import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import {
  CommercialAgentQueue,
  type QueueItem,
  type QueueView,
} from "../src/components/commercial-agent-queue";
import { Button } from "../src/components/ui/button";
import "../src/styles.css";
async function call(path: string, data?: unknown) {
  const r = await fetch(
    `/demo-api/${path}`,
    data
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        }
      : {},
  );
  const body = await r.json();
  if (!r.ok) throw new Error(body.error);
  return body;
}
export function Demo() {
  const [data, setData] = useState<{
      view: QueueView;
      trace: string[];
      deliveries: Array<{ conversationId: string; contactId: string; message: string }>;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const refresh = async () => setData(await call("state"));
  useEffect(() => {
    void refresh().catch(() =>
      setError("Servidor local indisponível. Reinicie a demonstração pelo guia de homologação."),
    );
  }, []);
  async function action(path: string, input: unknown) {
    setBusy(true);
    setError("");
    try {
      await call(path, input);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "demo_error");
    } finally {
      setBusy(false);
    }
  }
  const approval = (r: QueueItem) => ({
    draftId: r.id,
    version: r.version,
    replyHash: r.reply_hash,
  });
  return (
    <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-8">
      <header>
        <p className="text-sm text-muted-foreground">JORNADA AI · DR. JOÃO FALCÃO</p>
        <h1 className="display-title mt-2 text-3xl">Agente de atendimento supervisionado</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Homologação local com banco PostgreSQL temporário. Integrações externas e operador
          simulados. Sem envio real.
        </p>
      </header>
      <section className="surface-card space-y-3 p-5">
        <h2 className="font-semibold">Demonstre o fluxo</h2>
        <p className="text-sm text-muted-foreground">
          1. Receba uma mensagem fictícia. 2. Revise o histórico e a resposta. 3. Aprove o envio
          simulado.
        </p>
        <div className="flex flex-wrap gap-2">
          {[
            ["normal", "Receber mensagem de teste"],
            ["conflict", "Testar conflito comercial"],
            ["human", "Testar pedido de humano"],
            ["stop", "Testar recusa"],
            ["timeout", "Testar envio incerto"],
          ].map(([scenario, label]) => (
            <Button
              key={scenario}
              variant="outline"
              disabled={busy}
              onClick={() => void action("receive", { scenario })}
            >
              {label}
            </Button>
          ))}
          <Button
            variant="outline"
            disabled={busy || !data?.view.items.length}
            onClick={() => void action("duplicate", {})}
          >
            Repetir webhook
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => void action("reset", {})}>
            Limpar demonstração
          </Button>
        </div>
        {error && <p role="alert">{error}</p>}
      </section>
      {data && (
        <CommercialAgentQueue
          key={data.view.items[0]?.id ?? "empty"}
          view={data.view}
          demo
          actions={{
            refresh,
            approve: async (row) => (await call("approve", approval(row))).state,
            reject: async (row) => {
              await call("reject", approval(row));
            },
            pause: async (row, paused) => {
              await call("pause", {
                contactId: row.contact_id,
                expectedVersion: row.session_version,
                paused,
              });
            },
          }}
        />
      )}
      <div className="grid gap-5 md:grid-cols-2">
        <section className="surface-card p-5">
          <h2 className="font-semibold">Evidências da execução</h2>
          <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm">
            {data?.trace.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ol>
        </section>
        <section className="surface-card p-5">
          <h2 className="font-semibold">
            Caixa de saída simulada ({data?.deliveries.length ?? 0})
          </h2>
          {data?.deliveries.map((d, i) => (
            <div key={i} className="mt-4 rounded-lg bg-secondary p-4 text-sm">
              <p className="mb-2 text-xs">
                Contato {d.contactId} · conversa {d.conversationId}
              </p>
              <p>{d.message}</p>
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Demo />);
