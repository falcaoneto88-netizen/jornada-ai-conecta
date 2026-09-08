import { createFileRoute } from "@tanstack/react-router";
import { Copy, Send, ShieldAlert, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { DemoNotice } from "@/components/demo-notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useServerFn } from "@tanstack/react-start";

import { aiSupport, type AnaliseIA } from "@/lib/ai.functions";
import { ghlProxy } from "@/lib/ghl.functions";
import { canalLabel, intencaoLabel, type Conversation } from "@/lib/demo-data";
import { useContactos, useConversas, useLigacaoGhl, useModoDados } from "@/lib/repo";
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
  const { demo, escopo } = useModoDados();
  const { data: conversations = [], isLoading } = useConversas();
  const { data: contactos = [] } = useContactos();
  const { data: ligacao } = useLigacaoGhl();
  const analisar = useServerFn(aiSupport);
  const enviarGhl = useServerFn(ghlProxy);

  const [ativaId, setAtivaId] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState("");
  const [analise, setAnalise] = useState<AnaliseIA | null>(null);
  const [erroIa, setErroIa] = useState<string | null>(null);
  const [aAnalisar, setAAnalisar] = useState(false);
  const [aEnviar, setAEnviar] = useState(false);
  const [confirmar, setConfirmar] = useState(false);

  // Ao mudar de conta (ou sair), descarta rascunhos e análises da sessão anterior.
  const escopoAnterior = useRef(escopo);
  useEffect(() => {
    if (escopoAnterior.current === escopo) return;
    escopoAnterior.current = escopo;
    setAtivaId(null);
    setRascunho("");
    setAnalise(null);
    setErroIa(null);
    setConfirmar(false);
  }, [escopo]);

  const conversa: Conversation | null =
    conversations.find((c) => c.id === ativaId) ?? conversations[0] ?? null;
  const contacto = contactos.find((c) => c.id === conversa?.contactId) ?? null;
  const podeEnviar = !demo && ligacao?.status === "conectada" && ligacao?.write_enabled === true;

  const sugestoes = analise
    ? analise.sugestoes.map((s) => ({ tom: s.tom, texto: s.texto }))
    : (conversa?.sugestoes ?? []).map((s) => ({ tom: s.tom, texto: s.texto }));

  function copiar(texto: string) {
    void navigator.clipboard.writeText(texto);
    toast.success("Resposta copiada para a área de transferência.");
  }

  async function analisarConversa() {
    if (!conversa) return;
    if (demo) {
      toast.error("A análise por IA exige conta iniciada.");
      return;
    }
    setAAnalisar(true);
    setErroIa(null);
    try {
      const texto = conversa.mensagens.map((m) => `${m.autor}: ${m.texto}`).join("\n");
      const res = await analisar({ data: { conversa: texto, contexto: contacto?.nome ?? "" } });
      if (res.ok) {
        setAnalise(res.analise);
        toast.success("Análise gerada pela IA.");
      } else {
        setErroIa(res.message);
      }
    } catch {
      setErroIa("Não foi possível contactar a IA.");
    } finally {
      setAAnalisar(false);
    }
  }

  async function enviar() {
    if (!podeEnviar || !conversa) {
      toast.error("Envio bloqueado.", {
        description: demo
          ? "Em modo demonstração não há envios reais."
          : "Valide a ligação ao GoHighLevel e ative a escrita em Integrações.",
      });
      return;
    }
    setAEnviar(true);
    try {
      const res = await enviarGhl({
        data: {
          operacao: "conversations.sendMessage",
          contactoId: conversa.contactId || null,
          body: { type: conversa.canal === "email" ? "Email" : "WhatsApp", message: rascunho },
        },
      });
      if (res.ok) {
        toast.success("Mensagem enviada via GoHighLevel.");
        setRascunho("");
      } else {
        toast.error(res.message);
      }
    } catch {
      toast.error("Falha ao enviar a mensagem.");
    } finally {
      setAEnviar(false);
      setConfirmar(false);
    }
  }

  return (
    <AppShell title="Caixa de Entrada IA" description="Conversas de todos os canais num só lugar">
      <div className="space-y-6">
        <DemoNotice
          texto={
            demo
              ? "Conversas de demonstração. O envio de mensagens só fica disponível após ligação validada ao GoHighLevel."
              : "O envio só fica disponível após ligação validada ao GoHighLevel e escrita ativada."
          }
        />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[340px_1fr]">
          <section className="surface-card overflow-hidden" aria-label="Lista de conversas">
            <ul className="divide-y divide-border">
              {conversations.map((c) => {
                const pessoa = contactos.find((p) => p.id === c.contactId);
                const ativa = c.id === conversa?.id;
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
              {conversations.length === 0 && (
                <li className="px-4 py-10 text-center text-sm text-muted-foreground">
                  {isLoading ? "A carregar conversas…" : "Ainda não há conversas sincronizadas."}
                </li>
              )}
            </ul>
          </section>

          {conversa === null ? (
            <section className="surface-card flex items-center justify-center p-10 text-sm text-muted-foreground">
              Selecione uma conversa para ver o resumo e as sugestões.
            </section>
          ) : (
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
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-base font-semibold">Respostas sugeridas pela IA</h3>
                <Button size="sm" variant="outline" onClick={() => void analisarConversa()} disabled={aAnalisar || demo}>
                  <Sparkles className="size-3.5" /> {aAnalisar ? "A analisar…" : "Analisar com IA"}
                </Button>
              </div>
              {erroIa && <p className="mt-3 text-sm text-destructive">{erroIa}</p>}
              {analise?.revisao_humana && (
                <p className="mt-3 rounded-lg border border-primary/40 bg-primary/10 p-3 text-sm">
                  Tema sensível: esta conversa precisa de revisão por um profissional de saúde antes de responder.
                </p>
              )}
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                {sugestoes.map((s) => (
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
                {sugestoes.length === 0 && (
                  <p className="text-sm text-muted-foreground md:col-span-3">
                    Ainda não há sugestões. Utilize «Analisar com IA» para as gerar.
                  </p>
                )}
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
                  <Button onClick={() => setConfirmar(true)} disabled={!rascunho.trim() || !podeEnviar || aEnviar}>
                    <Send className="size-4" /> {aEnviar ? "A enviar…" : "Enviar via GHL"}
                  </Button>
                </div>
              </div>
            </div>

            <div className="surface-card p-6">
              <h3 className="text-base font-semibold">Registo de auditoria</h3>
              <p className="mt-3 text-sm text-muted-foreground">
                Todos os envios, análises de IA e mudanças de etapa ficam registados em Configurações › Saúde do
                sistema.
              </p>
            </div>
          </section>
          )}
        </div>
      </div>

      <Dialog open={confirmar} onOpenChange={setConfirmar}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar envio via GoHighLevel</DialogTitle>
            <DialogDescription>
              A mensagem será enviada ao cliente {contacto?.nome ?? ""} pelo canal{" "}
              {conversa ? canalLabel[conversa.canal] : ""}.
            </DialogDescription>
          </DialogHeader>
          <p className="whitespace-pre-wrap rounded-xl border border-border bg-secondary/40 p-4 text-sm">{rascunho}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmar(false)}>
              Cancelar
            </Button>
            <Button onClick={() => void enviar()} disabled={aEnviar}>
              {aEnviar ? "A enviar…" : "Confirmar envio"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
