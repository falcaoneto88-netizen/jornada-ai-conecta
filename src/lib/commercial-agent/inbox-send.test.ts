import { beforeEach, expect, it, vi } from "vitest";
import { AgentError } from "./core";
import { CommercialAgent } from "./service.server";

const store = { command: vi.fn() };
const agent = new CommercialAgent({
  store, provider: { history: vi.fn(), send: vi.fn() }, generate: vi.fn(),
  encryptionKey: "x", enabled: true, sendEnabled: true,
});
const a = agent as unknown as Record<string, ReturnType<typeof vi.fn>>;
const input = { contactId: "c1", conversationId: "v1", text: "Olá", requestId: "00000000-0000-4000-8000-000000000001" };
const row = (state: string) => ({ id: "m1", state, prepared_by: "u1", contact_id: "c1", conversation_id: "v1", reply_hash: "h", error_code: null, result_message_id: state === "sent" ? "g1" : null });
beforeEach(() => {
  store.command.mockReset();
  a["manualPayload"] = vi.fn(() => ({ text: "Olá" }));
  a["manualContext"] = vi.fn(async () => ({ blockedReason: null, sessionVersion: 3, snapshot: { historyHash: "a".repeat(64) } }));
  a["manualPrepare"] = vi.fn(async () => ({ id: "m1" }));
  a["manualSend"] = vi.fn(async () => ({ state: "sent", code: null, messageId: "g1" }));
});
it("primeiro clique prepara e envia uma vez", async () => {
  store.command.mockImplementation(async (op: string) => (op === "manual_lookup" ? null : row("prepared")));
  expect(await agent.inboxSend("o", "u1", input, true)).toMatchObject({ state: "sent", messageId: "g1" });
  expect(a["manualSend"]).toHaveBeenCalledTimes(1);
  expect(a["manualPrepare"]).toHaveBeenCalledWith("o", "u1", expect.objectContaining({ expectedVersion: 3 }), true);
});
it("repetição com a mesma chave não faz segundo POST (sent/unknown/sending)", async () => {
  for (const st of ["sent", "unknown", "sending", "rejected"]) {
    store.command.mockResolvedValue(row(st));
    const r = await agent.inboxSend("o", "u1", input, true);
    expect(r.state).toBe(st);
  }
  expect(a["manualSend"]).not.toHaveBeenCalled();
  expect(a["manualContext"]).not.toHaveBeenCalled();
});
it("mesma chave com outro texto, contato ou utilizador é recusada", async () => {
  store.command.mockResolvedValue(row("prepared"));
  await expect(agent.inboxSend("o", "u1", { ...input, text: "Outro" }, true)).rejects.toThrow("manual_request_mismatch");
  await expect(agent.inboxSend("o", "u2", input, true)).rejects.toThrow("manual_request_mismatch");
  await expect(agent.inboxSend("o", "u1", { ...input, contactId: "c2" }, true)).rejects.toThrow("manual_request_mismatch");
});
it("bloqueios do servidor (DND, canal, janela, escopo, viewer) impedem o envio", async () => {
  store.command.mockResolvedValue(null);
  for (const code of ["do_not_contact", "unsupported_channel", "channel_window", "send_disabled"]) {
    a["manualContext"] = vi.fn(async () => ({ blockedReason: code }));
    await expect(agent.inboxSend("o", "u1", input, true)).rejects.toThrow(code);
  }
  for (const code of ["scope_mismatch", "forbidden"]) {
    a["manualContext"] = vi.fn(async () => { throw new AgentError(code); });
    await expect(agent.inboxSend("o", "u1", input, true)).rejects.toThrow(code);
  }
  expect(a["manualSend"]).not.toHaveBeenCalled();
});
it("pedido concorrente com a mesma chave devolve o estado já reclamado", async () => {
  let n = 0;
  store.command.mockImplementation(async () => (n++ === 0 ? null : row("sending")));
  a["manualPrepare"] = vi.fn(async () => { throw new AgentError("manual_request_used"); });
  expect((await agent.inboxSend("o", "u1", input, true)).state).toBe("sending");
  expect(a["manualSend"]).not.toHaveBeenCalled();
});
it("resultado incerto é devolvido sem nova tentativa", async () => {
  store.command.mockImplementation(async (op: string) => (op === "manual_lookup" ? null : row("prepared")));
  a["manualSend"] = vi.fn(async () => ({ state: "unknown", code: "outcome_unknown", messageId: null }));
  expect((await agent.inboxSend("o", "u1", input, true)).state).toBe("unknown");
  expect(a["manualSend"]).toHaveBeenCalledTimes(1);
});
