import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  ExternalLink,
  ArrowLeft,
  ArrowDown,
  Mic,
  Paperclip,
  RefreshCw,
  Send,
  Sparkles,
  SpellCheck,
  Square,
  UserRound,
  Undo2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { InboxContextDock } from "@/components/inbox-context-dock";
import { AttendanceConversationTarget } from "@/components/attendance-conversation-target";
import { AttendanceContextPanel } from "@/components/attendance-context-panel";
import {
  createAttendanceDraftSync,
  type DraftSendSnapshot,
} from "@/components/attendance-draft-sync";
import {
  loadAttendanceDraft,
  saveAttendanceDraft,
  clearAttendanceDraft,
} from "@/lib/attendance-draft.functions";
import { useConversasGhl, useMensagensGhl } from "@/lib/ghl-observation";
import { canalMensagem, respostaLiteral, type ConversaGhl } from "@/lib/ghl-observation.core";
import { useOrganizacao } from "@/lib/organization";
import { useModoDados } from "@/lib/repo";
import { formatarDataHora } from "@/lib/clinic-time";
import { aiSupport, type AnaliseIA } from "@/lib/ai.functions";
import { corrigirRascunho } from "@/lib/correcao-texto.functions";
import {
  getInboxSendContext,
  getInboxSendStatus,
  reconcileManualAgentMessage,
  sendInboxMessage,
} from "@/lib/commercial-agent.functions";
import { useInboxMedia, type InboxAttachment } from "@/components/inbox-media";
import {
  createInboxDraftStore,
  filterLoadedConversations,
  inboxAnalysisFingerprint,
  inboxDraftKey,
  useInboxHistoryScroll,
  type InboxDraftStore,
} from "@/components/inbox-workspace";

type EstadoEnvio =
  | { estado: "livre" }
  | { estado: "a_enviar" }
  | { estado: "aceite"; messageId: string }
  | {
      estado: "incerto";
      requestId: string | null;
      manualId: string | null;
      draftRevision?: string | null;
      /** Momento do clique (só informativo; nunca usado para libertar novo envio). */
      desde?: number;
    };
type Revisao = {
  historyHash: string;
  sessionVersion: number;
  channel: "SMS" | "IG" | "FB" | "WhatsApp";
  providerId: string | null;
  defaultId: string | null;
};
type DestinoEnvio = {
  name: string;
  channel: string | null;
  transport: string | null;
  sendAllowed: boolean;
  mediaAllowed: boolean;
  blockedReason: string | null;
  revision: Omit<Revisao, "channel"> & { channel: Revisao["channel"] | null };
  connectionVerifiedAtSend?: boolean;
};
const CHAVE_INTENCAO = "jornada:envio-pendente:";
type Intencao = {
  requestId: string | null;
  manualId: string | null;
  desde: number;
  draftRevision?: string | null;
};
/** Metadados mínimos (sem texto nem dados clínicos) para sobreviver a recarregar a página. */
export function lerIntencao(chave: string): Intencao | null {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE_INTENCAO + chave) ?? "null") as unknown;
    if (!v || typeof v !== "object") return null;
    const o = v as Record<string, unknown>;
    const uuid = /^[0-9a-f-]{36}$/;
    return {
      requestId:
        typeof o["requestId"] === "string" && uuid.test(o["requestId"]) ? o["requestId"] : null,
      manualId:
        typeof o["manualId"] === "string" && uuid.test(o["manualId"]) ? o["manualId"] : null,
      desde: typeof o["desde"] === "number" ? o["desde"] : 0,
      ...(typeof o["draftRevision"] === "string" && uuid.test(o["draftRevision"])
        ? { draftRevision: o["draftRevision"] }
        : {}),
    };
  } catch {
    return null;
  }
}
function gravarIntencao(chave: string, i: Intencao | null) {
  try {
    if (i) localStorage.setItem(CHAVE_INTENCAO + chave, JSON.stringify(i));
    else localStorage.removeItem(CHAVE_INTENCAO + chave);
  } catch {
    /* armazenamento indisponível: o servidor continua a ser a autoridade */
  }
}
const CHAVE_LIMPEZA = "jornada:rascunho-limpeza:";
const EVENTO_LIMPEZA = "jornada:rascunho-limpeza-alterada";
type LimpezaRascunho = { revision: string; requestId: string | null; confirmedAt: number };
/** Each revision has its own key: different tabs cannot overwrite another cleanup obligation.
 * draftKey includes user, organization, contact and conversation. Never persist text or hashes. */
function lerLimpezasRascunho(draftKey: string): LimpezaRascunho[] {
  const prefix = `${CHAVE_LIMPEZA}${draftKey}:`;
  const result: LimpezaRascunho[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(prefix)) continue;
      let value: unknown;
      try {
        value = JSON.parse(localStorage.getItem(key) ?? "null") as unknown;
      } catch {
        continue;
      }
      if (!value || typeof value !== "object") continue;
      const item = value as Record<string, unknown>;
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (
        typeof item["revision"] === "string" &&
        uuid.test(item["revision"]) &&
        key === prefix + item["revision"] &&
        (item["requestId"] === null ||
          (typeof item["requestId"] === "string" && uuid.test(item["requestId"]))) &&
        typeof item["confirmedAt"] === "number" &&
        Number.isFinite(item["confirmedAt"])
      )
        result.push({
          revision: item["revision"],
          requestId: item["requestId"],
          confirmedAt: item["confirmedAt"],
        });
    }
  } catch {
    /* No cleanup success is inferred from unavailable browser storage. */
  }
  return result;
}
function gravarLimpezaRascunho(draftKey: string, entry: LimpezaRascunho, remove = false): boolean {
  try {
    const key = `${CHAVE_LIMPEZA}${draftKey}:${entry.revision}`;
    if (remove) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(entry));
    window.dispatchEvent(new CustomEvent(EVENTO_LIMPEZA, { detail: draftKey }));
    return true;
  } catch {
    return false;
  }
}
const LIMITE = 1500;
const mesmaRevisao = (a: Revisao, b: DestinoEnvio["revision"]) =>
  a.historyHash === b.historyHash &&
  a.sessionVersion === b.sessionVersion &&
  a.channel === b.channel &&
  a.providerId === b.providerId &&
  a.defaultId === b.defaultId;
/** Envios incertos sobrevivem à troca de conversa (o servidor guarda o estado durável). */
export const pendentesEnvio = new Map<string, Extract<EstadoEnvio, { estado: "incerto" }>>();
/** Códigos que comprovadamente acontecem antes de qualquer POST ao GHL. */
const ANTES_DO_ENVIO = new Set([
  "revision_changed",
  "route_changed",
  "route_unverified",
  "route_ambiguous",
  "draft_stale",
  "version_conflict",
  "do_not_contact",
  "unsupported_channel",
  "channel_window",
  "whatsapp_sender_unverified",
  "request_expired",
  "invalid_manual",
  "send_disabled",
  "forbidden",
  "scope_mismatch",
  "inbound_not_verified",
  "history_invalid",
  "history_incomplete",
  "history_conflict",
  "manual_request_mismatch",
  "not_configured",
  "manual_not_configured",
  "encryption_not_configured",
  "media_invalid",
  "media_too_large",
  "media_unsupported",
  "media_channel_unsupported",
  "media_expired",
  "media_not_configured",
]);

const ERROS_ENVIO: Record<string, string> = {
  send_disabled: "O envio por esta tela ainda não está liberado nesta clínica.",
  forbidden: "A sua conta não tem permissão para enviar nesta clínica.",
  scope_mismatch:
    "Esta conversa não pertence à subconta GHL vinculada a esta clínica. Envio bloqueado.",
  not_configured: "O envio manual não está configurado nesta clínica.",
  manual_not_configured: "O envio manual não está configurado nesta clínica.",
  encryption_not_configured: "O envio manual não está configurado nesta clínica.",
  do_not_contact: "Contato com DND ativo ou pedido de interrupção. Envio bloqueado.",
  unsupported_channel:
    "Este canal não tem envio manual por esta tela (só SMS, Instagram, Facebook e WhatsApp). Continue no GHL.",
  channel_window:
    "A última mensagem recebida tem mais de 24 horas: a janela de resposta deste canal fechou. Continue no GHL.",
  whatsapp_sender_unverified:
    "Remetente WhatsApp não identificado: o GHL não indicou o número comercial que recebeu a mensagem. Envio bloqueado.",
  request_expired: "O pedido demorou demais e foi interrompido antes do envio. Nada foi enviado.",
  invalid_manual: "Texto inválido para envio. O texto foi mantido.",
  inbound_not_verified: "Não há mensagem recebida válida para responder.",
  draft_stale: "A conversa mudou. Atualize as mensagens; o texto foi mantido.",
  version_conflict: "A conversa mudou. Atualize as mensagens; o texto foi mantido.",
  history_invalid: "Histórico do GHL inválido. Envio bloqueado.",
  history_incomplete: "Histórico do GHL incompleto. Envio bloqueado.",
  history_conflict: "Histórico do GHL inconsistente. Envio bloqueado.",
  reconciliation_required:
    "Existe um envio sem confirmação nesta conversa. Confira no GHL antes de enviar outra.",
  send_unknown: "Resultado do envio não confirmado. Não repita: confira no GHL.",
  manual_request_used: "Este envio já foi processado. Confira a conversa no GHL.",
  manual_request_mismatch: "Pedido de envio inconsistente. Atualize a página.",
  dispatch_blocked: "Envio bloqueado pelas regras de segurança. Confira no GHL.",
  receipt_not_verified: "O ID indicado não corresponde a este envio.",
  storage_unavailable: "Serviço temporariamente indisponível. O texto foi mantido.",
  draft_binding_invalid:
    "Não foi possível validar o vínculo do rascunho. O texto foi mantido; verifique o estado deste pedido antes de repetir.",
  draft_binding_conflict:
    "O rascunho ou o pedido mudou em outra sessão. O texto foi mantido; verifique o estado do envio antes de repetir.",
  draft_binding_unavailable:
    "Não foi possível confirmar o vínculo do rascunho ao pedido. O texto foi mantido; verifique o estado do envio antes de repetir.",
  route_unverified:
    "Não foi possível comprovar o fornecedor real de envio desta conversa. Envio bloqueado.",
  route_ambiguous:
    "O fornecedor de envio é ambíguo (difere do padrão da subconta). Envio bloqueado.",
  route_changed: "A rota de envio mudou desde a revisão. Nada foi enviado.",
  revision_changed: "A conversa mudou desde a revisão. Nada foi enviado.",
  media_invalid: "O anexo não é válido. Escolha outro arquivo; nada foi enviado.",
  media_too_large: "O anexo deve ter no máximo 5 MB. Nada foi enviado.",
  media_unsupported:
    "Formato de anexo não suportado. Escolha uma imagem JPG, PNG ou GIF, ou áudio MP3, WAV, OGG, M4A ou AAC.",
  media_channel_unsupported:
    "Anexos estão disponíveis apenas na rota SMS com fornecedor identificado, como o Zaptos. Use o GHL para este canal.",
  media_expired: "O anexo expirou antes do envio. Selecione o arquivo novamente.",
  media_not_configured: "O envio de anexos ainda não está configurado nesta clínica.",
};
const erroEnvio = (code: string) =>
  ERROS_ENVIO[code] ?? "Não foi possível enviar. O texto foi mantido.";

export function GhlInbox({
  targetContactId,
  targetConversationId,
}: { targetContactId?: string | undefined; targetConversationId?: string | undefined } = {}) {
  const contexto = useOrganizacao();
  const { escopo } = useModoDados();
  const [drafts] = useState(createInboxDraftStore);
  if (contexto.isError)
    return <p role="alert">Não foi possível identificar a clínica. Atualize a página.</p>;
  if (!contexto.data) return <p>A carregar a clínica…</p>;
  const organization = contexto.data.organizacao;
  const renderInbox = (initialConversation?: ConversaGhl) => (
    <CaixaGhl
      key={`${escopo}:${organization.id}:${initialConversation?.id ?? "all"}`}
      fuso={organization.timezone}
      organizationId={organization.id}
      scope={escopo}
      drafts={drafts}
      initialConversation={initialConversation}
    />
  );
  return targetContactId ? (
    <AttendanceConversationTarget
      key={`${escopo}:${organization.id}:${targetContactId}:${targetConversationId ?? ""}`}
      organizationId={organization.id}
      ghlContactId={targetContactId}
      conversationId={targetConversationId}
      scope={escopo}
      fuso={organization.timezone}
    >
      {renderInbox}
    </AttendanceConversationTarget>
  ) : (
    renderInbox()
  );
}

function CaixaGhl({
  fuso,
  organizationId,
  scope,
  drafts,
  initialConversation,
}: {
  fuso: string;
  organizationId: string;
  scope: string;
  drafts: InboxDraftStore;
  initialConversation?: ConversaGhl | undefined;
}) {
  const [pesquisa, setPesquisa] = useState("");
  const [query, setQuery] = useState("");
  const [ativa, setAtiva] = useState<string | null>(initialConversation?.id ?? null);
  const [soNaoLidas, setSoNaoLidas] = useState(false);
  const [canalFiltro, setCanalFiltro] = useState("all");
  const [mobileOpen, setMobileOpen] = useState(Boolean(initialConversation));
  useSyncExternalStore(drafts.subscribe, drafts.getVersion, drafts.getVersion);
  const result = useConversasGhl(query);
  const paginas = result.data?.pages ?? [];
  const conversas = Array.from(
    new Map(paginas.flatMap((p) => p.conversas).map((c) => [c.id, c])).values(),
  );
  const visiveis = filterLoadedConversations(conversas, soNaoLidas, canalFiltro);
  const canais = Array.from(
    new Set([
      ...conversas.map((c) => canalMensagem(c.tipo)),
      ...(canalFiltro === "all" ? [] : [canalFiltro]),
    ]),
  ).sort();
  const selecionada =
    visiveis.find((c) => c.id === ativa) ??
    (ativa === initialConversation?.id
      ? initialConversation
      : ativa === null
        ? visiveis[0]
        : undefined);
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <details className="shrink-0 text-xs text-muted-foreground">
        <summary className="cursor-pointer">Origem e atualização das conversas</summary>
        <p className="mt-2">
          GoHighLevel · atualização a cada 30 segundos · horários {fuso}. Abrir aqui não marca como
          lida no GHL.
        </p>
        {paginas[0] && !result.isError && (
          <p className="mt-1">Última consulta: {formatarDataHora(paginas[0].consultadoEm, fuso)}</p>
        )}
      </details>
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
        <section
          className={`surface-card min-h-0 flex-col overflow-hidden ${mobileOpen ? "hidden lg:flex" : "flex"}`}
          aria-label="Conversas reais"
        >
          <form
            className="flex shrink-0 gap-2 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              setQuery(pesquisa.trim());
              setAtiva(null);
              setMobileOpen(false);
            }}
          >
            <Input
              aria-label="Pesquisar conversas no GHL"
              placeholder="Nome ou telefone"
              maxLength={100}
              value={pesquisa}
              onChange={(e) => setPesquisa(e.target.value)}
            />
            <Button type="submit" variant="outline">
              Buscar
            </Button>
          </form>
          <div className="shrink-0 space-y-2 px-3 pb-3">
            <div className="flex flex-wrap gap-2" aria-label="Filtrar conversas carregadas">
              <Button
                type="button"
                size="sm"
                variant={soNaoLidas ? "outline" : "secondary"}
                aria-pressed={!soNaoLidas}
                onClick={() => {
                  setSoNaoLidas(false);
                  setAtiva(null);
                }}
              >
                Todas
              </Button>
              <Button
                type="button"
                size="sm"
                variant={soNaoLidas ? "secondary" : "outline"}
                aria-pressed={soNaoLidas}
                onClick={() => {
                  setSoNaoLidas(true);
                  setAtiva(null);
                }}
              >
                Não lidas no GHL
              </Button>
              <label className="flex w-full min-w-0 basis-full items-center gap-2 text-xs">
                Canal
                <select
                  aria-label="Filtrar por canal"
                  value={canalFiltro}
                  onChange={(e) => {
                    setCanalFiltro(e.target.value);
                    setAtiva(null);
                  }}
                  className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="all">Todos os canais</option>
                  {canais.map((canal) => (
                    <option key={canal} value={canal}>
                      {canal}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                {visiveis.length} de {conversas.length} · das conversas carregadas
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={result.isFetching}
                onClick={() => void result.refetch()}
                aria-label="Atualizar conversas"
              >
                <RefreshCw className="size-4" />
              </Button>
            </div>
          </div>
          <div
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
            aria-label="Lista de conversas"
          >
            {result.isError ? (
              <ErroLeitura erro={result.error} repetir={() => void result.refetch()} />
            ) : (
              <>
                <ul className="divide-y divide-border">
                  {visiveis.map((c) => (
                    <li key={c.id}>
                      <button
                        className={`w-full p-4 text-left hover:bg-secondary/60 ${selecionada?.id === c.id ? "bg-secondary" : ""}`}
                        onClick={() => {
                          setAtiva(c.id);
                          setMobileOpen(true);
                        }}
                        aria-pressed={selecionada?.id === c.id}
                      >
                        <p className="font-medium">{c.nome}</p>
                        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                          {c.ultimaMensagem || "Sem prévia textual"}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Badge variant="outline">{canalMensagem(c.tipo)}</Badge>
                          {drafts.get(inboxDraftKey(scope, organizationId, c.contactId, c.id))
                            .text && <Badge variant="secondary">Rascunho</Badge>}
                          {c.naoLidas !== null && c.naoLidas > 0 && (
                            <Badge>{c.naoLidas} por ler no GHL</Badge>
                          )}
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">
                          {c.ultimaData
                            ? formatarDataHora(c.ultimaData, fuso)
                            : "Data não informada"}
                        </p>
                      </button>
                    </li>
                  ))}
                </ul>
                {visiveis.length === 0 && (
                  <p className="p-6 text-sm text-muted-foreground">
                    {result.isPending
                      ? "A consultar o GHL…"
                      : "Nenhuma conversa carregada corresponde aos filtros. Carregue mais ou ajuste a pesquisa."}
                  </p>
                )}
                {result.hasNextPage && (
                  <Button
                    className="m-4"
                    variant="outline"
                    disabled={result.isFetching}
                    onClick={() => void result.fetchNextPage()}
                  >
                    Carregar mais conversas
                  </Button>
                )}
                {paginas.some((p) => p.limitePaginacao) && (
                  <p className="p-4 text-sm">
                    O GHL não forneceu um cursor que permita continuar. Refine a pesquisa ou
                    consulte o GHL para o histórico completo.
                  </p>
                )}
              </>
            )}
          </div>
        </section>
        <div className={`min-h-0 min-w-0 flex-col ${mobileOpen ? "flex" : "hidden lg:flex"}`}>
          {!result.isError && selecionada ? (
            <ConversaReal
              key={`${selecionada.id}:${selecionada.contactId}`}
              conversa={selecionada}
              organizationId={organizationId}
              fuso={fuso}
              drafts={drafts}
              draftKey={inboxDraftKey(scope, organizationId, selecionada.contactId, selecionada.id)}
              onBack={() => setMobileOpen(false)}
            />
          ) : (
            <div className="surface-card space-y-3 p-5 text-sm text-muted-foreground">
              <Button
                size="sm"
                variant="outline"
                className="lg:hidden"
                onClick={() => setMobileOpen(false)}
              >
                <ArrowLeft className="size-4" />
                Voltar às conversas
              </Button>
              <p>Selecione uma conversa disponível para ler as mensagens.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ErroLeitura({ erro, repetir }: { erro: unknown; repetir: () => void }) {
  return (
    <div role="alert" className="space-y-3 p-5">
      <p className="text-sm text-destructive">
        {erro instanceof Error ? erro.message : "Não foi possível consultar o GHL."}
      </p>
      <p className="text-xs text-muted-foreground">
        Uma falha de acesso não significa que não existam registos.
      </p>
      <Button variant="outline" size="sm" onClick={repetir}>
        Tentar novamente
      </Button>
    </div>
  );
}

function subscribeWideInbox(listener: () => void) {
  const query = window.matchMedia?.("(min-width: 1280px)");
  query?.addEventListener("change", listener);
  return () => query?.removeEventListener("change", listener);
}
function wideInboxSnapshot() {
  return window.matchMedia?.("(min-width: 1280px)").matches ?? true;
}

function ConversaReal({
  conversa,
  organizationId,
  fuso,
  drafts,
  draftKey,
  onBack,
}: {
  conversa: ConversaGhl;
  organizationId: string;
  fuso: string;
  drafts: InboxDraftStore;
  draftKey: string;
  onBack: () => void;
}) {
  const [panelTab, setPanelTab] = useState<"context" | "assistant">("context");
  const [panelOpen, setPanelOpen] = useState(false);
  const wide = useSyncExternalStore(subscribeWideInbox, wideInboxSnapshot, () => false);
  function openPanel(tab: "context" | "assistant") {
    setPanelTab(tab);
    setPanelOpen(true);
  }
  const result = useMensagensGhl(conversa.id);
  const paginas = result.data?.pages ?? [];
  const mensagens = Array.from(
    new Map(paginas.flatMap((p) => p.mensagens).map((m) => [m.id, m])).values(),
  ).sort((a, b) => (a.data ?? "").localeCompare(b.data ?? ""));
  const draft = useSyncExternalStore(
    drafts.subscribe,
    () => drafts.get(draftKey),
    () => drafts.get(draftKey),
  );
  const rascunho = draft.text;
  const setRascunho = (text: string) => drafts.set(draftKey, text);
  const [limpezas, setLimpezas] = useState(() => lerLimpezasRascunho(draftKey));
  const limpezasRef = useRef(new Map(limpezas.map((item) => [item.revision, item])));
  const limpezasEmCurso = useRef(new Set<string>());
  const limpezasNaoPersistidas = useRef(new Set<string>());
  const [limpando, setLimpando] = useState(false);
  const loadDraft = useServerFn(loadAttendanceDraft);
  const saveDraft = useServerFn(saveAttendanceDraft);
  const clearDraft = useServerFn(clearAttendanceDraft);
  const [draftSync] = useState(() => {
    const scope = { organizationId, contactId: conversa.contactId, conversationId: conversa.id };
    return createAttendanceDraftSync(drafts, draftKey, {
      load: () => loadDraft({ data: scope }),
      save: (text, expectedRevision) => saveDraft({ data: { ...scope, text, expectedRevision } }),
      clear: (expectedText, expectedRevision) =>
        clearDraft({ data: { ...scope, expectedText, expectedRevision } }),
    });
  });
  const draftState = useSyncExternalStore(
    draftSync.subscribe,
    draftSync.getSnapshot,
    draftSync.getSnapshot,
  );
  useEffect(() => draftSync.start(), [draftSync]);
  useEffect(() => {
    const protectDraft = (event: BeforeUnloadEvent) => {
      if (draftSync.hasUnsavedChanges() || limpezasRef.current.size > 0) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", protectDraft);
    return () => window.removeEventListener("beforeunload", protectDraft);
  }, [draftSync]);
  const draftSendSnapshots = useRef(new Map<string, DraftSendSnapshot | null>());
  const [undoDraft, setUndoDraft] = useState<{ previous: string; applied: string } | null>(null);
  const historyScroll = useInboxHistoryScroll(mensagens);
  const [analise, setAnalise] = useState<AnaliseIA | null>(null);
  const [erroIA, setErroIA] = useState<string | null>(null);
  const [pendente, setPendente] = useState(false);
  const [analiseContexto, setAnaliseContexto] = useState<string | null>(null);
  const [mostrarAnalise, setMostrarAnalise] = useState(false);
  const [corrigindo, setCorrigindo] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [envio, setEnvio] = useState<EstadoEnvio>({ estado: "livre" });
  const [recibo, setRecibo] = useState("");
  const [destino, setDestino] = useState<DestinoEnvio | null>(null);
  const [erroDestino, setErroDestino] = useState<string | null>(null);
  const [referencia, setReferencia] = useState<Revisao | null>(null);
  const [tick, setTick] = useState(0);
  const [conferindo, setConferindo] = useState(false);
  const revisao = useRef(0);
  const pedido = useRef<{ rev: number; id: string } | null>(null);
  const orgId = useOrganizacao().data?.organizacao.id ?? null;
  const chavePendente = `${orgId}:${conversa.contactId}:${conversa.id}`;
  // Estado síncrono do envio: bloqueia entradas e duplo clique antes do re-render.
  const envioRef = useRef<EstadoEnvio>(envio);
  const anexoEmEnvio = useRef<{ requestId: string; attachment: InboxAttachment } | null>(null);
  const media = useInboxMedia(() => {
    revisao.current += 1;
    setAviso(null);
    if (envioRef.current.estado === "aceite") mudarEnvio({ estado: "livre" });
  });
  const arquivoInput = useRef<HTMLInputElement | null>(null);
  function mudarEnvio(e: EstadoEnvio) {
    envioRef.current = e;
    setEnvio(e);
    if (e.estado === "incerto") {
      pendentesEnvio.set(chavePendente, e);
      gravarIntencao(chavePendente, {
        requestId: e.requestId,
        manualId: e.manualId,
        desde: e.desde ?? Date.now(),
        draftRevision: e.draftRevision ?? null,
      });
    } else if (e.estado !== "a_enviar") {
      pendentesEnvio.delete(chavePendente);
      // If browser storage rejected the separate cleanup marker, retain the original
      // confirmed request metadata so reload can still reconcile it without a new send.
      if (limpezasNaoPersistidas.current.size === 0) gravarIntencao(chavePendente, null);
    }
  }
  const analisar = useServerFn(aiSupport);
  const corrigirFn = useServerFn(corrigirRascunho);
  const enviarFn = useServerFn(sendInboxMessage);
  const contextoFn = useServerFn(getInboxSendContext);
  const estadoFn = useServerFn(getInboxSendStatus);
  const conferirFn = useServerFn(reconcileManualAgentMessage);
  const vivo = useRef(true);
  function atualizarLimpezas() {
    if (vivo.current) setLimpezas([...limpezasRef.current.values()]);
  }
  async function executarLimpeza(entry: LimpezaRascunho, snapshot?: DraftSendSnapshot) {
    if (limpezasEmCurso.current.has(entry.revision)) return;
    limpezasEmCurso.current.add(entry.revision);
    if (vivo.current) setLimpando(true);
    try {
      const outcome = snapshot
        ? await draftSync.afterConfirmedSend(snapshot)
        : await draftSync.afterRecoveredSend(entry.revision);
      if (outcome === "cleared" || outcome === "superseded") {
        if (gravarLimpezaRascunho(draftKey, entry, true)) {
          limpezasRef.current.delete(entry.revision);
          limpezasNaoPersistidas.current.delete(entry.revision);
          // Only this already-confirmed request may be removed; an unrelated unknown send stays.
          if (entry.requestId && lerIntencao(chavePendente)?.requestId === entry.requestId)
            gravarIntencao(chavePendente, null);
        }
      }
    } catch {
      // Keep the recovery metadata and the visible warning; never infer successful deletion.
    } finally {
      limpezasEmCurso.current.delete(entry.revision);
      atualizarLimpezas();
      if (vivo.current) setLimpando(limpezasEmCurso.current.size > 0);
    }
  }
  function registrarLimpezaConfirmada(requestId: string | null, recoveredRevision?: string | null) {
    const snapshot = requestId ? draftSendSnapshots.current.get(requestId) : null;
    if (requestId) draftSendSnapshots.current.delete(requestId);
    // Media-only sends and unavailable persistence have no saved textual snapshot to remove.
    if (snapshot?.text === "") return;
    const revision = snapshot?.revision ?? recoveredRevision;
    if (!revision) return;
    const entry = limpezasRef.current.get(revision) ?? {
      revision,
      requestId,
      confirmedAt: Date.now(),
    };
    limpezasRef.current.set(revision, entry);
    if (gravarLimpezaRascunho(draftKey, entry)) limpezasNaoPersistidas.current.delete(revision);
    else limpezasNaoPersistidas.current.add(revision);
    atualizarLimpezas();
    void executarLimpeza(entry, snapshot ?? undefined);
  }
  useEffect(() => {
    const refresh = () => {
      // Keep in-memory failures too: storage availability is not proof that cleanup succeeded.
      for (const entry of lerLimpezasRascunho(draftKey))
        limpezasRef.current.set(entry.revision, entry);
      atualizarLimpezas();
    };
    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener(EVENTO_LIMPEZA, refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener(EVENTO_LIMPEZA, refresh);
    };
  }, [draftKey]);
  useEffect(() => {
    vivo.current = true;
    // Trocar de conversa e voltar não contorna um envio incerto.
    const p = pendentesEnvio.get(chavePendente);
    if (p) mudarEnvio(p);
    else {
      // Recarregar a página também não contorna: recupera a intenção mínima gravada.
      const i = lerIntencao(chavePendente);
      if (i) mudarEnvio({ estado: "incerto", ...i });
    }
    return () => {
      vivo.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const ultimaId = mensagens.at(-1)?.id ?? null;
  // Capacidade atualizada a cada nova mensagem/atualização; a referência revista não muda sozinha.
  useEffect(() => {
    if (!orgId) return;
    let ativo = true;
    contextoFn({
      data: { organizationId: orgId, contactId: conversa.contactId, conversationId: conversa.id },
    })
      .then((r) => {
        if (!ativo) return;
        if (r.ok) {
          setDestino(r.data);
          setErroDestino(r.data.blockedReason ? erroEnvio(r.data.blockedReason) : null);
          if (r.data.sendAllowed && r.data.revision.channel)
            setReferencia((atual) => atual ?? (r.data.revision as Revisao));
          const ultimo = r.data.lastDispatch;
          if (
            ultimo &&
            ["unknown", "sending"].includes(ultimo.state) &&
            envioRef.current.estado !== "a_enviar"
          )
            mudarEnvio({
              ...(envioRef.current.estado === "incerto"
                ? envioRef.current
                : { estado: "incerto" as const, requestId: null }),
              manualId: ultimo.id,
            });
        } else {
          setDestino(null);
          setErroDestino(erroEnvio(r.code));
        }
      })
      .catch(() => {
        if (!ativo) return;
        setDestino(null);
        setErroDestino("Não foi possível verificar o canal de envio desta conversa.");
      });
    return () => {
      ativo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, conversa.id, conversa.contactId, ultimaId, tick]);
  const revisaoMudou = Boolean(
    referencia && destino && !mesmaRevisao(referencia, destino.revision),
  );
  const contextoAnalise = inboxAnalysisFingerprint(mensagens, destino?.revision ?? null);
  const contextoAnaliseRef = useRef(contextoAnalise);
  contextoAnaliseRef.current = contextoAnalise;
  const analiseDesatualizada = Boolean(
    analise && (result.isError || erroDestino || analiseContexto !== contextoAnalise),
  );
  // Remontado por conversationId/contactId: uma promessa antiga não altera o novo atendimento.
  async function gerarAnalise() {
    if (pendente || result.isError || mensagens.length === 0) return;
    setPendente(true);
    setErroIA(null);
    const contextoCapturado = contextoAnalise;
    try {
      const texto = mensagens
        .map((m) => `${m.direcao}: ${m.texto}`)
        .join("\n")
        .slice(-12000);
      const resposta = await analisar({ data: { conversa: texto, contexto: conversa.nome } });
      if (!vivo.current) return;
      if (resposta.ok) {
        setAnalise(resposta.analise);
        setAnaliseContexto(contextoCapturado);
        setMostrarAnalise(true);
      } else setErroIA(resposta.message);
    } catch {
      if (vivo.current) setErroIA("Não foi possível consultar a IA.");
    } finally {
      if (vivo.current) setPendente(false);
    }
  }
  function usarSugestao(text: string) {
    if (
      pendente ||
      result.isError ||
      erroDestino ||
      analiseContexto !== contextoAnaliseRef.current ||
      envioRef.current.estado === "a_enviar"
    )
      return;
    setUndoDraft({ previous: rascunho, applied: text });
    editar(text);
  }
  // Cada alteração do campo (digitação, sugestão, Jev, correção) gera nova revisão.
  // Durante o envio todas as entradas são recusadas no próprio handler.
  function editar(texto: string) {
    if (envioRef.current.estado === "a_enviar") return;
    revisao.current += 1;
    setRascunho(texto);
    setAviso(null);
    if (envioRef.current.estado === "aceite") mudarEnvio({ estado: "livre" });
  }
  async function corrigir() {
    const draftCapturado = drafts.get(draftKey);
    const texto = draftCapturado.text;
    if (!texto.trim() || corrigindo || envioRef.current.estado === "a_enviar") return;
    if (texto.length > LIMITE) {
      setAviso(`A correção aceita até ${LIMITE} caracteres. O texto foi mantido.`);
      return;
    }
    const rev = revisao.current;
    setCorrigindo(true);
    setAviso(null);
    try {
      const r = await corrigirFn({ data: { texto } });
      if (!vivo.current) return;
      if (
        revisao.current !== rev ||
        drafts.get(draftKey).version !== draftCapturado.version ||
        (envioRef.current as EstadoEnvio).estado === "a_enviar"
      ) {
        setAviso("O texto foi alterado durante a correção; a sugestão foi descartada.");
        return;
      }
      if (r.ok) {
        if (r.texto === texto) setAviso("Nenhuma correção necessária.");
        else {
          setUndoDraft({ previous: texto, applied: r.texto });
          editar(r.texto);
          setAviso("Correção aplicada. Reveja e edite livremente antes de enviar.");
        }
      } else setAviso(r.message);
    } catch {
      if (vivo.current) setAviso("Não foi possível corrigir agora. O texto foi mantido.");
    } finally {
      if (vivo.current) setCorrigindo(false);
    }
  }
  async function enviar() {
    const atual = envioRef.current.estado;
    // Incerto nunca envia: só verificação de leitura. Nenhuma retomada de texto oculto.
    if (
      atual === "a_enviar" ||
      atual === "incerto" ||
      !orgId ||
      media.isBusy() ||
      limpezasRef.current.size > 0
    )
      return;
    // Texto EXATO visível no campo agora: trim só para testar vazio.
    const texto = drafts.get(draftKey).text;
    const revisaoEnvio = referencia;
    if (!revisaoEnvio || !destino?.sendAllowed || revisaoMudou) return;
    const attachments = media.snapshot();
    if ((!texto.trim() && attachments.length === 0) || texto.length > LIMITE) return;
    if (attachments.length && !mediaPermitida) return;
    if (!pedido.current || pedido.current.rev !== revisao.current)
      pedido.current = { rev: revisao.current, id: crypto.randomUUID() };
    const requestId = pedido.current.id;
    drafts.submitted(requestId, draftKey);
    anexoEmEnvio.current = attachments[0] ? { requestId, attachment: attachments[0] } : null;
    const rev = revisao.current;
    const desde = Date.now();
    mudarEnvio({ estado: "a_enviar" });
    setAviso(null);
    let draftRevision: string | null = null;
    let requestStarted = false;
    const incerto = (manualId: string | null) =>
      mudarEnvio({ estado: "incerto", requestId, manualId, desde, draftRevision });
    try {
      const persisted = await draftSync.beforeSend();
      const snapshot = persisted?.text === texto ? persisted : null;
      draftRevision = snapshot?.text ? snapshot.revision : null;
      draftSendSnapshots.current.set(requestId, snapshot);
      // Persistir só quando o POST vai começar; salvar rascunho ainda não é enviar.
      gravarIntencao(chavePendente, { requestId, manualId: null, desde, draftRevision });
      requestStarted = true;
      const r = await enviarFn({
        data: {
          organizationId: orgId,
          contactId: conversa.contactId,
          conversationId: conversa.id,
          text: texto,
          draftRevision,
          ...(attachments.length ? { attachments } : {}),
          requestId,
          revision: revisaoEnvio,
        },
      });
      // A late, proven result belongs to the original conversation, even after switching away.
      if (r.ok && r.data.state === "sent" && r.data.messageId) {
        registrarLimpezaConfirmada(requestId);
        drafts.confirmed(requestId);
        if (
          !vivo.current &&
          limpezasNaoPersistidas.current.size === 0 &&
          lerIntencao(chavePendente)?.requestId === requestId
        ) {
          gravarIntencao(chavePendente, null);
          if (pendentesEnvio.get(chavePendente)?.requestId === requestId)
            pendentesEnvio.delete(chavePendente);
        }
      }
      if (!vivo.current) return;
      if (!r.ok) {
        if (ANTES_DO_ENVIO.has(r.code)) {
          // Recusa definitiva antes de qualquer POST: nova tentativa explícita gera nova chave.
          pedido.current = null;
          drafts.forget(requestId);
          mudarEnvio({ estado: "livre" });
          setTick((t) => t + 1);
        } else incerto(null);
        setAviso(
          r.code === "revision_changed" || r.code === "route_changed"
            ? "A conversa ou a rota mudou desde a sua revisão. Confira as mensagens e tente de novo; nada foi enviado."
            : erroEnvio(r.code),
        );
        return;
      }
      aplicarEstado(r.data.state, r.data.messageId, r.data.manualId, requestId, rev, r.data.code, {
        desde,
        ...(r.data.state !== "sent" ? { draftRevision } : {}),
      });
    } catch {
      // Tempo esgotado/rede: o servidor pode ter aceite. Nunca gerar nova chave.
      if (vivo.current) {
        if (requestStarted) incerto(null);
        else {
          drafts.forget(requestId);
          pedido.current = null;
          mudarEnvio({ estado: "livre" });
          setAviso("Não foi possível preparar o rascunho. Nada foi enviado; o texto foi mantido.");
        }
      }
    }
  }
  function limparAnexoEnviado(requestId: string | null) {
    const enviado = anexoEmEnvio.current;
    const atual = media.snapshot()[0];
    if (
      enviado &&
      enviado.requestId === requestId &&
      atual &&
      enviado.attachment.name === atual.name &&
      enviado.attachment.mimeType === atual.mimeType &&
      enviado.attachment.base64 === atual.base64
    )
      media.clearAfterSend();
    anexoEmEnvio.current = null;
  }
  function aplicarEstado(
    state: string,
    messageId: string | null,
    manualId: string,
    requestId: string | null,
    rev: number | null,
    code: string | null = null,
    extra: { desde?: number; draftRevision?: string | null } = {},
  ) {
    if (state === "sent" && messageId) {
      registrarLimpezaConfirmada(requestId, extra.draftRevision);
      drafts.confirmed(requestId);
      mudarEnvio({ estado: "aceite", messageId });
      limparAnexoEnviado(requestId);
      pedido.current = null;
      // Só limpa se ninguém editou depois da captura.
      if (rev !== null && revisao.current === rev) {
        revisao.current += 1;
      }
      setReferencia(null);
      setTick((t) => t + 1);
      void result.refetch();
    } else if (state === "rejected") {
      drafts.forget(requestId);
      // Terminal: a chave antiga não é reutilizada; contexto relido; novo clique é nova intenção.
      pedido.current = null;
      mudarEnvio({ estado: "livre" });
      setTick((t) => t + 1);
      setAviso(
        code === "route_changed"
          ? erroEnvio("route_changed")
          : "O GHL recusou este envio (pode ser permissão, conexão do canal ou janela). O texto foi mantido. Pode tentar de novo com um novo clique em Enviar.",
      );
    } else if (state === "invalidated") {
      drafts.forget(requestId);
      // Pedido substituído/expirado: não houve POST. Exige leitura atualizada antes de decidir.
      mudarEnvio({ estado: "livre" });
      pedido.current = null;
      setReferencia(null);
      setTick((t) => t + 1);
      void result.refetch();
      setAviso(erroEnvio("draft_stale"));
    } else
      // prepared/sending/unknown não são terminais: o pedido original pode ainda enviar.
      mudarEnvio({ estado: "incerto", requestId, manualId, ...extra });
  }
  async function verificarEstado() {
    const e = envioRef.current;
    if (e.estado !== "incerto" || !orgId || conferindo) return;
    setConferindo(true);
    try {
      if (!e.requestId) {
        setTick((t) => t + 1);
        return;
      }
      const r = await estadoFn({ data: { organizationId: orgId, requestId: e.requestId } });
      if (!vivo.current) return;
      if (!r.ok) setAviso(erroEnvio(r.code));
      else if (r.data === null) {
        // Sem registo NÃO prova não-envio: o pedido original pode chegar/continuar depois.
        setAviso(
          "Ainda não há registo deste pedido no servidor. Isso não prova que nada foi enviado; o envio continua bloqueado. Confira a conversa no GHL.",
        );
      } else {
        aplicarEstado(
          r.data.state,
          r.data.messageId,
          r.data.manualId,
          e.requestId,
          null,
          r.data.code,
          {
            ...(e.desde !== undefined ? { desde: e.desde } : {}),
            ...(e.draftRevision !== undefined ? { draftRevision: e.draftRevision } : {}),
          },
        );
        if (r.data.state === "prepared")
          setAviso(
            "Pedido registado e ainda não enviado. O pedido original ainda pode ser processado; o envio continua bloqueado.",
          );
      }
    } catch {
      if (vivo.current) setAviso("Não foi possível verificar agora. O envio continua bloqueado.");
    } finally {
      if (vivo.current) setConferindo(false);
    }
  }
  async function conferir() {
    const e = envioRef.current;
    if (e.estado !== "incerto" || !e.manualId || !orgId || conferindo) return;
    setConferindo(true);
    try {
      const r = await conferirFn({
        data: { organizationId: orgId, manualId: e.manualId, messageId: recibo.trim() },
      });
      if (!vivo.current) return;
      if (r.ok) {
        aplicarEstado("sent", recibo.trim(), e.manualId, e.requestId, null, null, e);
        setRecibo("");
      } else setAviso(erroEnvio(r.code));
    } catch {
      if (vivo.current) setAviso("Não foi possível conferir agora. O envio continua bloqueado.");
    } finally {
      if (vivo.current) setConferindo(false);
    }
  }
  const enviando = envio.estado === "a_enviar";
  const mediaPermitida =
    destino?.mediaAllowed === true &&
    destino.channel === "SMS" &&
    Boolean(destino.revision?.providerId);
  const mediaBloqueada = enviando || envio.estado === "incerto";
  const url = `https://app.gohighlevel.com/v2/location/${conversa.locationId}/contacts/detail/${conversa.contactId}`;
  const panel = (
    <>
      <div
        className="sticky top-0 z-10 grid grid-cols-2 gap-1 border-b border-border bg-card p-2"
        role="group"
        aria-label="Painel do atendimento"
      >
        <Button
          aria-pressed={panelTab === "context"}
          variant={panelTab === "context" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setPanelTab("context")}
        >
          Contexto
        </Button>
        <Button
          aria-pressed={panelTab === "assistant"}
          variant={panelTab === "assistant" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setPanelTab("assistant")}
        >
          Assistente
        </Button>
      </div>
      <div hidden={panelTab !== "context"}>
        <AttendanceContextPanel
          organizationId={organizationId}
          ghlContactId={conversa.contactId}
          conversationId={conversa.id}
          fuso={fuso}
        />
      </div>
      <div hidden={panelTab !== "assistant"}>
        <section className="space-y-3 p-4" aria-label="Assistência IA">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              className="flex items-center gap-2 text-sm font-medium"
              onClick={() => setMostrarAnalise((value) => !value)}
              aria-expanded={mostrarAnalise}
            >
              <Sparkles className="size-4" />
              Assistência IA{analiseDesatualizada && <Badge variant="outline">Desatualizada</Badge>}
            </button>
            <Button
              size="sm"
              variant="outline"
              disabled={pendente || result.isError || mensagens.length === 0}
              onClick={() => void gerarAnalise()}
            >
              {pendente ? "A analisar…" : "Analisar conversa"}
            </Button>
          </div>
          {erroIA && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {erroIA}
            </p>
          )}
          {mostrarAnalise && (
            <div className="mt-3 space-y-3">
              <p className="text-xs text-muted-foreground">
                Sugestões sobre as mensagens carregadas. Reveja antes de usar; a IA não confirma
                consultas nem envia respostas.
              </p>
              {analise && (
                <>
                  {analiseDesatualizada && (
                    <p role="status" className="text-sm text-destructive">
                      A conversa ou o contexto mudou. Analise novamente para usar uma sugestão. Seu
                      rascunho foi preservado.
                    </p>
                  )}
                  <p className="text-sm">
                    <span className="font-medium">Resumo: </span>
                    {analise.resumo}
                  </p>
                  {analise.intencao && (
                    <p className="text-sm">
                      <span className="font-medium">Intenção sugerida: </span>
                      {
                        {
                          informacao: "Informação",
                          preco: "Preço",
                          agendamento: "Agendamento",
                          objecao: "Objeção",
                          pos_procedimento: "Pós-procedimento",
                          urgencia: "Urgência",
                        }[analise.intencao]
                      }
                    </p>
                  )}
                  {analise.revisao_humana && (
                    <p className="text-sm">
                      Próxima ação: encaminhar para revisão por um profissional de saúde.
                    </p>
                  )}
                  <div className="grid gap-2">
                    {analise.sugestoes.map((suggestion) => (
                      <article key={suggestion.tom} className="rounded-lg border border-border p-3">
                        <Badge variant="outline">{suggestion.tom}</Badge>
                        <p className="my-2 whitespace-pre-wrap text-sm">{suggestion.texto}</p>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={enviando || pendente || analiseDesatualizada}
                          onClick={() => usarSugestao(suggestion.texto)}
                        >
                          Usar rascunho
                        </Button>
                      </article>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </section>
      </div>
    </>
  );
  return (
    <div className="grid h-full min-h-0 min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_280px]">
      <section
        className="surface-card flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
        aria-label={`Atendimento de ${conversa.nome}`}
      >
        <header className="max-h-[30%] shrink-0 overflow-y-auto border-b border-border px-3 py-3 sm:px-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-start gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="lg:hidden"
                aria-label="Voltar às conversas"
                onClick={() => {
                  media.remove();
                  onBack();
                }}
              >
                <ArrowLeft className="size-4" />
              </Button>
              <div className="min-w-0">
                <h2 className="truncate font-semibold">{conversa.nome}</h2>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                  <Badge variant="outline">
                    {destino?.channel ?? canalMensagem(conversa.tipo)}
                  </Badge>
                  <span className="text-muted-foreground">
                    {destino?.transport ?? "Verificando canal…"}
                  </span>
                  {(erroDestino || envio.estado === "incerto") && (
                    <Badge variant="destructive">Envio bloqueado</Badge>
                  )}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                size="sm"
                variant="outline"
                className="xl:hidden"
                onClick={() => openPanel("context")}
                aria-label="Ver contexto do atendimento"
              >
                <UserRound className="size-4" />
                <span className="hidden sm:inline">Contexto</span>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={result.isFetching}
                onClick={() => {
                  setTick((t) => t + 1);
                  void result.refetch();
                }}
              >
                <RefreshCw className="size-4" />
                <span className="hidden sm:inline">Atualizar</span>
                <span className="sr-only sm:hidden">Atualizar</span>
              </Button>
              <Button size="sm" variant="ghost" asChild>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Abrir atendimento no GHL"
                >
                  <ExternalLink className="size-4" />
                  <span className="hidden sm:inline">GHL</span>
                </a>
              </Button>
            </div>
          </div>
          <details className="mt-2 text-xs text-muted-foreground">
            <summary className="cursor-pointer">Detalhes da conversa</summary>
            <p className="mt-2 break-all">
              Contato: {conversa.contactId} · Conversa: {conversa.id}
            </p>
            <p>
              {!result.isError && paginas[0]
                ? `Mensagens consultadas: ${formatarDataHora(paginas[0].consultadoEm, fuso)}`
                : "Consulta de mensagens"}
            </p>
            <p>
              SIM/NÃO são textos recebidos. A confirmação da consulta depende dos registros do GHL.
            </p>
          </details>
        </header>
        <div className="relative min-h-20 flex-1">
          <div
            ref={historyScroll.ref}
            onScroll={historyScroll.onScroll}
            tabIndex={0}
            role="region"
            className="h-full overflow-y-auto overscroll-contain px-3 py-3 sm:px-4"
            aria-label="Histórico da conversa"
          >
            {result.isError ? (
              <ErroLeitura erro={result.error} repetir={() => void result.refetch()} />
            ) : (
              <>
                {result.hasNextPage && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={result.isFetching}
                    onClick={() => void result.fetchNextPage()}
                  >
                    Carregar mensagens anteriores
                  </Button>
                )}
                {paginas.some((p) => p.limitePaginacao) && (
                  <p className="my-3 text-sm">
                    Histórico parcial: consulte o GHL para mensagens anteriores.
                  </p>
                )}
                <ul className="space-y-3" aria-label="Mensagens do GHL">
                  {mensagens.map((m) => (
                    <li
                      key={m.id}
                      className={`max-w-[92%] rounded-xl border border-border p-4 ${m.direcao === "outbound" ? "ml-auto bg-secondary/60" : "bg-card"}`}
                    >
                      <div className="flex flex-wrap gap-2 text-xs">
                        <Badge variant="outline">
                          {m.direcao === "inbound"
                            ? "Recebida"
                            : m.direcao === "outbound"
                              ? "Enviada"
                              : "Direção não informada"}
                        </Badge>
                        <Badge variant="secondary">{canalMensagem(m.tipo)}</Badge>
                        {respostaLiteral(m) && <Badge>Texto recebido: {respostaLiteral(m)}</Badge>}
                      </div>
                      <p className="mt-3 whitespace-pre-wrap break-words text-sm">
                        {m.texto ||
                          (m.anexos ? "Mensagem com anexo" : "Sem conteúdo textual disponível")}
                      </p>
                      {m.html && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          Conteúdo HTML apresentado como texto. Abra o GHL para ver a formatação.
                        </p>
                      )}
                      {m.anexos > 0 && (
                        <p className="mt-2 text-xs">{m.anexos} anexo(s) — disponíveis no GHL</p>
                      )}
                      <p className="mt-3 text-xs text-muted-foreground">
                        {m.data ? formatarDataHora(m.data, fuso) : "Data não informada"} · Estado no
                        GHL: {m.estado ?? "não informado"}
                        {m.origem ? ` · Origem: ${m.origem}` : ""}
                      </p>
                      {m.provedor && (
                        <p className="mt-1 break-all text-xs text-muted-foreground">
                          Provedor: {m.provedor}
                        </p>
                      )}
                      {m.erro && (
                        <p className="mt-2 text-sm text-destructive">
                          Erro informado pelo GHL: {m.erro}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
                {mensagens.length === 0 && (
                  <p className="py-5 text-sm text-muted-foreground">
                    {result.isPending
                      ? "A carregar mensagens…"
                      : "O GHL não devolveu mensagens para esta conversa."}
                  </p>
                )}
              </>
            )}
          </div>
          {historyScroll.hasNewMessages && (
            <Button
              size="sm"
              variant="secondary"
              className="absolute bottom-3 left-1/2 -translate-x-1/2 shadow-md"
              onClick={historyScroll.toLatest}
            >
              <ArrowDown className="size-4" />
              Novas mensagens
            </Button>
          )}
        </div>

        <div
          className="flex max-h-[48%] min-h-[11rem] shrink flex-col border-t border-border bg-card"
          aria-label="Preparar resposta"
        >
          <div className="min-h-0 space-y-2 overflow-y-auto px-3 pt-3 sm:px-4">
            <label className="block text-sm font-medium" htmlFor="rascunho-ghl">
              Rascunho para {conversa.nome}
            </label>
            <Textarea
              id="rascunho-ghl"
              value={rascunho}
              onChange={(e) => editar(e.target.value)}
              readOnly={enviando}
              disabled={enviando}
              aria-busy={enviando}
              aria-describedby="rascunho-contador"
              rows={2}
              className="min-h-[68px] max-h-40 resize-y"
            />
            <p
              id="rascunho-contador"
              className={`text-xs ${rascunho.length > LIMITE ? "text-destructive" : "text-muted-foreground"}`}
            >
              {rascunho.length}/{LIMITE} caracteres
              {rascunho.length > LIMITE ? " · reduza o texto para poder corrigir ou enviar" : ""}
            </p>
            <div className="space-y-2 text-xs" aria-label="Salvamento do rascunho">
              <p
                role="status"
                className={
                  draftState.status === "error" || draftState.status === "conflict"
                    ? "text-destructive"
                    : "text-muted-foreground"
                }
              >
                {draftState.status === "loading"
                  ? "Recuperando seu rascunho…"
                  : draftState.status === "saving"
                    ? "Salvando rascunho…"
                    : draftState.status === "saved"
                      ? `Rascunho privado salvo${draftState.updatedAt ? ` · ${formatarDataHora(draftState.updatedAt, fuso)}` : ""}.`
                      : draftState.status === "conflict"
                        ? "Existe outra versão salva. Seu texto foi mantido; escolha qual versão usar."
                        : draftState.status === "memory"
                          ? "Recuperação entre sessões indisponível. Texto mantido apenas nesta caixa aberta."
                          : "Não foi possível salvar. Mantenha esta página aberta; seu texto foi preservado."}
              </p>
              {draftState.status === "conflict" && (
                <div className="space-y-2 rounded-md border p-2">
                  <details>
                    <summary className="cursor-pointer">Ver versão salva</summary>
                    <p className="mt-2 whitespace-pre-wrap break-words">
                      {draftState.remote?.draft?.text || "Versão salva vazia"}
                    </p>
                  </details>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={enviando}
                      onClick={() => void draftSync.keepLocal()}
                    >
                      Salvar meu texto
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={enviando}
                      onClick={() => {
                        setUndoDraft({
                          previous: rascunho,
                          applied: draftState.remote?.draft?.text ?? "",
                        });
                        draftSync.useRemote();
                        revisao.current += 1;
                      }}
                    >
                      Usar versão salva
                    </Button>
                  </div>
                </div>
              )}
              {limpezas.length === 0 &&
                (draftState.status === "error" || draftState.status === "memory") && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={enviando}
                    onClick={() => void draftSync.retry()}
                  >
                    Tentar salvar rascunho
                  </Button>
                )}
              {limpezas.length > 0 && (
                <div role="alert" className="space-y-2 rounded-md border p-2">
                  <p>Envio confirmado; limpeza do rascunho pendente.</p>
                  <p>
                    A mensagem não será reenviada. Conclua a limpeza antes de outro envio; novas
                    edições serão preservadas.
                  </p>
                  {limpezasNaoPersistidas.current.size > 0 && (
                    <p>
                      Mantenha esta página aberta: a recuperação da limpeza não foi gravada neste
                      navegador.
                    </p>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={limpando || enviando}
                    onClick={() =>
                      void (async () => {
                        for (const entry of [...limpezasRef.current.values()])
                          await executarLimpeza(entry);
                      })()
                    }
                  >
                    {limpando ? "Concluindo limpeza…" : "Tentar concluir limpeza"}
                  </Button>
                </div>
              )}
              {undoDraft && rascunho === undoDraft.applied && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={enviando}
                  onClick={() => {
                    editar(undoDraft.previous);
                    setUndoDraft(null);
                  }}
                >
                  <Undo2 className="size-4" />
                  Desfazer alteração do texto
                </Button>
              )}
            </div>
            <div className="space-y-2" aria-label="Anexo da resposta">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={arquivoInput}
                  type="file"
                  aria-label="Selecionar imagem ou áudio"
                  className="sr-only"
                  accept="image/jpeg,image/png,image/gif,audio/mpeg,audio/wav,audio/x-wav,audio/ogg,audio/mp4,audio/x-m4a,audio/aac,.jpg,.jpeg,.png,.gif,.mp3,.wav,.ogg,.m4a,.aac"
                  disabled={mediaBloqueada || media.state !== "idle" || !mediaPermitida}
                  onChange={(e) => {
                    const file = e.currentTarget.files?.[0];
                    e.currentTarget.value = "";
                    if (
                      file &&
                      !mediaBloqueada &&
                      mediaPermitida &&
                      envioRef.current.estado !== "a_enviar" &&
                      envioRef.current.estado !== "incerto"
                    )
                      void media.select(file);
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={mediaBloqueada || media.state !== "idle" || !mediaPermitida}
                  onClick={() => arquivoInput.current?.click()}
                >
                  <Paperclip className="size-4" /> Anexar imagem ou áudio
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={mediaBloqueada || media.state !== "idle" || !mediaPermitida}
                  onClick={() => {
                    if (
                      envioRef.current.estado !== "a_enviar" &&
                      envioRef.current.estado !== "incerto"
                    )
                      void media.start();
                  }}
                >
                  <Mic className="size-4" /> Gravar áudio
                </Button>
                {media.state === "recording" && (
                  <>
                    <span role="status" className="text-sm">
                      Gravando {Math.floor(media.seconds / 60)}:
                      {String(media.seconds % 60).padStart(2, "0")} / 2:00
                    </span>
                    <Button type="button" size="sm" variant="outline" onClick={media.stop}>
                      <Square className="size-4" /> Parar e ouvir
                    </Button>
                  </>
                )}
                {media.state === "permission" && (
                  <span role="status" className="text-sm">
                    Aguardando permissão do microfone…
                  </span>
                )}
                {media.state === "loading" && (
                  <span role="status" className="text-sm">
                    Preparando anexo…
                  </span>
                )}
                {media.state !== "idle" && (
                  <Button type="button" size="sm" variant="ghost" onClick={media.cancel}>
                    Cancelar preparação
                  </Button>
                )}
              </div>
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">Formatos e limites de anexos</summary>
                <p className="mt-1">
                  Um anexo por mensagem, até 5 MB. JPG, PNG, GIF, MP3, WAV, OGG, M4A ou AAC.
                  Gravação de até 2 minutos. Selecione, confira a prévia e clique em Enviar. Nada é
                  enviado ao selecionar ou gravar.
                </p>
              </details>
              {!mediaPermitida && (
                <p className="text-xs text-muted-foreground">
                  Anexos disponíveis na rota SMS com fornecedor identificado, como o Zaptos. O envio
                  de texto segue as regras do canal acima.
                </p>
              )}
              {media.error && (
                <p role="alert" className="text-sm text-destructive">
                  {media.error}
                </p>
              )}
              {media.draft && (
                <div className="space-y-3" aria-label="Prévia do anexo">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 break-words text-sm">
                      {media.draft.name} · {(media.draft.size / (1024 * 1024)).toFixed(2)} MB
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={mediaBloqueada || media.state !== "idle"}
                      onClick={() => {
                        if (
                          envioRef.current.estado !== "a_enviar" &&
                          envioRef.current.estado !== "incerto"
                        )
                          media.remove();
                      }}
                    >
                      <X className="size-4" /> Remover anexo
                    </Button>
                  </div>
                  {media.draft.kind === "image" ? (
                    <img
                      src={media.draft.url}
                      alt={`Prévia de ${media.draft.name}`}
                      className="max-h-28 max-w-full rounded-lg object-contain"
                    />
                  ) : (
                    <>
                      <audio
                        src={media.draft.url}
                        controls
                        preload="metadata"
                        className="w-full"
                        aria-label="Ouvir áudio antes de enviar"
                      />
                      <p className="text-xs text-muted-foreground">
                        O áudio será enviado como anexo. A aparência da mensagem depende do canal e
                        do fornecedor.
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">Revisão e privacidade do rascunho</summary>
              <p className="mt-1">
                Apenas o texto pode ser recuperado entre sessões quando o salvamento estiver
                disponível. Anexos e gravações são descartados ao sair da conversa. Nenhum rascunho
                é enviado automaticamente.
              </p>
            </details>
            <p className="text-xs text-muted-foreground">
              Destinatário: {destino?.name ?? conversa.nome} · Canal:{" "}
              {destino?.channel ?? "não verificado"} · Transporte:{" "}
              {destino?.transport ?? "não verificado"}
            </p>
            {destino?.sendAllowed && destino.connectionVerifiedAtSend && (
              <p className="text-xs text-muted-foreground">
                Canal identificado; a conexão e a permissão serão validadas pelo GHL no envio.
              </p>
            )}
            {revisaoMudou && (
              <div role="alert" className="space-y-2 rounded-xl border border-border p-4 text-sm">
                <p>
                  A conversa ou a rota de envio mudou desde que começou a rever. Confira as
                  mensagens novas antes de enviar; nada foi enviado.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={enviando}
                  onClick={() =>
                    destino?.revision.channel && setReferencia(destino.revision as Revisao)
                  }
                >
                  Conferi as mensagens novas
                </Button>
              </div>
            )}
            {aviso && (
              <p role="status" className="text-sm">
                {aviso}
              </p>
            )}
            {erroDestino && (
              <p role="alert" className="text-sm text-destructive">
                {erroDestino}
              </p>
            )}
            {envio.estado === "aceite" && (
              <p role="status" className="text-sm">
                Mensagem aceite pelo GHL (ID {envio.messageId}). A entrega só fica comprovada quando
                o estado da mensagem no histórico mudar para entregue.
              </p>
            )}
            {envio.estado === "incerto" && (
              <div role="alert" className="space-y-2 rounded-xl border border-border p-4 text-sm">
                <p>
                  Resultado do envio não confirmado. Não repita: confira a conversa no GHL. O texto
                  foi mantido e novos envios ficam bloqueados até o estado ser recuperado.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={conferindo}
                  onClick={() => void verificarEstado()}
                >
                  Verificar estado do envio
                </Button>
                {envio.manualId && (
                  <div className="flex flex-wrap gap-2">
                    <Input
                      aria-label="ID da mensagem encontrada no GHL"
                      placeholder="ID da mensagem no GHL"
                      maxLength={100}
                      value={recibo}
                      onChange={(e) => setRecibo(e.target.value)}
                      className="max-w-xs"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={conferindo || !/^[A-Za-z0-9_-]{1,100}$/.test(recibo.trim())}
                      onClick={() => void conferir()}
                    >
                      Conferir no GHL
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="shrink-0 border-t border-border px-3 py-2 sm:px-4">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => openPanel("assistant")}
                aria-label="Abrir assistente IA"
              >
                <Sparkles className="size-4" />
                <span className="hidden sm:inline">Assistente</span>
              </Button>
              <Button
                variant="outline"
                disabled={!rascunho.trim() || corrigindo || enviando || rascunho.length > LIMITE}
                onClick={() => void corrigir()}
              >
                <SpellCheck className="size-4" /> {corrigindo ? "A corrigir…" : "Corrigir"}
              </Button>
              <Button
                disabled={
                  (!rascunho.trim() && !media.draft) ||
                  corrigindo ||
                  enviando ||
                  media.state !== "idle" ||
                  (Boolean(media.draft) && !mediaPermitida) ||
                  envio.estado === "incerto" ||
                  limpezas.length > 0 ||
                  !destino?.sendAllowed ||
                  !referencia ||
                  revisaoMudou ||
                  rascunho.length > LIMITE
                }
                onClick={() => void enviar()}
              >
                <Send className="size-4" />{" "}
                {enviando ? "A enviar…" : `Enviar para ${conversa.nome}`}
              </Button>
            </div>
          </div>
        </div>
      </section>
      <InboxContextDock
        wide={wide}
        open={panelOpen}
        onOpenChange={setPanelOpen}
        title={`Atendimento de ${conversa.nome}`}
      >
        {panel}
      </InboxContextDock>
    </div>
  );
}
