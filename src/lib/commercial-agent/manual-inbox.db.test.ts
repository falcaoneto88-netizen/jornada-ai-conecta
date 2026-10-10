/**
 * Envio manual a partir da caixa de entrada, em PostgreSQL local efémero (nunca produção).
 * O GHL é sempre simulado: nenhum POST real.
 */
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { ACTOR, FOREIGN, ORG, startCommercialDb } from "../../../test/commercial-agent-db";
import { CommercialAgent, type Provider } from "./service.server";
import { sha } from "./providers.server";
import type { Snapshot } from "./core";

let db: Awaited<ReturnType<typeof startCommercialDb>>;
let snapshot: Snapshot, provider: Provider, agent: CommercialAgent;
const key = randomBytes(32).toString("base64");
const ev = {
  type: "InboundMessage" as const,
  locationId: "loc-test",
  contactId: "c-inbox-fict",
  conversationId: "v-inbox-fict",
  messageId: "m-inbox-fict",
};
const scope = { contactId: ev.contactId, conversationId: ev.conversationId };
const generate = vi.fn();
const sendManual = vi.fn();

beforeAll(async () => {
  db = await startCommercialDb();
}, 60000);
afterAll(async () => db?.stop());
beforeEach(async () => {
  await db.sql`truncate commercial_agent_manual_dispatches,commercial_agent_drafts,commercial_agent_inbox,commercial_agent_sessions,commercial_agent_audit restart identity cascade`;
  // Permissão humana de envio manual; allowed_channels do agente automático NÃO mudam.
  await db.sql`update commercial_agent_settings set mode='supervised',manual_send_all_contacts=true,allowed_channels=array['WhatsApp','SMS'] where organization_id=${ORG}`;
  await db.sql`update ghl_connections set write_enabled=true`;
  snapshot = {
    event: { ...ev },
    name: "Contato fictício",
    dnd: false,
    historyHash: sha("inbox-fict-1"),
    messages: [
      {
        id: ev.messageId,
        at: new Date(Date.now() - 60000).toISOString(),
        text: "Olá, queria informações.",
        direction: "inbound",
        channel: "SMS",
        attachments: 0,
        provider: "zap",
      },
    ],
  };
  generate.mockReset();
  sendManual.mockReset().mockResolvedValue({ state: "sent", code: null, messageId: "rcpt-1" });
  provider = {
    history: vi.fn(),
    send: vi.fn(),
    manualHistory: vi.fn(async () => structuredClone(snapshot)),
    sendManual,
    smsChannels: vi.fn(async () => ({ defaultId: "zap", providers: new Map([["zap", "Zaptos"]]) })),
  };
  agent = new CommercialAgent({
    store: db.store,
    provider,
    generate,
    encryptionKey: key,
    enabled: true,
    sendEnabled: true,
  });
});
const counts = async () => {
  const [r] = await db.sql`select
    (select count(*)::int from commercial_agent_sessions) s,
    (select count(*)::int from commercial_agent_manual_dispatches) d,
    (select count(*)::int from commercial_agent_inbox) i,
    (select count(*)::int from commercial_agent_audit) a`;
  return r as unknown as { s: number; d: number; i: number; a: number };
};
const ctx = () => agent.inboxContext(ORG, ACTOR, scope, true, "zap");
const send = async (text = "Resposta humana exata  ", requestId: string = randomUUID()) => {
  const c = await ctx();
  return agent.inboxSend(
    ORG,
    ACTOR,
    {
      ...scope,
      text,
      requestId,
      revision: { ...c.revision, providerId: c.revision.providerId },
    },
    true,
    "zap",
  );
};

it("contexto de conversa sem fila/sessão é só leitura (versão virtual 0)", async () => {
  const before = await counts();
  const c = await ctx();
  expect(c.blockedReason).toBeNull();
  expect(c.revision.sessionVersion).toBe(0);
  expect(await counts()).toEqual(before);
});
it("clique cria exatamente um despacho e um POST, sem fila nem IA; sessão criada já pausada", async () => {
  const r = await send();
  expect(r.state).toBe("sent");
  expect(sendManual).toHaveBeenCalledTimes(1);
  expect(sendManual.mock.calls[0]![1]).toBe("Resposta humana exata  ");
  expect(generate).not.toHaveBeenCalled();
  const c = await counts();
  expect(c).toMatchObject({ s: 1, d: 1, i: 0 });
  const [s] = await db.sql`select paused,version,opt_out from commercial_agent_sessions`;
  expect(s).toMatchObject({ paused: true, version: 1, opt_out: false });
  const [d] = await db.sql`select channel,state from commercial_agent_manual_dispatches`;
  expect(d).toMatchObject({ channel: "SMS", state: "sent" });
  const [cfg] =
    await db.sql`select allowed_channels from commercial_agent_settings where organization_id=${ORG}`;
  expect(cfg!["allowed_channels"]).toEqual(["WhatsApp", "SMS"]);
});
it("contato/conversa/localização inválidos bloqueiam sem escrita", async () => {
  const before = await counts();
  snapshot.event.locationId = "loc-outra";
  await expect(send()).rejects.toMatchObject({ code: "scope_mismatch" });
  snapshot.event.locationId = "loc-test";
  (provider.manualHistory as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
    Object.assign(new Error("x"), { code: "scope_mismatch" }),
  );
  await expect(ctx()).rejects.toBeTruthy();
  await expect(
    db.store.command("manual_inbox_context", ORG, { ...scope, locationId: "loc-outra" }, ACTOR),
  ).rejects.toMatchObject({ code: "scope_mismatch" });
  await expect(
    db.store.command(
      "manual_inbox_context",
      ORG,
      { contactId: "bad id!", conversationId: "v", locationId: "loc-test" },
      ACTOR,
    ),
  ).rejects.toMatchObject({ code: "scope_mismatch" });
  // Utilizador de outra organização: proibido.
  await expect(
    db.store.command("manual_inbox_context", ORG, { ...scope, locationId: "loc-test" }, FOREIGN),
  ).rejects.toMatchObject({ code: "forbidden" });
  expect(sendManual).not.toHaveBeenCalled();
  expect(await counts()).toEqual(before);
});
it("o fluxo antigo (manual_context/prepare) continua a exigir a fila e só SMS", async () => {
  await expect(db.store.command("manual_context", ORG, scope, ACTOR)).rejects.toMatchObject({
    code: "scope_mismatch",
  });
});
it("mesma chave em paralelo: um despacho, um POST", async () => {
  const id = randomUUID();
  const c = await ctx();
  const input = { ...scope, text: "Mesmo texto", requestId: id, revision: c.revision };
  const rs = await Promise.allSettled([
    agent.inboxSend(ORG, ACTOR, input, true, "zap"),
    agent.inboxSend(ORG, ACTOR, input, true, "zap"),
  ]);
  expect(rs.some((r) => r.status === "fulfilled")).toBe(true);
  expect(sendManual).toHaveBeenCalledTimes(1);
  expect((await counts()).d).toBe(1);
});
it("chaves diferentes em paralelo (duplo pedido): no máximo um POST", async () => {
  const c = await ctx();
  const base = { ...scope, text: "Texto", revision: c.revision };
  await Promise.allSettled([
    agent.inboxSend(ORG, ACTOR, { ...base, requestId: randomUUID() }, true, "zap"),
    agent.inboxSend(ORG, ACTOR, { ...base, requestId: randomUUID() }, true, "zap"),
  ]);
  expect(sendManual.mock.calls.length).toBeLessThanOrEqual(1);
});
it("novo inbound desde a revisão bloqueia sem escrita", async () => {
  const c = await ctx();
  snapshot.historyHash = sha("inbox-fict-2");
  const before = await counts();
  await expect(
    agent.inboxSend(
      ORG,
      ACTOR,
      { ...scope, text: "T", requestId: randomUUID(), revision: c.revision },
      true,
      "zap",
    ),
  ).rejects.toMatchObject({ code: "revision_changed" });
  expect(await counts()).toEqual(before);
  expect(sendManual).not.toHaveBeenCalled();
});
it("rota mudou desde a revisão bloqueia sem escrita", async () => {
  const c = await ctx();
  provider.smsChannels = vi.fn(async () => ({
    defaultId: "outro",
    providers: new Map([
      ["zap", "Zaptos"],
      ["outro", "X"],
    ]),
  }));
  await expect(
    agent.inboxSend(
      ORG,
      ACTOR,
      { ...scope, text: "T", requestId: randomUUID(), revision: c.revision },
      true,
      "zap",
    ),
  ).rejects.toMatchObject({ code: "route_changed" });
  expect((await counts()).d).toBe(0);
});
it("STOP/opt-out e envio incerto de sessões existentes são preservados", async () => {
  await db.sql`insert into commercial_agent_sessions(organization_id,contact_id,version,paused,opt_out) values(${ORG},${ev.contactId},5,false,true)`;
  expect((await ctx()).blockedReason).toBe("do_not_contact");
  await expect(send()).rejects.toMatchObject({ code: "do_not_contact" });
  await db.sql`update commercial_agent_sessions set opt_out=false`;
  snapshot.messages[0]!.text = "STOP";
  expect((await ctx()).blockedReason).toBe("do_not_contact");
  snapshot.messages[0]!.text = "Olá";
  const [s] = await db.sql`select opt_out,version from commercial_agent_sessions`;
  expect(s).toMatchObject({ opt_out: false, version: 5 });
  await db.sql`insert into commercial_agent_manual_dispatches(organization_id,request_id,contact_id,conversation_id,location_id,session_version,inbound_id,inbound_at,channel,history_hash,payload,reply_hash,prepared_by,state,approved_at)
    values(${ORG},${randomUUID()},${ev.contactId},${ev.conversationId},'loc-test',5,'m0',now(),'SMS',${"a".repeat(64)},'x',${"b".repeat(64)},${ACTOR},'unknown',now())`;
  expect((await ctx()).blockedReason).toBe("reconciliation_required");
  expect(sendManual).not.toHaveBeenCalled();
});
it("corrida com a IA: o envio manual pausa a sessão e invalida rascunhos pendentes", async () => {
  await send();
  const [s] = await db.sql`select paused from commercial_agent_sessions`;
  expect(s!["paused"]).toBe(true);
  expect(sendManual).toHaveBeenCalledTimes(1);
});
it("pedido substituído (invalidated) é devolvido como tal, sem POST", async () => {
  const c = await ctx();
  const first = randomUUID();
  // Prepara sem enviar: prazo já ultrapassado depois da preparação.
  await agent.manualPrepare(
    ORG,
    ACTOR,
    {
      ...scope,
      expectedVersion: 0,
      historyHash: c.revision.historyHash,
      text: "A",
      requestId: first,
    },
    true,
    { channel: "SMS", providerId: "zap", name: "Zaptos", defaultId: "zap" },
    new Date(Date.now() + 20000).toISOString(),
  );
  const c2 = await ctx();
  await agent.manualPrepare(
    ORG,
    ACTOR,
    {
      ...scope,
      expectedVersion: c2.revision.sessionVersion,
      historyHash: c2.revision.historyHash,
      text: "B",
      requestId: randomUUID(),
    },
    true,
    { channel: "SMS", providerId: "zap", name: "Zaptos", defaultId: "zap" },
    new Date(Date.now() + 20000).toISOString(),
  );
  const r = await agent.inboxSend(
    ORG,
    ACTOR,
    { ...scope, text: "A", requestId: first, revision: c.revision },
    true,
    "zap",
  );
  expect(r.state).toBe("invalidated");
  expect(sendManual).not.toHaveBeenCalled();
  expect((await agent.inboxStatus(ORG, ACTOR, first))?.state).toBe("invalidated");
});
it("prazo do pedido ultrapassado no SQL: request_expired sem escrita", async () => {
  const c = await ctx();
  const before = await counts();
  await expect(
    agent.manualPrepare(
      ORG,
      ACTOR,
      {
        ...scope,
        expectedVersion: 0,
        historyHash: c.revision.historyHash,
        text: "A",
        requestId: randomUUID(),
      },
      true,
      { channel: "SMS", providerId: "zap", name: "Zaptos", defaultId: "zap" },
      new Date(Date.now() - 1000).toISOString(),
    ),
  ).rejects.toMatchObject({ code: "request_expired" });
  expect(await counts()).toEqual(before);
});
it("prepared consultado em paralelo com o envio: estado nunca é terminal falso, um POST", async () => {
  const id = randomUUID();
  let release!: () => void;
  sendManual.mockImplementationOnce(
    () =>
      new Promise((r) => (release = () => r({ state: "sent", code: null, messageId: "rcpt-2" }))),
  );
  const p = send("T", id);
  for (let i = 0; i < 50 && !release; i++) await new Promise((r) => setTimeout(r, 20));
  const mid = await agent.inboxStatus(ORG, ACTOR, id);
  expect(["prepared", "sending"]).toContain(mid?.state);
  release();
  expect((await p).state).toBe("sent");
  expect(sendManual).toHaveBeenCalledTimes(1);
});
it("Instagram e WhatsApp: canal gravado; IG sem conversationProviderId; WA fora da janela bloqueia", async () => {
  snapshot.messages[0] = { ...snapshot.messages[0]!, channel: "IG", provider: "sms-nao-herdar" };
  const r = await send("Olá IG");
  expect(r.state).toBe("sent");
  const routed = sendManual.mock.calls[0]![0] as Snapshot;
  expect(routed.route).toMatchObject({ channel: "IG", providerId: null });
  const [d] = await db.sql`select channel from commercial_agent_manual_dispatches`;
  expect(d!["channel"]).toBe("IG");
  await db.sql`truncate commercial_agent_manual_dispatches,commercial_agent_sessions,commercial_agent_audit restart identity cascade`;
  snapshot.messages[0] = {
    ...snapshot.messages[0]!,
    id: ev.messageId,
    channel: "WhatsApp",
    provider: null,
    from: "+351910000001",
    to: "+351210000009",
    at: new Date(Date.now() - 25 * 3600000).toISOString(),
  };
  expect((await ctx()).blockedReason).toBe("channel_window");
  snapshot.messages[0]!.at = new Date(Date.now() - 60000).toISOString();
  snapshot.historyHash = sha("wa");
  await send("Olá WA");
  const wa = sendManual.mock.calls[1]![0] as Snapshot;
  expect(wa.route).toMatchObject({
    channel: "WhatsApp",
    fromNumber: "+351210000009",
    toNumber: "+351910000001",
  });
});
it("credenciais negadas pelo GHL (403): rejeitado, sem segundo POST", async () => {
  sendManual.mockResolvedValueOnce({ state: "rejected", code: "forbidden", messageId: null });
  const id = randomUUID();
  expect((await send("T", id)).state).toBe("rejected");
  expect((await send("T", id)).state).toBe("rejected");
  expect(sendManual).toHaveBeenCalledTimes(1);
});
it("janela da caixa de entrada é 24 h: IG a 23h30 envia; 24h exatas bloqueiam sem POST nem escrita", async () => {
  snapshot.messages[0] = {
    ...snapshot.messages[0]!,
    channel: "IG",
    provider: null,
    at: new Date(Date.now() - 23.5 * 3600000).toISOString(),
  };
  expect((await ctx()).blockedReason).toBeNull();
  expect((await send("Olá IG 23h30")).state).toBe("sent");
  expect(sendManual).toHaveBeenCalledTimes(1);
  await db.sql`truncate commercial_agent_manual_dispatches,commercial_agent_sessions,commercial_agent_audit restart identity cascade`;
  snapshot.messages[0]!.at = new Date(Date.now() - 24 * 3600000).toISOString();
  snapshot.historyHash = sha("ig-24");
  const before = await counts();
  expect((await ctx()).blockedReason).toBe("channel_window");
  await expect(send("Olá IG 24h")).rejects.toMatchObject({ code: "channel_window" });
  expect(sendManual).toHaveBeenCalledTimes(1);
  expect(await counts()).toEqual(before);
});
it("SQL: prepare do inbox recusa 24h exatas mesmo que o servidor tente (janela no banco)", async () => {
  const c = await ctx();
  snapshot.messages[0] = {
    ...snapshot.messages[0]!,
    channel: "IG",
    provider: null,
    at: new Date(Date.now() - 24 * 3600000 - 1000).toISOString(),
  };
  const before = await counts();
  await expect(
    agent.manualPrepare(
      ORG,
      ACTOR,
      { ...scope, expectedVersion: 0, historyHash: c.revision.historyHash, text: "A", requestId: randomUUID() },
      true,
      { channel: "IG", providerId: null, name: "Instagram", defaultId: null },
      new Date(Date.now() + 20000).toISOString(),
    ),
  ).rejects.toBeTruthy();
  expect(await counts()).toEqual(before);
});
it("manual_check_dispatch aplica o prazo com clock_timestamp: prazo vencido bloqueia o POST", async () => {
  const id = randomUUID();
  // Simula espera longa entre a reserva e a verificação: o prazo passa durante a transação.
  const original = db.store.command.bind(db.store);
  const spy = vi
    .spyOn(db.store, "command")
    .mockImplementation(async (op: string, org: string, data?: unknown, actor?: string) => {
      if (op === "manual_check_dispatch")
        return original(op, org, { ...(data as object), notAfter: new Date(Date.now() - 1).toISOString() }, actor);
      return original(op, org, data as never, actor);
    });
  try {
    await expect(send("T", id)).rejects.toMatchObject({ code: "dispatch_blocked" });
  } finally {
    spy.mockRestore();
  }
  expect(sendManual).not.toHaveBeenCalled();
  expect((await agent.inboxStatus(ORG, ACTOR, id))?.state).toBe("rejected");
});
