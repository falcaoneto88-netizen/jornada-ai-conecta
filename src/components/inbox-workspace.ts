import { useLayoutEffect, useRef, useState } from "react";
import { canalMensagem, type ConversaGhl, type MensagemGhl } from "@/lib/ghl-observation.core";

const EMPTY_DRAFT = { text: "", version: 0 };
type Draft = { text: string; version: number };

/** Owned by the mounted inbox, never module-global or browser-persistent. Contains text only. */
export function createInboxDraftStore() {
  const drafts = new Map<string, Draft>();
  const submissions = new Map<string, { key: string; draft: Draft }>();
  const listeners = new Set<() => void>();
  let version = 0;
  const notify = () => {
    version++;
    listeners.forEach((listener) => listener());
  };
  return {
    get: (key: string) => drafts.get(key) ?? EMPTY_DRAFT,
    getVersion: () => version,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(key: string, text: string) {
      drafts.set(key, { text, version: (drafts.get(key)?.version ?? 0) + 1 });
      notify();
    },
    submitted(requestId: string, key: string) {
      submissions.set(requestId, { key, draft: drafts.get(key) ?? EMPTY_DRAFT });
    },
    confirmed(requestId: string | null) {
      if (!requestId) return;
      const submission = submissions.get(requestId);
      if (!submission) return;
      const current = drafts.get(submission.key) ?? EMPTY_DRAFT;
      if (current.version === submission.draft.version && current.text === submission.draft.text) {
        drafts.set(submission.key, { text: "", version: current.version + 1 });
        notify();
      }
      submissions.delete(requestId);
    },
    forget: (requestId: string | null) => {
      if (requestId) submissions.delete(requestId);
    },
  };
}
export type InboxDraftStore = ReturnType<typeof createInboxDraftStore>;
export const inboxDraftKey = (
  scope: string,
  organizationId: string,
  contactId: string,
  conversationId: string,
) => JSON.stringify([scope, organizationId, contactId, conversationId]);

export function filterLoadedConversations(
  conversations: ConversaGhl[],
  unread: boolean,
  channel: string,
) {
  return conversations.filter(
    (conversation) =>
      (!unread || (conversation.naoLidas ?? 0) > 0) &&
      (channel === "all" || canalMensagem(conversation.tipo) === channel),
  );
}

/** Same loaded material sent to AI plus message identity/metadata, independently of the server revision. */
export function inboxAnalysisFingerprint(messages: MensagemGhl[], revision: unknown) {
  return JSON.stringify([
    messages.map((message) => [
      message.id,
      message.direcao,
      message.texto,
      message.tipo,
      message.data,
      message.estado,
    ]),
    revision,
  ]);
}

/** Start at the latest message; don't move the reader when newer messages arrive away from the bottom. */
export function useInboxHistoryScroll(messages: MensagemGhl[]) {
  const ref = useRef<HTMLDivElement | null>(null);
  const previous = useRef<{ first: string | null; last: string | null; height: number } | null>(
    null,
  );
  const following = useRef(true);
  const viewportHeight = useRef(0);
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const first = messages[0]?.id ?? null;
  const last = messages.at(-1)?.id ?? null;
  const version = messages
    .map((message) => `${message.id}:${message.texto}:${message.estado}`)
    .join("\u0000");
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !last) return;
    const old = previous.current;
    viewportHeight.current = element.clientHeight;
    if (!old || following.current) {
      element.scrollTop = element.scrollHeight;
      following.current = true;
      setHasNewMessages(false);
    } else if (first !== old.first && last === old.last) {
      // Older messages were prepended: keep the same message at the same visual offset.
      element.scrollTop += element.scrollHeight - old.height;
    } else if (last !== old.last) setHasNewMessages(true);
    previous.current = { first, last, height: element.scrollHeight };
  }, [first, last, version]);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      // Mobile opens a previously hidden panel; IA and attachments can also resize the history.
      if (following.current) element.scrollTop = element.scrollHeight;
      viewportHeight.current = element.clientHeight;
      if (previous.current) previous.current.height = element.scrollHeight;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  function onScroll() {
    const element = ref.current;
    if (!element) return;
    // Resize-induced scroll events can run before ResizeObserver. They aren't a reader scrolling away.
    if (element.clientHeight !== viewportHeight.current) return;
    following.current = element.scrollHeight - element.scrollTop - element.clientHeight < 64;
    if (following.current) setHasNewMessages(false);
    if (previous.current) previous.current.height = element.scrollHeight;
  }
  function toLatest() {
    const element = ref.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
    following.current = true;
    setHasNewMessages(false);
  }
  return { ref, onScroll, toLatest, hasNewMessages };
}
