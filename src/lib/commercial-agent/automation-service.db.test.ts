import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { ACTOR, ORG, startCommercialDb } from "../../../test/commercial-agent-db";
import { CommercialAgent, type Provider } from "./service.server";
import { AUTOMATION_POLICY_HASH, POLICY_HASH, sha } from "./providers.server";
import type { DraftPayload, Snapshot, Settings } from "./core";

let db: Awaited<ReturnType<typeof startCommercialDb>>,
  snapshot: Snapshot,
  provider: Provider,
  agent: CommercialAgent;
const key = randomBytes(32).toString("base64");
const automatic = vi.fn(),
  supervised = vi.fn();
const payload = (s: Snapshot, auto: boolean): DraftPayload => ({
  snapshot: s,
  policyHash: auto ? AUTOMATION_POLICY_HASH : POLICY_HASH,
  model: "synthetic-fixture",
  inputTokens: 2,
  outputTokens: 2,
  ...(auto
    ? { generationMode: "automatic" as const, sourceRecordIds: ["FICTIONAL_APPROVED"] }
    : {}),
  decision: {
    reply: "Olá! Sou a Izabel, assistente virtual da clínica. Como posso ajudar?",
    flags: [],
    handoff: false,
    optOut: false,
  },
});
beforeAll(async () => {
  db = await startCommercialDb();
}, 60_000);
afterAll(async () => db?.stop());
beforeEach(async () => {
  await db.sql`truncate commercial_agent_drafts,commercial_agent_inbox,commercial_agent_sessions,commercial_agent_manual_dispatches,commercial_agent_audit cascade`;
  await db.sql`update user_roles set role='gestor' where user_id=${ACTOR}`;
  await db.sql`update commercial_agent_settings set automation_enabled=false,automation_version=0,automation_since=null,automation_policy_hash=null,automation_channels='{}',mode='supervised',receive_all_contacts=true,receive_since=now()-interval '1 hour',monthly_draft_limit=3000 where organization_id=${ORG}`;
  await db.store.command(
    "automation_set",
    ORG,
    { enabled: true, expectedVersion: 0, policyHash: AUTOMATION_POLICY_HASH, channels: ["SMS"] },
    ACTOR,
  );
  // Synthetic cutoff avoids timestamp truncation between PostgreSQL microseconds and JS milliseconds.
  await db.sql`update commercial_agent_settings set automation_since=now()-interval '1 minute' where organization_id=${ORG}`;
  snapshot = {
    event: {
      type: "InboundMessage",
      locationId: "loc-test",
      contactId: "new-outside-pilot",
      conversationId: "v-auto",
      messageId: "m-auto",
    },
    name: "Somente teste sintético",
    dnd: false,
    historyHash: sha("history"),
    messages: [
      {
        id: "m-auto",
        at: new Date().toISOString(),
        direction: "inbound",
        text: "Olá",
        channel: "SMS",
        attachments: 0,
        provider: "provider-test",
      },
    ],
  };
  vi.clearAllMocks();
  automatic.mockImplementation(async (s) => payload(s, true));
  supervised.mockImplementation(async (s) => payload(s, false));
  provider = {
    history: vi.fn(async () => structuredClone(snapshot)),
    smsChannels: vi.fn(async () => ({
      defaultId: "provider-test",
      providers: new Map([["provider-test", "Teste fictício"]]),
    })),
    send: vi.fn(),
    sendManual: vi.fn(async () => ({
      state: "sent" as const,
      code: null,
      messageId: "fake-receipt",
    })),
  };
  agent = new CommercialAgent({
    store: db.store,
    provider,
    generate: supervised,
    encryptionKey: key,
    enabled: true,
    sendEnabled: true,
    automation: {
      policyHash: AUTOMATION_POLICY_HASH,
      generate: automatic,
      writeEnabled: async () => true,
      configuredProviderId: async () => "provider-test",
    },
  });
});
const receive = () => agent.receive(ORG, snapshot.event, snapshot.messages[0]!.at);
describe("recebimento → geração → despacho global (provedores falsos)", () => {
  it("envia entrada nova fora da allowlist piloto, sem fabricar aprovação humana", async () => {
    await receive();
    expect(await agent.work(ORG)).toMatchObject({ status: "ready", automation: { state: "sent" } });
    expect(provider.sendManual).toHaveBeenCalledOnce();
    expect(provider.send).not.toHaveBeenCalled();
    expect(supervised).not.toHaveBeenCalled();
    const [row] =
      await db.sql`select state,dispatch_origin,approved_by from commercial_agent_drafts`;
    expect(row).toMatchObject({ state: "sent", dispatch_origin: "automatic", approved_by: null });
    expect(
      await db.sql`select code from commercial_agent_audit where code='human_approved'`,
    ).toHaveLength(0);
  });
  it("desligado e histórico antigo permanecem apenas sugestões", async () => {
    await db.sql`update commercial_agent_settings set automation_since=now() where organization_id=${ORG}`;
    snapshot.messages[0]!.at = new Date(Date.now() - 5000).toISOString();
    await receive();
    await agent.work(ORG);
    expect(supervised).toHaveBeenCalledOnce();
    expect(automatic).not.toHaveBeenCalled();
    expect(provider.sendManual).not.toHaveBeenCalled();
  });
  it("duas execuções e webhook repetido produzem um só envio", async () => {
    await receive();
    await receive();
    await Promise.all([agent.work(ORG), agent.work(ORG)]);
    expect(provider.sendManual).toHaveBeenCalledOnce();
    await receive();
    await agent.work(ORG);
    expect(provider.sendManual).toHaveBeenCalledOnce();
  });
  it("aguarda recibo da própria saída sem pausar a conversa como intervenção humana", async () => {
    const own = { ...snapshot.event, type: "OutboundMessage" as const, messageId: "fake-receipt" };
    vi.mocked(provider.sendManual!).mockImplementation(async () => {
      await expect(agent.receive(ORG, own, new Date().toISOString())).rejects.toThrow(
        "receipt_pending",
      );
      return { state: "sent", code: null, messageId: own.messageId };
    });
    await receive();
    expect(await agent.work(ORG)).toMatchObject({ automation: { state: "sent" } });
    expect(await agent.receive(ORG, own, new Date().toISOString())).toMatchObject({
      status: "own_message",
    });
    const [session] = await db.sql`select paused from commercial_agent_sessions`;
    expect(session?.["paused"]).toBe(false);
    await agent.receive(ORG, { ...own, messageId: "real-human-message" }, new Date().toISOString());
    const [human] = await db.sql`select paused from commercial_agent_sessions`;
    expect(human?.["paused"]).toBe(true);
  });
  it("pausa global durante geração impede envio sem pausar individualmente", async () => {
    automatic.mockImplementation(async (s) => {
      await db.store.command(
        "automation_set",
        ORG,
        {
          enabled: false,
          expectedVersion: 1,
          policyHash: AUTOMATION_POLICY_HASH,
          channels: ["SMS"],
        },
        ACTOR,
      );
      return payload(s, true);
    });
    await receive();
    await agent.work(ORG);
    expect(provider.sendManual).not.toHaveBeenCalled();
    const [session] = await db.sql`select paused from commercial_agent_sessions`;
    expect(session?.["paused"]).toBe(false);
  });
  it("humano assume durante geração e invalida trabalho automático", async () => {
    automatic.mockImplementation(async (s) => {
      const [session] = await db.sql`select version from commercial_agent_sessions`;
      await db.store.command(
        "pause",
        ORG,
        { contactId: s.event.contactId, expectedVersion: session?.["version"] },
        ACTOR,
      );
      return payload(s, true);
    });
    await receive();
    expect(await agent.work(ORG)).toMatchObject({ status: "stale" });
    expect(provider.sendManual).not.toHaveBeenCalled();
  });
  it.each(["attachment", "human", "optout", "dnd", "policy"])(
    "não envia e deixa com equipe: %s",
    async (kind) => {
      if (kind === "attachment") snapshot.messages[0]!.attachments = 1;
      if (kind === "human") snapshot.messages[0]!.text = "Quero falar com um humano";
      if (kind === "optout") snapshot.messages[0]!.text = "Não quero mais mensagens";
      if (kind === "dnd") snapshot.dnd = true;
      if (kind === "policy")
        automatic.mockImplementation(async (s) => ({
          ...payload(s, true),
          decision: { ...payload(s, true).decision, flags: ["missing_policy"] },
        }));
      await receive();
      await agent.work(ORG);
      expect(provider.sendManual).not.toHaveBeenCalled();
      const [session] = await db.sql`select paused from commercial_agent_sessions`;
      expect(session?.["paused"]).toBe(true);
    },
  );
  it("nova mensagem humana entre geração e despacho bloqueia", async () => {
    vi.mocked(provider.history)
      .mockResolvedValueOnce(structuredClone(snapshot))
      .mockImplementation(async () => ({ ...snapshot, historyHash: sha("changed") }));
    await receive();
    await agent.work(ORG);
    expect(provider.sendManual).not.toHaveBeenCalled();
  });
  it("não usa provedor SMS implícito sem prova da rota", async () => {
    vi.mocked(provider.smsChannels!).mockResolvedValue(null);
    await receive();
    await agent.work(ORG);
    expect(provider.sendManual).not.toHaveBeenCalled();
  });
  it("exceção do transporte fica incerta, pausada e não é repetida", async () => {
    vi.mocked(provider.sendManual!).mockRejectedValue(new Error("timeout"));
    await receive();
    expect(await agent.work(ORG)).toMatchObject({ automation: { state: "unknown" } });
    await receive();
    await agent.work(ORG);
    expect(provider.sendManual).toHaveBeenCalledOnce();
    const [row] = await db.sql`select state from commercial_agent_drafts`;
    expect(row?.["state"]).toBe("unknown");
    const [session] = await db.sql`select paused from commercial_agent_sessions`;
    expect(session?.["paused"]).toBe(true);
  });
  it("reconcilia somente recibo conferido pela rota automática preservada", async () => {
    vi.mocked(provider.sendManual!).mockRejectedValue(new Error("timeout"));
    provider.verifyReceipt = vi.fn(async () => true);
    provider.verifyManualReceipt = vi.fn(async () => false);
    await receive();
    await agent.work(ORG);
    const [row] = await db.sql`select id from commercial_agent_drafts`;
    const input = { draftId: String(row?.["id"]), messageId: "receipt-proved" };
    await expect(agent.reconcile(ORG, ACTOR, input)).rejects.toThrow("receipt_not_verified");
    expect(provider.verifyReceipt).not.toHaveBeenCalled();
    expect(provider.verifyManualReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ route: expect.objectContaining({ channel: "SMS" }) }),
      expect.any(String),
      "receipt-proved",
      expect.any(String),
    );
    vi.mocked(provider.verifyManualReceipt).mockResolvedValue(true);
    await agent.reconcile(ORG, ACTOR, input);
    expect(provider.sendManual).toHaveBeenCalledOnce();
    const [sent] = await db.sql`select state from commercial_agent_drafts`;
    expect(sent?.["state"]).toBe("sent");
  });
  it("mudança de política exige nova ativação", async () => {
    const cfg = await db.store.command<Settings>("settings", ORG);
    expect(cfg.automation_enabled).toBe(true);
    await db.sql`update commercial_agent_settings set automation_policy_hash=${"c".repeat(64)} where organization_id=${ORG}`;
    await receive();
    await agent.work(ORG);
    expect(automatic).not.toHaveBeenCalled();
    expect(provider.sendManual).not.toHaveBeenCalled();
  });
});
