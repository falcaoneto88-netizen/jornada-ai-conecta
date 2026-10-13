/** Real isolated PostgreSQL ledger + fake GHL only. No production data, credentials or sends. */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { ACTOR, FOREIGN, ORG, OTHER, startCommercialDb } from "../../test/commercial-agent-db";
import {
  AttendanceDraftService,
  bindAttendanceDraftDispatch,
  type AttendanceDraftRpc,
  type VerifiedDraftScope,
} from "./attendance-draft.server";
import { CommercialAgent } from "./commercial-agent/service.server";
import { sha } from "./commercial-agent/providers.server";
import type { Snapshot } from "./commercial-agent/core";
import type { AttendanceDraftResult } from "./attendance-draft.core";

const SECOND = "55555555-5555-4555-8555-555555555555";
const key = Buffer.alloc(32, 21).toString("base64");
const text = "Resposta exata  ";
let db: Awaited<ReturnType<typeof startCommercialDb>>;
let rpc: AttendanceDraftRpc;
let agent: CommercialAgent;
const sendManual = vi.fn(),
  verifyReceipt = vi.fn();
const scope = (userId = ACTOR, organizationId = ORG): VerifiedDraftScope => ({
  organizationId,
  userId,
  contactId: "draft-test-contact",
  conversationId: "draft-test-conversation",
  locationId: organizationId === ORG ? "loc-test" : "loc-other",
});
const service = () =>
  new AttendanceDraftService({ rpc, encryptionKey: key, verifyScope: async () => {} });
const value = (r: AttendanceDraftResult) => {
  if (!r.ok) throw new Error(r.code);
  return r.data;
};
const save = async (s = scope(), body = text, revision: string | null = null) =>
  value(await service().save(s, { text: body, expectedRevision: revision }));
const row = async () =>
  (
    await db.sql`select * from attendance_drafts where organization_id=${ORG} and user_id=${ACTOR}`
  )[0]!;
const ledger = async () =>
  (await db.sql`select * from commercial_agent_manual_dispatches order by created_at`)[0]!;

beforeAll(async () => {
  db = await startCommercialDb();
  for (const file of [
    "20261013110000_attendance_drafts.sql",
    "20261013130000_attendance_draft_dispatch_recovery.sql",
  ])
    await db.sql.unsafe(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await db.sql`insert into auth.users values(${SECOND})`;
  await db.sql`insert into profiles values(${SECOND},${ORG})`;
  await db.sql`insert into user_roles values(${SECOND},${ORG},'comercial')`;
  rpc = {
    async rpc(name, args) {
      if (name === "attendance_draft_bind_dispatch") {
        const [r] =
          await db.sql`select attendance_draft_bind_dispatch(${String(args["_org"])}::uuid,${String(args["_actor"])}::uuid,${String(args["_location"])},${String(args["_contact"])},${String(args["_conversation"])},${String(args["_manual"])}::uuid,${String(args["_request"])}::uuid,${String(args["_revision"])}::uuid,${String(args["_text_hash"])}) value`;
        return { data: r?.["value"], error: null };
      }
      expect(["attendance_draft_command", "attendance_draft_load_reconciled"]).toContain(name);
      const [r] =
        await db.sql`select ${db.sql(name)}(${String(args["_op"])},${String(args["_org"])}::uuid,${String(args["_actor"])}::uuid,${String(args["_location"])},${String(args["_contact"])},${String(args["_conversation"])},${db.sql.json(args["_data"] as never)}) value`;
      return { data: r?.["value"], error: null };
    },
  };
}, 60000);
afterAll(async () => db?.stop());
beforeEach(async () => {
  await db.sql`truncate attendance_drafts,commercial_agent_manual_dispatches,commercial_agent_drafts,commercial_agent_inbox,commercial_agent_sessions,commercial_agent_audit restart identity cascade`;
  await db.sql`update commercial_agent_settings set manual_send_all_contacts=true where organization_id=${ORG}`;
  await db.sql`update ghl_connections set write_enabled=true`;
  sendManual
    .mockReset()
    .mockResolvedValue({ state: "sent", code: null, messageId: "receipt-fake-1" });
  verifyReceipt.mockReset().mockResolvedValue(true);
  const snapshot: Snapshot = {
    event: {
      type: "InboundMessage",
      locationId: "loc-test",
      contactId: scope().contactId,
      conversationId: scope().conversationId,
      messageId: "in-fake",
    },
    name: "Fictício",
    dnd: false,
    historyHash: sha("draft-recovery-fixture"),
    messages: [
      {
        id: "in-fake",
        at: new Date(Date.now() - 60000).toISOString(),
        text: "Olá",
        direction: "inbound",
        channel: "SMS",
        attachments: 0,
        provider: "zap",
      },
    ],
  };
  agent = new CommercialAgent({
    store: db.store,
    provider: {
      history: vi.fn(),
      send: vi.fn(),
      manualHistory: async () => structuredClone(snapshot),
      sendManual,
      verifyManualReceipt: verifyReceipt,
      smsChannels: async () => ({ defaultId: "zap", providers: new Map([["zap", "Zaptos"]]) }),
    },
    generate: vi.fn(),
    encryptionKey: key,
    enabled: true,
    sendEnabled: true,
    bindAttendanceDraft: (input) => bindAttendanceDraftDispatch(rpc, key, input),
  });
});
const send = async (draftRevision: string | null, body = text) => {
  const context = await agent.inboxContext(ORG, ACTOR, scope(), true, "zap");
  return agent.inboxSend(
    ORG,
    ACTOR,
    {
      contactId: scope().contactId,
      conversationId: scope().conversationId,
      text: body,
      requestId: randomUUID(),
      draftRevision,
      revision: context.revision,
    },
    true,
    "zap",
  );
};
const prepare = async () => {
  const context = await agent.inboxContext(ORG, ACTOR, scope(), true, "zap");
  return agent.manualPrepare(
    ORG,
    ACTOR,
    {
      contactId: scope().contactId,
      conversationId: scope().conversationId,
      text,
      requestId: randomUUID(),
      expectedVersion: context.revision.sessionVersion,
      historyHash: context.revision.historyHash,
    },
    true,
    context.route!,
    new Date(Date.now() + 20_000).toISOString(),
  );
};
const bind = async (revision: string, body = text, s = scope()) => {
  const d = await ledger();
  return bindAttendanceDraftDispatch(rpc, key, {
    ...s,
    manualId: String(d["id"]),
    requestId: String(d["request_id"]),
    revision,
    text: body,
  });
};

it("sent + failed client clear recovers on another service/device using only the durable ledger", async () => {
  const saved = await save();
  expect(await send(saved.revision)).toMatchObject({ state: "sent", messageId: "receipt-fake-1" });
  const d = await ledger();
  expect(d["attendance_draft_revision"]).toBe(saved.revision);
  expect(d["attendance_draft_text_hash"]).toBe((await row())["text_hash"]);
  expect((await row())["payload"]).not.toBeNull();
  const offlineClear = new AttendanceDraftService({
    rpc: { rpc: async () => ({ error: {}, data: null }) },
    encryptionKey: key,
    verifyScope: async () => {},
  });
  expect(
    await offlineClear.clear(scope(), { expectedText: text, expectedRevision: saved.revision }),
  ).toEqual({ ok: false, code: "draft_unavailable" });
  const recovered = value(await service().load(scope()));
  expect(recovered.draft).toBeNull();
  expect(recovered.revision).not.toBe(saved.revision);
  expect((await row())["payload"]).toBeNull();
  expect(value(await service().load(scope()))).toEqual(recovered);
  expect(sendManual).toHaveBeenCalledTimes(1);
});

it("newer revisions, including identical text and ABA edits, are never cleaned by an older sent binding", async () => {
  const saved = await save();
  await send(saved.revision);
  const changed = await save(scope(), "Outra resposta", saved.revision);
  const newer = await save(scope(), text, changed.revision);
  expect(value(await service().load(scope()))).toEqual(newer);
});

it("pending, sending, unknown and rejected evidence never clears; verified reconciliation does", async () => {
  const saved = await save();
  const prepared = await prepare();
  await bind(saved.revision!);
  expect(value(await service().load(scope()))).toEqual(saved);
  sendManual.mockImplementationOnce(async () => {
    expect(value(await service().load(scope()))).toEqual(saved); // SQL state is already sending
    return { state: "unknown", code: "outcome_unknown", messageId: null };
  });
  await agent.manualSend(
    ORG,
    ACTOR,
    { manualId: prepared.id, replyHash: prepared.replyHash },
    true,
    new Date(Date.now() + 20_000).toISOString(),
  );
  expect(value(await service().load(scope()))).toEqual(saved);
  verifyReceipt.mockResolvedValueOnce(false);
  await expect(
    agent.manualReconcile(ORG, ACTOR, { manualId: prepared.id, messageId: "invented" }),
  ).rejects.toThrow();
  expect(value(await service().load(scope()))).toEqual(saved);
  await agent.manualReconcile(ORG, ACTOR, { manualId: prepared.id, messageId: "verified-fake" });
  expect(value(await service().load(scope())).draft).toBeNull();
  expect(sendManual).toHaveBeenCalledTimes(1);
});

it("rejected or sent without a message ID is not confirmation evidence", async () => {
  const saved = await save();
  sendManual.mockResolvedValueOnce({
    state: "rejected",
    code: "provider_rejected",
    messageId: null,
  });
  await send(saved.revision);
  expect(value(await service().load(scope()))).toEqual(saved);
  // Fault injection only: a malformed ledger must fail closed even if its state string is sent.
  await db.sql`update commercial_agent_manual_dispatches set state='sent',result_message_id=null`;
  expect(value(await service().load(scope()))).toEqual(saved);
});

it("binding fails before POST for the same revision but different text, key or missing migration", async () => {
  const saved = await save();
  await expect(send(saved.revision, text.trim())).rejects.toThrow("draft_binding_conflict");
  expect(sendManual).not.toHaveBeenCalled();
  expect((await ledger())["attendance_draft_revision"]).toBeNull();
  const d = await ledger();
  const input = {
    ...scope(),
    manualId: String(d["id"]),
    requestId: String(d["request_id"]),
    revision: saved.revision!,
    text,
  };
  await expect(bindAttendanceDraftDispatch(rpc, "", input)).rejects.toThrow(
    "draft_binding_unavailable",
  );
  await expect(
    bindAttendanceDraftDispatch(
      { rpc: async () => ({ error: { code: "PGRST202" }, data: null }) },
      key,
      input,
    ),
  ).rejects.toThrow("draft_binding_unavailable");
  expect(value(await service().load(scope()))).toEqual(saved);
});

it("binding is immutable, author/contact/organization scoped, and idempotent before dispatch", async () => {
  const saved = await save();
  const otherUser = await save(scope(SECOND));
  const otherOrg = await save(scope(FOREIGN, OTHER));
  await prepare();
  await expect(bind(otherUser.revision!, text, scope(SECOND))).rejects.toThrow(
    "draft_binding_unavailable",
  );
  await expect(bind(otherOrg.revision!, text, scope(FOREIGN, OTHER))).rejects.toThrow(
    "draft_binding_unavailable",
  );
  await expect(bind(saved.revision!, text, { ...scope(), contactId: "other" })).rejects.toThrow(
    "draft_binding_conflict",
  );
  await bind(saved.revision!);
  await bind(saved.revision!);
  const d = await ledger();
  await agent.manualSend(
    ORG,
    ACTOR,
    { manualId: String(d["id"]), replyHash: String(d["reply_hash"]) },
    true,
    new Date(Date.now() + 20_000).toISOString(),
  );
  expect(value(await service().load(scope())).draft).toBeNull();
  expect(value(await service().load(scope(SECOND)))).toEqual(otherUser);
  expect(value(await service().load(scope(FOREIGN, OTHER)))).toEqual(otherOrg);
});

it("a later draft cannot be attached retroactively to an older prepared or already sent request", async () => {
  const saved = await save();
  await prepare();
  const newer = await save(scope(), text, saved.revision);
  await expect(bind(newer.revision!)).rejects.toThrow("draft_binding_conflict");
  expect(sendManual).not.toHaveBeenCalled();
  expect((await ledger())["attendance_draft_revision"]).toBeNull();
});

it("legacy sends without a revision do not erase a draft or invent a cleanup binding", async () => {
  const saved = await save();
  await send(null);
  expect((await ledger())["attendance_draft_revision"]).toBeNull();
  expect(value(await service().load(scope()))).toEqual(saved);
});

it("media-only sends have no textual cleanup binding and preserve any saved text", async () => {
  const saved = await save();
  const context = await agent.inboxContext(ORG, ACTOR, scope(), true, "zap");
  const result = await agent.inboxSend(
    ORG,
    ACTOR,
    {
      contactId: scope().contactId,
      conversationId: scope().conversationId,
      text: "",
      requestId: randomUUID(),
      draftRevision: null,
      revision: context.revision,
      attachments: [
        {
          name: "fake.png",
          mimeType: "image/png",
          base64:
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=",
        },
      ],
    },
    true,
    "zap",
  );
  expect(result.state).toBe("sent");
  expect((await ledger())["attendance_draft_revision"]).toBeNull();
  expect(value(await service().load(scope()))).toEqual(saved);
  expect(sendManual).toHaveBeenCalledTimes(1);
});

it("stale saves racing recovery cannot resurrect the sent revision", async () => {
  const saved = await save();
  await send(saved.revision);
  const [loaded, edited] = await Promise.all([
    service().load(scope()),
    service().save(scope(), { text: "Próxima mensagem", expectedRevision: saved.revision }),
  ]);
  expect(loaded.ok).toBe(true);
  if (edited.ok) expect(value(await service().load(scope()))).toEqual(edited.data);
  else {
    expect(edited.code).toBe("draft_conflict");
    expect(value(await service().load(scope())).draft).toBeNull();
  }
  expect(sendManual).toHaveBeenCalledTimes(1);
});
