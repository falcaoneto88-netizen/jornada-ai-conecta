/** PostgreSQL efêmero, apenas dados fictícios; todos os GET GHL são substituídos por prova de escopo. */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { startCommercialDb, ORG, OTHER, ACTOR, FOREIGN } from "../../test/commercial-agent-db";
import {
  AttendanceDraftService,
  type AttendanceDraftRpc,
  type VerifiedDraftScope,
} from "./attendance-draft.server";
import type { AttendanceDraftResult, AttendanceDraftSnapshot } from "./attendance-draft.core";

const SECOND = "55555555-5555-4555-8555-555555555555",
  VIEWER = "66666666-6666-4666-8666-666666666666";
const key = Buffer.alloc(32, 9).toString("base64");
let db: Awaited<ReturnType<typeof startCommercialDb>>;
const scope = (userId = ACTOR, organizationId = ORG): VerifiedDraftScope => ({
  userId,
  organizationId,
  contactId: "contact-fictional",
  conversationId: "conversation-fictional",
  locationId: organizationId === ORG ? "loc-test" : "loc-other",
});
const value = (result: AttendanceDraftResult): AttendanceDraftSnapshot => {
  if (!result.ok) throw new Error(result.code);
  return result.data;
};
let rpc: AttendanceDraftRpc;
const service = (encryptionKey = key) =>
  new AttendanceDraftService({ rpc, encryptionKey, verifyScope: vi.fn(async () => {}) });
const save = async (text = "Texto exato  ", expectedRevision: string | null = null, s = scope()) =>
  service().save(s, { text, expectedRevision });
const rows = () => db.sql`select * from attendance_drafts order by user_id`;
beforeAll(async () => {
  db = await startCommercialDb();
  await db.sql.unsafe(
    readFileSync("supabase/migrations/20261013110000_attendance_drafts.sql", "utf8"),
  );
  await db.sql.unsafe(
    readFileSync(
      "supabase/migrations/20261013130000_attendance_draft_dispatch_recovery.sql",
      "utf8",
    ),
  );
  await db.sql`insert into auth.users values(${SECOND}),(${VIEWER})`;
  await db.sql`insert into profiles values(${SECOND},${ORG}),(${VIEWER},${ORG})`;
  await db.sql`insert into user_roles values(${SECOND},${ORG},'comercial'),(${VIEWER},${ORG},'visualizador')`;
  rpc = {
    async rpc(name, args) {
      expect(["attendance_draft_command", "attendance_draft_load_reconciled"]).toContain(name);
      const [result] =
        await db.sql`select ${db.sql(name)}(${String(args["_op"])},${String(args["_org"])}::uuid,${String(args["_actor"])}::uuid,${String(args["_location"])},${String(args["_contact"])},${String(args["_conversation"])},${db.sql.json(args["_data"] as never)}) as value`;
      return { data: result?.["value"], error: null };
    },
  };
}, 60000);
afterAll(async () => db?.stop());
beforeEach(async () => {
  await db.sql`truncate attendance_drafts`;
});

it("first load is empty; exact draft survives a new service instance encrypted at rest", async () => {
  expect(value(await service().load(scope()))).toEqual({ revision: null, draft: null });
  expect(await rows()).toHaveLength(0);
  const saved = value(await save());
  expect(saved.revision).toMatch(/^[a-f0-9-]{36}$/);
  expect(saved.draft?.text).toBe("Texto exato  ");
  expect(Date.parse(saved.draft!.expiresAt) - Date.parse(saved.draft!.updatedAt)).toBe(
    7 * 86400000,
  );
  expect(value(await service().load(scope()))).toEqual(saved);
  const [row] = await rows();
  expect(row!["payload"]).toMatch(/^v1\./);
  expect(row!["payload"]).not.toContain("Texto exato");
});

it("two users in one tenant and a second tenant have independent drafts for identical CRM IDs", async () => {
  const a = value(await save("Pessoa A")),
    b = value(await save("Pessoa B", null, scope(SECOND))),
    c = value(await save("Outro tenant", null, scope(FOREIGN, OTHER)));
  expect(value(await service().load(scope())).draft?.text).toBe("Pessoa A");
  expect(value(await service().load(scope(SECOND))).draft?.text).toBe("Pessoa B");
  expect(value(await service().load(scope(FOREIGN, OTHER))).draft?.text).toBe("Outro tenant");
  expect(new Set([a.revision, b.revision, c.revision]).size).toBe(3);
  expect(await service().load(scope(ACTOR, OTHER))).toEqual({ ok: false, code: "forbidden" });
  expect(await service().load(scope(VIEWER))).toEqual({ ok: false, code: "forbidden" });
  expect(await save("wrong location", null, { ...scope(), locationId: "loc-other" })).toEqual({
    ok: false,
    code: "scope_mismatch",
  });
});

it("contact and conversation are both part of the scope and cipher binding", async () => {
  await save("Original");
  expect(
    value(await service().load({ ...scope(), conversationId: "different-conversation" })).draft,
  ).toBeNull();
  expect(
    value(await service().load({ ...scope(), contactId: "different-contact" })).draft,
  ).toBeNull();
  await db.sql`update attendance_drafts set conversation_id='different-conversation'`;
  expect(await service().load({ ...scope(), conversationId: "different-conversation" })).toEqual({
    ok: false,
    code: "draft_unavailable",
  });
});

it("two tabs racing from empty create one winner; conflict returns that exact current draft", async () => {
  const results = await Promise.all([save("A"), save("B")]);
  const winner = results.find((r) => r.ok),
    conflict = results.find((r) => !r.ok);
  expect(winner?.ok).toBe(true);
  expect(conflict).toMatchObject({
    ok: false,
    code: "draft_conflict",
    current: winner?.ok ? winner.data : null,
  });
  expect(await rows()).toHaveLength(1);
});

it("CAS preserves the winning revision and a late save cannot overwrite newer text", async () => {
  const first = value(await save("Primeiro"));
  const second = value(await save("Segundo", first.revision));
  expect(await save("Resposta atrasada", first.revision)).toEqual({
    ok: false,
    code: "draft_conflict",
    current: second,
  });
  expect(value(await service().load(scope()))).toEqual(second);
});

it("a late send success clears only its exact revision and text, preserving a newly typed draft", async () => {
  const sending = value(await save("Mensagem enviada  "));
  const newer = value(await save("Próximo assunto", sending.revision));
  const clear = await service().clear(scope(), {
    expectedRevision: sending.revision,
    expectedText: "Mensagem enviada  ",
  });
  expect(clear).toEqual({ ok: false, code: "draft_conflict", current: newer });
  expect(value(await service().load(scope()))).toEqual(newer);
  expect(
    await service().clear(scope(), {
      expectedRevision: newer.revision,
      expectedText: "Outro texto",
    }),
  ).toEqual({ ok: false, code: "draft_conflict", current: newer });
  const cleared = value(
    await service().clear(scope(), {
      expectedRevision: newer.revision,
      expectedText: "Próximo assunto",
    }),
  );
  expect(cleared.draft).toBeNull();
  expect(cleared.revision).not.toBe(newer.revision);
  expect(await save("ABA de aba antiga", null)).toEqual({
    ok: false,
    code: "draft_conflict",
    current: cleared,
  });
});

it("empty saves erase content through CAS, retain the tombstone, and never touch send/AI state", async () => {
  const first = value(await save("Apagar")),
    empty = value(await save("", first.revision));
  expect(empty.draft).toBeNull();
  const [row] = await rows();
  expect(row!["payload"]).toBeNull();
  expect(row!["text_hash"]).toBeNull();
  expect(row!["expires_at"]).toBeNull();
  expect(
    await service().clear(scope(), { expectedRevision: empty.revision, expectedText: "" }),
  ).toEqual({ ok: true, data: empty });
  const [counts] =
    await db.sql`select (select count(*)::int from commercial_agent_drafts) ai,(select count(*)::int from commercial_agent_manual_dispatches) sends,(select count(*)::int from commercial_agent_sessions) sessions`;
  expect(counts).toEqual({ ai: 0, sends: 0, sessions: 0 });
});

it("load expires and physically blanks payload opportunistically; stale revision cannot resurrect it", async () => {
  const first = value(await save("Expirado"));
  await db.sql`update attendance_drafts set updated_at=now()-interval '8 days',expires_at=now()-interval '1 day'`;
  const expired = value(await service().load(scope()));
  expect(expired.draft).toBeNull();
  expect(expired.revision).not.toBe(first.revision);
  expect((await rows())[0]!["payload"]).toBeNull();
  expect(await save("Repetição antiga", first.revision)).toEqual({
    ok: false,
    code: "draft_conflict",
    current: expired,
  });
  expect(value(await save("Novo", expired.revision)).draft?.text).toBe("Novo");
});

it("explicit maintenance purges expired cold scopes without deleting newer drafts", async () => {
  await save("Expira");
  await save("Ainda ativo", null, scope(SECOND));
  await db.sql`update attendance_drafts set updated_at=now()-interval '8 days',expires_at=now()-interval '1 day' where user_id=${ACTOR}`;
  const [purge] = await db.sql`select attendance_draft_purge_expired() as count`;
  expect(purge?.["count"]).toBe(1);
  expect(value(await service().load(scope(SECOND))).draft?.text).toBe("Ainda ativo");
  expect(value(await service().load(scope())).draft).toBeNull();
});

it("corrupt/missing encryption never acknowledges save and does not alter existing state", async () => {
  const saved = value(await save("Preservado"));
  expect(
    await service("").save(scope(), { expectedRevision: saved.revision, text: "Local" }),
  ).toEqual({ ok: false, code: "draft_unavailable" });
  expect(value(await service().load(scope()))).toEqual(saved);
  expect(await service(Buffer.alloc(32, 8).toString("base64")).load(scope())).toEqual({
    ok: false,
    code: "draft_unavailable",
  });
});

it("anonymous and authenticated clients cannot read table or execute its service RPCs", async () => {
  await save("Privado");
  const connection = await db.sql.reserve();
  try {
    for (const role of ["anon", "authenticated"]) {
      for (const query of [
        "select * from public.attendance_drafts",
        "select public.attendance_draft_purge_expired()",
        `select public.attendance_draft_command('load','${ORG}','${ACTOR}','loc-test','contact-fictional','conversation-fictional','{}')`,
        `select public.attendance_draft_load_reconciled('load','${ORG}','${ACTOR}','loc-test','contact-fictional','conversation-fictional','{}')`,
        `select public.attendance_draft_bind_dispatch('${ORG}','${ACTOR}','loc-test','contact-fictional','conversation-fictional',null,null,null,null)`,
      ]) {
        await connection`begin`;
        await connection.unsafe(`set local role ${role}`);
        await expect(connection.unsafe(query)).rejects.toMatchObject({ code: "42501" });
        await connection`rollback`;
      }
    }
  } finally {
    await connection`rollback`.catch(() => {});
    connection.release();
  }
});
