/** Native, isolated PostgreSQL and synthetic events only. No GHL/model/network dispatch. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { ACTOR, FOREIGN, ORG, OTHER, startCommercialDb } from "../../../test/commercial-agent-db";

type State = {
  automation_enabled: boolean;
  automation_version: number;
  automation_since: string | null;
  automation_policy_hash: string | null;
  automation_channels: string[];
  canManage: boolean;
};
type Draft = {
  id: string;
  version: number;
  reply_hash: string;
  dispatch_id: string;
  contact_id: string;
  conversation_id: string;
};
let db: Awaited<ReturnType<typeof startCommercialDb>>;
const hash = "a".repeat(64);
const replyHash = "b".repeat(64);
const state = () => db.store.command<State>("automation_state", ORG, {}, ACTOR);
const set = (enabled: boolean, expectedVersion: number, extra: Record<string, unknown> = {}) =>
  db.store.command<State>(
    "automation_set",
    ORG,
    { enabled, expectedVersion, policyHash: hash, channels: ["SMS"], ...extra },
    ACTOR,
  );
async function now() {
  const [row] =
    await db.sql`select to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at`;
  return String(row!["at"]);
}
async function seedDraft(options: { at?: string; contactId?: string; flags?: string[] } = {}) {
  const at = options.at ?? (await now());
  const event = {
    type: "InboundMessage",
    locationId: "loc-test",
    contactId: options.contactId ?? "c-new-fictional",
    conversationId: "v-fictional",
    messageId: randomUUID(),
  };
  await db.store.command("ingress", ORG, { ...event, observedAt: at });
  const job = await db.store.command<{ id: string; lease: string }>("claim", ORG);
  const ready = await db.store.command<{ id: string }>("ready", ORG, {
    id: job.id,
    lease: job.lease,
    payload: "synthetic-encrypted-placeholder",
    replyHash,
    policyHash: hash,
    flags: options.flags ?? [],
    inputTokens: 0,
    outputTokens: 0,
    observedAt: at,
    pause: false,
    optOut: false,
  });
  const row = await db.store.command<Draft>("automation_detail", ORG, { draftId: ready.id });
  return { row, at, event };
}
function startInput(draft: Awaited<ReturnType<typeof seedDraft>>, version = 1) {
  return {
    draftId: draft.row.id,
    version: draft.row.version,
    replyHash: draft.row.reply_hash,
    automationVersion: version,
    policyHash: hash,
    channel: "SMS",
    inboundAt: draft.at,
  };
}
const checkInput = (row: Draft, version = 1) => ({
  draftId: row.id,
  dispatchId: row.dispatch_id,
  automationVersion: version,
  policyHash: hash,
});
beforeAll(async () => {
  db = await startCommercialDb();
}, 60000);
afterAll(async () => db?.stop());
beforeEach(async () => {
  await db.sql`truncate commercial_agent_manual_dispatches,commercial_agent_drafts,commercial_agent_inbox,commercial_agent_sessions,commercial_agent_audit restart identity cascade`;
  await db.sql`update commercial_agent_settings set mode='supervised',receive_all_contacts=true,receive_since=now()-interval '3 days',receive_cursor_until=null,manual_send_all_contacts=true,allowed_channels=array['SMS','WhatsApp'],automation_enabled=false,automation_version=0,automation_since=null,automation_policy_hash=null,automation_channels='{}',automation_enabled_by=null,automation_enabled_at=null`;
  await db.sql`update user_roles set role='administrador' where user_id=${ACTOR}`;
  await db.sql`update ghl_connections set write_enabled=true`;
  await db.sql`delete from ghl_location_bindings`;
  await db.sql`insert into ghl_location_bindings values(${ORG},'loc-test'),(${OTHER},'loc-other')`;
});

describe("global automation authorization and durable dispatch", () => {
  it("migration mirrors are identical and capability starts disabled", async () => {
    expect(
      readFileSync(
        "supabase/migrations/20261117160000_commercial_agent_global_automation.sql",
        "utf8",
      ),
    ).toBe(readFileSync("drizzle/migrations/0029_commercial_agent_global_automation.sql", "utf8"));
    expect(await state()).toMatchObject({
      automation_enabled: false,
      automation_version: 0,
      canManage: true,
    });
  });
  it("only manager/admin in the bound organization can change it; commercial can read", async () => {
    await db.sql`update user_roles set role='comercial' where user_id=${ACTOR}`;
    expect(await state()).toMatchObject({ canManage: false });
    await expect(set(true, 0)).rejects.toThrow("forbidden");
    await expect(db.store.command("automation_state", ORG, {}, FOREIGN)).rejects.toThrow(
      "forbidden",
    );
    await expect(db.store.command("automation_state", ORG)).rejects.toThrow("forbidden");
  });
  it("server assigns cutoff and CAS; repeated identical activation preserves cutoff", async () => {
    const before = Date.now();
    const enabled = await set(true, 0);
    expect(enabled).toMatchObject({
      automation_enabled: true,
      automation_version: 1,
      automation_channels: ["SMS"],
    });
    expect(Date.parse(enabled.automation_since!)).toBeGreaterThanOrEqual(before - 1);
    await expect(set(false, 0)).rejects.toThrow("version_conflict");
    expect(await set(true, 1)).toMatchObject({
      automation_version: 1,
      automation_since: enabled.automation_since,
    });
    await expect(set(true, 1, { since: "2000-01-01T00:00:00Z" })).rejects.toThrow(
      "invalid_automation",
    );
  });
  it("requires existing broad receipt, supervised engine, write permission and allowed channels", async () => {
    await db.sql`update commercial_agent_settings set receive_all_contacts=false where organization_id=${ORG}`;
    await expect(set(true, 0)).rejects.toThrow("send_disabled");
    await db.sql`update commercial_agent_settings set receive_all_contacts=true,mode='off' where organization_id=${ORG}`;
    await expect(set(true, 0)).rejects.toThrow("send_disabled");
    await db.sql`update commercial_agent_settings set mode='supervised' where organization_id=${ORG}`;
    await db.sql`update ghl_connections set write_enabled=false where organization_id=${ORG}`;
    await expect(set(true, 0)).rejects.toThrow("send_disabled");
    await db.sql`update ghl_connections set write_enabled=true where organization_id=${ORG}`;
    await expect(set(true, 0, { channels: ["IG"] })).rejects.toThrow("unsupported_channel");
    await expect(set(true, 0, { channels: [] })).rejects.toThrow("unsupported_channel");
  });
  it("kill switch works with CRM write disabled and does not alter other settings", async () => {
    await set(true, 0);
    await db.sql`update ghl_connections set write_enabled=false where organization_id=${ORG}`;
    expect(await set(false, 1)).toMatchObject({
      automation_enabled: false,
      automation_version: 2,
      automation_since: null,
    });
    const [cfg] =
      await db.sql`select mode,receive_all_contacts,manual_send_all_contacts,allowed_contacts from commercial_agent_settings where organization_id=${ORG}`;
    expect(cfg).toMatchObject({
      mode: "supervised",
      receive_all_contacts: true,
      manual_send_all_contacts: true,
      allowed_contacts: ["c-test", "c-second"],
    });
  });
  it("never sends old backlog, including after disable and re-enable", async () => {
    const old = await seedDraft();
    await set(true, 0);
    await expect(db.store.command("automation_start", ORG, startInput(old))).rejects.toThrow(
      "before_automation_since",
    );
    const next = await seedDraft({ contactId: "c-another-fictional" });
    await set(false, 1);
    await set(true, 2);
    await expect(db.store.command("automation_start", ORG, startInput(next, 3))).rejects.toThrow(
      "before_automation_since",
    );
  });
  it("reserves new eligible contact outside the supervised pilot without claiming human approval", async () => {
    await set(true, 0);
    const d = await seedDraft();
    const started = await db.store.command<Draft>("automation_start", ORG, startInput(d));
    expect(started).toMatchObject({
      state: "sending",
      dispatch_origin: "automatic",
      automation_version: 1,
      approved_by: null,
    });
    expect(await db.store.command("automation_check", ORG, checkInput(started))).toEqual({
      status: "allowed",
    });
    const codes = await db.sql`select code from commercial_agent_audit`;
    expect(codes.map((r) => r["code"])).toContain("automatic_dispatch");
    expect(codes.map((r) => r["code"])).not.toContain("human_approved");
  });
  it("keeps immutable authorizer and authorization time after disable/reactivation by another manager", async () => {
    const firstAuthorization = await set(true, 0);
    const d = await seedDraft();
    await db.store.command<Draft>("automation_start", ORG, startInput(d));
    await set(false, 1);
    const secondActor = "55555555-5555-4555-8555-555555555555";
    await db.sql`insert into auth.users values(${secondActor})`;
    await db.sql`insert into profiles values(${secondActor},${ORG})`;
    await db.sql`insert into user_roles values(${secondActor},${ORG},'gestor')`;
    await db.store.command(
      "automation_set",
      ORG,
      { enabled: true, expectedVersion: 2, policyHash: hash, channels: ["SMS"] },
      secondActor,
    );
    const frozen = await db.store.command("automation_detail", ORG, { draftId: d.row.id });
    expect(frozen).toMatchObject({
      automation_authorized_by: ACTOR,
      automation_authorized_at: firstAuthorization.automation_since,
      automation_version: 1,
      approved_by: null,
    });
  });
  it("two native concurrent claims reserve exactly one dispatch", async () => {
    await set(true, 0);
    const d = await seedDraft();
    const results = await Promise.allSettled([
      db.store.command("automation_start", ORG, startInput(d)),
      db.store.command("automation_start", ORG, startInput(d)),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      (
        await db.sql`select count(*)::int as n from commercial_agent_audit where code='automatic_dispatch'`
      )[0]!["n"],
    ).toBe(1);
  });
  it("manual approval competing with automation cannot acquire the same draft twice", async () => {
    await set(true, 0);
    const d = await seedDraft({ contactId: "c-test" });
    const results = await Promise.allSettled([
      db.store.command("automation_start", ORG, startInput(d)),
      db.store.command(
        "start_send",
        ORG,
        { draftId: d.row.id, version: d.row.version, replyHash },
        ACTOR,
      ),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
  it.each(["prepared", "sending", "unknown"])(
    "a %s human dispatch blocks automatic reservation even if pause was lost",
    async (manualState) => {
      await set(true, 0);
      const d = await seedDraft();
      await db.sql`insert into commercial_agent_manual_dispatches
        (organization_id,request_id,contact_id,conversation_id,location_id,session_version,inbound_id,inbound_at,channel,history_hash,payload,reply_hash,state,prepared_by)
        values(${ORG},${randomUUID()},${d.event.contactId},${d.event.conversationId},'loc-test',1,${d.event.messageId},${d.at}::timestamptz,'SMS',${hash},'synthetic-encrypted-placeholder',${replyHash},${manualState},${ACTOR})`;
      await expect(db.store.command("automation_start", ORG, startInput(d))).rejects.toThrow(
        "reconciliation_required",
      );
    },
  );
  it("unknown earlier automatic dispatch blocks a newer response for the same contact", async () => {
    await set(true, 0);
    const first = await seedDraft();
    const started = await db.store.command<Draft>("automation_start", ORG, startInput(first));
    const next = await seedDraft();
    await db.sql`update commercial_agent_drafts set state='unknown' where id=${started.id}`;
    await expect(db.store.command("automation_start", ORG, startInput(next))).rejects.toThrow(
      "reconciliation_required",
    );
  });
  it("a real pre-reservation safety failure persists a handoff without posting a message", async () => {
    await set(true, 0);
    const d = await seedDraft();
    expect(
      await db.store.command("automation_block", ORG, {
        draftId: d.row.id,
        code: "review_required",
      }),
    ).toEqual({ status: "blocked", code: "review_required" });
    expect(await db.store.command("automation_detail", ORG, { draftId: d.row.id })).toMatchObject({
      state: "invalidated",
      paused: true,
      session_version: 2,
      error_code: "review_required",
    });
    expect(
      (await db.sql`select code from commercial_agent_audit where draft_id=${d.row.id}`).map(
        (r) => r["code"],
      ),
    ).toContain("automatic_blocked");
    expect(
      await db.store.command("automation_block", ORG, {
        draftId: d.row.id,
        code: "review_required",
      }),
    ).toEqual({ status: "unchanged" });
  });
  it.each([
    "send_disabled",
    "automation_disabled",
    "automation_policy_changed",
    "before_automation_since",
    "version_conflict",
  ])("%s is ineligibility rather than a reason to pause the contact", async (code) => {
    await set(true, 0);
    const d = await seedDraft();
    expect(await db.store.command("automation_block", ORG, { draftId: d.row.id, code })).toEqual({
      status: "unchanged",
    });
    expect(await db.store.command("automation_detail", ORG, { draftId: d.row.id })).toMatchObject({
      state: "pending",
      paused: false,
      session_version: 1,
    });
  });
  it.each(["sending", "unknown"])(
    "block never rewrites a %s reservation",
    async (dispatchState) => {
      await set(true, 0);
      const d = await seedDraft();
      const started = await db.store.command<Draft>("automation_start", ORG, startInput(d));
      if (dispatchState === "unknown")
        await db.store.command("finish_send", ORG, {
          draftId: started.id,
          dispatchId: started.dispatch_id,
          state: "unknown",
          code: "send_unknown",
          messageId: null,
        });
      expect(
        await db.store.command("automation_block", ORG, {
          draftId: d.row.id,
          code: "review_required",
        }),
      ).toEqual({ status: "unchanged" });
      expect(await db.store.command("automation_detail", ORG, { draftId: d.row.id })).toMatchObject(
        { state: dispatchState },
      );
    },
  );
  it("pause after reservation blocks pre-POST check; global enable never clears human pause", async () => {
    await set(true, 0);
    const d = await seedDraft();
    const started = await db.store.command<Draft>("automation_start", ORG, startInput(d));
    await db.store.command(
      "pause",
      ORG,
      { contactId: d.event.contactId, expectedVersion: 1 },
      ACTOR,
    );
    await expect(db.store.command("automation_check", ORG, checkInput(started))).rejects.toThrow(
      "human_paused",
    );
    await set(false, 1);
    await set(true, 2);
    expect((await db.sql`select paused from commercial_agent_sessions`)[0]!["paused"]).toBe(true);
  });
  it("disable, policy change and settings epoch invalidate pre-POST reservation", async () => {
    await set(true, 0);
    const d = await seedDraft();
    const started = await db.store.command<Draft>("automation_start", ORG, startInput(d));
    await expect(
      db.store.command("automation_check", ORG, {
        ...checkInput(started),
        policyHash: "c".repeat(64),
      }),
    ).rejects.toThrow("draft_stale");
    await set(false, 1);
    await expect(db.store.command("automation_check", ORG, checkInput(started))).rejects.toThrow(
      "send_disabled",
    );
    await set(true, 2);
    await expect(db.store.command("automation_check", ORG, checkInput(started))).rejects.toThrow(
      "version_conflict",
    );
  });
  it.each(["paused", "opt_out"])("persisted %s blocks automatic reservation", async (field) => {
    await set(true, 0);
    const d = await seedDraft();
    await db.sql`update commercial_agent_sessions set ${db.sql(field)}=true where organization_id=${ORG}`;
    await expect(db.store.command("automation_start", ORG, startInput(d))).rejects.toThrow(
      field === "paused" ? "human_paused" : "do_not_contact",
    );
  });
  it("rejects safety flags, foreign policy, changed version and unverified inbound timestamp", async () => {
    await set(true, 0);
    const flagged = await seedDraft({ flags: ["clinical"] });
    await expect(db.store.command("automation_start", ORG, startInput(flagged))).rejects.toThrow(
      "review_required",
    );
    const d = await seedDraft({ contactId: "c-other-new" });
    await expect(
      db.store.command("automation_start", ORG, { ...startInput(d), policyHash: "c".repeat(64) }),
    ).rejects.toThrow("draft_stale");
    await expect(
      db.store.command("automation_start", ORG, { ...startInput(d), version: 9 }),
    ).rejects.toThrow("version_conflict");
    await expect(
      db.store.command("automation_start", ORG, {
        ...startInput(d),
        inboundAt: "2000-01-01T00:00:00Z",
      }),
    ).rejects.toThrow("inbound_not_verified");
  });
  it("future or expired canonical timestamps and channel mutations are blocked", async () => {
    await set(true, 0);
    const d = await seedDraft();
    await db.sql`update commercial_agent_inbox set observed_at=now()+interval '1 hour' where id=(select event_id from commercial_agent_drafts where id=${d.row.id})`;
    await expect(db.store.command("automation_start", ORG, startInput(d))).rejects.toThrow(
      "channel_window",
    );
    await db.sql`update commercial_agent_settings set automation_since=now()-interval '2 days' where organization_id=${ORG}`;
    await db.sql`update commercial_agent_inbox set observed_at=now()-interval '24 hours' where id=(select event_id from commercial_agent_drafts where id=${d.row.id})`;
    await expect(db.store.command("automation_start", ORG, startInput(d))).rejects.toThrow(
      "channel_window",
    );
    await db.sql`update commercial_agent_inbox set observed_at=${d.at}::timestamptz where id=(select event_id from commercial_agent_drafts where id=${d.row.id})`;
    await expect(
      db.store.command("automation_start", ORG, { ...startInput(d), channel: "IG" }),
    ).rejects.toThrow("unsupported_channel");
  });
  it.each(["paused", "opt_out"])("block does not mutate an already %s session", async (field) => {
    await set(true, 0);
    const d = await seedDraft();
    await db.sql`update commercial_agent_sessions set ${db.sql(field)}=true where organization_id=${ORG}`;
    expect(
      await db.store.command("automation_block", ORG, {
        draftId: d.row.id,
        code: "review_required",
      }),
    ).toEqual({ status: "unchanged" });
    expect(await db.store.command("automation_detail", ORG, { draftId: d.row.id })).toMatchObject({
      state: "pending",
      session_version: 1,
    });
  });
  it("unknown result pauses and cannot be retried; watchdog recognizes automatic reservations", async () => {
    await set(true, 0);
    const d = await seedDraft();
    const started = await db.store.command<Draft>("automation_start", ORG, startInput(d));
    await db.store.command("finish_send", ORG, {
      draftId: started.id,
      dispatchId: started.dispatch_id,
      state: "unknown",
      code: "send_unknown",
      messageId: null,
    });
    expect((await db.sql`select state from commercial_agent_drafts`)[0]!["state"]).toBe("unknown");
    expect((await db.sql`select paused from commercial_agent_sessions`)[0]!["paused"]).toBe(true);
    await expect(db.store.command("automation_start", ORG, startInput(d))).rejects.toThrow(
      "human_paused",
    );
    const next = await seedDraft({ contactId: "c-watchdog" });
    await db.store.command("automation_start", ORG, startInput(next));
    await db.sql`update commercial_agent_drafts set approved_at=now()-interval '3 minutes' where id=${next.row.id}`;
    await db.store.command("claim", ORG);
    expect(
      (await db.sql`select state from commercial_agent_drafts where id=${next.row.id}`)[0]![
        "state"
      ],
    ).toBe("unknown");
  });
  it("provider receipt remains an own message and does not pause the session", async () => {
    await set(true, 0);
    const d = await seedDraft();
    const started = await db.store.command<Draft>("automation_start", ORG, startInput(d));
    await db.store.command("finish_send", ORG, {
      draftId: started.id,
      dispatchId: started.dispatch_id,
      state: "sent",
      code: null,
      messageId: "synthetic-receipt",
    });
    expect(
      await db.store.command("ingress", ORG, {
        ...d.event,
        type: "OutboundMessage",
        messageId: "synthetic-receipt",
        observedAt: await now(),
      }),
    ).toMatchObject({ status: "own_message" });
    expect((await db.sql`select paused from commercial_agent_sessions`)[0]!["paused"]).toBe(false);
  });
  it("scope is rechecked and privileged RPC is unavailable to public clients", async () => {
    await set(true, 0);
    const d = await seedDraft();
    await expect(
      db.store.command("automation_detail", OTHER, { draftId: d.row.id }),
    ).rejects.toThrow("not_found");
    await db.sql`delete from ghl_location_bindings where organization_id=${ORG}`;
    await expect(db.store.command("automation_start", ORG, startInput(d))).rejects.toThrow(
      "scope_mismatch",
    );
    for (const role of ["anon", "authenticated"]) {
      await expect(
        db.sql.begin(async (tx) => {
          await tx.unsafe(`set local role ${role}`);
          await tx`select public.commercial_agent_automation_command('automation_state',${ORG}::uuid,'{}',${ACTOR}::uuid)`;
        }),
      ).rejects.toThrow();
    }
  });
});
