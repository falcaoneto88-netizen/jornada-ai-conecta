/** Native PostgreSQL, synthetic identifiers and no provider/model/network dispatch. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { ACTOR, ORG, OTHER, startCommercialDb } from "../../../test/commercial-agent-db";

let db: Awaited<ReturnType<typeof startCommercialDb>>;
const policy = "a".repeat(64),
  hash = "b".repeat(64);
const inbound = {
  type: "InboundMessage",
  locationId: "loc-test",
  contactId: "c-test",
  conversationId: "v-test",
  messageId: "in-test",
};
type Dispatch = { id: string; dispatch_id: string; version: number; reply_hash: string };
async function now() {
  const [row] =
    await db.sql`select to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at`;
  return String(row!["at"]);
}
async function sending() {
  const at = await now();
  await db.store.command("ingress", ORG, { ...inbound, observedAt: at });
  const job = await db.store.command<{ id: string; lease: string }>("claim", ORG);
  const ready = await db.store.command<{ id: string }>("ready", ORG, {
    id: job.id,
    lease: job.lease,
    payload: "synthetic-placeholder",
    replyHash: hash,
    policyHash: policy,
    flags: [],
    inputTokens: 0,
    outputTokens: 0,
    observedAt: at,
    pause: false,
    optOut: false,
  });
  const draft = await db.store.command<Dispatch>("automation_detail", ORG, { draftId: ready.id });
  return db.store.command<Dispatch>("automation_start", ORG, {
    draftId: draft.id,
    version: draft.version,
    replyHash: draft.reply_hash,
    automationVersion: 1,
    policyHash: policy,
    channel: "SMS",
    inboundAt: at,
  });
}
async function outbound(messageId: string = randomUUID(), overrides: Record<string, unknown> = {}) {
  return { ...inbound, type: "OutboundMessage", messageId, observedAt: await now(), ...overrides };
}
const session = async () =>
  (
    await db.sql`select version,paused from commercial_agent_sessions where organization_id=${ORG} and contact_id='c-test'`
  )[0];
const finish = (draft: Dispatch, messageId: string) =>
  db.store.command("finish_send", ORG, {
    draftId: draft.id,
    dispatchId: draft.dispatch_id,
    state: "sent",
    messageId,
  });

describe.skipIf(!process.env["PG_TEST_BINDIR"])("automatic receipt ingress race", () => {
  beforeAll(async () => {
    db = await startCommercialDb();
  }, 60000);
  afterAll(async () => db?.stop());
  beforeEach(async () => {
    await db.sql`truncate commercial_agent_manual_dispatches,commercial_agent_drafts,commercial_agent_inbox,commercial_agent_sessions,commercial_agent_audit restart identity cascade`;
    await db.sql`update commercial_agent_settings set mode='supervised',receive_all_contacts=true,receive_since=now()-interval '3 days',receive_cursor_until=null,allowed_channels=array['SMS'],automation_enabled=false,automation_version=0,automation_since=null,automation_policy_hash=null,automation_channels='{}',automation_enabled_by=null,automation_enabled_at=null`;
    await db.sql`update user_roles set role='administrador' where user_id=${ACTOR}`;
    await db.store.command(
      "automation_set",
      ORG,
      { enabled: true, expectedVersion: 0, policyHash: policy, channels: ["SMS"] },
      ACTOR,
    );
  });

  it("defers an observed outbound until finish_send persists its ID without creating a tombstone or human pause", async () => {
    const draft = await sending();
    const event = await outbound();
    const before = await session();
    const auditBefore = await db.sql`select count(*)::int as n from commercial_agent_audit`;
    await expect(db.store.command("automation_ingress", ORG, event)).rejects.toThrow(
      "receipt_pending",
    );
    expect(await session()).toEqual(before);
    expect(
      (
        await db.sql`select count(*)::int as n from commercial_agent_inbox where message_id=${event.messageId}`
      )[0]!["n"],
    ).toBe(0);
    expect(await db.sql`select count(*)::int as n from commercial_agent_audit`).toEqual(
      auditBefore,
    );
    await finish(draft, event.messageId);
    expect(await db.store.command("automation_ingress", ORG, event)).toMatchObject({
      status: "own_message",
    });
    expect(await session()).toEqual(before);
    expect(await db.store.command("automation_ingress", ORG, event)).toMatchObject({
      status: "duplicate",
    });
    expect(await session()).toMatchObject({ paused: false });
  });

  it("does not treat a different human outbound as ours after receipt persistence", async () => {
    const draft = await sending();
    const event = await outbound("human-reply");
    await expect(db.store.command("automation_ingress", ORG, event)).rejects.toThrow(
      "receipt_pending",
    );
    await finish(draft, "actual-automatic-receipt");
    expect(await db.store.command("automation_ingress", ORG, event)).toMatchObject({
      status: "accepted",
    });
    expect(await session()).toMatchObject({ paused: true, version: 2 });
    expect(
      (await db.sql`select code from commercial_agent_audit`).map((row) => row["code"]),
    ).toContain("human_paused");
  });

  it("expires the brief deferral and never auto-resumes a contact after a late receipt", async () => {
    const draft = await sending();
    await db.sql`update commercial_agent_drafts set approved_at=clock_timestamp()-interval '3 minutes' where id=${draft.id}`;
    const event = await outbound("unresolved-outgoing");
    expect(await db.store.command("automation_ingress", ORG, event)).toMatchObject({
      status: "accepted",
    });
    expect(await session()).toMatchObject({ paused: true, version: 2 });
    await finish(draft, event.messageId);
    expect(await db.store.command("automation_ingress", ORG, event)).toMatchObject({
      status: "duplicate",
    });
    expect(await session()).toMatchObject({ paused: true, version: 2 });
  });

  it("delegates inbound messages immediately while an outgoing receipt is unresolved", async () => {
    await sending();
    const event = { ...inbound, messageId: "next-inbound", observedAt: await now() };
    expect(await db.store.command("automation_ingress", ORG, event)).toMatchObject({
      status: "accepted",
    });
    expect(await session()).toMatchObject({ paused: false, version: 2 });
  });

  it("does not defer an outbound in another conversation or contact", async () => {
    await sending();
    expect(
      await db.store.command(
        "automation_ingress",
        ORG,
        await outbound("human-other-conversation", { conversationId: "v-other" }),
      ),
    ).toMatchObject({ status: "accepted" });
    expect(await session()).toMatchObject({ paused: true });
    expect(
      await db.store.command(
        "automation_ingress",
        ORG,
        await outbound("human-other-contact", { contactId: "c-second" }),
      ),
    ).toMatchObject({ status: "accepted" });
    expect(
      (
        await db.sql`select paused from commercial_agent_sessions where organization_id=${ORG} and contact_id='c-second'`
      )[0],
    ).toMatchObject({ paused: true });
  });

  it("rejects foreign location/organization scope and user impersonation before deferring", async () => {
    await sending();
    const event = await outbound();
    await expect(db.store.command("automation_ingress", ORG, event, ACTOR)).rejects.toThrow(
      "forbidden",
    );
    await expect(
      db.store.command("automation_ingress", ORG, { ...event, locationId: "loc-other" }),
    ).rejects.toThrow("scope_mismatch");
    await expect(db.store.command("automation_ingress", OTHER, event)).rejects.toThrow(
      "scope_mismatch",
    );
    // Matching IDs in another correctly bound organization cannot see the first organization's dispatch.
    expect(
      await db.store.command("automation_ingress", OTHER, { ...event, locationId: "loc-other" }),
    ).toMatchObject({ status: "accepted" });
    expect(await session()).toMatchObject({ paused: false, version: 1 });
  });

  it("keeps legacy validation for malformed events and disables receipt deferral for a nonautomatic dispatch", async () => {
    const draft = await sending();
    const event = await outbound();
    await expect(
      db.store.command("automation_ingress", ORG, { ...event, extra: "invalid" }),
    ).rejects.toThrow("invalid_event");
    await db.sql`update commercial_agent_drafts set dispatch_origin='supervised',automation_version=null,automation_channel=null,automation_authorized_by=null,automation_authorized_at=null where id=${draft.id}`;
    expect(await db.store.command("automation_ingress", ORG, event)).toMatchObject({
      status: "accepted",
    });
    expect(await session()).toMatchObject({ paused: true });
  });
});
