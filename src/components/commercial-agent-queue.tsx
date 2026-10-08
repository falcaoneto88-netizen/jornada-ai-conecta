import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  labels,
  type DraftPayload,
  type DraftRow,
  type QueueError,
  type Settings,
} from "@/lib/commercial-agent/core";

export type QueueItem = Omit<DraftRow, "payload"> & { content: DraftPayload | null };
export type QueueView = {
  enabled: boolean;
  sendEnabled: boolean;
  items: QueueItem[];
  errors: QueueError[];
  settings?: Settings;
};
export type QueueActions = {
  refresh(): Promise<void>;
  approve(row: QueueItem): Promise<string>;
  reject(row: QueueItem): Promise<void>;
  pause(row: QueueItem, paused: boolean): Promise<void>;
  reconcile?(row: QueueItem, messageId: string): Promise<void>;
};
export const friendlyError: Record<string, string> = {
  not_configured: "O agente ainda não foi configurado nesta clínica.",
  encryption_not_configured: "O serviço aguarda configuração segura no servidor.",
  forbidden: "Sua sessão não tem permissão para esta ação.",
  draft_stale: "A conversa mudou ou o rascunho expirou. Atualize antes de continuar.",
  version_conflict: "Este rascunho já mudou. Atualize a fila.",
  send_disabled: "O envio está desativado para homologação.",
  do_not_contact: "Contato bloqueado por recusa ou DND.",
  human_paused: "O atendimento está com a equipe humana.",
  reconciliation_required: "Confira o envio incerto no HighLevel antes de retomar o agente.",
  receipt_not_verified:
    "Essa mensagem não corresponde ao envio aprovado. O contato continua pausado.",
  review_required: "Há uma pendência que precisa ser decidida pela equipe.",
  send_unknown:
    "O resultado não foi confirmado. Confira no HighLevel antes de qualquer nova mensagem.",
};

export function CommercialAgentQueue({
  view,
  actions,
  demo = false,
}: {
  view: QueueView;
  actions: QueueActions;
  demo?: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null),
    [confirm, setConfirm] = useState<QueueItem | null>(null),
    [busy, setBusy] = useState(false),
    [receiptId, setReceiptId] = useState(""),
    [notice, setNotice] = useState("");
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 10000);
    return () => clearInterval(timer);
  }, []);
  const row = view.items.find((x) => x.id === selected) ?? view.items[0];
  const content = row?.content;
  const expired = row ? Date.parse(row.expires_at) <= clock : true;
  function sendAllowed(item: QueueItem) {
    const settings = view.settings;
    if (!settings) return demo;
    const channel = item.content?.snapshot.messages.at(-1)?.channel;
    return (
      settings.mode === "supervised" &&
      settings.organization_id === item.organization_id &&
      settings.location_id === item.location_id &&
      settings.allowed_contacts.includes(item.contact_id) &&
      Boolean(channel && settings.allowed_channels.includes(channel))
    );
  }
  function approvalBlocked(item: QueueItem | undefined) {
    return (
      !view.enabled ||
      !view.sendEnabled ||
      !item ||
      !item.content ||
      !sendAllowed(item) ||
      item.state !== "pending" ||
      item.paused ||
      item.opt_out ||
      Date.parse(item.expires_at) <= clock ||
      Boolean(item.content.decision.flags.length)
    );
  }
  const blocked = approvalBlocked(row);
  const currentConfirm = confirm ? view.items.find((item) => item.id === confirm.id) : undefined;
  const confirmationBlocked =
    !currentConfirm ||
    currentConfirm.version !== confirm?.version ||
    currentConfirm.reply_hash !== confirm?.reply_hash ||
    approvalBlocked(currentConfirm);
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setNotice("");
    try {
      await fn();
      await actions.refresh();
    } catch (e) {
      const code = e instanceof Error ? e.message : "internal_error";
      setNotice(
        friendlyError[code] ??
          "Não foi possível concluir. Atualize e confira o estado antes de repetir.",
      );
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }
  return (
    <div className="space-y-5">
      <section className="surface-card flex flex-wrap items-start justify-between gap-4 p-5">
        <div>
          <div className="mb-2 flex flex-wrap gap-2">
            <Badge variant="outline">Treinamento V02</Badge>
            <Badge>{demo ? "Demonstração com dados fictícios" : "Supervisionado"}</Badge>
            <Badge variant="outline">
              {view.sendEnabled ? "Aprovação obrigatória" : "Envio desativado"}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Revise o histórico, o destinatário e a resposta. Cada envio exige sua aprovação.
          </p>
          {view.settings?.receive_all_contacts && (
            <p className="mt-2 text-sm text-muted-foreground">
              Recebimento geral{" "}
              {view.enabled && view.settings.mode === "supervised" ? "ativo" : "desativado"}. Novas
              mensagens individuais desta clínica entram para revisão. Respostas sugeridas nos
              canais: {view.settings.allowed_channels.join(", ") || "nenhum canal autorizado"}.
              Outros canais exigem revisão manual. O envio continua restrito a{" "}
              {view.settings.allowed_contacts.length}{" "}
              {view.settings.allowed_contacts.length === 1
                ? "contato autorizado"
                : "contatos autorizados"}
              .
            </p>
          )}
          {demo && (
            <p className="mt-2 text-sm font-medium">
              HighLevel e OpenAI simulados. Nenhuma mensagem sai para pacientes.
            </p>
          )}
        </div>
        <Button variant="outline" disabled={busy} onClick={() => void act(actions.refresh)}>
          Atualizar fila
        </Button>
      </section>
      {notice && (
        <p role="status" className="rounded-xl border border-primary/30 bg-primary/10 p-4 text-sm">
          {notice}
        </p>
      )}
      <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <section className="surface-card overflow-hidden" aria-label="Fila de respostas">
          <h2 className="border-b p-4 font-semibold">
            Respostas para revisar{" "}
            <span className="text-muted-foreground">({view.items.length})</span>
          </h2>
          {view.items.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">Nenhuma resposta na fila.</p>
          ) : (
            <ul className="divide-y">
              {view.items.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    className={`w-full p-4 text-left hover:bg-secondary ${row?.id === d.id ? "bg-secondary" : ""}`}
                    aria-pressed={row?.id === d.id}
                    onClick={() => {
                      setSelected(d.id);
                      setConfirm(null);
                      setNotice("");
                      setReceiptId("");
                    }}
                  >
                    <p className="font-medium">{d.content?.snapshot.name ?? "Conteúdo expirado"}</p>
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                      {d.content?.snapshot.messages.at(-1)?.text}
                    </p>
                    <p className="mt-3 text-xs">
                      {labels[d.state] ?? d.state}
                      {d.paused ? " · Com a equipe humana" : ""}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        {row && content ? (
          <section className="surface-card min-w-0 p-5 sm:p-6" aria-label="Revisão da resposta">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">{content.snapshot.name}</h2>
                <p className="text-sm text-muted-foreground">
                  {content.snapshot.messages.at(-1)?.channel} · {labels[row.state] ?? row.state}
                </p>
              </div>
              {!demo && (
                <a
                  className="text-sm underline"
                  target="_blank"
                  rel="noreferrer"
                  href={`https://app.leadconnectorhq.com/v2/location/${row.location_id}/conversations/conversations/${row.conversation_id}`}
                >
                  Conferir no HighLevel
                </a>
              )}
            </div>
            <details className="mt-3 text-xs text-muted-foreground">
              <summary>Identificação do destinatário</summary>
              <p className="mt-2 break-all">
                Contato: {row.contact_id}
                <br />
                Conversa: {row.conversation_id}
                <br />
                Mensagem recebida: {row.message_id}
              </p>
            </details>
            <h3 className="mb-3 mt-6 text-sm font-semibold">Histórico recuperado</h3>
            <div className="max-h-72 space-y-3 overflow-y-auto rounded-xl bg-secondary/40 p-4">
              {content.snapshot.messages.slice(-12).map((m) => (
                <div
                  key={m.id}
                  className={`max-w-[95%] rounded-xl border p-3 text-sm sm:max-w-[85%] ${m.direction === "outbound" ? "ml-auto bg-background" : "bg-secondary"}`}
                >
                  <p className="mb-1 text-xs font-medium text-muted-foreground">
                    {m.direction === "inbound" ? "Contato" : "Equipe"}
                  </p>
                  <p className="whitespace-pre-wrap break-words">{m.text}</p>
                  {m.attachments > 0 && (
                    <p className="mt-2 text-xs">Anexo disponível para revisão no HighLevel</p>
                  )}
                </div>
              ))}
            </div>
            <h3 className="mb-3 mt-6 text-sm font-semibold">Resposta proposta</h3>
            <blockquote className="whitespace-pre-wrap break-words rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm leading-relaxed">
              {content.decision.reply}
            </blockquote>
            {content.decision.flags.length > 0 && (
              <div
                role="alert"
                className="mt-4 rounded-xl border border-amber-400/40 bg-amber-50 p-4 text-sm text-amber-950"
              >
                <p className="font-semibold">Decisão da equipe necessária</p>
                <ul className="mt-2 list-disc pl-5">
                  {content.decision.flags.map((f) => (
                    <li key={f}>{labels[f] ?? f}</li>
                  ))}
                </ul>
                <p className="mt-2">
                  Assuma o atendimento e resolva a pendência. Uma regra nova deve ser registrada na
                  base vigente.
                </p>
              </div>
            )}
            {(row.paused || row.opt_out) && (
              <p className="mt-4 text-sm font-medium">
                {row.opt_out
                  ? "Contato comercial interrompido. Retomar não remove a recusa."
                  : "Agente pausado para este contato, em todos os seus canais."}
              </p>
            )}
            {!sendAllowed(row) && (
              <p role="status" className="mt-4 text-sm font-medium">
                {!view.settings && !demo
                  ? "Não foi possível verificar quais destinatários e canais têm envio liberado. Atualize a fila antes de aprovar."
                  : "Esta entrada está em revisão. O envio não está liberado para este destinatário ou canal."}
              </p>
            )}
            {row.state === "invalidated" && (
              <p role="status" className="mt-4 text-sm font-medium">
                Este rascunho ficou desatualizado e não pode ser enviado. Retomar o agente não
                reativa respostas antigas. Uma nova mensagem do contato poderá gerar outro rascunho.
              </p>
            )}
            {expired && row.state === "pending" && (
              <p className="mt-3 text-sm">
                Rascunho expirado. Reavalie a conversa antes de responder.
              </p>
            )}
            {row.state === "unknown" && (
              <p role="alert" className="mt-4 text-sm font-medium">
                O HighLevel pode ter aceitado a mensagem. O serviço não repetirá o envio. Confira a
                conversa.
              </p>
            )}
            {row.state === "unknown" && actions.reconcile && (
              <form
                className="mt-4 space-y-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void act(async () => {
                    await actions.reconcile!(row, receiptId.trim());
                    setReceiptId("");
                    setNotice(
                      "Mensagem conferida no HighLevel. O contato permanece pausado até a retomada pela equipe.",
                    );
                  });
                }}
              >
                <label htmlFor="receipt-id" className="block text-sm font-medium">
                  ID da mensagem encontrada no HighLevel
                </label>
                <input
                  id="receipt-id"
                  className="w-full rounded-lg border bg-background p-3 text-sm"
                  value={receiptId}
                  onChange={(event) => setReceiptId(event.target.value)}
                  maxLength={100}
                  pattern="[A-Za-z0-9_-]{1,100}"
                  required
                  autoComplete="off"
                />
                <Button type="submit" variant="outline" disabled={busy || !receiptId.trim()}>
                  Conferir mensagem e registrar envio
                </Button>
                <p className="text-xs text-muted-foreground">
                  Verifica destinatário, conversa, texto e horário. Não envia outra mensagem.
                </p>
              </form>
            )}
            <div className="mt-5 flex flex-wrap gap-2">
              <Button disabled={busy || blocked} onClick={() => setConfirm(row)}>
                {demo ? "Aprovar envio simulado" : "Revisar e aprovar envio"}
              </Button>
              <Button
                variant="outline"
                disabled={busy || row.state !== "pending"}
                onClick={() => void act(() => actions.reject(row))}
              >
                Rejeitar rascunho
              </Button>
              <Button
                variant="outline"
                disabled={busy || row.opt_out}
                onClick={() => void act(() => actions.pause(row, !row.paused))}
              >
                {row.paused ? "Retomar agente" : "Assumir atendimento"}
              </Button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Uma nova mensagem invalida esta aprovação. “Aceita pelo HighLevel” não confirma
              entrega ou leitura.
            </p>
          </section>
        ) : (
          <p className="surface-card p-6 text-sm text-muted-foreground">
            Selecione uma resposta disponível para revisão.
          </p>
        )}
      </div>
      {view.errors.length > 0 && (
        <section className="surface-card p-5">
          <h2 className="font-semibold">Falhas de processamento</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            A equipe técnica pode consultar os registros sem expor o conteúdo das conversas.
          </p>
          <ul className="mt-3 space-y-2 text-xs">
            {view.errors.map((e) => (
              <li key={e.id}>
                {e.error_code} · tentativa {e.attempts} · {e.state}
              </li>
            ))}
          </ul>
        </section>
      )}
      <Dialog open={Boolean(confirm)} onOpenChange={(open) => !open && !busy && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{demo ? "Confirmar envio simulado" : "Aprovar esta resposta"}</DialogTitle>
            <DialogDescription>
              Destinatário: {confirm?.content?.snapshot.name} ·{" "}
              {confirm?.content?.snapshot.messages.at(-1)?.channel}. Confira o texto abaixo.
            </DialogDescription>
          </DialogHeader>
          <p className="whitespace-pre-wrap break-words rounded-lg bg-secondary p-4 text-sm">
            {confirm?.content?.decision.reply}
          </p>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setConfirm(null)}>
              Voltar à revisão
            </Button>
            <Button
              disabled={busy || !confirm || confirmationBlocked}
              onClick={() => {
                if (confirm && !confirmationBlocked)
                  void act(async () => {
                    const state = await actions.approve(confirm);
                    setNotice(
                      state === "sent"
                        ? demo
                          ? "Envio simulado registrado na conversa fictícia correta."
                          : "Mensagem aceita pelo HighLevel. Acompanhe a entrega na conversa."
                        : friendlyError["send_unknown"]!,
                    );
                  });
              }}
            >
              Confirmar aprovação e enviar{demo ? " simulação" : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
