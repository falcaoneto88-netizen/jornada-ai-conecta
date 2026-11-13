/** Isolated PostgreSQL, synthetic contacts and mocked provider only. Never calls GHL. */
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { ACTOR, FOREIGN, ORG, OTHER, startCommercialDb } from "../../../test/commercial-agent-db";
import { CommercialAgent, type ManualPayload, type Provider } from "./service.server";
import { POLICY_HASH, replyHash, seal, sha, unseal } from "./providers.server";
import type { DraftPayload, Snapshot, SourceAgentDraft } from "./core";
import {
  AttendanceDraftService,
  bindAttendanceDraftDispatch,
  type AttendanceDraftRpc,
} from "../attendance-draft.server";
let db: Awaited<ReturnType<typeof startCommercialDb>>;
let snapshot: Snapshot, agent: CommercialAgent, provider: Provider;
let flags: DraftPayload["decision"]["flags"] = [];
const key = randomBytes(32).toString("base64");
const event = {
  type: "InboundMessage" as const,
  locationId: "loc-test",
  contactId: "c-test",
  conversationId: "v-test",
  messageId: "m-test",
};
const scope = { contactId: event.contactId, conversationId: event.conversationId };
const sendManual = vi.fn();
const make = (overrides: Partial<ConstructorParameters<typeof CommercialAgent>[0]> = {}) =>
  new CommercialAgent({
    store: db.store,
    provider,
    encryptionKey: key,
    enabled: true,
    sendEnabled: true,
    generate: async (s) => ({
      snapshot: s,
      policyHash: POLICY_HASH,
      model: "fixture",
      inputTokens: 1,
      outputTokens: 1,
      decision: {
        reply: "Podemos ajudar a organizar sua avaliação.",
        flags,
        handoff: false,
        optOut: false,
      },
    }),
    ...overrides,
  });
beforeAll(async () => {
  db = await startCommercialDb();
  for (const file of [
    "20261013110000_attendance_drafts.sql",
    "20261013130000_attendance_draft_dispatch_recovery.sql",
  ])
    await db.sql.unsafe(readFileSync(`supabase/migrations/${file}`, "utf8"));
}, 60000);
afterAll(async () => db?.stop());
beforeEach(async () => {
  await db.sql`truncate attendance_drafts,commercial_agent_manual_dispatches,commercial_agent_drafts,commercial_agent_inbox,commercial_agent_sessions,commercial_agent_audit restart identity cascade`;
  await db.sql`update commercial_agent_settings set mode='supervised',manual_send_all_contacts=true,allowed_contacts=array['c-test','c-second'],allowed_channels=array['SMS','WhatsApp'] where organization_id=${ORG}`;
  await db.sql`update ghl_connections set write_enabled=true`;
  flags = [];
  snapshot = {
    event,
    name: "Contato fictício",
    dnd: false,
    historyHash: sha("reviewed-source"),
    messages: [
      {
        id: event.messageId,
        at: new Date(Date.now() - 60000).toISOString(),
        text: "Como marcar uma avaliação?",
        direction: "inbound",
        channel: "SMS",
        attachments: 0,
        provider: "zap",
      },
    ],
  };
  sendManual
    .mockReset()
    .mockResolvedValue({ state: "sent", code: null, messageId: "synthetic-receipt" });
  provider = {
    history: vi.fn(async () => structuredClone(snapshot)),
    send: vi.fn(),
    manualHistory: vi.fn(async () => structuredClone(snapshot)),
    sendManual,
    smsChannels: vi.fn(async () => ({ defaultId: "zap", providers: new Map([["zap", "Zaptos"]]) })),
  };
  agent = make();
});
async function input() {
  await agent.receive(ORG, event);
  await agent.work(ORG);
  const row = (await agent.list(ORG, ACTOR)).items[0]!;
  const sourceAgentDraft: SourceAgentDraft = {
    draftId: row.id,
    version: row.version,
    replyHash: row.reply_hash,
  };
  return {
    ...scope,
    requestId: randomUUID(),
    text: "Posso explicar os horários disponíveis?",
    sourceAgentDraft,
    revision: (await agent.inboxContext(ORG, ACTOR, scope, true, "zap")).revision,
  };
}
const send = (i: Awaited<ReturnType<typeof input>>, current = agent, org = ORG, actor = ACTOR) =>
  current.inboxSend(org, actor, i, true, "zap");
async function untouched() {
  expect(sendManual).not.toHaveBeenCalled();
  expect(
    (await db.sql`select count(*)::integer n from commercial_agent_manual_dispatches`)[0]!["n"],
  ).toBe(0);
}
it("keeps immutable original, persists source version/hash in encrypted/manual ledger, audits and sends exact edit once", async () => {
  const i = await input();
  const [original] =
    await db.sql`select payload,reply_hash from commercial_agent_drafts where id=${i.sourceAgentDraft.draftId}`;
  const result = await send(i);
  expect(result.state).toBe("sent");
  expect(sendManual).toHaveBeenCalledTimes(1);
  expect(sendManual.mock.calls[0]![1]).toBe(i.text);
  const [row] =
    await db.sql`select * from commercial_agent_manual_dispatches where id=${result.manualId}`;
  expect(row).toMatchObject({
    source_agent_draft_id: i.sourceAgentDraft.draftId,
    source_agent_version: i.sourceAgentDraft.version,
    source_agent_reply_hash: i.sourceAgentDraft.replyHash,
    state: "sent",
    prepared_by: ACTOR,
    approved_by: ACTOR,
  });
  expect(
    unseal<ManualPayload>(row!["payload"], key, `manual:${ORG}:${i.requestId}`).sourceAgentDraft,
  ).toEqual(i.sourceAgentDraft);
  const [after] =
    await db.sql`select payload,reply_hash,state from commercial_agent_drafts where id=${i.sourceAgentDraft.draftId}`;
  expect(after).toMatchObject({ ...original, state: "invalidated" });
  expect(
    (
      await db.sql`select code from commercial_agent_audit where draft_id=${i.sourceAgentDraft.draftId}`
    ).map((r) => r["code"]),
  ).toContain("inbox_edited_manual_prepared");
  expect((await send(i)).messageId).toBe(result.messageId);
  expect(sendManual).toHaveBeenCalledTimes(1);
  for (const changed of [
    { ...i, text: i.text + " " },
    { ...i, sourceAgentDraft: { ...i.sourceAgentDraft, version: 2 } },
    { ...i, sourceAgentDraft: undefined },
  ])
    await expect(send(changed as typeof i)).rejects.toThrow("manual_request_mismatch");
});
it.each([
  "paused",
  "dnd",
  "optout",
  "mode",
  "contact",
  "channel",
  "write",
  "version",
  "expired",
  "history",
  "flags",
  "reply",
  "policy",
  "scope",
])("blocks %s before preparing or sending", async (kind) => {
  if (kind === "flags") flags = ["clinical"];
  const i = await input();
  if (kind === "paused")
    await db.sql`update commercial_agent_sessions set paused=true where organization_id=${ORG}`;
  if (kind === "dnd") snapshot.dnd = true;
  if (kind === "optout")
    await db.sql`update commercial_agent_sessions set opt_out=true where organization_id=${ORG}`;
  if (kind === "mode")
    await db.sql`update commercial_agent_settings set mode='off' where organization_id=${ORG}`;
  if (kind === "contact")
    await db.sql`update commercial_agent_settings set allowed_contacts='{}' where organization_id=${ORG}`;
  if (kind === "channel")
    await db.sql`update commercial_agent_settings set allowed_channels='{}' where organization_id=${ORG}`;
  if (kind === "write")
    await db.sql`update ghl_connections set write_enabled=false where organization_id=${ORG}`;
  if (kind === "version") i.sourceAgentDraft.version++;
  if (kind === "expired")
    await db.sql`update commercial_agent_drafts set expires_at=now()-interval '1 second' where id=${i.sourceAgentDraft.draftId}`;
  if (kind === "history") snapshot.historyHash = sha("new inbound");
  if (kind === "reply") i.text = "Resultado 100% seguro.";
  if (kind === "scope") {
    snapshot = { ...snapshot, event: { ...event, contactId: "c-second" } };
    i.contactId = "c-second";
  }
  if (kind === "policy") {
    const [r] =
      await db.sql`select payload,event_id from commercial_agent_drafts where id=${i.sourceAgentDraft.draftId}`;
    const p = unseal<DraftPayload>(r!["payload"], key, `${ORG}:${r!["event_id"]}`);
    p.policyHash = "old-policy";
    i.sourceAgentDraft.replyHash = replyHash(p);
    await db.sql`update commercial_agent_drafts set payload=${seal(p, key, `${ORG}:${r!["event_id"]}`)},reply_hash=${i.sourceAgentDraft.replyHash} where id=${i.sourceAgentDraft.draftId}`;
  }
  await expect(send(i)).rejects.toThrow();
  await untouched();
});
it.each([{ enabled: false }, { sendEnabled: false }])(
  "global gate %j remains closed",
  async (override) => {
    const i = await input();
    await expect(send(i, make(override))).rejects.toThrow("send_disabled");
    await untouched();
  },
);
it("rejects cross-tenant actor and source, exact conversation mismatch", async () => {
  const i = await input();
  await expect(send(i, agent, ORG, FOREIGN)).rejects.toThrow("forbidden");
  await expect(send(i, agent, OTHER, FOREIGN)).rejects.toThrow();
  snapshot = { ...snapshot, event: { ...event, conversationId: "other-v" } };
  await expect(send({ ...i, conversationId: "other-v" })).rejects.toThrow("scope_mismatch");
  await untouched();
});
it("atomically rejects source rejected after JS validation", async () => {
  const i = await input();
  const store = {
    command: async <T>(op: string, org: string, data?: Record<string, unknown>, actor?: string) => {
      if (op === "manual_inbox_review_prepare") await agent.reject(ORG, ACTOR, i.sourceAgentDraft);
      return db.store.command<T>(op, org, data, actor);
    },
  };
  await expect(send(i, make({ store }))).rejects.toThrow("version_conflict");
  await untouched();
});
it("rechecks allowlist after preparation before provider POST", async () => {
  const i = await input();
  const store = {
    command: async <T>(op: string, org: string, data?: Record<string, unknown>, actor?: string) => {
      const result = await db.store.command<T>(op, org, data, actor);
      if (op === "manual_inbox_review_prepare")
        await db.sql`update commercial_agent_settings set allowed_contacts='{}' where organization_id=${ORG}`;
      return result;
    },
  };
  await expect(send(i, make({ store }))).rejects.toThrow("send_disabled");
  expect(sendManual).not.toHaveBeenCalled();
});
it.each([false, true])(
  "concurrent reviewed approvals (different keys=%s) make at most one POST",
  async (different) => {
    const i = await input();
    const second = { ...i, requestId: different ? randomUUID() : i.requestId };
    const results = await Promise.allSettled([send(i), send(second)]);
    expect(results.some((r) => r.status === "fulfilled" && r.value.state === "sent")).toBe(true);
    expect(sendManual).toHaveBeenCalledTimes(1);
    expect(
      (await db.sql`select count(*)::integer n from commercial_agent_manual_dispatches`)[0]!["n"],
    ).toBe(1);
  },
);
it("uncertain send is durable and retry never issues another POST", async () => {
  const i = await input();
  sendManual.mockResolvedValue({ state: "unknown", code: "send_unknown", messageId: null });
  expect((await send(i)).state).toBe("unknown");
  expect((await send(i)).state).toBe("unknown");
  expect(sendManual).toHaveBeenCalledTimes(1);
});
it("existing manual inbox send remains supported without a source", async () => {
  const i = await input();
  const { sourceAgentDraft: _source, ...manual } = i;
  expect((await agent.inboxSend(ORG, ACTOR, manual, true, "zap")).state).toBe("sent");
  const [row] = await db.sql`select source_agent_draft_id from commercial_agent_manual_dispatches`;
  expect(row!["source_agent_draft_id"]).toBeNull();
});

it("reviewed source survives draft reload and full send binding; durable sent evidence clears it", async () => {
  const i = await input();
  const rpc: AttendanceDraftRpc = {
    async rpc(name, args) {
      if (name === "attendance_draft_bind_dispatch") {
        const [r] =
          await db.sql`select attendance_draft_bind_dispatch(${String(args["_org"])}::uuid,${String(args["_actor"])}::uuid,${String(args["_location"])},${String(args["_contact"])},${String(args["_conversation"])},${String(args["_manual"])}::uuid,${String(args["_request"])}::uuid,${String(args["_revision"])}::uuid,${String(args["_text_hash"])}) value`;
        return { data: r?.["value"], error: null };
      }
      const [r] =
        await db.sql`select ${db.sql(name)}(${String(args["_op"])},${String(args["_org"])}::uuid,${String(args["_actor"])}::uuid,${String(args["_location"])},${String(args["_contact"])},${String(args["_conversation"])},${db.sql.json(args["_data"] as never)}) value`;
      return { data: r?.["value"], error: null };
    },
  };
  const draftScope = { ...scope, organizationId: ORG, userId: ACTOR, locationId: event.locationId };
  const drafts = new AttendanceDraftService({
    rpc,
    encryptionKey: key,
    verifyScope: async () => {},
  });
  const saved = await drafts.save(draftScope, {
    text: i.text,
    sourceAgentDraft: i.sourceAgentDraft,
    expectedRevision: null,
  });
  if (!saved.ok || !saved.data.revision) throw new Error("fixture");
  expect(await drafts.load(draftScope)).toEqual(saved);
  const tracked = make({
    bindAttendanceDraft: (input) => bindAttendanceDraftDispatch(rpc, key, input),
  });
  const result = await tracked.inboxSend(
    ORG,
    ACTOR,
    { ...i, draftRevision: saved.data.revision },
    true,
    "zap",
  );
  expect(result.state).toBe("sent");
  expect(sendManual).toHaveBeenCalledTimes(1);
  const [dispatch] =
    await db.sql`select source_agent_draft_id,attendance_draft_revision from commercial_agent_manual_dispatches where id=${result.manualId}`;
  expect(dispatch).toEqual({
    source_agent_draft_id: i.sourceAgentDraft.draftId,
    attendance_draft_revision: saved.data.revision,
  });
  expect(await drafts.load(draftScope)).toMatchObject({ ok: true, data: { draft: null } });
});

it("a confirmed pre-POST route failure cancels preparation and allows a new explicit approval with immutable source", async () => {
  const i = await input();
  const sms = vi.mocked(provider.smsChannels!);
  sms
    .mockResolvedValueOnce({ defaultId: "zap", providers: new Map([["zap", "Zaptos"]]) })
    .mockResolvedValueOnce({ defaultId: "other", providers: new Map([["other", "Other"]]) });
  await expect(send(i)).rejects.toThrow("route_changed");
  expect(sendManual).not.toHaveBeenCalled();
  const [failed] =
    await db.sql`select * from commercial_agent_manual_dispatches where request_id=${i.requestId}`;
  expect(failed).toMatchObject({
    state: "invalidated",
    error_code: "review_retry_required",
    approved_at: null,
    dispatch_id: null,
  });
  const [source] =
    await db.sql`select version,state,payload from commercial_agent_drafts where id=${i.sourceAgentDraft.draftId}`;
  expect(source).toMatchObject({ version: i.sourceAgentDraft.version + 1, state: "invalidated" });
  expect(
    (await db.sql`select paused from commercial_agent_sessions where organization_id=${ORG}`)[0]![
      "paused"
    ],
  ).toBe(true);
  const revision = (await agent.inboxContext(ORG, ACTOR, scope, true, "zap")).revision;
  const next = {
    ...i,
    requestId: randomUUID(),
    revision,
    text: "Posso explicar como marcar sua avaliação?",
  };
  const outcomes = await Promise.allSettled([
    send(next),
    send({ ...next, requestId: randomUUID() }),
  ]);
  expect(outcomes.some((r) => r.status === "fulfilled" && r.value.state === "sent")).toBe(true);
  expect(sendManual).toHaveBeenCalledTimes(1);
  expect(
    (await db.sql`select count(*)::int n from commercial_agent_manual_dispatches`)[0]!["n"],
  ).toBe(2);
  const [unchanged] =
    await db.sql`select version,state,payload from commercial_agent_drafts where id=${i.sourceAgentDraft.draftId}`;
  expect(unchanged).toEqual(source);
  expect(sendManual.mock.calls[0]![1]).toBe(next.text);
  expect((await send(i)).state).toBe("invalidated");
  expect(sendManual).toHaveBeenCalledTimes(1);
});

it("recovery never refreshes stale history or an independently changed session", async () => {
  const i = await input();
  const tracked = make({
    bindAttendanceDraft: async () => {
      throw new Error("draft_binding_conflict");
    },
  });
  await expect(
    tracked.inboxSend(ORG, ACTOR, { ...i, draftRevision: randomUUID() }, true, "zap"),
  ).rejects.toThrow("draft_binding_conflict");
  snapshot.historyHash = sha("new history after cancellation");
  const next = {
    ...i,
    requestId: randomUUID(),
    revision: (await agent.inboxContext(ORG, ACTOR, scope, true, "zap")).revision,
  };
  await expect(send(next)).rejects.toThrow("draft_stale");
  expect(sendManual).not.toHaveBeenCalled();
  expect(
    (await db.sql`select count(*)::int n from commercial_agent_manual_dispatches`)[0]!["n"],
  ).toBe(1);
  await db.sql`update commercial_agent_sessions set version=version+1 where organization_id=${ORG}`;
  snapshot.historyHash = sha("reviewed-source");
  next.revision = (await agent.inboxContext(ORG, ACTOR, scope, true, "zap")).revision;
  await expect(send(next)).rejects.toThrow("version_conflict");
});

it("expiry of operational request after preparation is cancelled before POST; new human approval can recover", async () => {
  const i = await input();
  let now = Date.now();
  let advance = true;
  const timed = make({
    now: () => now,
    store: {
      async command<T>(op: string, org: string, data?: Record<string, unknown>, actor?: string) {
        const result = await db.store.command<T>(op, org, data, actor);
        if (op === "manual_inbox_review_prepare" && advance) {
          now += 21_000;
          advance = false;
        }
        return result;
      },
    },
  });
  await expect(send(i, timed)).rejects.toThrow("request_expired");
  expect(sendManual).not.toHaveBeenCalled();
  const next = {
    ...i,
    requestId: randomUUID(),
    revision: (await timed.inboxContext(ORG, ACTOR, scope, true, "zap")).revision,
  };
  expect((await send(next, timed)).state).toBe("sent");
  expect(sendManual).toHaveBeenCalledTimes(1);
});

it("a claim already started concurrently cannot be cancelled or classified as pre-POST", async () => {
  const i = await input();
  const raced = make({
    store: {
      async command<T>(op: string, org: string, data?: Record<string, unknown>, actor?: string) {
        const result = await db.store.command<T>(op, org, data, actor);
        if (op === "manual_start_send") throw new Error("response lost after claim");
        return result;
      },
    },
  });
  await expect(send(i, raced)).rejects.toThrow("send_unknown");
  expect(sendManual).not.toHaveBeenCalled();
  const [record] = await db.sql`select state,dispatch_id from commercial_agent_manual_dispatches`;
  expect(record!["state"]).toBe("sending");
  expect(record!["dispatch_id"]).not.toBeNull();
  await expect(send({ ...i, requestId: randomUUID() }, raced)).rejects.toThrow(
    "reconciliation_required",
  );
  expect(sendManual).not.toHaveBeenCalled();
});

it("pre-POST recovery stays with the original human actor even inside the same tenant", async () => {
  const i = await input();
  const tracked = make({
    bindAttendanceDraft: async () => {
      throw new Error("draft_binding_conflict");
    },
  });
  await expect(
    tracked.inboxSend(ORG, ACTOR, { ...i, draftRevision: randomUUID() }, true, "zap"),
  ).rejects.toThrow("draft_binding_conflict");
  const second = "99999999-9999-4999-8999-999999999999";
  await db.sql`insert into auth.users values(${second})`;
  await db.sql`insert into profiles values(${second},${ORG})`;
  await db.sql`insert into user_roles values(${second},${ORG},'comercial')`;
  const next = {
    ...i,
    requestId: randomUUID(),
    revision: (await agent.inboxContext(ORG, second, scope, true, "zap")).revision,
  };
  await expect(send(next, agent, ORG, second)).rejects.toThrow("version_conflict");
  expect(sendManual).not.toHaveBeenCalled();
});
