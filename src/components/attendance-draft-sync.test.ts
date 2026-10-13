import { afterEach, expect, it, vi } from "vitest";
import { createInboxDraftStore } from "./inbox-workspace";
import { createAttendanceDraftSync } from "./attendance-draft-sync";
import type { AttendanceDraftResult, AttendanceDraftSnapshot } from "@/lib/attendance-draft.core";

afterEach(() => vi.useRealTimers());
const snapshot = (text: string, revision = "r1"): AttendanceDraftSnapshot => ({
  revision,
  draft: text
    ? { text, updatedAt: "2026-10-13T12:00:00Z", expiresAt: "2026-10-20T12:00:00Z" }
    : null,
});
function server(initial: AttendanceDraftSnapshot = { revision: null, draft: null }) {
  let remote = initial;
  let version = 1;
  const result = (): AttendanceDraftResult => ({ ok: true, data: remote });
  const conflict = (): AttendanceDraftResult => ({
    ok: false,
    code: "draft_conflict",
    current: remote,
  });
  return {
    load: vi.fn(async (): Promise<AttendanceDraftResult> => result()),
    save: vi.fn(async (text: string, revision: string | null): Promise<AttendanceDraftResult> => {
      if (remote.revision !== revision) return conflict();
      remote = snapshot(text, `r${++version}`);
      return result();
    }),
    clear: vi.fn(async (text: string, revision: string | null): Promise<AttendanceDraftResult> => {
      if (remote.revision !== revision || (remote.draft?.text ?? "") !== text) return conflict();
      remote = snapshot("", `r${++version}`);
      return result();
    }),
    current: () => remote,
    externalEdit: (text: string) => {
      remote = snapshot(text, `r${++version}`);
    },
  };
}
it("recupera somente a conversa selecionada, sem salvar dados no navegador", async () => {
  const store = createInboxDraftStore();
  store.set("outro", "Outro atendimento");
  const api = server(snapshot("Resposta em preparação"));
  const sync = createAttendanceDraftSync(store, "este", api);
  sync.start();
  await sync.beforeSend();
  expect(store.get("este").text).toBe("Resposta em preparação");
  expect(store.get("outro").text).toBe("Outro atendimento");
  expect(api.save).not.toHaveBeenCalled();
  expect(sync.getSnapshot().status).toBe("saved");
});
it("uma leitura lenta não substitui o texto que o atendente começou a escrever", async () => {
  const store = createInboxDraftStore();
  const api = server(snapshot("Texto de outra aba"));
  let resolve!: (r: AttendanceDraftResult) => void;
  api.load.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const sync = createAttendanceDraftSync(store, "k", api);
  sync.start();
  store.set("k", "Meu texto novo");
  resolve({ ok: true, data: api.current() });
  expect(await sync.beforeSend()).toBeNull();
  expect(store.get("k").text).toBe("Meu texto novo");
  expect(sync.getSnapshot().status).toBe("conflict");
  await sync.keepLocal();
  expect(api.current().draft?.text).toBe("Meu texto novo");
});
it("conflito entre abas não sobrescreve a versão remota sem decisão humana", async () => {
  const store = createInboxDraftStore(),
    api = server();
  const sync = createAttendanceDraftSync(store, "k", api);
  sync.start();
  await sync.beforeSend();
  api.externalEdit("Versão da outra aba");
  store.set("k", "Minha versão");
  expect(await sync.beforeSend()).toBeNull();
  expect(api.current().draft?.text).toBe("Versão da outra aba");
  expect(store.get("k").text).toBe("Minha versão");
  sync.useRemote();
  expect(store.get("k").text).toBe("Versão da outra aba");
});
it("flush ao trocar de contato salva o texto no escopo original", async () => {
  vi.useFakeTimers();
  const store = createInboxDraftStore(),
    api = server();
  const sync = createAttendanceDraftSync(store, "a", api);
  const dispose = sync.start();
  await sync.beforeSend();
  store.set("a", "Texto antes de sair");
  dispose();
  store.set("b", "Outro paciente");
  await vi.runAllTimersAsync();
  expect(api.current().draft?.text).toBe("Texto antes de sair");
});
it("confirmação de envio limpa apenas o snapshot enviado e preserva uma edição posterior", async () => {
  const store = createInboxDraftStore(),
    api = server();
  const sync = createAttendanceDraftSync(store, "k", api);
  sync.start();
  await sync.beforeSend();
  store.set("k", "Mensagem enviada");
  const sent = await sync.beforeSend();
  store.submitted("request", "k");
  store.set("k", "Nova resposta");
  await sync.beforeSend();
  store.confirmed("request");
  await sync.afterConfirmedSend(sent);
  expect(store.get("k").text).toBe("Nova resposta");
  expect(api.current().draft?.text).toBe("Nova resposta");
});
it("não recupera o texto enviado após limpeza confirmada", async () => {
  const store = createInboxDraftStore(),
    api = server();
  const sync = createAttendanceDraftSync(store, "k", api);
  sync.start();
  await sync.beforeSend();
  store.set("k", "Enviar este texto");
  const sent = await sync.beforeSend();
  store.submitted("r", "k");
  store.confirmed("r");
  await sync.afterConfirmedSend(sent);
  expect(api.current().draft).toBeNull();
  expect(store.get("k").text).toBe("");
});
it("indisponibilidade mantém o texto em memória e nunca informa salvo", async () => {
  const store = createInboxDraftStore(),
    api = server();
  api.load.mockResolvedValue({ ok: false, code: "draft_unavailable" });
  const sync = createAttendanceDraftSync(store, "k", api);
  sync.start();
  store.set("k", "Não perder");
  expect(await sync.beforeSend()).toBeNull();
  expect(sync.getSnapshot().status).toBe("memory");
  expect(store.get("k").text).toBe("Não perder");
  expect(api.save).not.toHaveBeenCalled();
});
it("reinício de efeito em StrictMode mantém a subscrição", async () => {
  vi.useFakeTimers();
  const store = createInboxDraftStore(),
    api = server();
  const sync = createAttendanceDraftSync(store, "k", api);
  sync.start()();
  sync.start();
  await sync.beforeSend();
  store.set("k", "Nova edição");
  await vi.runAllTimersAsync();
  expect(api.current().draft?.text).toBe("Nova edição");
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

it("apagar todo o texto continua pendente até persistir a exclusão", async () => {
  vi.useFakeTimers();
  const store = createInboxDraftStore(),
    api = server(snapshot("Rascunho anterior"));
  const sync = createAttendanceDraftSync(store, "k", api);
  sync.start();
  await sync.beforeSend();
  expect(sync.hasUnsavedChanges()).toBe(false);
  store.set("k", "");
  expect(sync.getSnapshot().status).toBe("saving");
  expect(sync.hasUnsavedChanges()).toBe(true);
  expect(api.current().draft?.text).toBe("Rascunho anterior");
  await sync.beforeSend();
  expect(api.current().draft).toBeNull();
  expect(sync.hasUnsavedChanges()).toBe(false);
});

it("reverter o texto durante uma escrita não informa salvo antes de compensar a escrita", async () => {
  vi.useFakeTimers();
  const store = createInboxDraftStore(),
    api = server(snapshot("Texto A"));
  const sync = createAttendanceDraftSync(store, "k", api);
  sync.start();
  await sync.beforeSend();
  const started = deferred<void>(),
    release = deferred<void>();
  const save = api.save.getMockImplementation()!;
  api.save.mockImplementationOnce(async (...args) => {
    started.resolve();
    await release.promise;
    return save(...args);
  });
  store.set("k", "Texto B");
  const pending = sync.beforeSend();
  await started.promise;
  store.set("k", "Texto A");
  expect(sync.getSnapshot().status).toBe("saving");
  expect(sync.hasUnsavedChanges()).toBe(true);
  release.resolve();
  await pending;
  expect(api.current().draft?.text).toBe("Texto B");
  expect(sync.getSnapshot().status).toBe("saving");
  expect(sync.hasUnsavedChanges()).toBe(true);
  await sync.beforeSend();
  expect(api.current().draft?.text).toBe("Texto A");
  expect(sync.getSnapshot().status).toBe("saved");
  expect(sync.hasUnsavedChanges()).toBe(false);
});

it("após reload a confirmação limpa a revisão enviada sem depender de submissions em memória", async () => {
  vi.useFakeTimers();
  const api = server(snapshot("Texto já enviado", "r1"));
  const store = createInboxDraftStore();
  const sync = createAttendanceDraftSync(store, "k", api);
  sync.start();
  await sync.afterRecoveredSend("r1");
  expect(api.clear).toHaveBeenCalledWith("Texto já enviado", "r1");
  expect(store.get("k").text).toBe("");
  expect(api.current().draft).toBeNull();
  expect(sync.hasUnsavedChanges()).toBe(false);
  const nextStore = createInboxDraftStore();
  const next = createAttendanceDraftSync(nextStore, "k", api);
  next.start();
  await next.beforeSend();
  expect(nextStore.get("k").text).toBe("");
  expect(api.save).not.toHaveBeenCalled();
});

it("a recuperação preserva edição nova ainda não salva e a persiste após limpar a revisão enviada", async () => {
  vi.useFakeTimers();
  const store = createInboxDraftStore(),
    api = server(snapshot("Mensagem enviada", "r1"));
  const sync = createAttendanceDraftSync(store, "k", api);
  sync.start();
  await sync.beforeSend();
  store.set("k", "Nova resposta depois do reload");
  await sync.afterRecoveredSend("r1");
  expect(api.clear).toHaveBeenCalledWith("Mensagem enviada", "r1");
  expect(store.get("k").text).toBe("Nova resposta depois do reload");
  expect(api.current().draft).toBeNull();
  expect(sync.hasUnsavedChanges()).toBe(true);
  await sync.beforeSend();
  expect(api.current().draft?.text).toBe("Nova resposta depois do reload");
  expect(sync.hasUnsavedChanges()).toBe(false);
});

it("a resposta lenta da limpeza não apaga edição realizada durante a requisição", async () => {
  vi.useFakeTimers();
  const store = createInboxDraftStore(),
    api = server(snapshot("Mensagem enviada", "r1"));
  const sync = createAttendanceDraftSync(store, "k", api);
  sync.start();
  await sync.beforeSend();
  const started = deferred<void>(),
    release = deferred<void>();
  const clear = api.clear.getMockImplementation()!;
  api.clear.mockImplementationOnce(async (...args) => {
    started.resolve();
    await release.promise;
    return clear(...args);
  });
  const pending = sync.afterRecoveredSend("r1");
  await started.promise;
  expect(sync.hasUnsavedChanges()).toBe(true);
  store.set("k", "Nova mensagem durante a limpeza");
  release.resolve();
  await pending;
  expect(store.get("k").text).toBe("Nova mensagem durante a limpeza");
  await sync.beforeSend();
  expect(api.current().draft?.text).toBe("Nova mensagem durante a limpeza");
});

it("uma revisão nova no servidor após reload nunca é apagada pela confirmação antiga", async () => {
  vi.useFakeTimers();
  const store = createInboxDraftStore(),
    api = server();
  api.externalEdit("Trabalho posterior");
  const sync = createAttendanceDraftSync(store, "k", api);
  sync.start();
  await sync.afterRecoveredSend("r1");
  expect(api.clear).not.toHaveBeenCalled();
  expect(store.get("k").text).toBe("Trabalho posterior");
  expect(api.current().draft?.text).toBe("Trabalho posterior");
});

it("escrita já em andamento termina antes da recuperação e preserva sua revisão nova", async () => {
  vi.useFakeTimers();
  const store = createInboxDraftStore(),
    api = server(snapshot("Texto enviado", "r1"));
  const sync = createAttendanceDraftSync(store, "k", api);
  sync.start();
  await sync.beforeSend();
  const started = deferred<void>(),
    release = deferred<void>();
  const save = api.save.getMockImplementation()!;
  api.save.mockImplementationOnce(async (...args) => {
    started.resolve();
    await release.promise;
    return save(...args);
  });
  store.set("k", "Trabalho novo");
  const saving = sync.beforeSend();
  await started.promise;
  const recovering = sync.afterRecoveredSend("r1");
  release.resolve();
  await Promise.all([saving, recovering]);
  expect(api.clear).not.toHaveBeenCalled();
  expect(api.current().draft?.text).toBe("Trabalho novo");
  expect(store.get("k").text).toBe("Trabalho novo");
});

it("conflito remoto durante a limpeza preserva ambas as versões e mantém aviso de pendência", async () => {
  vi.useFakeTimers();
  const store = createInboxDraftStore(),
    api = server(snapshot("Texto enviado", "r1"));
  const sync = createAttendanceDraftSync(store, "k", api);
  sync.start();
  await sync.beforeSend();
  const started = deferred<void>(),
    release = deferred<void>();
  const clear = api.clear.getMockImplementation()!;
  api.clear.mockImplementationOnce(async (...args) => {
    started.resolve();
    await release.promise;
    return clear(...args);
  });
  const recovering = sync.afterRecoveredSend("r1");
  await started.promise;
  api.externalEdit("Texto de outra aba");
  release.resolve();
  await recovering;
  expect(api.current().draft?.text).toBe("Texto de outra aba");
  expect(store.get("k").text).toBe("Texto enviado");
  expect(sync.getSnapshot().status).toBe("conflict");
  expect(sync.hasUnsavedChanges()).toBe(true);
});

it("hidratação lenta seguida de confirmação não descarta uma edição iniciada após reload", async () => {
  vi.useFakeTimers();
  const store = createInboxDraftStore(),
    api = server(snapshot("Texto enviado", "r1"));
  const read = deferred<AttendanceDraftResult>();
  api.load.mockImplementationOnce(() => read.promise);
  const sync = createAttendanceDraftSync(store, "k", api);
  sync.start();
  const recovering = sync.afterRecoveredSend("r1");
  store.set("k", "Nova resposta antes da hidratação");
  read.resolve({ ok: true, data: api.current() });
  await recovering;
  expect(api.clear).toHaveBeenCalledWith("Texto enviado", "r1");
  expect(store.get("k").text).toBe("Nova resposta antes da hidratação");
  await sync.beforeSend();
  expect(api.current().draft?.text).toBe("Nova resposta antes da hidratação");
});

it("editar e voltar ao mesmo texto durante clear é uma edição posterior que deve permanecer", async () => {
  vi.useFakeTimers();
  const store = createInboxDraftStore(),
    api = server(snapshot("Texto enviado", "r1"));
  const sync = createAttendanceDraftSync(store, "k", api);
  sync.start();
  await sync.beforeSend();
  const started = deferred<void>(),
    release = deferred<void>();
  const clear = api.clear.getMockImplementation()!;
  api.clear.mockImplementationOnce(async (...args) => {
    started.resolve();
    await release.promise;
    return clear(...args);
  });
  const recovering = sync.afterRecoveredSend("r1");
  await started.promise;
  store.set("k", "Edição intermediária");
  store.set("k", "Texto enviado");
  release.resolve();
  await recovering;
  expect(store.get("k").text).toBe("Texto enviado");
  expect(sync.hasUnsavedChanges()).toBe(true);
  await sync.beforeSend();
  expect(api.current().draft?.text).toBe("Texto enviado");
  expect(api.current().revision).not.toBe("r1");
});

it("falha de limpeza não é sucesso e a recuperação usa leitura fresca antes de novo CAS", async () => {
  vi.useFakeTimers();
  const store = createInboxDraftStore(),
    api = server(snapshot("Texto enviado", "r1"));
  const sync = createAttendanceDraftSync(store, "k", api);
  sync.start();
  const sent = await sync.beforeSend();
  store.submitted("r", "k");
  store.confirmed("r");
  api.clear.mockResolvedValueOnce({ ok: false, code: "draft_unavailable" });
  expect(await sync.afterConfirmedSend(sent)).toBe("pending");
  expect(api.current().draft?.text).toBe("Texto enviado");
  expect(await sync.afterRecoveredSend("r1")).toBe("cleared");
  expect(api.load).toHaveBeenCalledTimes(2);
  expect(api.current().draft).toBeNull();
});

it("cache antigo e leitura offline nunca provam que a revisão pendente foi substituída", async () => {
  vi.useFakeTimers();
  const store = createInboxDraftStore(),
    api = server(snapshot("Cache anterior", "r1"));
  const sync = createAttendanceDraftSync(store, "k", api);
  sync.start();
  await sync.beforeSend();
  api.load.mockRejectedValueOnce(new Error("offline"));
  expect(await sync.afterRecoveredSend("r2")).toBe("pending");
  expect(api.clear).not.toHaveBeenCalled();
  expect(store.get("k").text).toBe("Cache anterior");
});

it("somente resposta fresca comprovando outra revisão encerra limpeza como substituída", async () => {
  vi.useFakeTimers();
  const store = createInboxDraftStore(),
    api = server(snapshot("Texto enviado", "r1"));
  const sync = createAttendanceDraftSync(store, "k", api);
  sync.start();
  await sync.beforeSend();
  api.externalEdit("Trabalho posterior");
  expect(await sync.afterRecoveredSend("r1")).toBe("superseded");
  expect(api.clear).not.toHaveBeenCalled();
  expect(api.current().draft?.text).toBe("Trabalho posterior");
  expect(sync.getSnapshot().status).toBe("conflict");
});

it("edição após hidratação permanece mesmo quando volta ao texto enviado antes da recuperação", async () => {
  vi.useFakeTimers();
  const store = createInboxDraftStore(),
    api = server(snapshot("Texto enviado", "r1"));
  const sync = createAttendanceDraftSync(store, "k", api);
  sync.start();
  await sync.beforeSend();
  store.set("k", "Outra edição");
  store.set("k", "Texto enviado");
  expect(await sync.afterRecoveredSend("r1")).toBe("cleared");
  expect(store.get("k").text).toBe("Texto enviado");
  expect(api.current().draft).toBeNull();
  await sync.beforeSend();
  expect(api.current().draft?.text).toBe("Texto enviado");
  expect(api.current().revision).not.toBe("r1");
});
