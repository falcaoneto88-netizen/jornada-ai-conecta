import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { ACTOR, FOREIGN, ORG, OTHER, startCommercialDb } from "../../../test/commercial-agent-db";
import { CommercialAgent, type Provider } from "./service.server";
import { POLICY_HASH, sha } from "./providers.server";
import type { DraftPayload, Event, Settings, Snapshot } from "./core";

let db: Awaited<ReturnType<typeof startCommercialDb>>;
let snapshot: Snapshot, provider: Provider, agent: CommercialAgent;
let observedAt: string;
const key = randomBytes(32).toString("base64");
const text = "Resposta escrita pela equipe para este contato fictício.";
const event: Event = {
  type: "InboundMessage",
  locationId: "loc-test",
  contactId: "c-manual-fictional",
  conversationId: "v-manual-fictional",
  messageId: "m-manual-fictional",
};
const scope = { contactId: event.contactId, conversationId: event.conversationId };
const generate = vi.fn<(s: Snapshot) => Promise<DraftPayload>>();

beforeAll(async () => {
  db = await startCommercialDb();
}, 60000);
afterAll(async () => db?.stop());
beforeEach(async () => {
  await db.sql`truncate commercial_agent_manual_dispatches,commercial_agent_drafts,commercial_agent_inbox,commercial_agent_sessions,commercial_agent_audit restart identity cascade`;
  await db.sql`update commercial_agent_settings set mode='supervised',manual_send_all_contacts=false,receive_all_contacts=false,receive_since=null,receive_cursor_until=null,monthly_draft_limit=3000`;
  await db.sql`update ghl_connections set write_enabled=true`;
  const since = new Date(Date.now() - 3600000).toISOString();
  await db.sql`update commercial_agent_settings set receive_all_contacts=true,receive_since=${since}::timestamptz,allowed_contacts=array['c-test','c-second'],allowed_channels=array['WhatsApp','SMS'] where organization_id=${ORG}`;
  observedAt = new Date(Date.now() - 1000).toISOString();
  snapshot = {
    event: { ...event },
    name: "Contato manual fictício",
    dnd: false,
    historyHash: sha("manual-fictional-history"),
    messages: [
      {
        id: event.messageId,
        at: observedAt,
        text: "Gostaria de falar com a equipe.",
        direction: "inbound",
        channel: "SMS",
        attachments: 0,
        provider: "fictional-sms-provider",
      },
    ],
  };
  provider = {
    history: vi.fn(async () => structuredClone(snapshot)),
    send: vi.fn(async () => ({ state: "sent" as const, code: null, messageId: "ai-receipt" })),
    manualHistory: vi.fn(async () => structuredClone(snapshot)),
    sendManual: vi.fn(async () => ({
      state: "sent" as const,
      code: null,
      messageId: "manual-receipt",
    })),
    verifyManualReceipt: vi.fn(async () => true),
  };
  generate.mockReset();
  generate.mockImplementation(async (s) => ({
    snapshot: s,
    policyHash: POLICY_HASH,
    model: "fictional-model",
    inputTokens: 20,
    outputTokens: 10,
    decision: {
      reply: "A equipe pode esclarecer como funciona a consulta.",
      flags: [],
      handoff: false,
      optOut: false,
    },
  }));
  agent = new CommercialAgent({
    store: db.store,
    provider,
    generate,
    encryptionKey: key,
    enabled: true,
    sendEnabled: true,
  });
});

async function receive() {
  expect(await agent.receive(ORG, snapshot.event, observedAt)).toMatchObject({
    status: "accepted",
  });
}
async function enableManual() {
  await db.sql`update commercial_agent_settings set manual_send_all_contacts=true where organization_id=${ORG}`;
}
async function prepare(overrides: Partial<Parameters<CommercialAgent["manualPrepare"]>[2]> = {}) {
  const requestedScope = {
    contactId: overrides.contactId ?? scope.contactId,
    conversationId: overrides.conversationId ?? scope.conversationId,
  };
  const current = await agent.manualContext(ORG, ACTOR, requestedScope, true);
  return agent.manualPrepare(
    ORG,
    ACTOR,
    {
      ...scope,
      expectedVersion: current.sessionVersion,
      historyHash: current.snapshot.historyHash,
      text,
      requestId: randomUUID(),
      ...overrides,
    },
    true,
  );
}
async function setup() {
  await receive();
  await enableManual();
}
const sendInput = (prepared: { id: string; replyHash: string }) => ({
  manualId: prepared.id,
  replyHash: prepared.replyHash,
});
async function session() {
  const rows =
    await db.sql`select * from commercial_agent_sessions where organization_id=${ORG} and contact_id=${event.contactId}`;
  return rows[0]!;
}
async function manualRows() {
  return db.sql`select * from commercial_agent_manual_dispatches where organization_id=${ORG} order by created_at,id`;
}

describe("atendimento manual em PostgreSQL local, sem contato com provedores reais", () => {
  it("migração deixa envio manual desligado e não amplia a autorização da IA", async () => {
    await receive();
    const cfg = await db.store.command<Settings>("settings", ORG);
    expect(cfg).toMatchObject({
      manual_send_all_contacts: false,
      allowed_contacts: ["c-test", "c-second"],
      allowed_channels: ["WhatsApp", "SMS"],
    });
    const context = await agent.manualContext(ORG, ACTOR, scope, true);
    expect(context.sendAllowed).toBe(false);
    await expect(prepare()).rejects.toThrow();
    expect(await manualRows()).toHaveLength(0);
    expect(provider.sendManual).not.toHaveBeenCalled();
  });

  it("lista contatos recebidos sem rascunho e isola organização e ator", async () => {
    await receive();
    const second = {
      ...event,
      contactId: "c-another-fictional",
      conversationId: "v-another",
      messageId: "m-another",
    };
    await agent.receive(ORG, second, observedAt);
    await agent.receive(OTHER, {
      ...event,
      locationId: "loc-other",
      contactId: "c-other",
      conversationId: "v-other",
      messageId: "m-other",
    });
    const rows = await agent.manualList(ORG, ACTOR);
    expect(rows).toHaveLength(2);
    expect(JSON.stringify(rows)).toContain(event.contactId);
    expect(JSON.stringify(rows)).toContain(second.contactId);
    expect(JSON.stringify(rows)).not.toContain("c-other");
    expect(await db.sql`select id from commercial_agent_drafts`).toHaveLength(0);
    await expect(agent.manualList(ORG, FOREIGN)).rejects.toThrow("forbidden");
    expect(provider.manualHistory).not.toHaveBeenCalled();
  });

  it("preparar pausa/versiona/invalida IA mas apenas confirmar envia texto humano", async () => {
    await setup();
    expect(await agent.work(ORG)).toMatchObject({ status: "ready" });
    const previous = await session();
    const prepared = await prepare();
    expect(prepared).toMatchObject({ text, snapshot });
    expect((await session())["paused"]).toBe(true);
    expect((await session())["version"]).toBe(Number(previous["version"]) + 1);
    expect((await agent.list(ORG, ACTOR)).items[0]?.state).toBe("invalidated");
    expect(provider.sendManual).not.toHaveBeenCalled();
    const stored = await manualRows();
    expect(stored[0]?.["state"]).toBe("prepared");
    expect(JSON.stringify(stored)).not.toContain(text);
    expect(await agent.manualSend(ORG, ACTOR, sendInput(prepared), true)).toMatchObject({
      state: "sent",
      messageId: "manual-receipt",
    });
    expect(provider.sendManual).toHaveBeenCalledExactlyOnceWith(snapshot, text);
    expect(provider.send).not.toHaveBeenCalled();
    expect((await session())["paused"]).toBe(true);
    expect((await db.store.command<Settings>("settings", ORG)).allowed_contacts).toEqual([
      "c-test",
      "c-second",
    ]);
  });

  it("flags clínicas e pausa da IA não impedem resposta da equipe humana", async () => {
    await setup();
    const produce = generate.getMockImplementation()!;
    generate.mockImplementation(async (s) => ({
      ...(await produce(s)),
      decision: {
        reply: "A equipe deve avaliar sua dúvida.",
        flags: ["clinical", "unsupported_attachment"],
        handoff: true,
        optOut: false,
      },
    }));
    await agent.work(ORG);
    expect((await agent.list(ORG, ACTOR)).items[0]).toMatchObject({
      paused: true,
      content: { decision: { flags: ["clinical", "unsupported_attachment"] } },
    });
    const prepared = await prepare();
    expect(await agent.manualSend(ORG, ACTOR, sendInput(prepared), true)).toMatchObject({
      state: "sent",
    });
    expect(provider.sendManual).toHaveBeenCalledTimes(1);
    expect(provider.send).not.toHaveBeenCalled();
  });

  it("histórico pode terminar em outbound sem impedir continuação humana", async () => {
    await setup();
    snapshot.messages.push({
      ...snapshot.messages[0]!,
      id: "prior-human-reply",
      direction: "outbound",
      at: new Date(Date.now() - 500).toISOString(),
      text: "Olá, sou da equipe.",
    });
    snapshot.historyHash = sha("history-ending-in-outbound");
    const prepared = await prepare();
    expect(prepared.snapshot.messages.at(-1)?.direction).toBe("outbound");
    expect(await agent.manualSend(ORG, ACTOR, sendInput(prepared), true)).toMatchObject({
      state: "sent",
    });
  });

  it.each(["dnd", "stop", "historical-stop", "opt-out", "channel", "window", "future"])(
    "recusa preparo manual por proteção %s",
    async (kind) => {
      await setup();
      if (kind === "dnd") snapshot.dnd = true;
      if (kind === "stop") snapshot.messages[0]!.text = "STOP";
      if (kind === "historical-stop")
        snapshot.messages.unshift({
          ...snapshot.messages[0]!,
          id: "historical-stop",
          text: "Parem de me procurar",
          at: new Date(Date.now() - 7200000).toISOString(),
        });
      if (kind === "opt-out")
        await db.sql`update commercial_agent_sessions set opt_out=true where organization_id=${ORG}`;
      if (kind === "channel") snapshot.messages[0]!.channel = "Email";
      if (kind === "window")
        snapshot.messages[0]!.at = new Date(Date.now() - 23 * 3600000).toISOString();
      if (kind === "future") snapshot.messages[0]!.at = new Date(Date.now() + 60000).toISOString();
      const context = await agent.manualContext(ORG, ACTOR, scope, true);
      expect(context.sendAllowed).toBe(false);
      await expect(prepare()).rejects.toThrow();
      expect(provider.sendManual).not.toHaveBeenCalled();
      expect(await manualRows()).toHaveLength(0);
    },
  );

  it("outbound recente não reabre janela expirada do último inbound", async () => {
    await setup();
    snapshot.messages[0]!.at = new Date(Date.now() - 24 * 3600000).toISOString();
    snapshot.messages.push({
      ...snapshot.messages[0]!,
      id: "recent-outbound",
      direction: "outbound",
      at: observedAt,
      text: "Mensagem da equipe.",
    });
    expect((await agent.manualContext(ORG, ACTOR, scope, true)).sendAllowed).toBe(false);
    await expect(prepare()).rejects.toThrow();
    expect(provider.sendManual).not.toHaveBeenCalled();
  });

  it("replay do requestId mantém preparado e versão; outro texto é recusado", async () => {
    await setup();
    const context = await agent.manualContext(ORG, ACTOR, scope, true);
    const input = {
      ...scope,
      expectedVersion: context.sessionVersion,
      historyHash: context.snapshot.historyHash,
      text,
      requestId: randomUUID(),
    };
    const prepared = await agent.manualPrepare(ORG, ACTOR, input, true);
    const version = (await session())["version"];
    const replay = await agent.manualPrepare(ORG, ACTOR, input, true);
    expect(replay.id).toBe(prepared.id);
    expect(replay.replyHash).toBe(prepared.replyHash);
    expect((await session())["version"]).toBe(version);
    expect(await manualRows()).toHaveLength(1);
    await expect(
      agent.manualPrepare(ORG, ACTOR, { ...input, text: "Outro texto humano." }, true),
    ).rejects.toThrow();
    expect(await manualRows()).toHaveLength(1);
    expect(provider.sendManual).not.toHaveBeenCalled();
  });

  it("duas confirmações concorrentes produzem somente um POST", async () => {
    await setup();
    const prepared = await prepare();
    const results = await Promise.allSettled([
      agent.manualSend(ORG, ACTOR, sendInput(prepared), true),
      agent.manualSend(ORG, ACTOR, sendInput(prepared), true),
    ]);
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    expect(provider.sendManual).toHaveBeenCalledTimes(1);
    expect((await manualRows())[0]?.["state"]).toBe("sent");
  });

  it("requestId concorrente produz um preparado, sem pausar/versionar duas vezes", async () => {
    await setup();
    const context = await agent.manualContext(ORG, ACTOR, scope, true);
    const input = {
      ...scope,
      expectedVersion: context.sessionVersion,
      historyHash: context.snapshot.historyHash,
      text,
      requestId: randomUUID(),
    };
    const rows = await Promise.all([
      agent.manualPrepare(ORG, ACTOR, input, true),
      agent.manualPrepare(ORG, ACTOR, input, true),
    ]);
    expect(rows[0]!.id).toBe(rows[1]!.id);
    expect((await session())["version"]).toBe(context.sessionVersion + 1);
    expect(await manualRows()).toHaveLength(1);
  });

  it("novo inbound invalida confirmação manual pela versão da sessão", async () => {
    await setup();
    const prepared = await prepare();
    await agent.receive(
      ORG,
      { ...event, messageId: "newer-manual-inbound" },
      new Date(Date.now() - 100).toISOString(),
    );
    await expect(agent.manualSend(ORG, ACTOR, sendInput(prepared), true)).rejects.toThrow();
    expect(provider.sendManual).not.toHaveBeenCalled();
  });

  it("mudança canônica sem webhook impede enviar o texto preparado", async () => {
    await setup();
    const prepared = await prepare();
    snapshot.historyHash = sha("changed-on-provider");
    await expect(agent.manualSend(ORG, ACTOR, sendInput(prepared), true)).rejects.toThrow();
    expect(provider.sendManual).not.toHaveBeenCalled();
  });

  it.each(["actor", "organization", "hash", "write-permission", "manual-disabled", "dnd"])(
    "confirmação revalida %s antes do POST",
    async (kind) => {
      await setup();
      const prepared = await prepare();
      if (kind === "manual-disabled")
        await db.sql`update commercial_agent_settings set manual_send_all_contacts=false where organization_id=${ORG}`;
      if (kind === "dnd") snapshot.dnd = true;
      const input = {
        ...sendInput(prepared),
        ...(kind === "hash" ? { replyHash: "a".repeat(64) } : {}),
      };
      await expect(
        agent.manualSend(
          kind === "organization" ? OTHER : ORG,
          kind === "actor" || kind === "organization" ? FOREIGN : ACTOR,
          input,
          kind !== "write-permission",
        ),
      ).rejects.toThrow();
      expect(provider.sendManual).not.toHaveBeenCalled();
    },
  );

  it("contato/conversa não recebidos e ator externo não criam preparação", async () => {
    await setup();
    await expect(
      agent.manualContext(
        ORG,
        ACTOR,
        { ...scope, conversationId: "unreceived-conversation" },
        true,
      ),
    ).rejects.toThrow();
    await expect(
      agent.manualContext(ORG, ACTOR, { ...scope, contactId: "unreceived-contact" }, true),
    ).rejects.toThrow();
    await expect(agent.manualContext(ORG, FOREIGN, scope, true)).rejects.toThrow("forbidden");
    expect(await manualRows()).toHaveLength(0);
    expect((await session())["paused"]).toBe(false);
  });

  it("timeout fica incerto, bloqueia novo preparo/retomada e não expõe erro bruto", async () => {
    await setup();
    const prepared = await prepare();
    provider.sendManual = vi.fn(async () => {
      throw new Error("sensitive provider body and secret");
    });
    expect(await agent.manualSend(ORG, ACTOR, sendInput(prepared), true)).toMatchObject({
      state: "unknown",
    });
    expect(await agent.manualSend(ORG, ACTOR, sendInput(prepared), true)).toMatchObject({
      state: "unknown",
    });
    await expect(prepare()).rejects.toThrow();
    await expect(
      agent.pause(ORG, ACTOR, event.contactId, Number((await session())["version"]), false),
    ).rejects.toThrow("reconciliation_required");
    await agent.work(ORG);
    expect(provider.sendManual).toHaveBeenCalledTimes(1);
    expect((await manualRows())[0]?.["state"]).toBe("unknown");
    expect(JSON.stringify(await manualRows())).not.toContain("sensitive provider");
  });

  it("reconciliação exige recibo verificado e mantém pausa depois de confirmar", async () => {
    await setup();
    const prepared = await prepare();
    provider.sendManual = vi.fn(async () => ({
      state: "unknown" as const,
      code: "send_unknown",
      messageId: null,
    }));
    await agent.manualSend(ORG, ACTOR, sendInput(prepared), true);
    provider.verifyManualReceipt = vi.fn(async () => false);
    await expect(
      agent.manualReconcile(ORG, ACTOR, { manualId: prepared.id, messageId: "wrong-receipt" }),
    ).rejects.toThrow("receipt_not_verified");
    expect((await manualRows())[0]?.["state"]).toBe("unknown");
    provider.verifyManualReceipt = vi.fn(async () => true);
    await agent.manualReconcile(ORG, ACTOR, {
      manualId: prepared.id,
      messageId: "verified-manual-receipt",
    });
    expect((await manualRows())[0]).toMatchObject({
      state: "sent",
      result_message_id: "verified-manual-receipt",
    });
    expect((await session())["paused"]).toBe(true);
    expect(provider.sendManual).toHaveBeenCalledTimes(1);
    await agent.pause(ORG, ACTOR, event.contactId, Number((await session())["version"]), false);
  });

  it("recibo próprio manual não retoma IA nem cria nova geração", async () => {
    await setup();
    const prepared = await prepare();
    await agent.manualSend(ORG, ACTOR, sendInput(prepared), true);
    const previous = await session();
    expect(
      await agent.receive(
        ORG,
        { ...event, type: "OutboundMessage", messageId: "manual-receipt" },
        new Date(Date.now() - 100).toISOString(),
      ),
    ).toMatchObject({ status: "own_message" });
    expect((await session())["paused"]).toBe(true);
    expect((await session())["version"]).toBe(previous["version"]);
    await agent.work(ORG);
    expect(generate).not.toHaveBeenCalled();
    expect(provider.sendManual).toHaveBeenCalledTimes(1);
  });

  it("preparo manual impede finalizar geração IA iniciada antes da pausa", async () => {
    await setup();
    const produce = generate.getMockImplementation()!;
    generate.mockImplementation(async (s) => {
      await prepare();
      return produce(s);
    });
    expect(await agent.work(ORG)).toMatchObject({ status: "stale" });
    expect((await agent.list(ORG, ACTOR)).items).toHaveLength(0);
    expect(await manualRows()).toHaveLength(1);
    expect(provider.sendManual).not.toHaveBeenCalled();
  });

  it("anon e authenticated não podem invocar operações manuais nem ler ciphertext", async () => {
    await setup();
    await prepare();
    for (const role of ["anon", "authenticated"]) {
      const connection = await db.sql.reserve();
      try {
        await connection.unsafe(`set role ${role}`);
        for (const op of [
          "manual_list",
          "manual_context",
          "manual_lookup",
          "manual_detail",
          "manual_prepare",
          "manual_start_send",
          "manual_check_dispatch",
          "manual_finish_send",
          "manual_reconcile",
        ]) {
          await expect(
            connection`select public.commercial_agent_manual_command(${op},${ORG}::uuid,'{}'::jsonb,${ACTOR}::uuid)`,
          ).rejects.toThrow("permission denied");
        }
        await expect(
          connection`select * from public.commercial_agent_manual_dispatches`,
        ).rejects.toThrow("permission denied");
        await expect(
          connection`insert into public.commercial_agent_manual_dispatches default values`,
        ).rejects.toThrow("permission denied");
      } finally {
        await connection`reset role`;
        connection.release();
      }
    }
    expect(provider.sendManual).not.toHaveBeenCalled();
  });

  it("envio manual em andamento bloqueia novo preparo e retomada em outra conversa do contato", async () => {
    await setup();
    const prepared = await prepare();
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    provider.sendManual = vi.fn(async () => {
      entered();
      await gate;
      return { state: "sent" as const, code: null, messageId: "held-manual-receipt" };
    });
    const sending = agent.manualSend(ORG, ACTOR, sendInput(prepared), true);
    try {
      await started;
      expect((await manualRows())[0]?.["state"]).toBe("sending");
      await expect(prepare()).rejects.toThrow("reconciliation_required");
      await expect(
        agent.pause(ORG, ACTOR, event.contactId, Number((await session())["version"]), false),
      ).rejects.toThrow("reconciliation_required");
      const other = {
        ...event,
        conversationId: "v-other-channel-same-contact",
        messageId: "other-conversation-inbound",
      };
      await agent.receive(ORG, other, new Date(Date.now() - 100).toISOString());
      const original = snapshot;
      snapshot = {
        ...structuredClone(snapshot),
        event: other,
        historyHash: sha("other-conversation"),
        messages: [{ ...snapshot.messages[0]!, id: other.messageId }],
      };
      await expect(
        prepare({ conversationId: other.conversationId, historyHash: snapshot.historyHash }),
      ).rejects.toThrow();
      snapshot = original;
      expect(provider.sendManual).toHaveBeenCalledTimes(1);
    } finally {
      release();
      await sending;
    }
    expect((await manualRows())[0]?.["state"]).toBe("sent");
    expect((await session())["paused"]).toBe(true);
  });

  it.each(["sending", "unknown"])(
    "IA em %s impede assumir novo envio manual e retomar",
    async (state) => {
      await setup();
      await db.sql`update commercial_agent_settings set allowed_contacts=array[${event.contactId}] where organization_id=${ORG}`;
      await agent.work(ORG);
      const d = (await agent.list(ORG, ACTOR)).items[0]!;
      await db.store.command(
        "start_send",
        ORG,
        { draftId: d.id, version: d.version, replyHash: d.reply_hash },
        ACTOR,
      );
      if (state === "unknown") {
        await db.sql`update commercial_agent_drafts set approved_at=now()-interval '3 minutes' where id=${d.id}`;
        await agent.work(ORG);
      }
      expect((await agent.list(ORG, ACTOR)).items[0]?.state).toBe(state);
      await expect(prepare()).rejects.toThrow("reconciliation_required");
      await expect(
        agent.pause(ORG, ACTOR, event.contactId, Number((await session())["version"]), false),
      ).rejects.toThrow("reconciliation_required");
      expect(await manualRows()).toHaveLength(0);
      expect(provider.sendManual).not.toHaveBeenCalled();
    },
  );

  it("disputa entre reserva IA e preparo manual permite somente um caminho", async () => {
    await setup();
    await db.sql`update commercial_agent_settings set allowed_contacts=array[${event.contactId}] where organization_id=${ORG}`;
    await agent.work(ORG);
    const d = (await agent.list(ORG, ACTOR)).items[0]!;
    const context = await agent.manualContext(ORG, ACTOR, scope, true);
    const results = await Promise.allSettled([
      db.store.command(
        "start_send",
        ORG,
        { draftId: d.id, version: d.version, replyHash: d.reply_hash },
        ACTOR,
      ),
      agent.manualPrepare(
        ORG,
        ACTOR,
        {
          ...scope,
          expectedVersion: context.sessionVersion,
          historyHash: snapshot.historyHash,
          text,
          requestId: randomUUID(),
        },
        true,
      ),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const ai = (await agent.list(ORG, ACTOR)).items[0]!;
    const manual = await manualRows();
    expect(
      ai.state === "sending"
        ? manual.length === 0
        : ai.state === "invalidated" && manual.length === 1,
    ).toBe(true);
    expect(provider.send).not.toHaveBeenCalled();
    expect(provider.sendManual).not.toHaveBeenCalled();
  });

  it("crash após reserva manual vira unknown, sem reenviar ou liberar contato", async () => {
    await setup();
    const prepared = await prepare();
    await db.store.command(
      "manual_start_send",
      ORG,
      { ...sendInput(prepared), historyHash: snapshot.historyHash },
      ACTOR,
    );
    await db.sql`update commercial_agent_manual_dispatches set approved_at=now()-interval '3 minutes' where id=${prepared.id}`;
    await db.store.command("purge", ORG);
    await agent.manualContext(ORG, ACTOR, scope, true);
    expect((await manualRows())[0]?.["state"]).toBe("unknown");
    expect((await session())["paused"]).toBe(true);
    await expect(prepare()).rejects.toThrow("reconciliation_required");
    expect(provider.sendManual).not.toHaveBeenCalled();
  });

  it("recibo que chega durante POST não impede guardar o resultado nem retoma IA", async () => {
    await setup();
    const prepared = await prepare();
    provider.sendManual = vi.fn(async () => {
      await agent.receive(
        ORG,
        { ...event, type: "OutboundMessage", messageId: "receipt-before-finish" },
        new Date(Date.now() - 100).toISOString(),
      );
      return { state: "sent" as const, code: null, messageId: "receipt-before-finish" };
    });
    expect(await agent.manualSend(ORG, ACTOR, sendInput(prepared), true)).toMatchObject({
      state: "sent",
    });
    expect((await manualRows())[0]).toMatchObject({
      state: "sent",
      result_message_id: "receipt-before-finish",
    });
    expect((await session())["paused"]).toBe(true);
    expect(provider.sendManual).toHaveBeenCalledTimes(1);
  });

  it("purge preserva ciphertext incerto para reconciliação e mantém bloqueio", async () => {
    await setup();
    const prepared = await prepare();
    provider.sendManual = vi.fn(async () => ({
      state: "unknown" as const,
      code: "send_unknown",
      messageId: null,
    }));
    await agent.manualSend(ORG, ACTOR, sendInput(prepared), true);
    const encrypted = (await manualRows())[0]!["payload"];
    await db.sql`update commercial_agent_manual_dispatches set created_at=now()-interval '8 days' where id=${prepared.id}`;
    await db.store.command("purge", ORG);
    const rows = await manualRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: prepared.id,
      payload: encrypted,
      state: "unknown",
      reply_hash: prepared.replyHash,
    });
    await expect(prepare()).rejects.toThrow("reconciliation_required");
    await expect(
      agent.pause(ORG, ACTOR, event.contactId, Number((await session())["version"]), false),
    ).rejects.toThrow("reconciliation_required");
    expect(provider.sendManual).toHaveBeenCalledTimes(1);
  });

  it.each(["prepared", "sent"])(
    "purge remove ciphertext %s após sete dias e conserva tombstone",
    async (state) => {
      await setup();
      const prepared = await prepare();
      if (state === "sent") await agent.manualSend(ORG, ACTOR, sendInput(prepared), true);
      const before = (await manualRows())[0]!;
      expect(before["payload"]).not.toBe("");
      await db.sql`update commercial_agent_manual_dispatches set created_at=now()-interval '8 days' where id=${prepared.id}`;
      await db.store.command("purge", ORG);
      expect((await manualRows())[0]).toMatchObject({
        id: prepared.id,
        payload: "",
        state: state === "prepared" ? "invalidated" : "sent",
        reply_hash: prepared.replyHash,
        result_message_id: before["result_message_id"],
      });
      expect((await session())["paused"]).toBe(true);
      expect(provider.sendManual).toHaveBeenCalledTimes(state === "sent" ? 1 : 0);
    },
  );
});
