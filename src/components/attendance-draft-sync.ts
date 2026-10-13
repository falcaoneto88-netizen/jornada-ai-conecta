import type { AttendanceDraftResult, AttendanceDraftSnapshot } from "@/lib/attendance-draft.core";
import type { InboxDraftStore } from "./inbox-workspace";

export type DraftSyncStatus = "loading" | "saved" | "saving" | "memory" | "error" | "conflict";
export type DraftSyncView = {
  status: DraftSyncStatus;
  updatedAt: string | null;
  remote: AttendanceDraftSnapshot | null;
};
type Api = {
  load: () => Promise<AttendanceDraftResult>;
  save: (text: string, expectedRevision: string | null) => Promise<AttendanceDraftResult>;
  clear: (text: string, expectedRevision: string | null) => Promise<AttendanceDraftResult>;
};
export type DraftSendSnapshot = { text: string; revision: string | null };
export type DraftCleanupResult = "cleared" | "superseded" | "pending" | "not_needed";

/** Per mounted conversation; no message text enters localStorage or a shared module cache. */
export function createAttendanceDraftSync(store: InboxDraftStore, key: string, api: Api) {
  let view: DraftSyncView = { status: "loading", updatedAt: null, remote: null };
  let revision: string | null = null;
  let savedText = "";
  let started = false;
  let hydrating = true;
  let loaded = false;
  let writing = false;
  let hydratedEditorVersion: number | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let chain = Promise.resolve();
  let loadPromise: Promise<void> = Promise.resolve();
  const listeners = new Set<() => void>();
  const update = (status: DraftSyncStatus, remote: AttendanceDraftSnapshot | null = null) => {
    view = { status, remote, updatedAt: view.updatedAt };
    listeners.forEach((f) => f());
  };
  const accept = (value: AttendanceDraftSnapshot) => {
    revision = value.revision;
    savedText = value.draft?.text ?? "";
    loaded = true;
    view = {
      status: writing || store.get(key).text !== savedText ? "saving" : "saved",
      remote: null,
      updatedAt: value.draft?.updatedAt ?? null,
    };
    listeners.forEach((f) => f());
  };
  function hasUnsavedChanges() {
    // Empty text can be an unsaved deletion; an in-flight write may still replace it.
    const current = store.get(key);
    return (
      writing ||
      current.text !== savedText ||
      (!loaded && current.version > 0) ||
      (["conflict", "error", "memory"].includes(view.status) && (loaded || current.version > 0))
    );
  }
  function finishWrite() {
    writing = false;
    if (view.status === "saving") update(store.get(key).text === savedText ? "saved" : "saving");
  }
  function failure(r: Exclude<AttendanceDraftResult, { ok: true }>) {
    if (r.code === "draft_conflict" && "current" in r && r.current) update("conflict", r.current);
    else update(r.code === "draft_unavailable" ? "memory" : "error");
  }
  async function saveLatest() {
    if (hydrating || ["conflict", "memory", "error"].includes(view.status)) return;
    const text = store.get(key).text;
    if (text === savedText) {
      update("saved");
      return;
    }
    if (text.length > 1500) {
      update("error");
      return;
    }
    writing = true;
    update("saving");
    try {
      const r = await api.save(text, revision);
      if (!r.ok) return failure(r);
      accept(r.data);
      // An edit while this request was running must be persisted separately with the new revision.
      if (store.get(key).text !== savedText) schedule();
    } catch {
      update("error");
    } finally {
      finishWrite();
    }
  }
  function queueSave() {
    if (timer) clearTimeout(timer);
    timer = undefined;
    chain = chain.then(saveLatest);
    return chain;
  }
  function schedule() {
    if (hydrating || ["conflict", "memory", "error"].includes(view.status)) return;
    if (timer) clearTimeout(timer);
    update(writing || store.get(key).text !== savedText ? "saving" : "saved");
    timer = setTimeout(() => void queueSave(), 1500);
  }
  async function load() {
    const before = store.get(key);
    hydrating = true;
    update("loading");
    try {
      const r = await api.load();
      if (!r.ok) {
        failure(r);
        return false;
      }
      revision = r.data.revision;
      savedText = r.data.draft?.text ?? "";
      loaded = true;
      const current = store.get(key);
      // Never overwrite typing or an in-memory draft when a slow load finishes.
      if (current.version === 0 && before.version === 0) {
        store.set(key, savedText);
        hydratedEditorVersion = store.get(key).version;
      } else if (current.text !== savedText && savedText) {
        update("conflict", r.data);
        return true;
      }
      accept(r.data);
      return true;
    } catch {
      update("error");
      return false;
    } finally {
      hydrating = false;
      if (["saved", "saving"].includes(view.status) && store.get(key).text !== savedText)
        schedule();
    }
  }
  async function clearSnapshot(
    snapshot: DraftSendSnapshot,
    recoverEditor: boolean,
  ): Promise<DraftCleanupResult> {
    const before = store.get(key);
    writing = true;
    update("saving");
    try {
      const r = await api.clear(snapshot.text, snapshot.revision);
      if (!r.ok) {
        // A newer version belongs to later work (possibly a different tab): preserve it.
        failure(r);
        return r.code === "draft_conflict" && r.current.revision !== snapshot.revision
          ? "superseded"
          : "pending";
      }
      const current = store.get(key);
      if (
        recoverEditor &&
        before.version === hydratedEditorVersion &&
        before.text === snapshot.text &&
        current.text === before.text &&
        current.version === before.version
      ) {
        // Only a proven clear may remove the recovered sent text. Later edits remain intact.
        store.set(key, "");
      }
      accept(r.data);
      if (store.get(key).text !== savedText) schedule();
      return "cleared";
    } catch {
      update("error");
      return "pending";
    } finally {
      finishWrite();
    }
  }
  return {
    getSnapshot: () => view,
    hasUnsavedChanges,
    subscribe: (f: () => void) => {
      listeners.add(f);
      return () => {
        listeners.delete(f);
      };
    },
    start() {
      const unsubscribe = store.subscribe(schedule);
      if (!started) {
        started = true;
        loadPromise = load().then(() => undefined);
      }
      return () => {
        unsubscribe();
        if (timer) clearTimeout(timer);
        // Switching contacts flushes only the original scoped draft, even after unmount.
        void loadPromise.then(queueSave);
      };
    },
    async retry() {
      await chain;
      loadPromise = load().then(() => undefined);
      await loadPromise;
      await queueSave();
    },
    async keepLocal() {
      if (view.status !== "conflict" || !view.remote) return;
      accept(view.remote);
      await queueSave();
    },
    useRemote() {
      if (view.status !== "conflict" || !view.remote) return;
      const remote = view.remote;
      hydrating = true;
      store.set(key, remote.draft?.text ?? "");
      accept(remote);
      hydrating = false;
    },
    async beforeSend(): Promise<DraftSendSnapshot | null> {
      await loadPromise;
      await queueSave();
      return view.status === "saved" && savedText === store.get(key).text
        ? { revision, text: savedText }
        : null;
    },
    async afterConfirmedSend(snapshot: DraftSendSnapshot | null): Promise<DraftCleanupResult> {
      if (!snapshot) return "not_needed";
      if (timer) clearTimeout(timer);
      timer = undefined;
      const cleanup = chain.then(() => clearSnapshot(snapshot, false));
      chain = cleanup.then(() => undefined);
      return cleanup;
    },
    async afterRecoveredSend(expectedRevision: string): Promise<DraftCleanupResult> {
      if (timer) clearTimeout(timer);
      timer = undefined;
      await loadPromise;
      // Hydration may have scheduled a save. Reconciliation must compare the loaded revision
      // before persisting any different, newly typed editor text.
      if (timer) clearTimeout(timer);
      timer = undefined;
      const cleanup = chain.then(async (): Promise<DraftCleanupResult> => {
        // A stale cache cannot prove that a newer revision replaced the sent one. Read afresh
        // on every explicit recovery, including retry after offline/failed cleanup.
        if (!(await load())) return "pending";
        if (timer) clearTimeout(timer);
        timer = undefined;
        if (revision !== expectedRevision) {
          if (store.get(key).text !== savedText) schedule();
          return "superseded";
        }
        return clearSnapshot({ text: savedText, revision }, true);
      });
      chain = cleanup.then(() => undefined);
      return cleanup;
    },
  };
}
