import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { prepareIzabelReply } from "@/lib/izabel-reply.functions";
import type { IzabelReply, IzabelReplyInput } from "@/lib/izabel-reply.core";
import { formatarDataHora } from "@/lib/clinic-time";

type ReplySnapshot = {
  workspaceKey: string;
  fingerprint: string;
  draftVersion: number;
  language: IzabelReplyInput["language"];
};
export type IzabelDraftExpectation = Pick<ReplySnapshot, "fingerprint" | "draftVersion">;
export type InboxIzabelPanelProps = {
  organizationId: string;
  contactId: string;
  conversationId: string;
  workspaceKey: string;
  fingerprint: string;
  draftVersion: number;
  currentDraft: string;
  timeZone: string;
  disabled: boolean;
  disabledReason?: string;
  onApply: (text: string, expected: IzabelDraftExpectation) => number | null;
};
const languageNames = {
  "PT-PT": "Português de Portugal",
  "PT-BR": "Português do Brasil",
  FR: "Francês",
  ES: "Espanhol",
  EN: "Inglês",
};

/** One contextual preparation action. It never sends a message or silently replaces authored text. */
export function InboxIzabelPanel(props: InboxIzabelPanelProps) {
  const prepare = useServerFn(prepareIzabelReply);
  const [language, setLanguage] = useState<IzabelReplyInput["language"]>("auto");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState<{
    data: IzabelReply;
    snapshot: ReplySnapshot;
    appliedVersion: number | null;
  } | null>(null);
  const live = useRef(true);
  const busy = useRef(false);
  const current = useRef({ ...props, language });
  current.current = { ...props, language };
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  function matches(snapshot: ReplySnapshot) {
    const now = current.current;
    return (
      now.workspaceKey === snapshot.workspaceKey &&
      now.fingerprint === snapshot.fingerprint &&
      now.draftVersion === snapshot.draftVersion &&
      now.language === snapshot.language &&
      !now.disabled
    );
  }
  async function prepareReply() {
    if (busy.current || current.current.disabled) return;
    busy.current = true;
    setPending(true);
    setError(null);
    const captured = current.current;
    const snapshot: ReplySnapshot = {
      workspaceKey: captured.workspaceKey,
      fingerprint: captured.fingerprint,
      draftVersion: captured.draftVersion,
      language: captured.language,
    };
    try {
      const result = await prepare({
        data: {
          organizationId: captured.organizationId,
          contactId: captured.contactId,
          conversationId: captured.conversationId,
          language: captured.language,
        },
      });
      if (!live.current || current.current.workspaceKey !== snapshot.workspaceKey) return;
      if (!result.ok) {
        setError(result.message);
        return;
      }
      let appliedVersion: number | null = null;
      if (!captured.currentDraft && matches(snapshot)) {
        appliedVersion = current.current.onApply(result.data.text, snapshot);
      }
      setReply({ data: result.data, snapshot, appliedVersion });
    } catch {
      if (live.current)
        setError(
          "Não foi possível preparar a resposta. Seu rascunho foi preservado; tente novamente.",
        );
    } finally {
      busy.current = false;
      if (live.current) setPending(false);
    }
  }
  const stale = Boolean(
    reply &&
    (reply.snapshot.workspaceKey !== props.workspaceKey ||
      reply.snapshot.fingerprint !== props.fingerprint ||
      reply.snapshot.language !== language ||
      (reply.appliedVersion === null && reply.snapshot.draftVersion !== props.draftVersion)),
  );
  function applyReply() {
    if (!reply || pending || !matches(reply.snapshot)) return;
    const appliedVersion = props.onApply(reply.data.text, reply.snapshot);
    if (appliedVersion !== null) setReply({ ...reply, appliedVersion });
  }
  return (
    <section className="space-y-4 p-4" aria-label="Izabel — preparar resposta">
      <div className="space-y-1">
        <h3 className="text-base font-semibold">Izabel</h3>
        <p className="text-sm text-muted-foreground">
          Uma resposta com o contexto disponível. Você revisa e envia na conversa.
        </p>
      </div>
      <div className="space-y-2">
        <label htmlFor="izabel-reply-language" className="text-xs font-medium">
          Idioma da resposta
        </label>
        <select
          id="izabel-reply-language"
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
          value={language}
          disabled={pending}
          onChange={(event) => setLanguage(event.target.value as IzabelReplyInput["language"])}
        >
          <option value="auto">Automático · idioma do paciente</option>
          {Object.entries(languageNames).map(([value, name]) => (
            <option key={value} value={value}>
              {name}
            </option>
          ))}
        </select>
        <Button
          className="min-h-11 w-full"
          disabled={pending || props.disabled}
          onClick={() => void prepareReply()}
        >
          <Sparkles className="size-4" aria-hidden="true" />
          {pending ? "A preparar resposta…" : "Preparar resposta"}
        </Button>
        {props.disabledReason && props.disabled && (
          <p className="text-xs text-muted-foreground">{props.disabledReason}</p>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {reply && (
        <div className="space-y-3 border-t border-border pt-3" aria-live="polite">
          {stale && (
            <p role="status" className="text-sm text-destructive">
              A conversa, o idioma ou o rascunho mudou. Prepare novamente; seu texto foi preservado.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {languageNames[reply.data.language]} · Consultado em{" "}
            {formatarDataHora(reply.data.checkedAt, props.timeZone)} ({props.timeZone})
          </p>
          <p className="text-sm">{reply.data.summary}</p>
          {reply.data.handover && (
            <p className="text-sm font-medium">Revisão humana necessária.</p>
          )}
          {reply.data.warnings.length > 0 && (
            <ul
              className="space-y-1 text-xs text-muted-foreground"
              aria-label="Conferir antes de enviar"
            >
              {reply.data.warnings.map((warning, index) => (
                <li key={`${index}-${warning}`}>{warning}</li>
              ))}
            </ul>
          )}
          {reply.appliedVersion === null ? (
            <>
              <p
                className="whitespace-pre-wrap break-words text-sm"
                aria-label="Resposta preparada pela Izabel"
              >
                {reply.data.text}
              </p>
              <p className="text-xs text-muted-foreground">
                Seu texto atual foi mantido. A substituição pode ser desfeita no editor.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="min-h-11 w-full"
                disabled={pending || props.disabled || stale}
                onClick={applyReply}
              >
                {props.currentDraft ? "Substituir meu rascunho" : "Usar no rascunho"}
              </Button>
            </>
          ) : (
            <p role="status" className="text-sm font-medium">
              {props.draftVersion === reply.appliedVersion
                ? "Resposta no rascunho. Revise o texto antes de enviar."
                : props.currentDraft
                  ? "O rascunho foi editado após a sugestão. Revise a versão atual."
                  : "O rascunho está vazio. Prepare novamente quando quiser responder."}
            </p>
          )}
          {reply.data.sources.length > 0 && (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer py-2 font-medium focus-visible:outline-2 focus-visible:outline-ring">
                Fontes consultadas
              </summary>
              <ul className="space-y-2 pt-1">
                {reply.data.sources.map((source, index) => (
                  <li key={`${index}-${source.label}`}>
                    {source.label}
                    {source.updatedAt
                      ? ` · ${formatarDataHora(source.updatedAt, props.timeZone)}`
                      : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
