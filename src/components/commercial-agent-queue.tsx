import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CommercialAgentManual, type ManualActions } from "./commercial-agent-manual";
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
  type ManualConversation,
} from "@/lib/commercial-agent/core";

import type {
  QueueCategory,
  QueuePageRequest,
  QueuePagination,
} from "@/lib/commercial-agent/queue-read";

export type QueueItem = Omit<DraftRow, "payload"> & {
  content: DraftPayload | null;
  contactName?: string | null;
  channel?: string | null;
  category?: QueueCategory;
  policyCurrent?: boolean;
};
export type QueueView = {
  enabled: boolean;
  sendEnabled: boolean;
  items: QueueItem[];
  errors: QueueError[];
  settings?: Settings;
  manualConversations?: ManualConversation[];
  pagination?: QueuePagination;
  counts?: Record<QueueCategory, number>;
  failedEventCount?: number;
  ignoredEventCount?: number;
};
export type QueueActions = {
  refresh(): Promise<void>;
  navigate?(request: QueuePageRequest): Promise<void>;
  manual?: ManualActions;
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
  queue_read_unavailable:
    "A nova fila aguarda atualização do serviço. Nenhuma pendência foi descartada. Tente atualizar após a implantação.",
};

const queueCategories: { id: QueueCategory; label: string; empty: string }[] = [
  { id: "review", label: "Revisar", empty: "Nenhuma resposta pronta para revisão nesta busca." },
  {
    id: "team",
    label: "Com a equipe",
    empty: "Nenhum atendimento exige decisão da equipe nesta busca.",
  },
  {
    id: "uncertain",
    label: "Envio a conferir",
    empty: "Nenhum envio precisa de conferência nesta busca.",
  },
  { id: "history", label: "Histórico", empty: "Nenhum registro encontrado neste histórico." },
];

function contactLabel(item: QueueItem) {
  return (
    item.contactName || item.content?.snapshot.name || `Contato · ${item.contact_id.slice(-6)}`
  );
}

export function CommercialAgentQueue({
  view,
  actions,
  demo = false,
  focused = false,
  loading = false,
  unavailable = false,
}: {
  view: QueueView;
  actions: QueueActions;
  demo?: boolean;
  focused?: boolean;
  loading?: boolean;
  unavailable?: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null),
    [confirm, setConfirm] = useState<QueueItem | null>(null),
    [busy, setBusy] = useState(false),
    [receiptId, setReceiptId] = useState(""),
    [notice, setNotice] = useState("");
  const [clock, setClock] = useState(Date.now());
  const [detailOpen, setDetailOpen] = useState(focused);
  const [search, setSearch] = useState(view.pagination?.query ?? "");
  const [navigating, setNavigating] = useState(false);
  const [queryFailed, setQueryFailed] = useState(false);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const rowButtons = useRef(new Map<string, HTMLButtonElement>());
  const wasDetailOpen = useRef(detailOpen);
  const lastAvailableView = useRef(view);
  useEffect(() => {
    if (!unavailable && view !== lastAvailableView.current) {
      lastAvailableView.current = view;
      setQueryFailed(false);
    }
  }, [view, unavailable]);
  useEffect(() => setSearch(view.pagination?.query ?? ""), [view.pagination?.query]);
  useEffect(() => {
    if (detailOpen && !wasDetailOpen.current) reviewHeading.current?.focus();
    if (!detailOpen && wasDetailOpen.current && selected) rowButtons.current.get(selected)?.focus();
    wasDetailOpen.current = detailOpen;
  }, [detailOpen, selected]);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 10000);
    return () => clearInterval(timer);
  }, []);
  const row = selected ? view.items.find((x) => x.id === selected) : view.items[0];
  const content = row?.content;
  const attendanceHref =
    !demo &&
    row?.contact_id &&
    row.conversation_id &&
    row.organization_id === view.settings?.organization_id &&
    row.location_id === view.settings?.location_id
      ? `/caixa-de-entrada?${new URLSearchParams({ contact: row.contact_id, conversation: row.conversation_id })}`
      : null;
  const attendanceLink = attendanceHref ? (
    <a
      href={attendanceHref}
      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none"
    >
      {row?.state === "pending" && content ? "Ajustar no Meu Chat" : "Abrir no Meu Chat"}
      <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
    </a>
  ) : null;
  const expired = row
    ? !Number.isFinite(Date.parse(row.expires_at)) || Date.parse(row.expires_at) <= clock
    : true;
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
      loading ||
      unavailable ||
      queryFailed ||
      navigating ||
      !view.sendEnabled ||
      !item ||
      !item.content ||
      !sendAllowed(item) ||
      item.state !== "pending" ||
      item.paused ||
      item.opt_out ||
      item.content.snapshot.dnd ||
      (item.session_version !== undefined && item.contact_version !== item.session_version) ||
      item.policyCurrent === false ||
      !Number.isFinite(Date.parse(item.expires_at)) ||
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
  async function act(fn: () => Promise<void>, refreshAfter = true) {
    setBusy(true);
    setNotice("");
    try {
      await fn();
      if (refreshAfter) await actions.refresh();
      setQueryFailed(false);
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
  async function navigate(request: QueuePageRequest) {
    if (!actions.navigate || navigating || busy || loading) return;
    setNavigating(true);
    setNotice("");
    setConfirm(null);
    try {
      await actions.navigate(request);
      setQueryFailed(false);
      setSelected(null);
      setDetailOpen(false);
      setReceiptId("");
    } catch (error) {
      setQueryFailed(true);
      const code = error instanceof Error ? error.message : "internal_error";
      setNotice(friendlyError[code] ?? "Não foi possível consultar a fila. Tente novamente.");
    } finally {
      setNavigating(false);
    }
  }
  const page = view.pagination;
  const actionBusy = busy || navigating || loading || unavailable || queryFailed;
  const category = queueCategories.find((item) => item.id === page?.category);
  const failures = view.errors.filter((event) => event.state === "failed");
  const historicalEvents = view.errors.filter((event) => event.state !== "failed");
  return (
    <div className="space-y-4">
      <section
        data-agent-toolbar
        className="flex flex-wrap items-start justify-between gap-x-3 gap-y-3 sm:gap-x-6"
      >
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge variant="outline">Treinamento V02</Badge>
            <Badge>
              {demo
                ? "Demonstração com dados fictícios"
                : view.enabled
                  ? "Supervisionado"
                  : "Agente desativado"}
            </Badge>
            <Badge variant="outline">
              {view.sendEnabled ? "Aprovação obrigatória" : "Envio desativado"}
            </Badge>
            {!focused && view.settings?.receive_all_contacts && (
              <details className="text-sm text-muted-foreground">
                <summary className="min-h-11 w-fit cursor-pointer content-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  Configuração de recebimento e envio
                </summary>
                <p className="mt-2 max-w-prose">
                  Recebimento geral{" "}
                  {view.enabled && view.settings.mode === "supervised" ? "ativo" : "desativado"}.
                  Novas mensagens individuais desta clínica entram para revisão. Respostas sugeridas
                  nos canais:{" "}
                  {view.settings.allowed_channels.join(", ") || "nenhum canal autorizado"}. Outros
                  canais exigem revisão manual. O envio de sugestões da IA continua restrito a{" "}
                  {view.settings.allowed_contacts.length}{" "}
                  {view.settings.allowed_contacts.length === 1
                    ? "contato autorizado"
                    : "contatos autorizados"}
                  .
                  {view.settings.manual_send_all_contacts &&
                    " A equipe pode escrever e enviar manualmente aos contatos recebidos pelo canal homologado."}
                </p>
              </details>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Revise uma conversa por vez. Aprovar uma resposta envia a mensagem.
          </p>
          {demo && (
            <p className="mt-2 text-sm font-medium">
              HighLevel e OpenAI simulados. Nenhuma mensagem sai para pacientes.
            </p>
          )}
        </div>
        <Button
          variant="outline"
          className="min-h-11 min-w-11 px-3 shadow-none transition-opacity duration-150 active:scale-100 motion-reduce:transition-none sm:px-4"
          disabled={busy || navigating || loading}
          onClick={() => void act(actions.refresh, false)}
        >
          <RefreshCw aria-hidden="true" />
          <span className="sr-only sm:not-sr-only">Atualizar fila</span>
        </Button>
      </section>
      {notice && (
        <p
          role="status"
          className="rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm"
        >
          {notice}
        </p>
      )}
      {page && actions.navigate && !focused && (
        <div
          className={`space-y-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,1fr)] xl:items-center xl:gap-3 xl:space-y-0 ${detailOpen ? "hidden lg:block xl:grid" : "block xl:grid"}`}
        >
          <div
            data-agent-categories
            className="grid grid-cols-2 gap-2 lg:grid-cols-4"
            role="group"
            aria-label="Filtrar atendimentos"
          >
            {queueCategories.map((option) => (
              <Button
                key={option.id}
                variant="outline"
                className={`h-auto min-h-12 justify-between gap-2 whitespace-normal rounded-xl px-3 py-2.5 text-left shadow-none transition-opacity duration-150 active:scale-100 motion-reduce:transition-none sm:px-4 ${page.category === option.id ? "border-primary bg-primary/15 text-foreground hover:bg-primary/20" : "bg-card text-muted-foreground"}`}
                aria-label={`${option.label}${view.counts ? ` (${view.counts[option.id]})` : ""}`}
                aria-pressed={page.category === option.id}
                disabled={navigating || busy || loading}
                onClick={() =>
                  void navigate({
                    category: option.id,
                    query: page.query,
                    page: 1,
                    pageSize: page.pageSize,
                  })
                }
              >
                <span>{option.label}</span>
                {view.counts && (
                  <span
                    aria-hidden="true"
                    className={`min-w-7 shrink-0 text-right text-base font-semibold tabular-nums ${page.category === option.id ? "text-foreground" : "text-muted-foreground"}`}
                  >
                    {view.counts[option.id]}
                  </span>
                )}
              </Button>
            ))}
          </div>
          <form
            className="flex flex-wrap items-end gap-2"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              void navigate({
                category: page.category,
                query: search.trim(),
                page: 1,
                pageSize: page.pageSize,
              });
            }}
          >
            <div className="relative min-w-0 flex-[1_1_16rem]">
              <label htmlFor="agent-queue-search" className="sr-only">
                Buscar contato nesta fila
              </label>
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted-foreground"
              />
              <input
                id="agent-queue-search"
                type="search"
                maxLength={100}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar contato por nome ou ID"
                className="h-11 w-full rounded-lg border bg-card pl-10 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <Button
              type="submit"
              variant="outline"
              className="min-h-11 shadow-none transition-opacity duration-150 active:scale-100 motion-reduce:transition-none"
              disabled={busy || navigating || loading}
            >
              Buscar
            </Button>
            {page.query && (
              <Button
                type="button"
                variant="ghost"
                className="min-h-11 transition-opacity duration-150 active:scale-100 motion-reduce:transition-none"
                disabled={busy || navigating || loading}
                onClick={() => {
                  setSearch("");
                  void navigate({
                    category: page.category,
                    query: "",
                    page: 1,
                    pageSize: page.pageSize,
                  });
                }}
              >
                Limpar busca
              </Button>
            )}
          </form>
          {navigating && (
            <p role="status" className="text-sm text-muted-foreground xl:col-span-2">
              Consultando atendimentos…
            </p>
          )}
        </div>
      )}
      <div className="grid min-w-0 overflow-hidden rounded-lg border bg-card lg:grid-cols-[320px_minmax(0,1fr)]">
        <section
          className={`min-w-0 overflow-hidden lg:border-r ${detailOpen ? "hidden lg:block" : "block"}`}
          aria-label="Fila de respostas"
          aria-busy={navigating}
        >
          <div className="border-b bg-secondary/40 px-4 py-3">
            <h2 className="text-sm font-semibold">
              {focused ? "Respostas desta conversa" : (category?.label ?? "Respostas recebidas")}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground" aria-live="polite">
              {page
                ? `${page.total} ${page.total === 1 ? "registro encontrado" : "registros encontrados"}${page.query ? ` para “${page.query}”` : ""}`
                : `${view.items.length} ${view.items.length === 1 ? "registro nesta consulta" : "registros nesta consulta"}`}
            </p>
          </div>
          {view.items.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">
              {focused
                ? "Nenhuma resposta disponível para esta conversa."
                : (category?.empty ?? "Nenhuma resposta disponível nesta consulta.")}
            </p>
          ) : (
            <ul className="max-h-[min(32rem,60dvh)] divide-y overflow-y-auto overscroll-contain lg:max-h-[calc(100dvh-27rem)] lg:min-h-72">
              {view.items.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    ref={(element) => {
                      if (element) rowButtons.current.set(d.id, element);
                      else rowButtons.current.delete(d.id);
                    }}
                    className={`min-h-11 w-full px-4 py-3.5 text-left transition-opacity duration-150 hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60 motion-reduce:transition-none ${row?.id === d.id ? "bg-primary/10" : ""}`}
                    aria-pressed={row?.id === d.id}
                    disabled={navigating || busy || loading}
                    onClick={() => {
                      setSelected(d.id);
                      setDetailOpen(true);
                      setConfirm(null);
                      setNotice("");
                      setReceiptId("");
                    }}
                  >
                    <p className="break-words text-sm font-semibold">{contactLabel(d)}</p>
                    <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                      {d.content?.snapshot.messages.at(-1)?.text ??
                        "Conteúdo indisponível para revisão. Consulte o registro original."}
                    </p>
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                      {d.channel || d.content?.snapshot.messages.at(-1)?.channel
                        ? `${d.channel || d.content?.snapshot.messages.at(-1)?.channel} · `
                        : ""}
                      {labels[d.state] ?? d.state}
                      {d.paused ? " · Com a equipe humana" : ""}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {page && actions.navigate && !focused && (
            <nav
              className="flex flex-wrap items-center justify-between gap-2 border-t bg-card px-3 py-2"
              aria-label="Páginas da fila"
            >
              <Button
                variant="outline"
                size="sm"
                className="min-h-11 shadow-none transition-opacity duration-150 active:scale-100 motion-reduce:transition-none"
                disabled={navigating || busy || loading || page.page <= 1}
                onClick={() =>
                  void navigate({
                    category: page.category,
                    query: page.query,
                    page: page.page - 1,
                    pageSize: page.pageSize,
                    asOf: page.asOf,
                  })
                }
              >
                Anterior
              </Button>
              <span className="text-xs tabular-nums">
                {page.page} de {Math.max(1, page.totalPages)}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="min-h-11 shadow-none transition-opacity duration-150 active:scale-100 motion-reduce:transition-none"
                disabled={navigating || busy || loading || !page.hasMore}
                onClick={() =>
                  void navigate({
                    category: page.category,
                    query: page.query,
                    page: page.page + 1,
                    pageSize: page.pageSize,
                    asOf: page.asOf,
                  })
                }
              >
                Próxima
              </Button>
            </nav>
          )}
        </section>
        {row && content ? (
          <section
            data-agent-review
            className={`min-w-0 p-4 sm:p-6 ${detailOpen || focused ? "block" : "hidden lg:block"}`}
            aria-label="Revisão da resposta"
          >
            {!focused && (
              <Button
                variant="ghost"
                className="mb-3 min-h-11 px-0 transition-opacity duration-150 active:scale-100 motion-reduce:transition-none lg:hidden"
                onClick={() => setDetailOpen(false)}
              >
                <ArrowLeft aria-hidden="true" />
                Voltar à fila
              </Button>
            )}
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h2
                  ref={reviewHeading}
                  tabIndex={-1}
                  className="scroll-mt-60 break-words text-lg font-semibold focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:scroll-mt-48 lg:scroll-mt-32"
                >
                  {contactLabel(row)}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {content.snapshot.messages.at(-1)?.channel} · {labels[row.state] ?? row.state}
                </p>
              </div>
              {attendanceLink}
              {!demo && (
                <a
                  className="inline-flex min-h-11 items-center gap-1.5 rounded text-sm underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  target="_blank"
                  rel="noreferrer"
                  href={`https://app.leadconnectorhq.com/v2/location/${row.location_id}/conversations/conversations/${row.conversation_id}`}
                >
                  Conferir no HighLevel
                  <ArrowUpRight aria-hidden="true" className="size-4" />
                </a>
              )}
            </div>
            <details className="mt-1 border-b pb-1 text-xs text-muted-foreground">
              <summary className="min-h-11 w-fit cursor-pointer content-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                Identificação do destinatário
              </summary>
              <p className="mt-2 break-all">
                Contato: {row.contact_id}
                <br />
                Conversa: {row.conversation_id}
                <br />
                Mensagem recebida: {row.message_id}
              </p>
            </details>
            <h3 className="mb-3 mt-4 text-sm font-semibold">Histórico recuperado</h3>
            <div
              role="region"
              aria-label="Histórico recuperado"
              tabIndex={0}
              className="max-h-72 space-y-3 overflow-y-auto overscroll-contain rounded-xl pb-1 pr-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              {content.snapshot.messages.slice(-12).map((m) => (
                <div
                  key={m.id}
                  data-agent-message={m.direction}
                  className={`max-w-[95%] rounded-xl p-3 text-sm leading-relaxed sm:max-w-[85%] ${m.direction === "outbound" ? "ml-auto bg-primary/10" : "bg-secondary"}`}
                >
                  <p className="mb-1 text-xs font-medium text-muted-foreground">
                    {m.direction === "inbound" ? "Contato" : "Equipe"}
                  </p>
                  <p className="max-w-prose whitespace-pre-wrap break-words">{m.text}</p>
                  {m.attachments > 0 && (
                    <p className="mt-2 text-xs">Anexo disponível para revisão no HighLevel</p>
                  )}
                </div>
              ))}
            </div>
            <h3 className="mb-2 mt-5 text-sm font-semibold">Resposta proposta</h3>
            <blockquote
              data-agent-proposal
              className="max-w-prose whitespace-pre-wrap break-words rounded-xl border border-primary/40 bg-primary/5 p-4 text-sm leading-relaxed"
            >
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
            {content.snapshot.dnd && !row.opt_out && (
              <p role="status" className="mt-4 text-sm font-medium">
                Contato com DND ativo. O envio está bloqueado.
              </p>
            )}
            {!sendAllowed(row) && (
              <p role="status" className="mt-4 text-sm font-medium">
                {!view.settings && !demo
                  ? "Não foi possível verificar quais destinatários e canais têm envio liberado. Atualize a fila antes de aprovar."
                  : "Esta entrada está em revisão. O envio desta sugestão da IA não está liberado para este destinatário ou canal. Para responder como equipe, use Atendimento manual."}
              </p>
            )}
            {row.state === "invalidated" && (
              <p role="status" className="mt-4 text-sm font-medium">
                Este rascunho ficou desatualizado e não pode ser enviado. Retomar o agente não
                reativa respostas antigas. Uma nova mensagem do contato poderá gerar outro rascunho.
              </p>
            )}
            {row.policyCurrent === false && row.state === "pending" && (
              <p role="status" className="mt-4 text-sm font-medium">
                A base de atendimento mudou desde esta sugestão. Este texto não pode ser aprovado.
              </p>
            )}
            {row.session_version !== undefined && row.contact_version !== row.session_version && (
              <p role="status" className="mt-4 text-sm font-medium">
                A conversa mudou desde esta sugestão. Atualize o histórico antes de responder; esta
                versão não pode ser aprovada.
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
                  if (actionBusy) return;
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
                  className="min-h-11 w-full rounded-lg border bg-background p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={receiptId}
                  onChange={(event) => setReceiptId(event.target.value)}
                  maxLength={100}
                  pattern="[A-Za-z0-9_-]{1,100}"
                  required
                  autoComplete="off"
                />
                <Button
                  type="submit"
                  variant="outline"
                  className="h-auto min-h-11 whitespace-normal text-left shadow-none transition-opacity duration-150 active:scale-100 motion-reduce:transition-none"
                  disabled={actionBusy || !receiptId.trim()}
                >
                  Conferir mensagem e registrar envio
                </Button>
                <p className="text-xs text-muted-foreground">
                  Verifica destinatário, conversa, texto e horário. Não envia outra mensagem.
                </p>
              </form>
            )}
            <div data-agent-actions className="mt-5 flex flex-wrap gap-2 border-t pt-4">
              <Button
                className="h-auto min-h-11 whitespace-normal shadow-none transition-opacity duration-150 active:scale-100 motion-reduce:transition-none"
                disabled={actionBusy || blocked}
                onClick={() => setConfirm(row)}
              >
                {demo ? "Aprovar envio simulado" : "Revisar e aprovar envio"}
              </Button>
              <Button
                variant="outline"
                className="h-auto min-h-11 whitespace-normal shadow-none transition-opacity duration-150 active:scale-100 motion-reduce:transition-none"
                disabled={actionBusy || row.state !== "pending"}
                onClick={() => void act(() => actions.reject(row))}
              >
                Rejeitar rascunho
              </Button>
              <Button
                variant="outline"
                className="h-auto min-h-11 whitespace-normal shadow-none transition-opacity duration-150 active:scale-100 motion-reduce:transition-none"
                disabled={actionBusy || row.opt_out}
                onClick={() => void act(() => actions.pause(row, !row.paused))}
              >
                {row.paused ? "Retomar agente" : "Assumir atendimento"}
              </Button>
            </div>
            <p className="mt-3 max-w-prose text-xs leading-relaxed text-muted-foreground">
              Uma nova mensagem invalida esta aprovação. “Aceita pelo HighLevel” não confirma
              entrega ou leitura.
            </p>
          </section>
        ) : (
          <section
            data-agent-review
            className={`min-w-0 p-4 sm:p-6 ${detailOpen || focused ? "block" : "hidden lg:block"}`}
            aria-label="Revisão da resposta"
          >
            {!focused && detailOpen && (
              <Button
                variant="ghost"
                className="mb-3 min-h-11 px-0 transition-opacity duration-150 active:scale-100 motion-reduce:transition-none lg:hidden"
                onClick={() => setDetailOpen(false)}
              >
                <ArrowLeft aria-hidden="true" />
                Voltar à fila
              </Button>
            )}
            <h2
              ref={reviewHeading}
              tabIndex={-1}
              className="scroll-mt-60 break-words font-semibold focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:scroll-mt-48 lg:scroll-mt-32"
            >
              {row ? contactLabel(row) : "Selecione um atendimento"}
            </h2>
            <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
              {row
                ? "O conteúdo deste registro não está disponível para revisão. Nenhuma resposta pode ser aprovada aqui."
                : selected
                  ? "Este item saiu da consulta atual. Volte à fila para escolher outro atendimento."
                  : "Abra um registro da fila para conferir o histórico e a próxima ação."}
            </p>
            {row && ["unknown", "sending"].includes(row.state) && (
              <p role="alert" className="mt-3 text-sm font-medium">
                Este envio precisa de conferência, mesmo sem o conteúdo disponível. Confira a
                conversa no HighLevel antes de qualquer nova mensagem.
              </p>
            )}
            {attendanceLink && <div className="mt-4">{attendanceLink}</div>}
            {row && !demo && (
              <a
                className="mt-4 inline-flex min-h-11 items-center gap-1.5 rounded text-sm underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                target="_blank"
                rel="noreferrer"
                href={`https://app.leadconnectorhq.com/v2/location/${row.location_id}/conversations/conversations/${row.conversation_id}`}
              >
                Conferir registro no HighLevel
                <ArrowUpRight aria-hidden="true" className="size-4" />
              </a>
            )}
          </section>
        )}
      </div>
      {actions.manual && !demo && !focused && (
        <details className="border-t pt-1">
          <summary className="min-h-11 w-fit cursor-pointer content-center rounded text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Abrir atendimento manual
          </summary>
          <div className="mt-4">
            <CommercialAgentManual
              disabled={loading || unavailable || navigating || queryFailed}
              conversations={view.manualConversations ?? []}
              names={Object.fromEntries(
                view.items
                  .filter((item) => item.contactName || item.content)
                  .map((item) => [item.contact_id, contactLabel(item)]),
              )}
              actions={actions.manual}
            />
          </div>
        </details>
      )}
      {(view.failedEventCount ?? failures.length) > 0 && (
        <details className="border-t pt-1">
          <summary className="min-h-11 w-fit cursor-pointer content-center rounded text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Falhas que exigem análise ({view.failedEventCount ?? failures.length})
          </summary>
          <p className="mt-1 text-sm text-muted-foreground">
            Registros técnicos de processamento. Conferir uma falha não repete o envio.
          </p>
          {(view.failedEventCount ?? failures.length) > failures.length && (
            <p className="mt-1 text-xs text-muted-foreground">
              Exibindo os {failures.length} registros mais recentes.
            </p>
          )}
          <ul className="mt-3 space-y-2 text-xs">
            {failures.map((e) => (
              <li key={e.id} className="break-words">
                {e.error_code} · tentativa {e.attempts} · {e.state}
              </li>
            ))}
          </ul>
        </details>
      )}
      {(view.ignoredEventCount ?? historicalEvents.length) > 0 && (
        <details className="border-t pt-1">
          <summary className="min-h-11 w-fit cursor-pointer content-center rounded text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Eventos ignorados ({view.ignoredEventCount ?? historicalEvents.length})
          </summary>
          <p className="mt-2 text-sm text-muted-foreground">
            Mensagens substituídas por uma mais recente não são falhas de envio.
          </p>
          <ul className="mt-3 space-y-2 text-xs">
            {historicalEvents.map((event) => (
              <li key={event.id} className="break-words">
                {event.error_code === "newer_message_exists"
                  ? "Ignorada porque chegou uma mensagem mais recente"
                  : event.error_code}{" "}
                · {event.state}
              </li>
            ))}
          </ul>
        </details>
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
            <Button
              variant="outline"
              className="h-auto min-h-11 whitespace-normal transition-opacity duration-150 active:scale-100 motion-reduce:transition-none"
              disabled={busy}
              onClick={() => setConfirm(null)}
            >
              Voltar à revisão
            </Button>
            <Button
              className="h-auto min-h-11 whitespace-normal transition-opacity duration-150 active:scale-100 motion-reduce:transition-none"
              disabled={actionBusy || !confirm || confirmationBlocked}
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
