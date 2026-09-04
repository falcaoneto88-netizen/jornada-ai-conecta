import { createFileRoute } from "@tanstack/react-router";
import { Copy, Send, ShieldAlert, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { DemoNotice } from "@/components/demo-notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAppMode } from "@/lib/app-mode";
import { canalLabel, contactById, conversations, intencaoLabel } from "@/lib/demo-data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/caixa-de-entrada")({
  head: () => ({
    meta: [
      { title: "Caixa de Entrada IA — Jornada AI | Dr. João Falcão" },
      {
        name: "description",
        content:
          "Centralize conversas de WhatsApp, Instagram, Facebook e e-mail com resumo, intenção e respostas sugeridas por IA.",
      },
      { property: "og:title", content: "Caixa de Entrada IA — Jornada AI" },
      {
        property: "og:description",
        content: "Conversas centralizadas com resumo automático, intenção e respostas sugeridas.",
      },
    ],
  }),
  component: CaixaEntrada,
});

function CaixaEntrada() {
  const modo = useAppMode();
  const [ativaId, setAtivaId] = useState(conversations[0]!.id);
  const [rascunho, setRascunho] = useState("");
  const conversa = conversations.find((c) => c.id === ativaId)!;
  const contacto = contactById(conversa.contactId);

  function copiar(texto: string) {
    void navigator.clipboard.writeText(texto);
    toast.success("Resposta copiada para a área de transferência.");
  }

  function enviar() {
    if (modo !== "conectado") {
      toast.error("Envio indisponível em modo demonstração.", {
        description: "Ligue o GoHighLevel em Integrações para enviar mensagens reais.",
      });
      return;
    }
    toast.success("Mensagem enviada via GoHighLevel.");
  }

  return (
    <AppShell title="Caixa de Entrada IA" description="Conversas de todos os canais num só lugar">
      <div className="space-y-6">
        <DemoNotice texto="Conversas de demonstração. O envio de mensagens só fica disponível após ligação validada ao GoHighLevel." />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[340px_1fr]">
          <section className="surface-card overflow-hidden" aria-label="Lista de conversas">
            <ul className="divide-y divide-border">
              {conversations.map((c) => {
                const pessoa = contactById(c.contactId);
                const ativa = c.id === ativaId;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setAtivaId(c.id)}
                      className={cn(
                        "w-full px-4 py-4 text-left transition-colors hover:bg-secondary/60",
                        ativa && "bg-secondary",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-medium text-heading">{pessoa?.nome}</p>
                        <span className="shrink-0 text-xs text-muted-foreground">{c.quando}</span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{c.ultimaMensagem}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline">{canalLabel[c.canal]}</Badge>
                        <Badge variant="secondary">{intencaoLabel[c.intencao]}</Badge>
                        {c.naoLidas > 0 && <Badge>{c.naoLidas} por ler</Badge>}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="space-y-4">
            <div className="surface-card p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-heading">{contacto?.nome}</h2>
                  <p className="text-sm text-muted-foreground">
                    {canalLabel[conversa.canal]} · Responsável: {contacto?.responsavel}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">Sentimento: {conversa.sentimento}</Badge>
                  <Badge variant={conversa.prioridade === "alta" ? "destructive" : "secondary"}>
                    Prioridade {conversa.prioridade}
                  </Badge>
                </div>
              </div>

              <div className="mt-5 rounded-xl border border-border bg-secondary/40 p-4">
                <p className="flex items-center gap-2 text-sm font-medium text-heading">
                  <Sparkles className="size-4 text-primary" aria-hidden /> Resumo automático
                </p>
                <p className="mt-2 text-sm text-foreground">{conversa.resumo}</p>
              </div>

              <ul className="mt-5 space-y-3">
                {conversa.mensagens.map((m, i) => (
                  <li
                    key={i}
                    className={cn(
                      "max-w-[85%] rounded-2xl px-4 py-3 text-sm",
                      m.autor === "cliente"
                        ? "bg-secondary text-foreground"
                        : "ml-auto bg-heading text-background",
                    )}
                  >
                    <p>{m.texto}</p>
                    <p
                      className={cn(
                        "mt-1 text-[11px]",
                        m.autor === "cliente" ? "text-muted-foreground" : "text-background/70",
                      )}
                    >
                      {m.hora}
                    </p>
                  </li>
                ))}
              </ul>
            </div>

            <div className="surface-card p-6">
              <h3 className="text-base font-semibold">Respostas sugeridas pela IA</h3>
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                {conversa.sugestoes.map((s) => (
                  <article key={s.tom} className="flex flex-col rounded-xl border border-border bg-secondary/30 p-4">
                    <Badge variant="outline" className="w-fit">
                      {s.tom}
                    </Badge>
                    <p className="mt-3 flex-1 text-sm text-foreground">{s.texto}</p>
                    <div className="mt-4 flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => copiar(s.texto)}>
                        <Copy className="size-3.5" /> Copiar
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setRascunho(s.texto)}>
                        Editar
                      </Button>
                    </div>
                  </article>
                ))}
              </div>

              <div className="mt-5">
                <label htmlFor="resposta" className="text-sm font-medium text-heading">
                  Resposta a enviar
                </label>
                <Textarea
                  id="resposta"
                  value={rascunho}
                  onChange={(e) => setRascunho(e.target.value)}
                  rows={4}
                  placeholder="Escreva ou escolha uma sugestão acima…"
                  className="mt-2 bg-card"
                />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <p className="flex items-start gap-2 text-xs text-muted-foreground">
                    <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
                    Assuntos clínicos sensíveis devem ser revistos por um profissional. A IA não faz diagnósticos.
                  </p>
                  <Button onClick={enviar} disabled={!rascunho.trim()}>
                    <Send className="size-4" /> Enviar via GHL
                  </Button>
                </div>
              </div>
            </div>

            <div className="surface-card p-6">
              <h3 className="text-base font-semibold">Registo de auditoria</h3>
              <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                <li>04/09/2026 21:04 — Resumo gerado pela IA (modo demonstração).</li>
                <li>04/09/2026 21:03 — Conversa aberta por Ana Ribeiro.</li>
                <li>04/09/2026 09:14 — Mensagem recebida do cliente.</li>
              </ul>
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
