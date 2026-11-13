import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  ManualContext,
  ManualConversation,
  ManualPrepared,
} from "@/lib/commercial-agent/core";
import type { ManualQueuePage, ManualQueueRequest } from "@/lib/commercial-agent/queue-read";

export type ManualActions = {
  search?(request: ManualQueueRequest): Promise<ManualQueuePage>;
  context(conversation: ManualConversation): Promise<ManualContext>;
  pause(conversation: ManualConversation, version: number, paused: boolean): Promise<void>;
  prepare(input: {
    contactId: string;
    conversationId: string;
    expectedVersion: number;
    historyHash: string;
    text: string;
    requestId: string;
  }): Promise<ManualPrepared>;
  send(
    prepared: ManualPrepared,
  ): Promise<{ state: string; code: string | null; messageId: string | null }>;
  reconcile(manualId: string, messageId: string): Promise<void>;
  refresh(): Promise<void>;
};
const errors: Record<string, string> = {
  send_disabled: "O envio manual ainda não está liberado para esta conversa.",
  manual_disabled: "O envio manual ainda não está liberado nesta clínica.",
  manual_send_disabled: "O envio manual ainda não está liberado nesta clínica.",
  do_not_contact: "Este contato pediu interrupção ou está com DND ativo. O envio está bloqueado.",
  unsupported_channel: "Este canal ainda não tem envio manual homologado. Continue pelo HighLevel.",
  channel_window: "A janela de resposta deste canal terminou. Continue pelo HighLevel.",
  draft_stale: "A conversa mudou. Atualize o histórico e revise o texto novamente.",
  history_changed: "A conversa mudou. Atualize o histórico e revise o texto novamente.",
  version_conflict: "A conversa mudou. Atualize o histórico antes de continuar.",
  manual_stale: "Esta revisão ficou desatualizada. Atualize o histórico e revise novamente.",
  reconciliation_required:
    "Existe um envio sem confirmação. Confira a conversa no HighLevel antes de outra mensagem.",
  send_unknown:
    "Não foi possível confirmar o envio. Não repita a mensagem: confira a conversa no HighLevel.",
  receipt_not_verified:
    "A mensagem informada não corresponde a este envio. Confira o ID no HighLevel.",
  forbidden: "Sua conta não tem permissão para enviar nesta clínica.",
};
const keyOf = (c: { contactId: string; conversationId: string }) =>
  `${c.contactId}:${c.conversationId}`;
type SearchConversation = ManualConversation & {
  contactName: string | null;
  channel: string | null;
};
const contactLabel = (c: SearchConversation) =>
  c.contactName?.trim() || `Contato sem nome · ${c.contactId.slice(-8)}`;

export function CommercialAgentManual({
  conversations,
  names = {},
  actions,
  disabled = false,
}: {
  conversations: ManualConversation[];
  names?: Record<string, string>;
  actions: ManualActions;
  disabled?: boolean;
}) {
  const [selected, setSelected] = useState("");
  const [selectedConversation, setSelectedConversation] = useState<SearchConversation | null>(null);
  const [choosing, setChoosing] = useState(true);
  const [query, setQuery] = useState("");
  const [searchRequest, setSearchRequest] = useState<ManualQueueRequest>({
    query: "",
    page: 1,
    pageSize: 25,
  });
  const [searchResult, setSearchResult] = useState<ManualQueuePage | null>(null);
  const [searchBusy, setSearchBusy] = useState(Boolean(actions.search));
  const [searchError, setSearchError] = useState(false);
  const searchSequence = useRef(0);
  const searchInput = useRef<HTMLInputElement>(null);
  const selectionHeading = useRef<HTMLHeadingElement>(null);
  const [context, setContext] = useState<ManualContext | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [prepared, setPrepared] = useState<ManualPrepared | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [receipt, setReceipt] = useState("");
  const [clock, setClock] = useState(Date.now());
  const actionRef = useRef(actions);
  actionRef.current = actions;
  const conversation = conversations.find((c) => keyOf(c) === selected) ?? selectedConversation;
  const localMatches: SearchConversation[] = actions.search
    ? []
    : conversations
        .map((c) => ({ ...c, contactName: names[c.contactId] ?? null, channel: null }))
        .filter((c) =>
          `${c.contactName ?? ""} ${c.contactId} ${c.conversationId}`
            .toLocaleLowerCase()
            .includes(searchRequest.query.toLocaleLowerCase()),
        );
  const visibleResults = actions.search
    ? (searchResult?.items ?? []).slice(0, 25)
    : localMatches.slice((searchRequest.page - 1) * 25, searchRequest.page * 25);
  const hasMore = actions.search
    ? Boolean(searchResult?.hasMore)
    : localMatches.length > searchRequest.page * 25;
  const text = drafts[selected] ?? "";
  useEffect(() => {
    if (!actionRef.current.search) return;
    const sequence = ++searchSequence.current;
    let active = true;
    setSearchBusy(true);
    setSearchError(false);
    setSearchResult(null);
    actionRef.current
      .search(searchRequest)
      .then((result) => {
        if (active && sequence === searchSequence.current) setSearchResult(result);
      })
      .catch(() => {
        if (active && sequence === searchSequence.current) setSearchError(true);
      })
      .finally(() => {
        if (active && sequence === searchSequence.current) setSearchBusy(false);
      });
    return () => {
      active = false;
    };
  }, [searchRequest]);
  function changeSearch(request: ManualQueueRequest) {
    searchSequence.current++;
    setSearchResult(null);
    setSearchBusy(Boolean(actions.search));
    setSearchError(false);
    setSearchRequest(request);
  }
  function chooseConversation(item: SearchConversation) {
    if (busy) return;
    setSelectedConversation(item);
    setSelected(keyOf(item));
    setChoosing(false);
  }
  useEffect(() => {
    if (!selected) return;
    if (choosing) searchInput.current?.focus();
    else selectionHeading.current?.focus();
  }, [selected, choosing]);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 10000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    let active = true;
    setContext(null);
    setPrepared(null);
    setNotice("");
    setReceipt("");
    if (!conversation) {
      setBusy(false);
      return;
    }
    setBusy(true);
    actionRef.current
      .context(conversation)
      .then((result) => {
        if (active) {
          setContext(result);
          setSelectedConversation((current) =>
            current && keyOf(current) === selected
              ? {
                  ...current,
                  sessionVersion: result.sessionVersion,
                  paused: result.paused,
                  optOut: result.optOut,
                }
              : current,
          );
        }
      })
      .catch(() => {
        if (active) setNotice("Não foi possível carregar esta conversa. Atualize o histórico.");
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
    // Polling the conversation list must not erase text or replace a reviewed history.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);
  const stale = Boolean(
    context && conversation && context.sessionVersion !== conversation.sessionVersion,
  );
  const blocked =
    disabled ||
    !conversation ||
    !context ||
    !context.paused ||
    !context.sendAllowed ||
    context.optOut ||
    stale;
  const latestInbound = context?.snapshot.messages.find(
    (m) => m.id === context.snapshot.event.messageId,
  );
  const unresolved =
    context?.lastDispatch && ["unknown", "sending"].includes(context.lastDispatch.state);
  const link = conversation
    ? `https://app.leadconnectorhq.com/v2/location/${conversation.locationId}/conversations/conversations/${conversation.conversationId}`
    : "";
  async function run(fn: () => Promise<void>) {
    if (busy || disabled) return;
    setBusy(true);
    setNotice("");
    try {
      await fn();
    } catch (e) {
      const code = e instanceof Error ? e.message : "internal_error";
      setNotice(
        errors[code] ??
          "Não foi possível concluir. Atualize o histórico e confira o estado antes de tentar novamente.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function reload() {
    if (!conversation) return;
    const fresh = await actions.context(conversation);
    setContext(fresh);
    setSelectedConversation((current) =>
      current && keyOf(current) === selected
        ? {
            ...current,
            sessionVersion: fresh.sessionVersion,
            paused: fresh.paused,
            optOut: fresh.optOut,
          }
        : current,
    );
    setPrepared(null);
    await actions.refresh();
  }
  return (
    <section className="surface-card space-y-4 p-5" aria-label="Atendimento manual">
      <div>
        <h2 className="font-semibold">Atendimento manual</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Assuma a conversa, escreva sua mensagem e confira antes de enviar. O agente permanece
          pausado até a equipe retomá-lo.
        </p>
      </div>
      {selectedConversation && (
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-b pb-3">
          <div className="min-w-0">
            <h3
              ref={selectionHeading}
              tabIndex={-1}
              className="break-words text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {contactLabel(selectedConversation)}
            </h3>
            <p className="break-all text-xs text-muted-foreground">
              Conversa · {selectedConversation.conversationId.slice(-8)}
            </p>
          </div>
          <Button
            variant="outline"
            disabled={busy}
            aria-expanded={choosing}
            aria-controls="manual-search-results"
            onClick={() => setChoosing((value) => !value)}
          >
            {choosing ? "Manter esta conversa" : "Trocar conversa"}
          </Button>
        </div>
      )}
      {choosing && (
        <div id="manual-search-results" className="min-w-0 space-y-3">
          <form
            role="search"
            aria-label="Buscar conversa para atendimento"
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              changeSearch({ query: query.trim(), page: 1, pageSize: 25 });
            }}
          >
            <div className="min-w-0 flex-1 basis-48 space-y-1.5">
              <label className="block text-sm font-medium" htmlFor="manual-conversation-query">
                Nome ou ID do contato
              </label>
              <input
                ref={searchInput}
                id="manual-conversation-query"
                type="search"
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                maxLength={100}
                autoComplete="off"
                placeholder="Busque uma conversa recebida"
              />
            </div>
            <Button type="submit" variant="outline">
              Buscar conversa
            </Button>
          </form>
          <div aria-live="polite" aria-atomic="true" className="text-sm text-muted-foreground">
            {searchBusy
              ? "Buscando conversas…"
              : searchError
                ? "A busca não foi concluída. Tente novamente."
                : searchRequest.query
                  ? `Resultados para “${searchRequest.query}”`
                  : "Conversas recebidas mais recentes"}
          </div>
          {searchError && (
            <Button
              variant="outline"
              onClick={() => changeSearch({ query: searchRequest.query, page: 1, pageSize: 25 })}
            >
              Tentar busca novamente
            </Button>
          )}
          {!searchBusy &&
            !searchError &&
            (visibleResults.length ? (
              <ul
                aria-label="Conversas encontradas"
                className="max-h-64 divide-y overflow-y-auto rounded-lg border"
              >
                {visibleResults.map((item) => (
                  <li key={keyOf(item)}>
                    <button
                      type="button"
                      className="flex w-full min-w-0 items-start justify-between gap-3 px-3 py-3 text-left text-sm hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60"
                      disabled={busy}
                      aria-pressed={keyOf(item) === selected}
                      aria-label={`Abrir conversa de ${contactLabel(item)} · ${item.conversationId.slice(-8)}`}
                      onClick={() => chooseConversation(item)}
                    >
                      <span className="min-w-0 space-y-1">
                        <span className="block break-words font-medium">{contactLabel(item)}</span>
                        <span className="block break-all text-xs text-muted-foreground">
                          Contato · {item.contactId.slice(-8)} · Conversa ·{" "}
                          {item.conversationId.slice(-8)}
                          {item.channel ? ` · ${item.channel}` : " · Canal a conferir"}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {keyOf(item) === selected
                          ? "Selecionada"
                          : item.paused
                            ? "Com a equipe"
                            : "Abrir"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-3 text-sm text-muted-foreground">
                {searchRequest.query
                  ? "Nenhuma conversa encontrada. Confira o nome ou procure pelo ID do contato."
                  : "As conversas recebidas aparecerão aqui. Nenhum histórico é aberto até você selecionar um contato."}
              </p>
            ))}
          {!searchBusy && !searchError && (searchRequest.page > 1 || hasMore) && (
            <nav
              aria-label="Páginas de conversas"
              className="flex flex-wrap items-center justify-between gap-2"
            >
              <span className="text-xs tabular-nums text-muted-foreground">
                Página {searchRequest.page}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  disabled={searchRequest.page <= 1}
                  onClick={() =>
                    changeSearch({
                      ...searchRequest,
                      page: searchRequest.page - 1,
                      asOf: searchResult?.asOf,
                    })
                  }
                >
                  Conversas anteriores
                </Button>
                <Button
                  variant="outline"
                  disabled={!hasMore}
                  onClick={() =>
                    changeSearch({
                      ...searchRequest,
                      page: searchRequest.page + 1,
                      asOf: searchResult?.asOf,
                    })
                  }
                >
                  Próximas conversas
                </Button>
              </div>
            </nav>
          )}
        </div>
      )}
      {notice && (
        <p role="status" className="rounded-lg border p-3 text-sm">
          {notice}
        </p>
      )}
      {conversation && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-medium">
              {context?.snapshot.name ?? "Carregando contato…"}
              {latestInbound ? ` · ${latestInbound.channel}` : ""}
            </p>
            <a href={link} target="_blank" rel="noreferrer" className="text-sm underline">
              Abrir esta conversa no HighLevel
            </a>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={busy || disabled} onClick={() => void run(reload)}>
              Atualizar histórico
            </Button>
            <Button
              variant="outline"
              disabled={
                busy || disabled || !context || context.optOut || stale || Boolean(unresolved)
              }
              onClick={() =>
                void run(async () => {
                  if (!context) return;
                  await actions.pause(conversation, context.sessionVersion, !context.paused);
                  await reload();
                })
              }
            >
              {context?.paused ? "Devolver ao agente" : "Assumir conversa para escrever"}
            </Button>
          </div>
          {context && (
            <>
              <p className="text-xs text-muted-foreground break-all">
                Contato: {conversation.contactId} · Conversa: {conversation.conversationId}
              </p>
              <div
                aria-label="Histórico atual do atendimento manual"
                className="max-h-72 space-y-3 overflow-y-auto rounded-xl bg-secondary/40 p-4"
              >
                {context.snapshot.messages.slice(-12).map((m) => (
                  <div
                    key={m.id}
                    className={`max-w-[95%] rounded-xl border p-3 text-sm sm:max-w-[85%] ${m.direction === "outbound" ? "ml-auto bg-background" : "bg-secondary"}`}
                  >
                    <p className="mb-1 text-xs font-medium text-muted-foreground">
                      {m.direction === "inbound" ? "Contato" : "Equipe"}
                    </p>
                    <p className="whitespace-pre-wrap break-words">{m.text}</p>
                    {m.attachments > 0 && (
                      <p className="mt-2 text-xs">Anexo disponível no HighLevel</p>
                    )}
                  </div>
                ))}
              </div>
              {stale && (
                <p role="alert" className="text-sm">
                  A conversa mudou. Atualize o histórico; seu texto permanece salvo neste painel.
                </p>
              )}
              {context.blockedReason && (
                <p role="alert" className="text-sm">
                  {errors[context.blockedReason] ??
                    "Envio indisponível para esta conversa. Confira no HighLevel."}
                </p>
              )}
              {!context.paused && (
                <p className="text-sm text-muted-foreground">
                  Assuma a conversa para liberar a escrita manual.
                </p>
              )}
              <label htmlFor="manual-message" className="block text-sm font-medium">
                Sua mensagem para {context.snapshot.name}
              </label>
              <textarea
                id="manual-message"
                className="min-h-28 w-full resize-y rounded-xl border bg-background p-3 text-sm"
                placeholder="Escreva a mensagem que a equipe deseja enviar…"
                value={text}
                maxLength={1500}
                disabled={busy || blocked}
                onChange={(e) => {
                  setDrafts((d) => ({ ...d, [selected]: e.target.value }));
                  setPrepared(null);
                }}
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  {text.length}/1500 caracteres · Texto escrito pela equipe
                </p>
                <Button
                  disabled={busy || blocked || !text.trim()}
                  onClick={() =>
                    void run(async () => {
                      const result = await actions.prepare({
                        contactId: conversation.contactId,
                        conversationId: conversation.conversationId,
                        expectedVersion: context.sessionVersion,
                        historyHash: context.snapshot.historyHash,
                        text: text.trim(),
                        requestId: crypto.randomUUID(),
                      });
                      setContext((current) =>
                        current
                          ? { ...current, paused: true, sessionVersion: result.sessionVersion }
                          : current,
                      );
                      setSelectedConversation((current) =>
                        current
                          ? { ...current, paused: true, sessionVersion: result.sessionVersion }
                          : current,
                      );
                      setPrepared(result);
                      await actions.refresh();
                    })
                  }
                >
                  Revisar mensagem manual
                </Button>
              </div>
              {unresolved && (
                <div className="space-y-2 rounded-xl border p-4">
                  <p className="text-sm">
                    Há um envio manual sem confirmação. Confira no HighLevel antes de continuar; o
                    sistema não repetirá essa mensagem.
                  </p>
                  <label htmlFor="manual-receipt" className="block text-sm">
                    ID da mensagem encontrada no HighLevel
                  </label>
                  <input
                    id="manual-receipt"
                    className="w-full rounded-lg border bg-background p-3 text-sm"
                    value={receipt}
                    onChange={(e) => setReceipt(e.target.value)}
                    maxLength={100}
                    autoComplete="off"
                  />
                  <Button
                    variant="outline"
                    disabled={busy || disabled || !/^[A-Za-z0-9_-]{1,100}$/.test(receipt.trim())}
                    onClick={() =>
                      void run(async () => {
                        await actions.reconcile(context.lastDispatch!.id, receipt.trim());
                        await reload();
                        setReceipt("");
                        setNotice(
                          "Mensagem conferida. O agente continua pausado para atendimento pela equipe.",
                        );
                      })
                    }
                  >
                    Conferir envio manual
                  </Button>
                </div>
              )}
            </>
          )}
        </>
      )}
      <Dialog open={Boolean(prepared)} onOpenChange={(open) => !open && !busy && setPrepared(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enviar mensagem da equipe</DialogTitle>
            <DialogDescription>
              Destinatário: {prepared?.snapshot.name}. Confira o texto exato. O agente continuará
              pausado.
            </DialogDescription>
          </DialogHeader>
          <p className="text-xs break-all">
            Contato: {prepared?.snapshot.event.contactId} · Conversa:{" "}
            {prepared?.snapshot.event.conversationId}
          </p>
          <p className="whitespace-pre-wrap break-words rounded-lg bg-secondary p-4 text-sm">
            {prepared?.text}
          </p>
          {prepared && Date.parse(prepared.expiresAt) <= clock && (
            <p role="alert" className="text-sm">
              Esta revisão expirou. Volte e revise novamente.
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setPrepared(null)}>
              Voltar à edição
            </Button>
            <Button
              disabled={
                busy ||
                disabled ||
                !prepared ||
                Date.parse(prepared.expiresAt) <= clock ||
                prepared.snapshot.event.contactId !== conversation?.contactId ||
                prepared.snapshot.event.conversationId !== conversation?.conversationId ||
                (conversation?.sessionVersion ?? 0) > prepared.sessionVersion
              }
              onClick={() =>
                void run(async () => {
                  if (!prepared) return;
                  let outcome;
                  try {
                    outcome = await actions.send(prepared);
                  } catch (error) {
                    setPrepared(null);
                    try {
                      await reload();
                    } catch {
                      /* Preserve the original send uncertainty. */
                    }
                    throw error;
                  }
                  setPrepared(null);
                  if (outcome.state === "sent") {
                    setDrafts((d) => ({ ...d, [selected]: "" }));
                    setNotice(
                      "Mensagem manual aceita pelo HighLevel. Confira a entrega na conversa. O agente continua pausado.",
                    );
                  } else
                    setNotice(
                      outcome.state === "unknown"
                        ? errors["send_unknown"]!
                        : "A mensagem foi recusada. Confira a conversa e atualize o histórico antes de tentar novamente.",
                    );
                  // A failed refresh must never be presented as a failed send or invite a retry.
                  try {
                    await reload();
                  } catch {
                    setNotice((n) => `${n} Não foi possível atualizar o histórico agora.`);
                  }
                })
              }
            >
              Confirmar e enviar mensagem manual
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
