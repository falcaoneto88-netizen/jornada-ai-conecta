import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { ACTOR, FOREIGN, ORG, OTHER, startCommercialDb } from "../../../test/commercial-agent-db";
import { CommercialAgent, type Provider } from "./service.server";
import { POLICY_HASH, sha } from "./providers.server";
import { eventSchema, type DraftPayload, type Event, type Settings, type Snapshot } from "./core";

let db: Awaited<ReturnType<typeof startCommercialDb>>;
let snapshot: Snapshot, provider: Provider, agent: CommercialAgent;
let since: string, observedAt: string;
const key = randomBytes(32).toString("base64");
const event: Event = {
  type: "InboundMessage",
  locationId: "loc-test",
  contactId: "c-new-fictional",
  conversationId: "v-new-fictional",
  messageId: "m-new-fictional",
};
const generate = vi.fn(async (s: Snapshot): Promise<DraftPayload> => ({
  snapshot: s,
  policyHash: POLICY_HASH,
  model: "fixture",
  inputTokens: 100,
  outputTokens: 20,
  decision: {
    reply: "A consulta de avaliação custa 50 €. Posso explicar como funciona?",
    flags: [],
    handoff: false,
    optOut: false,
  },
}));
const approval = (d: { id: string; version: number; reply_hash: string }) => ({
  draftId: d.id,
  version: d.version,
  replyHash: d.reply_hash,
});
beforeAll(async () => {
  db = await startCommercialDb();
}, 60000);
afterAll(async () => db?.stop());
beforeEach(async () => {
  await db.sql`truncate commercial_agent_drafts,commercial_agent_inbox,commercial_agent_sessions,commercial_agent_audit restart identity cascade`;
  await db.sql`update commercial_agent_settings set mode='supervised',receive_all_contacts=false,receive_since=null,receive_cursor_until=null,monthly_draft_limit=3000`;
  since = new Date(Date.now() - 60000).toISOString();
  observedAt = new Date(Date.now() - 1000).toISOString();
  snapshot = {
    event,
    name: "Contato fictício",
    dnd: false,
    historyHash: sha("fictional-history"),
    messages: [
      {
        id: event.messageId,
        at: observedAt,
        text: "Quanto custa a consulta?",
        direction: "inbound",
        channel: "SMS",
        attachments: 0,
        provider: null,
      },
    ],
  };
  provider = {
    history: vi.fn(async () => structuredClone(snapshot)),
    send: vi.fn(async () => ({ state: "sent" as const, code: null, messageId: "fake-receipt" })),
  };
  generate.mockReset();
  generate.mockImplementation(async (s) => ({
    snapshot: s,
    policyHash: POLICY_HASH,
    model: "fixture",
    inputTokens: 100,
    outputTokens: 20,
    decision: {
      reply: "A consulta de avaliação custa 50 €. Posso explicar como funciona?",
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
async function enableAll() {
  await db.sql`update commercial_agent_settings set receive_all_contacts=true,receive_since=${since}::timestamptz where organization_id=${ORG}`;
}
async function draft() {
  await agent.receive(ORG, event, observedAt);
  expect(await agent.work(ORG)).toMatchObject({ status: "ready" });
  return (await agent.list(ORG, ACTOR)).items[0]!;
}
async function counts() {
  const rows =
    await db.sql`select (select count(*)::int from commercial_agent_inbox) as inbox,(select count(*)::int from commercial_agent_drafts) as drafts,(select count(*)::int from commercial_agent_sessions) as sessions`;
  return rows[0];
}
describe("recebimento geral separado da autorização de envio, PostgreSQL local", () => {
  it("migração mantém defaults desligados, listas e limite de 3000", async () => {
    const config = await db.store.command<Settings & { monthly_draft_limit: number }>(
      "settings",
      ORG,
    );
    expect(config).toMatchObject({
      receive_all_contacts: false,
      receive_since: null,
      receive_cursor_until: null,
      allowed_contacts: ["c-test", "c-second"],
      allowed_channels: ["WhatsApp", "SMS"],
      monthly_draft_limit: 3000,
    });
    await db.sql`insert into organizations(id) values('55555555-5555-4555-8555-555555555555')`;
    const rows =
      await db.sql`insert into commercial_agent_settings(organization_id,location_id) values('55555555-5555-4555-8555-555555555555','loc-new-default') returning mode,receive_all_contacts,receive_since,receive_cursor_until,allowed_contacts,allowed_channels,monthly_draft_limit`;
    expect(rows[0]).toEqual({
      mode: "off",
      receive_all_contacts: false,
      receive_since: null,
      receive_cursor_until: null,
      allowed_contacts: [],
      allowed_channels: [],
      monthly_draft_limit: 3000,
    });
    await expect(agent.receive(ORG, event, observedAt)).rejects.toThrow("contact_not_allowed");
    expect(await counts()).toEqual({ inbox: 0, drafts: 0, sessions: 0 });
  });
  it("novo contato gera rascunho, mas serviço e start_send SQL recusam envio", async () => {
    await enableAll();
    const d = await draft();
    expect(d.content?.decision.flags).toEqual([]);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(provider.send).not.toHaveBeenCalled();
    await expect(agent.approve(ORG, ACTOR, approval(d), true)).rejects.toThrow("send_disabled");
    await expect(db.store.command("start_send", ORG, approval(d), ACTOR)).rejects.toThrow(
      "dispatch_blocked",
    );
    expect(provider.send).not.toHaveBeenCalled();
    const config = await db.store.command<Settings>("settings", ORG);
    expect(config.allowed_contacts).toEqual(["c-test", "c-second"]);
    expect((await agent.list(ORG, ACTOR)).items[0]?.state).toBe("pending");
  });
  it("contato já autorizado mantém aprovação humana obrigatória", async () => {
    await enableAll();
    const known = { ...event, contactId: "c-test" };
    snapshot.event = known;
    await agent.receive(ORG, known, observedAt);
    await agent.work(ORG);
    const d = (await agent.list(ORG, ACTOR)).items[0]!;
    expect(provider.send).not.toHaveBeenCalled();
    expect(await agent.approve(ORG, ACTOR, approval(d), true)).toMatchObject({ state: "sent" });
    expect(provider.send).toHaveBeenCalledTimes(1);
  });
  it("não cruza location nem organização e preserva autenticação do revisor", async () => {
    await enableAll();
    await expect(
      agent.receive(ORG, { ...event, locationId: "loc-other" }, observedAt),
    ).rejects.toThrow("scope_mismatch");
    await expect(agent.receive(OTHER, event, observedAt)).rejects.toThrow("scope_mismatch");
    await expect(agent.list(ORG, FOREIGN)).rejects.toThrow("forbidden");
    expect(await counts()).toEqual({ inbox: 0, drafts: 0, sessions: 0 });
    expect(provider.history).not.toHaveBeenCalled();
  });
  it("desligado ignora ingresso e cursor, sem histórico/modelo/envio", async () => {
    await enableAll();
    await db.sql`update commercial_agent_settings set mode='off' where organization_id=${ORG}`;
    expect(await agent.receive(ORG, event, observedAt)).toEqual({ status: "disabled" });
    expect(await agent.work(ORG)).toEqual({ status: "idle" });
    expect(await db.store.command("receive_advance", ORG, { until: observedAt })).toEqual({
      status: "disabled",
    });
    expect(await counts()).toEqual({ inbox: 0, drafts: 0, sessions: 0 });
    expect(provider.history).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(provider.send).not.toHaveBeenCalled();
  });
  it("feature do serviço desligada não faz chamada ao store", async () => {
    const store = { command: vi.fn() };
    const off = new CommercialAgent({
      store,
      provider,
      generate,
      encryptionKey: key,
      enabled: false,
      sendEnabled: false,
    });
    expect(await off.receive(ORG, event, observedAt)).toEqual({ status: "disabled" });
    expect(await off.work(ORG)).toEqual({ status: "disabled" });
    expect(store.command).not.toHaveBeenCalled();
  });
  it("dedup ignora metadado temporal e mantém compatibilidade com Event antigo", async () => {
    const known = { ...event, contactId: "c-test" };
    await agent.receive(ORG, known);
    await enableAll();
    expect(await agent.receive(ORG, known, observedAt)).toMatchObject({ status: "duplicate" });
    expect(
      await agent.receive(ORG, known, new Date(Date.parse(observedAt) - 500).toISOString()),
    ).toMatchObject({ status: "duplicate" });
    await expect(
      agent.receive(ORG, { ...known, contactId: "another-new" }, observedAt),
    ).rejects.toThrow("duplicate_mismatch");
    const rows = await db.sql`select event from commercial_agent_inbox`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["event"]).toEqual(known);
    expect(await counts()).toEqual({ inbox: 1, drafts: 0, sessions: 1 });
  });
  it("inbound antigo indexado depois não invalida o rascunho atual nem muda versão", async () => {
    await enableAll();
    const olderAt = new Date(Date.parse(observedAt) - 10000).toISOString();
    const older = { ...event, messageId: "older-delayed-inbound" };
    snapshot.messages.unshift({ ...snapshot.messages[0]!, id: older.messageId, at: olderAt });
    const d = await draft();
    expect(await agent.receive(ORG, older, olderAt)).toMatchObject({ status: "accepted" });
    expect(await agent.receive(ORG, older, olderAt)).toMatchObject({ status: "duplicate" });
    expect(await agent.receive(ORG, event, observedAt)).toMatchObject({ status: "duplicate" });
    expect(await agent.work(ORG)).toEqual({ status: "idle" });
    const row = (await agent.list(ORG, ACTOR)).items[0]!;
    expect(row).toMatchObject({
      id: d.id,
      state: "pending",
      version: d.version,
      session_version: d.session_version,
      paused: false,
    });
    const inbox =
      await db.sql`select state,event,contact_version from commercial_agent_inbox where message_id=${older.messageId}`;
    expect(inbox[0]).toMatchObject({
      state: "ignored",
      event: older,
      contact_version: d.contact_version,
    });
    const sessions =
      await db.sql`select last_event_id,last_event_at from commercial_agent_sessions where organization_id=${ORG} and contact_id=${event.contactId}`;
    expect(sessions[0]?.["last_event_id"]).toBe(event.messageId);
    expect(new Date(sessions[0]?.["last_event_at"]).getTime()).toBe(Date.parse(observedAt));
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it("timestamps iguais com IDs distintos pausam para revisão sem escolher resposta", async () => {
    await enableAll();
    const d = await draft();
    const tie = { ...event, messageId: "same-timestamp-different-id" };
    await agent.receive(ORG, tie, observedAt);
    expect(await agent.receive(ORG, tie, observedAt)).toMatchObject({ status: "duplicate" });
    expect(await agent.work(ORG)).toEqual({ status: "idle" });
    const view = await agent.list(ORG, ACTOR);
    expect(view.items[0]).toMatchObject({ id: d.id, state: "invalidated", paused: true });
    expect(view.errors).toEqual([
      expect.objectContaining({ state: "ignored", error_code: "message_order_ambiguous" }),
    ]);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(provider.send).not.toHaveBeenCalled();
  });
  it("outbound humano antigo ainda pausa e preserva o marco mais recente", async () => {
    await enableAll();
    const d = await draft();
    await agent.receive(
      ORG,
      { ...event, type: "OutboundMessage", messageId: "delayed-human" },
      new Date(Date.parse(observedAt) - 10000).toISOString(),
    );
    expect((await agent.list(ORG, ACTOR)).items[0]).toMatchObject({
      id: d.id,
      state: "invalidated",
      paused: true,
    });
    const sessions =
      await db.sql`select last_event_id from commercial_agent_sessions where organization_id=${ORG} and contact_id=${event.contactId}`;
    expect(sessions[0]?.["last_event_id"]).toBe(event.messageId);
  });
  it("recibo próprio avança marco canônico sem pausar nem incrementar versão", async () => {
    await enableAll();
    const known = { ...event, contactId: "c-test" };
    snapshot.event = known;
    await agent.receive(ORG, known, observedAt);
    await agent.work(ORG);
    const d = (await agent.list(ORG, ACTOR)).items[0]!;
    await agent.approve(ORG, ACTOR, approval(d), true);
    const receiptAt = new Date(Date.parse(observedAt) + 500).toISOString();
    expect(
      await agent.receive(
        ORG,
        { ...known, type: "OutboundMessage", messageId: "fake-receipt" },
        receiptAt,
      ),
    ).toMatchObject({ status: "own_message" });
    const sessions =
      await db.sql`select paused,version,last_event_id,last_event_at from commercial_agent_sessions where organization_id=${ORG} and contact_id='c-test'`;
    expect(sessions[0]).toMatchObject({
      paused: false,
      version: d.session_version,
      last_event_id: "fake-receipt",
    });
    expect(new Date(sessions[0]?.["last_event_at"]).getTime()).toBe(Date.parse(receiptAt));
    await agent.receive(
      ORG,
      { ...known, messageId: "delayed-before-receipt" },
      new Date(Date.parse(observedAt) + 200).toISOString(),
    );
    expect((await agent.list(ORG, ACTOR)).items[0]).toMatchObject({
      state: "sent",
      paused: false,
      session_version: d.session_version,
    });
  });
  it.each([
    undefined,
    null,
    1,
    "",
    "today",
    "infinity",
    "2026-10-08T12:00:00",
    "2026-02-30T12:00:00Z",
  ])("recusa observedAt ausente ou inválido: %s", async (value) => {
    await enableAll();
    await expect(
      db.store.command("ingress", ORG, {
        ...event,
        ...(value === undefined ? {} : { observedAt: value }),
      }),
    ).rejects.toThrow("observed_at_invalid");
    expect(await counts()).toEqual({ inbox: 0, drafts: 0, sessions: 0 });
  });
  it("recusa data antiga e futura antes de persistir; permite limite exato", async () => {
    await enableAll();
    await expect(
      agent.receive(ORG, event, new Date(Date.parse(since) - 1).toISOString()),
    ).rejects.toThrow("before_receive_since");
    await expect(
      agent.receive(ORG, event, new Date(Date.now() + 60000).toISOString()),
    ).rejects.toThrow("observed_at_invalid");
    expect(await counts()).toEqual({ inbox: 0, drafts: 0, sessions: 0 });
    expect(await agent.receive(ORG, event, since)).toMatchObject({ status: "accepted" });
  });
  it("callback não consegue fornecer observedAt dentro do Event", async () => {
    await enableAll();
    const forged = { ...event, observedAt };
    expect(eventSchema.parse(forged)).toEqual(event);
    await expect(agent.receive(ORG, forged)).rejects.toThrow("observed_at_invalid");
    expect(await counts()).toEqual({ inbox: 0, drafts: 0, sessions: 0 });
  });
  it("data canônica antiga no histórico bloqueia modelo mesmo com metadado recente", async () => {
    await enableAll();
    snapshot.messages[0]!.at = new Date(Date.parse(since) - 1000).toISOString();
    await agent.receive(ORG, event, observedAt);
    expect(await agent.work(ORG)).toEqual({ status: "failed", code: "before_receive_since" });
    expect(generate).not.toHaveBeenCalled();
    expect((await counts())?.["drafts"]).toBe(0);
  });
  it("receive_since futuro falha fechado e ativação sem cutoff não passa a constraint", async () => {
    await expect(
      db.sql`update commercial_agent_settings set receive_all_contacts=true where organization_id=${ORG}`,
    ).rejects.toThrow();
    await db.sql`update commercial_agent_settings set receive_all_contacts=true,receive_since=now()+interval '1 hour' where organization_id=${ORG}`;
    await expect(agent.receive(ORG, event, observedAt)).rejects.toThrow("receive_since_invalid");
    expect(await counts()).toEqual({ inbox: 0, drafts: 0, sessions: 0 });
  });
  it("canal fora da lista fica em revisão manual, sem modelo nem aprovação", async () => {
    await enableAll();
    snapshot.messages[0]!.channel = "Email";
    const d = await draft();
    expect(d.content).toMatchObject({
      model: "deterministic_manual_review",
      inputTokens: 0,
      outputTokens: 0,
      decision: { flags: ["unsupported_action"], handoff: true, optOut: false },
    });
    expect(d.paused).toBe(true);
    expect(generate).not.toHaveBeenCalled();
    await expect(agent.approve(ORG, ACTOR, approval(d), true)).rejects.toThrow("send_disabled");
    await expect(db.store.command("start_send", ORG, approval(d), ACTOR)).rejects.toThrow(
      "dispatch_blocked",
    );
    expect(provider.send).not.toHaveBeenCalled();
  });
  it.each(["dnd", "stop", "historical-stop", "human", "urgent"])(
    "canal não autorizado preserva proteção %s",
    async (kind) => {
      await enableAll();
      snapshot.messages[0]!.channel = "Email";
      if (kind === "dnd") snapshot.dnd = true;
      if (kind === "stop") snapshot.messages[0]!.text = "STOP";
      if (kind === "historical-stop")
        snapshot.messages.unshift({
          ...snapshot.messages[0]!,
          id: "prior-stop",
          text: "Parem de me procurar",
          at: new Date(Date.parse(since) - 10000).toISOString(),
        });
      if (kind === "human") snapshot.messages[0]!.text = "Quero falar com um humano";
      if (kind === "urgent") snapshot.messages[0]!.text = "Estou com falta de ar";
      const d = await draft();
      expect(d.content?.model).toBe("deterministic_safety");
      expect(d.content?.decision.flags).toContain("unsupported_action");
      expect(d.paused).toBe(true);
      expect(d.opt_out).toBe(["dnd", "stop", "historical-stop"].includes(kind));
      if (kind === "urgent") expect(d.content?.decision.flags).toContain("urgent");
      if (kind === "human") expect(d.content?.decision.flags).toContain("human_requested");
      expect(generate).not.toHaveBeenCalled();
      expect(provider.send).not.toHaveBeenCalled();
    },
  );
  it("novo outbound humano pausa e invalida sem enviar; inbound posterior permanece ignorado", async () => {
    await enableAll();
    const d = await draft();
    await agent.receive(
      ORG,
      { ...event, type: "OutboundMessage", messageId: "human-new" },
      observedAt,
    );
    await agent.receive(ORG, { ...event, messageId: "inbound-after-human" }, observedAt);
    expect(await agent.work(ORG)).toEqual({ status: "idle" });
    const row = (await agent.list(ORG, ACTOR)).items[0]!;
    expect(row).toMatchObject({ id: d.id, state: "invalidated", paused: true });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(provider.send).not.toHaveBeenCalled();
  });
  it.each(["mode", "permission"])("ready revalida %s revogado durante geração", async (kind) => {
    await enableAll();
    const produce = generate.getMockImplementation()!;
    generate.mockImplementation(async (s) => {
      if (kind === "mode")
        await db.sql`update commercial_agent_settings set mode='off' where organization_id=${ORG}`;
      else
        await db.sql`update commercial_agent_settings set receive_all_contacts=false where organization_id=${ORG}`;
      return produce(s);
    });
    await agent.receive(ORG, event, observedAt);
    expect(await agent.work(ORG)).toEqual({ status: "stale" });
    expect((await counts())?.["drafts"]).toBe(0);
    const rows = await db.sql`select state from commercial_agent_inbox`;
    expect(rows[0]?.["state"]).toBe("ignored");
  });
  it("claim ignora contato que perde permissão antes do processamento", async () => {
    await enableAll();
    await agent.receive(ORG, event, observedAt);
    await db.sql`update commercial_agent_settings set receive_all_contacts=false where organization_id=${ORG}`;
    expect(await agent.work(ORG)).toEqual({ status: "idle" });
    expect(provider.history).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });
  it("claim limpa backlog obsoleto e alcança a mensagem válida no mesmo ciclo", async () => {
    await enableAll();
    for (let index = 0; index < 50; index++) {
      await agent.receive(
        ORG,
        { ...event, messageId: `stale-backlog-${index}` },
        new Date(Date.parse(since) + 1000 + index * 10).toISOString(),
      );
    }
    await agent.receive(ORG, event, observedAt);
    expect(await agent.work(ORG)).toMatchObject({ status: "ready" });
    const rows =
      await db.sql`select state,count(*)::int as count from commercial_agent_inbox group by state order by state`;
    expect(rows).toEqual([
      { state: "ignored", count: 50 },
      { state: "ready", count: 1 },
    ]);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(provider.history).toHaveBeenCalledWith(event);
    expect((await agent.list(ORG, ACTOR)).items[0]?.message_id).toBe(event.messageId);
  });
  it("ready descarta geração quando o cutoff avança além da mensagem canônica", async () => {
    await enableAll();
    const produce = generate.getMockImplementation()!;
    generate.mockImplementation(async (s) => {
      const nextSince = new Date(Date.parse(observedAt) + 500).toISOString();
      await db.sql`update commercial_agent_settings set receive_since=${nextSince}::timestamptz where organization_id=${ORG}`;
      return produce(s);
    });
    await agent.receive(ORG, event, observedAt);
    expect(await agent.work(ORG)).toEqual({ status: "stale" });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(provider.send).not.toHaveBeenCalled();
    expect((await counts())?.["drafts"]).toBe(0);
    const rows = await db.sql`select state from commercial_agent_inbox`;
    expect(rows[0]?.["state"]).toBe("ignored");
  });
  it.each([undefined, "infinity", "2099-01-01T00:00:00Z"])(
    "ready exige data canônica finita e passada: %s",
    async (value) => {
      await enableAll();
      await agent.receive(ORG, event, observedAt);
      const job = await db.store.command<{ id: string; lease: string }>("claim", ORG);
      expect(
        await db.store.command("ready", ORG, {
          id: job.id,
          lease: job.lease,
          ...(value === undefined ? {} : { observedAt: value }),
        }),
      ).toEqual({ status: "stale" });
      expect((await counts())?.["drafts"]).toBe(0);
      const rows = await db.sql`select state from commercial_agent_inbox`;
      expect(rows[0]?.["state"]).toBe("ignored");
    },
  );
  it("mantém limite mensal existente ao ampliar recebimento", async () => {
    await enableAll();
    await db.sql`update commercial_agent_settings set monthly_draft_limit=1 where organization_id=${ORG}`;
    await draft();
    await agent.receive(
      ORG,
      { ...event, contactId: "other-fictional", messageId: "other-message" },
      observedAt,
    );
    expect(await agent.work(ORG)).toEqual({ status: "idle" });
    expect(generate).toHaveBeenCalledTimes(1);
    expect((await counts())?.["drafts"]).toBe(1);
  });
  it("cursor é monotônico, não altera listas e só avança em modo geral ativo", async () => {
    expect(await db.store.command("receive_advance", ORG, { until: observedAt })).toEqual({
      status: "disabled",
    });
    await enableAll();
    expect(await db.store.command("receive_advance", ORG, { until: observedAt })).toEqual({
      status: "advanced",
    });
    expect(await db.store.command("receive_advance", ORG, { until: since })).toEqual({
      status: "unchanged",
    });
    expect(await db.store.command("receive_advance", ORG, { until: observedAt })).toEqual({
      status: "unchanged",
    });
    const config = await db.store.command<Settings>("settings", ORG);
    expect(Date.parse(config.receive_cursor_until!)).toBe(Date.parse(observedAt));
    expect(config.allowed_contacts).toEqual(["c-test", "c-second"]);
    expect(config.allowed_channels).toEqual(["WhatsApp", "SMS"]);
    expect(await counts()).toEqual({ inbox: 0, drafts: 0, sessions: 0 });
  });
  it.each([
    {},
    { until: null },
    { until: "infinity" },
    { until: "2026-02-30T10:00:00Z" },
    { until: "2026-10-08T12:00:00" },
    { until: "2020-01-01T00:00:00Z" },
    { until: "2099-01-01T00:00:00Z" },
    { until: "2020-01-01T00:00:00Z", extra: true },
  ])("cursor rejeita formato/intervalo/payload inválido %j", async (data) => {
    await enableAll();
    await expect(db.store.command("receive_advance", ORG, data)).rejects.toThrow(
      "receive_cursor_invalid",
    );
    expect((await db.store.command<Settings>("settings", ORG)).receive_cursor_until).toBeNull();
  });
  it("anon e authenticated não têm EXECUTE para ingresso ou avanço", async () => {
    await enableAll();
    for (const role of ["anon", "authenticated"]) {
      const connection = await db.sql.reserve();
      try {
        await connection.unsafe(`set role ${role}`);
        await expect(
          connection`select public.commercial_agent_command('receive_advance',${ORG}::uuid,${connection.json({ until: observedAt })},null)`,
        ).rejects.toThrow("permission denied");
        await expect(
          connection`select public.commercial_agent_command('ingress',${ORG}::uuid,${connection.json({ ...event, observedAt })},null)`,
        ).rejects.toThrow("permission denied");
      } finally {
        await connection`reset role`;
        connection.release();
      }
    }
    expect((await db.store.command<Settings>("settings", ORG)).receive_cursor_until).toBeNull();
    expect(await counts()).toEqual({ inbox: 0, drafts: 0, sessions: 0 });
  });
});
