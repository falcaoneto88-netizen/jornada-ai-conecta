import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowUpRight, PencilLine, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getInboxAgentContext } from "@/lib/commercial-agent.functions";
import { labels } from "@/lib/commercial-agent/core";
import { useModoDados } from "@/lib/repo";
import { izabelMetadata } from "@/lib/izabel/metadata";
import { friendlyError } from "./commercial-agent-queue";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";

type AgentView = Extract<Awaited<ReturnType<typeof getInboxAgentContext>>, { ok: true }>["data"];
type AgentItem = AgentView["items"][number];

export type InboxAgentSuggestionSelection = {
  text: string;
  contactId: string;
  conversationId: string;
  source: { draftId: string; version: number; replyHash: string };
};

export type InboxAgentPanelProps = {
  organizationId: string;
  contactId: string;
  conversationId: string;
  timeZone?: string;
  hasDraft?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  /** Only fills the composer; approval and delivery remain separate, explicit actions. */
  onUseSuggestion?: (selection: InboxAgentSuggestionSelection) => boolean;
};

function matchesScope(view: AgentView, props: InboxAgentPanelProps) {
  return (
    view.settings.organization_id === props.organizationId &&
    (!view.session || view.session.contact_id === props.contactId) &&
    view.items.every(
      (item) =>
        item.organization_id === props.organizationId &&
        item.location_id === view.settings.location_id &&
        item.contact_id === props.contactId &&
        item.conversation_id === props.conversationId &&
        (!item.content ||
          (item.content.snapshot.event.locationId === item.location_id &&
            item.content.snapshot.event.contactId === props.contactId &&
            item.content.snapshot.event.conversationId === props.conversationId &&
            item.content.snapshot.event.messageId === item.message_id)),
    )
  );
}

function blockedReason(view: AgentView, item: AgentItem, props: InboxAgentPanelProps, now: number) {
  const content = item.content;
  if (props.disabled)
    return (
      props.disabledReason ??
      "Há uma ação pendente neste atendimento. Aguarde a conclusão antes de preparar outra resposta."
    );
  if (
    item.organization_id !== props.organizationId ||
    item.contact_id !== props.contactId ||
    item.conversation_id !== props.conversationId ||
    view.settings.organization_id !== props.organizationId ||
    view.settings.location_id !== item.location_id ||
    view.session?.contact_id !== props.contactId ||
    (content &&
      (content.snapshot.event.locationId !== item.location_id ||
        content.snapshot.event.contactId !== props.contactId ||
        content.snapshot.event.conversationId !== props.conversationId ||
        content.snapshot.event.messageId !== item.message_id))
  )
    return "Não foi possível confirmar o vínculo desta sugestão com a conversa. Atualize a supervisão.";
  if (view.items.some((row) => row.state === "unknown" || row.state === "sending"))
    return "Há um envio em andamento ou sem resultado confirmado. Confira o envio na auditoria antes de preparar outra resposta.";
  if (item.state !== "pending")
    return "Esta sugestão já foi tratada. Consulte o registro na auditoria.";
  if (!content) return "Conteúdo indisponível ou removido pelo prazo de retenção.";
  if (view.session.opt_out || item.opt_out || content.decision.optOut)
    return "O contato pediu a interrupção das mensagens. A sugestão permanece bloqueada.";
  if (content.snapshot.dnd)
    return "O contato está com DND. Confira a permissão de contato antes de responder.";
  if (content.decision.handoff || content.decision.flags.length)
    return "Esta sugestão exige avaliação humana especializada. Resolva a pendência na supervisão.";
  if (item.policyCurrent !== true)
    return "A sugestão usa uma política anterior ou não confirmada. Atualize a supervisão.";
  if (
    item.contact_version !== view.session.version ||
    item.session_version !== view.session.version
  )
    return "A conversa mudou desde esta sugestão. Atualize a supervisão antes de continuar.";
  if (!Number.isFinite(Date.parse(item.expires_at)) || Date.parse(item.expires_at) <= now)
    return "Esta sugestão expirou. Use uma sugestão atual antes de preparar a resposta.";
  if (view.session.paused || item.paused)
    return "O agente está pausado para atendimento humano. Confira a pausa na supervisão.";
  if (!view.enabled || !view.sendEnabled || view.settings.mode !== "supervised")
    return "O envio supervisionado está desativado. A equipe responsável precisa conferir a configuração.";
  const inbound = content.snapshot.messages.find((message) => message.id === item.message_id);
  if (
    !view.settings.allowed_contacts.includes(props.contactId) ||
    !inbound ||
    inbound.direction !== "inbound" ||
    !view.settings.allowed_channels.includes(inbound.channel)
  )
    return "Este contato ou canal não está autorizado para revisão com envio. Confira a configuração na supervisão.";
  const inboundAge = now - Date.parse(inbound.at);
  if (!Number.isFinite(inboundAge) || inboundAge < 0 || inboundAge >= 23 * 3_600_000)
    return "A janela de revisão desta mensagem encerrou. Confira uma mensagem recebida mais recente antes de continuar.";
  if (!props.onUseSuggestion)
    return "Abra o atendimento deste contato para ajustar a sugestão no campo de resposta.";
  return null;
}

function formatTime(value: string | undefined, timeZone: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  try {
    return new Intl.DateTimeFormat("pt-PT", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone,
    }).format(new Date(value));
  } catch {
    return null;
  }
}

export function InboxAgentPanel(props: InboxAgentPanelProps) {
  const { demo, escopo } = useModoDados();
  if (demo) return null;
  return (
    <ConnectedAgentPanel
      key={JSON.stringify([escopo, props.organizationId, props.contactId, props.conversationId])}
      {...props}
      scope={escopo}
    />
  );
}

function ConnectedAgentPanel(props: InboxAgentPanelProps & { scope: string }) {
  const { organizationId, contactId, conversationId, scope, timeZone = "Europe/Lisbon" } = props;
  const [clock, setClock] = useState(Date.now);
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState("");
  const [replace, setReplace] = useState<InboxAgentSuggestionSelection | null>(null);
  const active = useRef(true);
  const inFlight = useRef(false);
  const latestProps = useRef(props);
  latestProps.current = props;
  useEffect(() => {
    active.current = true;
    const timer = window.setInterval(() => setClock(Date.now()), 15_000);
    return () => {
      active.current = false;
      window.clearInterval(timer);
    };
  }, []);
  const read = useServerFn(getInboxAgentContext);
  const query = useQuery({
    queryKey: ["inbox-agent-context", scope, organizationId, contactId, conversationId],
    queryFn: () => read({ data: { organizationId, contactId, conversationId } }),
    retry: false,
    staleTime: 15_000,
    refetchInterval: 15_000,
    refetchOnWindowFocus: false,
  });
  const resultView = query.data?.ok && !query.isError ? query.data.data : null;
  const scopeMismatch = Boolean(resultView && !matchesScope(resultView, props));
  const view = scopeMismatch ? null : resultView;
  const failure = scopeMismatch
    ? "scope_mismatch"
    : query.data && !query.data.ok
      ? query.data.code
      : null;
  async function applySuggestion(selection: InboxAgentSuggestionSelection, replacing = false) {
    if (inFlight.current) return;
    inFlight.current = true;
    setChecking(true);
    setNotice("");
    try {
      const refreshed = await query.refetch();
      if (!active.current) return;
      const currentView =
        refreshed.data?.ok &&
        !refreshed.isError &&
        matchesScope(refreshed.data.data, latestProps.current)
          ? refreshed.data.data
          : null;
      const current = currentView?.items.find((item) => item.id === selection.source.draftId);
      const reason =
        currentView && current
          ? blockedReason(currentView, current, latestProps.current, Date.now())
          : "Não foi possível conferir esta sugestão. Atualize a supervisão antes de continuar.";
      if (
        reason ||
        !current ||
        current.version !== selection.source.version ||
        current.reply_hash !== selection.source.replyHash ||
        current.content?.decision.reply !== selection.text
      ) {
        setReplace(null);
        setNotice(reason ?? "A sugestão mudou. Confira a versão atual antes de continuar.");
        return;
      }
      if (latestProps.current.hasDraft && !replacing) {
        setReplace(selection);
        return;
      }
      const accepted = latestProps.current.onUseSuggestion?.(selection);
      setReplace(null);
      setNotice(
        accepted
          ? "Sugestão no campo de resposta. Ajuste o texto e confira a prévia antes de aprovar o envio."
          : "A conversa ou o rascunho mudou. Confira o atendimento antes de usar a sugestão.",
      );
    } catch {
      if (active.current) setNotice("Não foi possível conferir esta sugestão. Tente atualizar.");
    } finally {
      inFlight.current = false;
      if (active.current) setChecking(false);
    }
  }
  const suggestions = view
    ? view.items.map((item) => {
        const decision = item.content?.decision;
        const expired = Date.parse(item.expires_at) <= Date.now();
        const reason = blockedReason(view, item, props, clock);
        const generatedAt = formatTime(item.created_at, timeZone);
        const inboundAt = formatTime(
          item.content?.snapshot.messages.find((message) => message.id === item.message_id)?.at,
          timeZone,
        );
        const search = new URLSearchParams({ contactId, conversationId, draftId: item.id });
        return (
          <li key={item.id} className="min-w-0 space-y-3">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{labels[item.state] ?? item.state}</Badge>
              {item.state === "pending" && expired && <Badge variant="outline">Expirada</Badge>}
            </div>
            {decision ? (
              <>
                <p className="whitespace-pre-wrap break-words leading-relaxed">{decision.reply}</p>
                {decision.flags.length > 0 && (
                  <ul
                    className="space-y-1 text-xs text-amber-800 dark:text-amber-300"
                    aria-label="Pendências de revisão"
                  >
                    {decision.flags.map((flag) => (
                      <li key={flag}>{labels[flag] ?? flag}</li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="text-muted-foreground">
                Conteúdo indisponível ou removido pelo prazo de retenção.
              </p>
            )}
            {item.state === "pending" && (
              <div className="space-y-2">
                <Button
                  type="button"
                  className="w-full whitespace-normal"
                  disabled={Boolean(reason) || checking || query.isFetching}
                  aria-describedby={`suggestion-reason-${item.id}`}
                  onClick={() =>
                    void applySuggestion({
                      text: decision?.reply ?? "",
                      contactId,
                      conversationId,
                      source: {
                        draftId: item.id,
                        version: item.version,
                        replyHash: item.reply_hash,
                      },
                    })
                  }
                >
                  <PencilLine className="size-4 shrink-0" aria-hidden="true" />
                  {checking ? "Conferindo sugestão…" : "Ajustar e revisar resposta"}
                </Button>
                <p id={`suggestion-reason-${item.id}`} className="text-xs text-muted-foreground">
                  {reason ?? "Preenche o campo de resposta. Nada é enviado nesta etapa."}
                </p>
              </div>
            )}
            {item.state !== "pending" && reason && (
              <p className="text-xs text-muted-foreground">{reason}</p>
            )}
            {(generatedAt || inboundAt) && (
              <div className="flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground">
                {generatedAt && <span>Sugestão gerada: {generatedAt}</span>}
                {inboundAt && <span>Mensagem recebida: {inboundAt}</span>}
                <span>Fuso: {timeZone}</span>
              </div>
            )}
            <a
              href={`/agente-supervisionado?${search.toString()}`}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary underline underline-offset-4"
            >
              Ver registro na supervisão <ArrowUpRight className="size-3" aria-hidden="true" />
            </a>
          </li>
        );
      })
    : [];
  return (
    <section className="min-w-0 space-y-3 py-2 text-sm" aria-label="Supervisão desta conversa">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold text-heading">Resposta proposta</h2>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Atualizar supervisão"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          <RefreshCw className="size-4" />
        </Button>
      </div>
      {notice && (
        <p role="status" className="text-xs text-primary">
          {notice}
        </p>
      )}
      {query.isPending ? (
        <p role="status" className="text-muted-foreground">
          A carregar supervisão…
        </p>
      ) : query.isError || failure ? (
        <p role="alert" className="text-destructive">
          {failure && friendlyError[failure]
            ? friendlyError[failure]
            : "Não foi possível consultar a supervisão desta conversa. Tente atualizar."}
        </p>
      ) : view ? (
        <>
          {view.items.length === 0 ? (
            <p className="text-muted-foreground">
              Nenhuma sugestão registrada para esta conversa. Consultar este painel não gera uma
              resposta.
            </p>
          ) : (
            <ul className="space-y-3" aria-label="Sugestões desta conversa">
              {suggestions[0]}
            </ul>
          )}
          {suggestions.length > 1 && (
            <details className="border-t pt-2">
              <summary className="cursor-pointer text-xs font-medium text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
                Histórico da supervisão ({suggestions.length - 1})
              </summary>
              <ul
                className="mt-3 space-y-3 divide-y divide-border [&>li+li]:pt-3"
                aria-label="Registros anteriores desta conversa"
              >
                {suggestions.slice(1)}
              </ul>
            </details>
          )}
          {view.truncated && (
            <p className="text-xs text-muted-foreground">
              Exibindo as 30 sugestões mais recentes desta conversa.
            </p>
          )}
        </>
      ) : null}
      <details className="border-t pt-2 text-xs text-muted-foreground">
        <summary className="cursor-pointer font-medium text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
          Base e auditoria
        </summary>
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">Treinamento V02</Badge>
            <Badge variant="outline">
              Pacote {izabelMetadata.name} · {izabelMetadata.versionLabel}
            </Badge>
          </div>
          {view && (
            <>
              <p>
                {view.session?.opt_out
                  ? "Contato comercial interrompido"
                  : view.session?.paused
                    ? "Com a equipe humana · agente pausado"
                    : !view.enabled || view.settings.mode !== "supervised"
                      ? "Agente desativado"
                      : view.session
                        ? "Agente supervisionado · sem pausa registrada"
                        : "Sem estado de supervisão registrado para este contato"}
              </p>
              <p>
                {view.sendEnabled
                  ? "Aprovação humana obrigatória antes de enviar."
                  : "Envio do agente desativado."}
                {view.session?.opt_out ? " A recusa permanece registrada." : ""}
              </p>
              {view.items[0] && (
                <p>
                  Base da sugestão:{" "}
                  {view.items[0].policyCurrent
                    ? "Treinamento V02 vigente"
                    : "versão anterior ou não confirmada"}
                  .
                </p>
              )}
            </>
          )}
          <p>
            A redação contextual da {izabelMetadata.name} e o agente supervisionado usam a base V02.
            O pacote novo de protocolos e imagens continua em homologação e não foi ativado. A fila
            geral mantém a triagem e a auditoria; rejeitar, pausar e retomar continuam disponíveis
            na supervisão.
          </p>
        </div>
      </details>
      <AlertDialog
        open={Boolean(replace)}
        onOpenChange={(open) => {
          if (!open && !checking) setReplace(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Substituir o rascunho desta conversa?</AlertDialogTitle>
            <AlertDialogDescription>
              Já existe texto no campo de resposta. Ao continuar, ele será substituído pela sugestão
              selecionada. Você poderá editar e revisar antes de aprovar qualquer envio.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={checking}>Manter meu rascunho</AlertDialogCancel>
            <Button
              type="button"
              disabled={checking}
              onClick={() => {
                if (replace) void applySuggestion(replace, true);
              }}
            >
              {checking ? "Conferindo sugestão…" : "Substituir pela sugestão"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
