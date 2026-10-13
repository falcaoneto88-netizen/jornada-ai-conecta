/** All real migrations in ephemeral PostgreSQL; synthetic identities only, no provider calls. */
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { startCommercialDb } from "../../test/commercial-agent-db";
import { AttendanceContextService, type AttendanceRpc } from "./attendance-context.server";
import type {
  AttendanceContext,
  AttendanceResult,
  AttendanceSaveInput,
} from "./attendance-context.core";

const ORG = "11111111-1111-4111-8111-111111111111",
  OTHER = "22222222-2222-4222-8222-222222222222",
  ACTOR = "33333333-3333-4333-8333-333333333333",
  SECOND = "44444444-4444-4444-8444-444444444444",
  VIEWER = "55555555-5555-4555-8555-555555555555",
  FOREIGN = "66666666-6666-4666-8666-666666666666",
  CONTACT = "77777777-7777-4777-8777-777777777777",
  CONTACT_B = "88888888-8888-4888-8888-888888888888";
let db: Awaited<ReturnType<typeof startCommercialDb>>;
const quote = (value: string) => "'" + value.replace(/'/g, "''") + "'";
const unwrap = (r: AttendanceResult): AttendanceContext => {
  if (!r.ok) throw new Error(r.code);
  return r.data;
};
const sqlCommand = (
  op: string,
  org: string,
  actor: string,
  data: unknown = {},
  contact = "contact-test",
) =>
  `select attendance_context_command(${quote(op)},${quote(org)}::uuid,${quote(actor)}::uuid,${quote(contact)},${quote(JSON.stringify(data))}::jsonb) as value`;
async function asRole(actor: string | null, statement: string) {
  return db.sql.begin(async (tx) => {
    if (actor) await tx.unsafe(`set local "request.jwt.claim.sub"=${quote(actor)}`);
    await tx.unsafe(`set local role ${actor ? "authenticated" : "service_role"}`);
    return tx.unsafe(statement);
  });
}
const call = async (
  op: string,
  data: unknown = {},
  actor = ACTOR,
  org = ORG,
  contact = "contact-test",
) => (await asRole(null, sqlCommand(op, org, actor, data, contact)))[0]?.["value"];
const scope = { organizationId: ORG, ghlContactId: "contact-test", actorId: ACTOR };
const input = (patch: Partial<AttendanceSaveInput> = {}): AttendanceSaveInput => ({
  organizationId: ORG,
  ghlContactId: "contact-test",
  expectedTimezone: "Europe/Lisbon",
  expectedVersion: 0,
  ownerId: SECOND,
  returnAction: "set",
  returnText: "Retorno interno fictício",
  dueLocal: "2026-10-13T14:00",
  ...patch,
});
const rpc: AttendanceRpc = {
  async rpc(name, args) {
    expect(name).toBe("attendance_context_command");
    try {
      const result = await asRole(
        null,
        sqlCommand(
          String(args["_op"]),
          String(args["_org"]),
          String(args["_actor"]),
          args["_data"],
          String(args["_contact"]),
        ),
      );
      return { data: result[0]?.["value"], error: null };
    } catch (error) {
      return { data: null, error };
    }
  },
};
const service = () => new AttendanceContextService(rpc);

beforeAll(async () => {
  db = await startCommercialDb();
  // Replace only this helper's freshly created ephemeral fixture with the project's real schema.
  await db.sql
    .unsafe(`drop schema public cascade; drop schema auth cascade; create schema public; create schema auth;
    create table auth.users(id uuid primary key default gen_random_uuid(),email text,raw_user_meta_data jsonb not null default '{}',created_at timestamptz not null default now());
    create function auth.uid() returns uuid language sql stable as $fn$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $fn$;
    grant usage on schema public,auth to anon,authenticated,service_role;`);
  const connection = await db.sql.reserve();
  try {
    let first = true;
    for (const filename of readdirSync("supabase/migrations").sort()) {
      await connection.unsafe(readFileSync(`supabase/migrations/${filename}`, "utf8"));
      if (first) {
        await connection.unsafe(
          "insert into organizations(id,name) values('f07ab3be-7419-4779-a901-ef71c5fc27f0','Marcador sintético')",
        );
        first = false;
      }
    }
  } finally {
    connection.release();
  }
  await db.sql.unsafe(`
    insert into organizations(id,name,timezone) values('${ORG}','Teste A','Europe/Lisbon'),('${OTHER}','Teste B','America/Bahia');
    alter table auth.users disable trigger on_auth_user_created;
    insert into auth.users(id,email) values('${ACTOR}','actor@example.test'),('${SECOND}','second@example.test'),('${VIEWER}','viewer@example.test'),('${FOREIGN}','foreign@example.test');
    alter table auth.users enable trigger on_auth_user_created;
    insert into profiles(id,organization_id,full_name) values('${ACTOR}','${ORG}','Operador A'),('${SECOND}','${ORG}','Operador B'),('${VIEWER}','${ORG}','Leitor'),('${FOREIGN}','${OTHER}','Outro tenant');
    insert into user_roles(user_id,organization_id,role) values('${ACTOR}','${ORG}','comercial'),('${SECOND}','${ORG}','gestor'),('${VIEWER}','${ORG}','visualizador'),('${FOREIGN}','${OTHER}','administrador');
    insert into journey_stages(organization_id,key,name) values('${ORG}','novo_lead','Novo lead'),('${OTHER}','novo_lead','Outro lead');
    insert into ghl_location_bindings(organization_id,location_id) values('${ORG}','test-location');
    insert into ghl_connections(organization_id,status) values('${ORG}','conectada');
  `);
}, 120000);
afterAll(async () => db?.stop());
beforeEach(async () => {
  await db.sql.unsafe(`delete from appointments where organization_id in ('${ORG}','${OTHER}');
    delete from contacts where organization_id in ('${ORG}','${OTHER}');
    delete from audit_logs where organization_id in ('${ORG}','${OTHER}');
    insert into contacts(id,organization_id,ghl_contact_id,full_name,notes) values
      ('${CONTACT}','${ORG}','contact-test','Mesmo nome','NOTA CLÍNICA NÃO EXPORTAR'),
      ('${CONTACT_B}','${OTHER}','contact-test','Mesmo nome','OUTRA NOTA CLÍNICA');
    insert into appointments(organization_id,contact_id,title,start_at,status,notes) values
      ('${ORG}','${CONTACT}','Cancelada','2099-01-01T09:00:00Z','cancelada','NOTA AGENDA'),
      ('${ORG}','${CONTACT}','Próxima consulta','2099-01-02T09:00:00Z','confirmada','NOTA AGENDA'),
      ('${OTHER}','${CONTACT_B}','Outra consulta','2099-01-01T08:00:00Z','confirmada','NOTA ESTRANGEIRA');`);
});

it("reads exact tenant/contact, filters team/appointment and never returns clinical notes", async () => {
  const result = unwrap(await service().read(scope));
  expect(result.contact.id).toBe(CONTACT);
  expect(result.nextAppointment?.title).toBe("Próxima consulta");
  expect(result.team.map((p) => p.id).sort()).toEqual([ACTOR, SECOND].sort());
  expect(result.timezone).toBe("Europe/Lisbon");
  expect(result.stage?.name).toBe("Novo lead");
  expect(JSON.stringify(result)).not.toMatch(/NOTA|Outro tenant/);
  expect((await call("read", {}, FOREIGN, OTHER)).contact.id).toBe(CONTACT_B);
  expect(await call("read", {}, ACTOR, OTHER)).toEqual({ error: "forbidden" });
});

it("missing exact CRM ID does not create a contact; viewers read but cannot write", async () => {
  expect(await service().read({ ...scope, ghlContactId: "missing" })).toMatchObject({
    ok: false,
    code: "contact_not_synced",
  });
  expect(
    (await db.sql`select count(*) from contacts where organization_id=${ORG}`)[0]?.["count"],
  ).toBe("1");
  expect((await call("read", {}, VIEWER)).canEdit).toBe(false);
  expect(await call("save", {}, VIEWER)).toEqual({ error: "forbidden" });
});

it("the next future booked appointment matches Meu dia while past and canceled appointments stay excluded", async () => {
  const [booked] =
    await db.sql`insert into appointments(organization_id,contact_id,title,start_at,status)
    values(${ORG},${CONTACT},'Bookmarked future fixture','2099-01-01T10:00:00Z','booked') returning id`;
  await db.sql`insert into appointments(organization_id,contact_id,title,start_at,status)
    values(${ORG},${CONTACT},'Past booked fixture','2020-01-01T10:00:00Z','booked')`;
  const context = unwrap(await service().read(scope));
  expect(context.nextAppointment).toMatchObject({ id: booked!["id"], status: "booked" });
  const [workspace] = await db.sql`select attendance_workspace_read(${ORG}::uuid,${ACTOR}::uuid,
    'all','appointments_today',0,25,'2099-01-01T08:00:00Z'::timestamptz) as value`;
  expect(workspace!["value"].counts.appointmentsToday).toBe(1);
  expect(workspace!["value"].rows[0].appointment.id).toBe(context.nextAppointment!.id);
  await db.sql`update appointments set status='cancelada' where id=${String(booked!["id"])}::uuid`;
  expect(unwrap(await service().read(scope)).nextAppointment?.title).toBe("Próxima consulta");
});

it("persists one local return with explicit owner, UTC deadline, CAS and trusted content-free audit", async () => {
  const saved = unwrap(await service().save(scope, input()));
  expect(saved.attendance).toMatchObject({
    version: 1,
    ownerId: SECOND,
    nextAction: input().returnText,
  });
  expect(Date.parse(saved.attendance.nextActionAt!)).toBe(Date.parse("2026-10-13T13:00:00Z"));
  expect(unwrap(await service().read(scope)).attendance).toEqual(saved.attendance);
  const [audit] = await db.sql`select * from audit_logs where action='attendance.set'`;
  expect(audit?.["verified"]).toBe(true);
  expect(audit?.["actor_id"]).toBe(ACTOR);
  expect(JSON.stringify(audit)).not.toContain(input().returnText);
  expect(await service().save(scope, input())).toMatchObject({ ok: false, code: "conflict" });
  expect(
    (await db.sql`select count(*) from audit_logs where action like 'attendance.%'`)[0]?.["count"],
  ).toBe("1");
});

it("rejects foreign/viewer assignees, foreign callers and organization time-zone races", async () => {
  for (const ownerId of [FOREIGN, VIEWER])
    expect(await service().save(scope, input({ ownerId }))).toMatchObject({
      ok: false,
      code: "invalid_input",
    });
  expect(await service().save(scope, input({ expectedTimezone: "UTC" }))).toMatchObject({
    ok: false,
    code: "conflict",
  });
  expect(
    await call("save", {
      expectedVersion: 0,
      ownerId: null,
      returnAction: "keep",
      timezone: "UTC",
    }),
  ).toEqual({ error: "conflict" });
  expect(await call("save", {}, FOREIGN)).toEqual({ error: "forbidden" });
  expect(unwrap(await service().read(scope)).attendance.version).toBe(0);
});

it("preserves the UTC deadline on assignment-only changes, completes and clears explicitly", async () => {
  const first = unwrap(await service().save(scope, input()));
  const command = (
    expectedVersion: number,
    returnAction: "keep" | "complete" | "clear",
    ownerId = ACTOR,
  ): AttendanceSaveInput => ({
    organizationId: ORG,
    ghlContactId: scope.ghlContactId,
    expectedTimezone: "Europe/Lisbon",
    expectedVersion,
    ownerId,
    returnAction,
  });
  const changed = unwrap(await service().save(scope, command(1, "keep")));
  expect(changed.attendance.nextActionAt).toBe(first.attendance.nextActionAt);
  const completed = unwrap(await service().save(scope, command(2, "complete")));
  expect(completed.attendance).toEqual({
    version: 3,
    ownerId: ACTOR,
    nextAction: null,
    nextActionAt: null,
  });
  unwrap(await service().save(scope, input({ expectedVersion: 3 })));
  unwrap(await service().save(scope, command(4, "clear", SECOND)));
  expect(
    (
      await db.sql`select count(*) from audit_logs where action in ('attendance.complete','attendance.clear') and verified`
    )[0]?.["count"],
  ).toBe("2");
});

it("serializes two different operators saving the same revision", async () => {
  const data = {
    expectedVersion: 0,
    ownerId: SECOND,
    returnAction: "set",
    returnText: "A",
    dueAt: "2026-10-13T13:00:00.000Z",
    timezone: "Europe/Lisbon",
  };
  const results = await Promise.all([
    call("save", data, ACTOR),
    call("save", { ...data, returnText: "B" }, SECOND),
  ]);
  expect(results.filter((r) => r.error === "conflict")).toHaveLength(1);
  expect(results.filter((r) => r.attendance?.version === 1)).toHaveLength(1);
  expect(
    (await db.sql`select count(*) from audit_logs where action='attendance.set'`)[0]?.["count"],
  ).toBe("1");
});

it("blocks arbitrary authenticated fields and direct RPC without weakening existing RLS", async () => {
  for (const change of [
    `attendance_owner_id='${SECOND}'`,
    "attendance_version=10",
    "next_action='Bypass'",
    "next_action_at=now()",
  ])
    await expect(
      asRole(ACTOR, `update contacts set ${change} where id='${CONTACT}'`),
    ).rejects.toThrow();
  await expect(asRole(ACTOR, sqlCommand("save", ORG, ACTOR))).rejects.toThrow();
  await expect(
    asRole(
      ACTOR,
      `insert into contacts(organization_id,full_name,attendance_owner_id) values('${ORG}','Bypass','${SECOND}')`,
    ),
  ).rejects.toThrow();
  await asRole(
    ACTOR,
    `update contacts set full_name='Atualização permitida' where id='${CONTACT}'`,
  );
  expect(
    (await asRole(FOREIGN, `select count(*) from contacts where id='${CONTACT}'`))[0]?.["count"],
  ).toBe("0");
  await asRole(VIEWER, `update contacts set full_name='Sem permissão' where id='${CONTACT}'`);
  expect((await call("read")).contact.name).toBe("Atualização permitida");
  await expect(
    asRole(
      null,
      `insert into contacts(organization_id,full_name,attendance_owner_id) values('${ORG}','Foreign assignment','${FOREIGN}')`,
    ),
  ).rejects.toThrow();
});

it("rejects null commands/payloads and keeps unchanged submissions free of duplicate audit events", async () => {
  const invalid = await asRole(
    null,
    `select attendance_context_command('save','${ORG}','${ACTOR}','contact-test',null) as value`,
  );
  expect(invalid[0]?.["value"]).toEqual({ error: "invalid_input" });
  const data = {
    expectedVersion: 0,
    ownerId: null,
    returnAction: "keep",
    timezone: "Europe/Lisbon",
  };
  await call("save", data);
  await call("save", data);
  expect((await call("read")).attendance.version).toBe(0);
  expect(
    (await db.sql`select count(*) from audit_logs where action like 'attendance.%'`)[0]?.["count"],
  ).toBe("0");
});

it("actual contact snapshot RPC retains local assignment, return and revision", async () => {
  const saved = unwrap(await service().save(scope, input()));
  await db.sql`insert into user_roles(user_id,organization_id,role) values(${ACTOR},${ORG},'administrador') on conflict do nothing`;
  const snapshot = {
    id: "contact-test",
    locationId: "test-location",
    dateUpdated: "2098-10-13T10:00:00Z",
    firstName: "Nome",
    lastName: "sincronizado",
    phone: null,
    email: null,
    tags: [],
  };
  const rows = await asRole(
    null,
    `select ghl_apply_contact_snapshot('${ORG}','test-location','${ACTOR}',${quote(JSON.stringify(snapshot))}::jsonb) as value`,
  );
  expect(rows[0]?.["value"]).toEqual({ estado: "aplicado" });
  expect(unwrap(await service().read(scope)).attendance).toEqual(saved.attendance);
});
