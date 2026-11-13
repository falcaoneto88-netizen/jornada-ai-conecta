import { useId, useLayoutEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Languages, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { traduzirInbox } from "@/lib/translation.functions";
import {
  MAX_TRANSLATION_RESULT,
  MAX_TRANSLATION_SOURCE,
  TRANSLATION_LANGUAGES,
  type TranslationLanguage,
} from "@/lib/translation.core";

export type InboxTranslatorProps = {
  /** Include user, organization, contact and conversation in this identity. */
  workspaceKey: string;
  currentDraft: string;
  draftVersion: number;
  messages: readonly { id: string; text: string }[];
  disabled?: boolean;
  onApply: (text: string) => void;
};

type Mode = "received" | "reply";
type Translation = { text: string; original: string; fingerprint: string };
type ModeState = {
  sourceLanguage: TranslationLanguage;
  targetLanguage: TranslationLanguage;
  revision: number;
  result: Translation | null;
};
type State = {
  mode: Mode;
  selectedMessage: string;
  incomingText: string;
  received: ModeState;
  reply: ModeState;
};
const initialState = (): State => ({
  mode: "received",
  selectedMessage: "",
  incomingText: "",
  received: { sourceLanguage: "fr", targetLanguage: "pt", revision: 0, result: null },
  reply: { sourceLanguage: "pt", targetLanguage: "fr", revision: 0, result: null },
});
const SELECT_CLASS =
  "h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

/** Text lives only in this mounted component tree; reload/unmount clears the translator. */
export function InboxTranslator(props: InboxTranslatorProps) {
  const workspaces = useRef(new Map<string, State>());
  return (
    <TranslatorWorkspace
      key={props.workspaceKey}
      {...props}
      initial={workspaces.current.get(props.workspaceKey) ?? initialState()}
      remember={(state) => workspaces.current.set(props.workspaceKey, state)}
    />
  );
}

function TranslatorWorkspace({
  workspaceKey,
  currentDraft,
  draftVersion,
  messages,
  disabled = false,
  onApply,
  initial,
  remember,
}: InboxTranslatorProps & { initial: State; remember: (state: State) => void }) {
  const id = useId();
  const translate = useServerFn(traduzirInbox);
  const [state, setState] = useState(initial);
  const stateRef = useRef(state);
  const rememberRef = useRef(remember);
  rememberRef.current = remember;
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  const [focusResult, setFocusResult] = useState(0);
  const requestId = useRef(0);
  const liveFingerprint = useRef("");
  const resultRef = useRef<HTMLTextAreaElement | null>(null);
  const translateRef = useRef<HTMLButtonElement | null>(null);
  const modeState = state[state.mode];
  const selected = messages.find((message) => message.id === state.selectedMessage);
  const source =
    state.mode === "reply"
      ? currentDraft
      : state.selectedMessage
        ? (selected?.text ?? "")
        : state.incomingText;
  const fingerprint = JSON.stringify([
    workspaceKey,
    state.mode,
    source,
    modeState.sourceLanguage,
    modeState.targetLanguage,
    modeState.revision,
    state.mode === "reply" ? draftVersion : state.selectedMessage,
  ]);
  const result = modeState.result;
  const stale = !!result && result.fingerprint !== fingerprint;
  const sourceInvalid = !source.trim() || source.length > MAX_TRANSLATION_SOURCE;
  const sameLanguage = modeState.sourceLanguage === modeState.targetLanguage;

  useLayoutEffect(() => {
    liveFingerprint.current = fingerprint;
    requestId.current += 1;
    setPending(false);
    const current = stateRef.current;
    const previousResult = current[current.mode].result;
    if (previousResult?.fingerprint && previousResult.fingerprint !== fingerprint) {
      // A source that changes and later returns to its old text still needs review.
      const next = {
        ...current,
        [current.mode]: {
          ...current[current.mode],
          result: { ...previousResult, fingerprint: "" },
        },
      };
      stateRef.current = next;
      setState(next);
      rememberRef.current(next);
    }
    // A disabled session or a changed source/version invalidates all pending work.
    return () => {
      requestId.current += 1;
    };
  }, [fingerprint, disabled]);
  useLayoutEffect(() => {
    if (focusResult) resultRef.current?.focus();
  }, [focusResult]);

  function update(next: State) {
    stateRef.current = next;
    setState(next);
    remember(next);
  }
  function changed(next: State) {
    requestId.current += 1;
    setPending(false);
    setNotice(null);
    update(next);
  }
  function changeLanguage(
    field: "sourceLanguage" | "targetLanguage",
    language: TranslationLanguage,
  ) {
    const previous = stateRef.current;
    changed({
      ...previous,
      [previous.mode]: {
        ...previous[previous.mode],
        [field]: language,
        revision: previous[previous.mode].revision + 1,
      },
    });
  }

  async function runTranslation() {
    if (disabled || pending || sourceInvalid || sameLanguage) return;
    const token = ++requestId.current;
    const original = source;
    const capturedFingerprint = fingerprint;
    const capturedMode = state.mode;
    setPending(true);
    setNotice(null);
    try {
      const response = await translate({
        data: {
          texto: original,
          sourceLanguage: modeState.sourceLanguage,
          targetLanguage: modeState.targetLanguage,
        },
      });
      if (token !== requestId.current || capturedFingerprint !== liveFingerprint.current) return;
      if (!response.ok) {
        setNotice({ error: true, text: response.message });
        return;
      }
      const previous = stateRef.current;
      update({
        ...previous,
        [capturedMode]: {
          ...previous[capturedMode],
          result: { text: response.texto, original, fingerprint: capturedFingerprint },
        },
      });
      setNotice({ error: false, text: "Tradução pronta. Revise o texto antes de usar." });
      // Do not steal focus if the operator moved to another control while waiting.
      if (
        document.activeElement === translateRef.current ||
        document.activeElement === document.body
      )
        setFocusResult((value) => value + 1);
    } catch {
      if (token === requestId.current && capturedFingerprint === liveFingerprint.current)
        setNotice({
          error: true,
          text: "Não foi possível traduzir. Tente novamente; o original foi mantido.",
        });
    } finally {
      if (token === requestId.current) setPending(false);
    }
  }

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="min-w-0 space-y-3 border-t border-border pt-3"
    >
      <div className="flex items-center gap-2">
        <Languages aria-hidden="true" className="size-4 text-muted-foreground" />
        <h3 id={`${id}-title`} className="text-sm font-semibold">
          Tradutor
        </h3>
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-mode`} className="text-xs font-medium">
          O que traduzir
        </label>
        <select
          id={`${id}-mode`}
          className={SELECT_CLASS}
          value={state.mode}
          disabled={disabled}
          onChange={(event) => changed({ ...stateRef.current, mode: event.target.value as Mode })}
        >
          <option value="received">Mensagem recebida</option>
          <option value="reply">Minha resposta</option>
        </select>
      </div>
      {state.mode === "received" && messages.length > 0 && (
        <div className="space-y-1">
          <label htmlFor={`${id}-message`} className="text-xs font-medium">
            Mensagem da conversa
          </label>
          <select
            id={`${id}-message`}
            className={SELECT_CLASS}
            disabled={disabled}
            value={state.selectedMessage}
            onChange={(event) => {
              const previous = stateRef.current;
              changed({
                ...previous,
                selectedMessage: event.target.value,
                received: { ...previous.received, revision: previous.received.revision + 1 },
              });
            }}
          >
            <option value="">Colar ou escrever um texto</option>
            {messages.map((message, index) => (
              <option key={message.id} value={message.id}>
                {index + 1}. {message.text.replace(/\s+/g, " ").slice(0, 90)}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <div className="min-w-0 space-y-1">
          <label htmlFor={`${id}-source-language`} className="text-xs font-medium">
            Idioma de origem
          </label>
          <select
            id={`${id}-source-language`}
            className={SELECT_CLASS}
            value={modeState.sourceLanguage}
            disabled={disabled}
            onChange={(event) =>
              changeLanguage("sourceLanguage", event.target.value as TranslationLanguage)
            }
          >
            {Object.entries(TRANSLATION_LANGUAGES).map(([value, label]) => (
              <option key={value} value={value}>
                {label} ({value.toUpperCase()})
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-0 space-y-1">
          <label htmlFor={`${id}-target-language`} className="text-xs font-medium">
            Traduzir para
          </label>
          <select
            id={`${id}-target-language`}
            className={SELECT_CLASS}
            value={modeState.targetLanguage}
            disabled={disabled}
            onChange={(event) =>
              changeLanguage("targetLanguage", event.target.value as TranslationLanguage)
            }
          >
            {Object.entries(TRANSLATION_LANGUAGES).map(([value, label]) => (
              <option key={value} value={value}>
                {label} ({value.toUpperCase()})
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-source`} className="text-xs font-medium">
          {state.mode === "reply" ? "Original da minha resposta" : "Texto original recebido"}
        </label>
        <Textarea
          id={`${id}-source`}
          value={source}
          readOnly={state.mode === "reply"}
          disabled={disabled}
          maxLength={MAX_TRANSLATION_SOURCE}
          rows={3}
          className="min-h-20 resize-y text-sm"
          placeholder={
            state.mode === "reply"
              ? "Escreva sua resposta no campo de mensagem."
              : "Selecione uma mensagem ou cole o texto recebido."
          }
          aria-describedby={`${id}-source-help`}
          onChange={(event) => {
            const previous = stateRef.current;
            changed({
              ...previous,
              selectedMessage: "",
              incomingText: event.target.value,
              received: { ...previous.received, revision: previous.received.revision + 1 },
            });
          }}
        />
        <p id={`${id}-source-help`} className="text-xs text-muted-foreground">
          {state.mode === "reply" ? "Edite o original no campo de mensagem. " : ""}
          {source.length.toLocaleString("pt-BR")}/1.500 caracteres
        </p>
      </div>
      {sameLanguage && (
        <p className="text-xs text-muted-foreground">Escolha dois idiomas diferentes.</p>
      )}
      {source.length > MAX_TRANSLATION_SOURCE && (
        <p role="alert" className="text-xs text-destructive">
          Reduza o original para até 1.500 caracteres.
        </p>
      )}
      {disabled && (
        <p role="status" className="text-xs text-muted-foreground">
          Tradutor indisponível neste momento.
        </p>
      )}
      <Button
        ref={translateRef}
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || pending || sourceInvalid || sameLanguage}
        aria-busy={pending}
        onClick={() => void runTranslation()}
      >
        {pending && (
          <Loader2
            aria-hidden="true"
            className="mr-2 size-3.5 animate-spin motion-reduce:animate-none"
          />
        )}
        {pending ? "Traduzindo…" : "Traduzir"}
      </Button>
      <div aria-live="polite" aria-atomic="true">
        {notice && (
          <p
            role={notice.error ? "alert" : "status"}
            className={`text-xs ${notice.error ? "text-destructive" : "text-muted-foreground"}`}
          >
            {notice.text}
          </p>
        )}
      </div>
      {result && (
        <div className="space-y-2">
          {stale && (
            <p role="status" className="text-xs font-medium text-muted-foreground">
              Resultado desatualizado. Traduza novamente antes de usar.
            </p>
          )}
          <label htmlFor={`${id}-result`} className="block text-xs font-medium">
            Tradução para revisão
          </label>
          <Textarea
            ref={resultRef}
            id={`${id}-result`}
            value={result.text}
            rows={3}
            maxLength={MAX_TRANSLATION_RESULT}
            disabled={disabled}
            className="min-h-20 resize-y text-sm"
            onChange={(event) => {
              const previous = stateRef.current;
              const oldResult = previous[previous.mode].result;
              if (!oldResult) return;
              // Editing the previous result while translating cancels that request's UI result.
              changed({
                ...previous,
                [previous.mode]: {
                  ...previous[previous.mode],
                  result: { ...oldResult, text: event.target.value },
                },
              });
            }}
          />
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Original desta tradução
            </summary>
            <p className="mt-2 whitespace-pre-wrap break-words">{result.original}</p>
          </details>
          {state.mode === "reply" && (
            <Button
              type="button"
              size="sm"
              disabled={
                disabled ||
                pending ||
                stale ||
                !result.text.trim() ||
                result.text.length > MAX_TRANSLATION_SOURCE
              }
              onClick={() => {
                if (
                  disabled ||
                  pending ||
                  stale ||
                  !result.text.trim() ||
                  result.text.length > MAX_TRANSLATION_SOURCE
                )
                  return;
                onApply(result.text);
                setNotice({ error: false, text: "Tradução inserida na resposta para revisão." });
              }}
            >
              Usar na resposta
            </Button>
          )}
          {state.mode === "reply" && result.text.length > MAX_TRANSLATION_SOURCE && (
            <p className="text-xs text-muted-foreground">
              Reduza a tradução para até 1.500 caracteres antes de usar na resposta.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
