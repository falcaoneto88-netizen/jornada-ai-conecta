import { beforeEach, expect, it, vi } from "vitest";
import { AgentError } from "./core";
import { CommercialAgent } from "./service.server";

const Z = "zap";
const store = { command: vi.fn() };
const channels = vi.fn();
const agent = new CommercialAgent({
  store,
  provider: { history: vi.fn(), send: vi.fn(), smsChannels: channels },
  generate: vi.fn(),
  encryptionKey: "x",
  enabled: true,
  sendEnabled: true,
});
const a = agent as unknown as Record<string, ReturnType<typeof vi.fn>>;
const H = "a".repeat(64);
const revision = { historyHash: H, sessionVersion: 3, providerId: Z, defaultId: Z };
const input = { contactId: "c1", conversationId: "v1", text: "Olá", requestId: "00000000-0000-4000-8000-000000000001", revision };
const route = { providerId: Z, name: "Zaptos", defaultId: Z };
const snapshot = {
  event: { type: "InboundMessage", locationId: "l", contactId: "c1", conversationId: "v1", messageId: "in" },
  messages: [
    { id: "o", at: "2026-10-08T10:00:00Z", direction: "outbound", text: "", channel: "SMS", attachments: 0, provider: Z },
    { id: "in", at: "2026-10-08T11:00:00Z", direction: "inbound", text: "", channel: "SMS", attachments: 0, provider: null },
  ],
  dnd: false,
  name: "C",
  historyHash: H,
};
const ch = (d: string) => ({ defaultId: d, providers: new Map([[Z, "Zaptos"]]) });
const row = (state: string) => ({ id: "m1", state, prepared_by: "u1", contact_id: "c1", conversation_id: "v1", reply_hash: "h", error_code: null, result_message_id: state === "sent" ? "g1" : null });
const send = (i = input) => agent.inboxSend("o", "u1", i, true, Z);
beforeEach(() => {
  store.command.mockReset();
  channels.mockReset().mockResolvedValue(ch(Z));
  a["manualPayload"] = vi.fn(() => ({ text: "Olá", snapshot: { ...snapshot, route } }));
  a["manualContext"] = vi.fn(async () => ({ blockedReason: null, sessionVersion: 3, snapshot }));
  a["manualPrepare"] = vi.fn(async () => ({ id: "m1" }));
  a["manualSend"] = vi.fn(async () => ({ state: "sent", code: null, messageId: "g1" }));
});
const prepared = () => store.command.mockImplementation(async (op: string) => (op === "manual_lookup" ? null : row("prepared")));
it("primeiro clique prepara com a revisão e rota fixada, e envia uma vez", async () => {
  prepared();
  expect(await send()).toMatchObject({ state: "sent", messageId: "g1" });
  expect(a["manualSend"]).toHaveBeenCalledTimes(1);
  expect(a["manualPrepare"]).toHaveBeenCalledWith("o", "u1", expect.objectContaining({ expectedVersion: 3, historyHash: H }), true, route);
});
it("novo inbound/alteração após a revisão: zero envio", async () => {
  prepared();
  a["manualContext"] = vi.fn(async () => ({ blockedReason: null, sessionVersion: 3, snapshot: { ...snapshot, historyHash: "b".repeat(64) } }));
  await expect(send()).rejects.toThrow("revision_changed");
  a["manualContext"] = vi.fn(async () => ({ blockedReason: null, sessionVersion: 4, snapshot }));
  await expect(send()).rejects.toThrow("revision_changed");
  expect(a["manualPrepare"]).not.toHaveBeenCalled();
  expect(a["manualSend"]).not.toHaveBeenCalled();
});
it("default/provider mudou entre revisão e envio: zero envio", async () => {
  prepared();
  channels.mockResolvedValue(ch("outro"));
  await expect(send()).rejects.toThrow(/route_/);
  channels.mockResolvedValue(ch(Z));
  await expect(send({ ...input, revision: { ...revision, providerId: "cliente-forjado" } })).rejects.toThrow("route_changed");
  expect(a["manualSend"]).not.toHaveBeenCalled();
});
it("provider ausente/ambíguo: zero envio", async () => {
  prepared();
  channels.mockResolvedValue(null);
  await expect(send()).rejects.toThrow("route_unverified");
  channels.mockResolvedValue(ch(Z));
  await expect(agent.inboxSend("o", "u1", input, true, null)).rejects.toThrow("route_unverified");
  expect(a["manualSend"]).not.toHaveBeenCalled();
});
it("rota muda entre prepare e dispatch: zero envio", async () => {
  prepared();
  channels.mockResolvedValueOnce(ch(Z)).mockResolvedValue(ch("outro"));
  await expect(send()).rejects.toThrow("route_changed");
  expect(a["manualSend"]).not.toHaveBeenCalled();
});
it("repetição com a mesma chave não faz segundo POST", async () => {
  for (const st of ["sent", "unknown", "sending", "rejected"]) {
    store.command.mockResolvedValue(row(st));
    expect((await send()).state).toBe(st);
  }
  expect(a["manualSend"]).not.toHaveBeenCalled();
  expect(a["manualContext"]).not.toHaveBeenCalled();
});
it("mesma chave com outro texto, contato ou utilizador é recusada", async () => {
  store.command.mockResolvedValue(row("prepared"));
  await expect(send({ ...input, text: "Outro" })).rejects.toThrow("manual_request_mismatch");
  await expect(agent.inboxSend("o", "u2", input, true, Z)).rejects.toThrow("manual_request_mismatch");
  await expect(send({ ...input, contactId: "c2" })).rejects.toThrow("manual_request_mismatch");
});
it("bloqueios do servidor (DND, canal, janela, escopo, viewer) impedem o envio", async () => {
  store.command.mockResolvedValue(null);
  for (const code of ["do_not_contact", "unsupported_channel", "channel_window", "send_disabled"]) {
    a["manualContext"] = vi.fn(async () => ({ blockedReason: code, sessionVersion: 3, snapshot }));
    await expect(send()).rejects.toThrow(code);
  }
  for (const code of ["scope_mismatch", "forbidden"]) {
    a["manualContext"] = vi.fn(async () => {
      throw new AgentError(code);
    });
    await expect(send()).rejects.toThrow(code);
  }
  expect(a["manualSend"]).not.toHaveBeenCalled();
});
it("pedido concorrente com a mesma chave devolve o estado já reclamado", async () => {
  let n = 0;
  store.command.mockImplementation(async () => (n++ === 0 ? null : row("sending")));
  a["manualPrepare"] = vi.fn(async () => {
    throw new AgentError("manual_request_used");
  });
  expect((await send()).state).toBe("sending");
  expect(a["manualSend"]).not.toHaveBeenCalled();
});
it("resultado incerto é devolvido sem nova tentativa; estado lido por requestId", async () => {
  prepared();
  a["manualSend"] = vi.fn(async () => ({ state: "unknown", code: "outcome_unknown", messageId: null }));
  expect((await send()).state).toBe("unknown");
  expect(a["manualSend"]).toHaveBeenCalledTimes(1);
  store.command.mockResolvedValue(row("unknown"));
  expect(await agent.inboxStatus("o", "u1", input.requestId)).toMatchObject({ manualId: "m1", state: "unknown" });
  await expect(agent.inboxStatus("o", "u2", input.requestId)).rejects.toThrow("forbidden");
});
