/** Real migrations in ephemeral PostgreSQL; synthetic appointments only, no provider calls. */
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { startCommercialDb } from "../../test/commercial-agent-db";

const ORG = "11111111-1111-4111-8111-111111111111",
  OTHER = "22222222-2222-4222-8222-222222222222",
  ACTOR = "33333333-3333-4333-8333-333333333333",
  MANAGER = "44444444-4444-4444-8444-444444444444",
  VIEWER = "55555555-5555-4555-8555-555555555555",
  FOREIGN = "66666666-6666-4666-8666-666666666666",
  ADMIN = "99999999-9999-4999-8999-999999999999",
  ROLE_WITHOUT_PROFILE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  CONTACT = "77777777-7777-4777-8777-777777777777",
  CONTACT_B = "88888888-8888-4888-8888-888888888888",
  APPOINTMENT = "a1111111-1111-4111-8111-111111111111",
  APPOINTMENT_B = "a2222222-2222-4222-8222-222222222222",
  APPOINTMENT_C = "a4444444-4444-4444-8444-444444444444",
  MISSING = "a3333333-3333-4333-8333-333333333333";

let db: Awaited<ReturnType<typeof startCommercialDb>>;
const quote = (value: string) => "'" + value.replace(/'/g, "''") + "'";
const statement = (op: string, org: string, actor: string, data: unknown) =>
  `select public.appointment_finance_command(${quote(op)},${quote(org)}::uuid,${quote(actor)}::uuid,${quote(JSON.stringify(data))}::jsonb) as value`;

async function asRole(actor: string | null, sql: string) {
  return db.sql.begin(async (tx) => {
    if (actor) await tx.unsafe(`set local "request.jwt.claim.sub"=${quote(actor)}`);
    await tx.unsafe(`set local role ${actor ? "authenticated" : "service_role"}`);
    return tx.unsafe(sql);
  });
}

const call = async (op: string, data: unknown, actor = ACTOR, org = ORG) =>
  (await asRole(null, statement(op, org, actor, data)))[0]?.["value"];
const read = (appointmentIds = [APPOINTMENT], actor = ACTOR, org = ORG) =>
  call("read", { appointmentIds }, actor, org);
const input = (patch: Record<string, unknown> = {}) => ({
  appointmentId: APPOINTMENT,
  totalCents: 12000,
  depositCents: 3500,
  expectedRevision: 0,
  requestId: randomUUID(),
  ...patch,
});
const count = async (table: string) =>
  (
    await db.sql.unsafe(
      `select count(*) from public.${table}${
        table === "audit_logs"
          ? ` where action='appointment.finance.saved' and organization_id in ('${ORG}','${OTHER}')`
          : ""
      }`,
    )
  )[0]?.["count"];

beforeAll(async () => {
  db = await startCommercialDb();
  // Replace only this helper's isolated fixture with the complete project's schema.
  await db.sql.unsafe(`
    drop schema public cascade; drop schema auth cascade;
    create schema public; create schema auth;
    create table auth.users(id uuid primary key default gen_random_uuid(),email text,raw_user_meta_data jsonb not null default '{}',created_at timestamptz not null default now());
    create function auth.uid() returns uuid language sql stable as $fn$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $fn$;
    grant usage on schema public,auth to anon,authenticated,service_role;
  `);
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
    insert into organizations(id,name,timezone) values('${ORG}','Teste financeiro A','Europe/Lisbon'),('${OTHER}','Teste financeiro B','America/Bahia');
    alter table auth.users disable trigger on_auth_user_created;
    insert into auth.users(id,email) values
      ('${ACTOR}','actor@example.test'),('${MANAGER}','manager@example.test'),
      ('${VIEWER}','viewer@example.test'),('${FOREIGN}','foreign@example.test'),
      ('${ADMIN}','admin@example.test'),('${ROLE_WITHOUT_PROFILE}','no-profile@example.test');
    alter table auth.users enable trigger on_auth_user_created;
    insert into profiles(id,organization_id,full_name) values
      ('${ACTOR}','${ORG}','Operador sintético'),('${MANAGER}','${ORG}','Gestor sintético'),
      ('${VIEWER}','${ORG}','Leitor sintético'),('${FOREIGN}','${OTHER}','Outro tenant'),
      ('${ADMIN}','${ORG}','Administrador sintético');
    insert into user_roles(user_id,organization_id,role) values
      ('${ACTOR}','${ORG}','comercial'),('${MANAGER}','${ORG}','gestor'),
      ('${VIEWER}','${ORG}','visualizador'),('${FOREIGN}','${OTHER}','administrador'),
      ('${ADMIN}','${ORG}','administrador'),('${ROLE_WITHOUT_PROFILE}','${ORG}','administrador');
  `);
}, 120000);

afterAll(async () => db?.stop());

beforeEach(async () => {
  await db.sql.unsafe(`
    delete from appointment_finance_requests;
    delete from appointment_finances;
    delete from appointments where organization_id in ('${ORG}','${OTHER}');
    delete from contacts where organization_id in ('${ORG}','${OTHER}');
    delete from audit_logs where organization_id in ('${ORG}','${OTHER}');
    insert into ghl_location_bindings(organization_id,location_id) values
      ('${ORG}','finance-test-location'),('${OTHER}','finance-other-location')
      on conflict (location_id) do nothing;
    insert into contacts(id,organization_id,ghl_contact_id,full_name,notes,ghl_synced_at,is_demo) values
      ('${CONTACT}','${ORG}','finance-contact','Mesmo nome','NOTA CLÍNICA PRIVADA A',now(),false),
      ('${CONTACT_B}','${OTHER}','finance-other-contact','Mesmo nome','NOTA CLÍNICA PRIVADA B',now(),false);
    insert into appointments(id,organization_id,contact_id,ghl_appointment_id,ghl_calendar_id,title,start_at,status,notes,is_demo) values
      ('${APPOINTMENT}','${ORG}','${CONTACT}','finance-appointment','finance-calendar','Consulta sintética A','2099-01-02T09:00:00Z','confirmada','NOTA AGENDA PRIVADA A',false),
      ('${APPOINTMENT_C}','${ORG}','${CONTACT}','finance-appointment-c','finance-calendar','Consulta sintética C','2099-01-03T09:00:00Z','confirmada','NOTA AGENDA PRIVADA C',false),
      ('${APPOINTMENT_B}','${OTHER}','${CONTACT_B}','finance-other-appointment','finance-other-calendar','Consulta sintética B','2099-01-02T09:00:00Z','confirmada','NOTA AGENDA PRIVADA B',false);
  `);
});

it("reads an empty ledger without inventing a zero-value financial entry", async () => {
  expect(await read()).toEqual({ available: true, entries: [], canEdit: true });
  expect(await read([])).toEqual({ available: true, entries: [], canEdit: true });
  expect(await count("appointment_finances")).toBe("0");
  expect(await count("appointment_finance_requests")).toBe("0");
});

it("persists integer cents, currency, actor and revision with a verified content-free audit", async () => {
  const data = input();
  const saved = await call("save", data);
  expect(saved.entry).toEqual({
    appointmentId: APPOINTMENT,
    totalCents: 12000,
    depositCents: 3500,
    currency: "EUR",
    revision: 1,
    updatedAt: expect.any(String),
    updatedBy: ACTOR,
  });
  expect(Number.isNaN(Date.parse(saved.entry.updatedAt))).toBe(false);
  expect(await read()).toEqual({ available: true, entries: [saved.entry], canEdit: true });
  expect(await count("appointment_finances")).toBe("1");
  expect(await count("appointment_finance_requests")).toBe("1");
  const [audit] = await db.sql`select * from audit_logs where action='appointment.finance.saved'`;
  expect(audit).toMatchObject({
    organization_id: ORG,
    actor_id: ACTOR,
    entity: "appointment_finances",
    verified: true,
  });
  expect(JSON.stringify(audit?.["metadata"])).not.toMatch(/12000|3500|NOTA|CLÍNICA|PRIVADA/);
  expect(JSON.stringify(saved)).not.toMatch(/NOTA|CLÍNICA|PRIVADA|Mesmo nome/);
});

it("allows administrators, managers and commercial staff through the scoped RPC", async () => {
  for (const [revision, actor] of [ACTOR, MANAGER, ADMIN].entries()) {
    const saved = await call("save", input({ expectedRevision: revision }), actor);
    expect(saved.entry).toMatchObject({ revision: revision + 1, updatedBy: actor });
    expect((await read([APPOINTMENT], actor)).entries).toEqual([saved.entry]);
  }
});

it("requires both membership and an allowed role for reads and writes", async () => {
  for (const actor of [VIEWER, FOREIGN, ROLE_WITHOUT_PROFILE, MISSING]) {
    expect(await read([APPOINTMENT], actor)).toEqual({ error: "forbidden" });
    expect(await call("save", input(), actor)).toEqual({ error: "forbidden" });
  }
  expect(await read([APPOINTMENT], ACTOR, OTHER)).toEqual({ error: "forbidden" });
  expect(await call("save", input(), ACTOR, OTHER)).toEqual({ error: "forbidden" });
  expect(await count("appointment_finances")).toBe("0");
});

it("does not return foreign records and refuses a foreign or nonexistent appointment", async () => {
  const own = await call("save", input());
  await call("save", input({ appointmentId: APPOINTMENT_B }), FOREIGN, OTHER);
  expect((await read([APPOINTMENT, APPOINTMENT_B])).entries).toEqual([own.entry]);
  for (const appointmentId of [APPOINTMENT_B, MISSING]) {
    expect(await call("save", input({ appointmentId }))).toEqual({
      error: "appointment_not_found",
    });
  }
  expect(await count("appointment_finances")).toBe("2");
});

it("rejects appointments without verified GHL/contact ownership or a location binding", async () => {
  const invalidParents = [
    ["appointments", "is_demo=true", "is_demo=false"],
    ["appointments", "ghl_appointment_id=null", "ghl_appointment_id='finance-appointment'"],
    ["appointments", "ghl_calendar_id=null", "ghl_calendar_id='finance-calendar'"],
    ["appointments", "contact_id=null", `contact_id='${CONTACT}'`],
    ["contacts", "is_demo=true", "is_demo=false"],
    ["contacts", "ghl_contact_id=null", "ghl_contact_id='finance-contact'"],
  ];
  for (const [table, change, restore] of invalidParents) {
    const id = table === "contacts" ? CONTACT : APPOINTMENT;
    await db.sql.unsafe(`update ${table} set ${change} where id='${id}'`);
    expect(await call("save", input()), `${table}: ${change}`).toEqual({
      error: "appointment_not_found",
    });
    await db.sql.unsafe(`update ${table} set ${restore} where id='${id}'`);
  }
  await db.sql`delete from ghl_location_bindings where organization_id=${ORG}`;
  expect(await call("save", input())).toEqual({ error: "forbidden" });
  expect(await count("appointment_finances")).toBe("0");
});

it("rejects malformed commands and numeric inputs without persisting any ledger entry", async () => {
  const invalidInputs = [
    ...[-1, 1.5, "12000", null, true, 1e30].map((totalCents) => ({ totalCents })),
    ...[-1, 1.5, "3500", null, true, 12001].map((depositCents) => ({ depositCents })),
    ...[-1, 1.5, "0", null, true].map((expectedRevision) => ({ expectedRevision })),
    { appointmentId: "not-a-uuid" },
    { appointmentId: null },
    { requestId: "not-a-uuid" },
    { requestId: null },
  ];
  for (const patch of invalidInputs)
    expect(await call("save", input(patch)), JSON.stringify(patch)).toEqual({
      error: "invalid_input",
    });
  for (const data of [null, [], "invalid", {}])
    expect(await call("save", data)).toEqual({ error: "invalid_input" });
  expect(await call("delete", input())).toEqual({ error: "invalid_input" });
  expect(await count("appointment_finances")).toBe("0");
  expect(await count("appointment_finance_requests")).toBe("0");
});

it("accepts a deliberately recorded zero total without confusing it with missing data", async () => {
  const saved = await call("save", input({ totalCents: 0, depositCents: 0 }));
  expect(saved.entry).toMatchObject({ totalCents: 0, depositCents: 0, revision: 1 });
  expect((await read()).entries).toEqual([saved.entry]);
});

it("rejects stale revisions and persists exactly one winner under concurrent saves", async () => {
  const results = await Promise.all([
    call("save", input({ totalCents: 13000 }), ACTOR),
    call("save", input({ totalCents: 14000 }), MANAGER),
  ]);
  const winner = results.find((result) => result.entry);
  expect(results.filter((result) => result.error === "conflict")).toHaveLength(1);
  expect(results.filter((result) => result.entry?.revision === 1)).toHaveLength(1);
  expect((await read()).entries).toEqual([winner.entry]);
  expect(await call("save", input())).toEqual({ error: "conflict" });
  expect(await count("appointment_finances")).toBe("1");
  expect(await count("appointment_finance_requests")).toBe("1");
  expect(await count("audit_logs")).toBe("1");
});

it("deduplicates simultaneous retries of the same request with a single audit event", async () => {
  const data = input();
  const [first, retry] = await Promise.all([call("save", data), call("save", data)]);
  expect(first.entry?.revision).toBe(1);
  expect(retry).toEqual(first);
  expect(await count("appointment_finances")).toBe("1");
  expect(await count("appointment_finance_requests")).toBe("1");
  expect(await count("audit_logs")).toBe("1");
});

it("replays the original result even after a later update without reverting current values", async () => {
  const firstInput = input();
  const first = await call("save", firstInput);
  const changed = await call(
    "save",
    input({ totalCents: 15000, depositCents: 4000, expectedRevision: 1 }),
    MANAGER,
  );
  expect(changed.entry).toMatchObject({ totalCents: 15000, revision: 2, updatedBy: MANAGER });
  expect(await call("save", firstInput)).toEqual(first);
  expect((await read()).entries).toEqual([changed.entry]);
  expect(await count("appointment_finance_requests")).toBe("2");
  expect(await count("audit_logs")).toBe("2");
});

it("refuses request-ID reuse with different data or a different actor", async () => {
  const data = input();
  const first = await call("save", data);
  for (const patch of [
    { totalCents: 12500 },
    { depositCents: 4000 },
    { expectedRevision: 1 },
    { appointmentId: APPOINTMENT_C },
  ])
    expect(await call("save", { ...data, ...patch })).toEqual({ error: "request_mismatch" });
  expect(await call("save", data, MANAGER)).toEqual({ error: "request_mismatch" });
  expect((await read()).entries).toEqual([first.entry]);
  expect(await count("appointment_finance_requests")).toBe("1");
  expect(await count("audit_logs")).toBe("1");
});

it("scopes the idempotency ledger by organization", async () => {
  const data = input();
  const own = await call("save", data);
  const other = await call(
    "save",
    { ...data, appointmentId: APPOINTMENT_B, totalCents: 25000 },
    FOREIGN,
    OTHER,
  );
  expect(other.entry).toMatchObject({ appointmentId: APPOINTMENT_B, totalCents: 25000 });
  expect((await read()).entries).toEqual([own.entry]);
  expect((await read([APPOINTMENT_B], FOREIGN, OTHER)).entries).toEqual([other.entry]);
  expect(await count("appointment_finance_requests")).toBe("2");
});

it("denies direct writes and RPC execution while restricting authenticated reads by tenant and role", async () => {
  await call("save", input());
  const directSql = [
    `update appointment_finances set total_cents=1 where appointment_id='${APPOINTMENT}'`,
    `delete from appointment_finances where appointment_id='${APPOINTMENT}'`,
    "insert into appointment_finances default values",
    "select * from appointment_finance_requests",
    statement("save", ORG, ACTOR, input()),
    statement("read", ORG, ACTOR, { appointmentIds: [APPOINTMENT] }),
  ];
  for (const sql of directSql) await expect(asRole(ACTOR, sql)).rejects.toThrow();
  expect(await asRole(FOREIGN, "select * from appointment_finances")).toHaveLength(0);
  expect(await asRole(VIEWER, "select * from appointment_finances")).toHaveLength(0);
  expect(await asRole(ACTOR, "select * from appointment_finances")).toHaveLength(1);
  const [anonPrivileges] = await db.sql`select
    has_table_privilege('anon','public.appointment_finances','SELECT') as can_read,
    has_function_privilege('anon','public.appointment_finance_command(text,uuid,uuid,jsonb)','EXECUTE') as can_execute`;
  expect(anonPrivileges).toMatchObject({ can_read: false, can_execute: false });
});

it("hides existing financial entries once their appointment is no longer eligible", async () => {
  await call("save", input());
  await db.sql`update appointments set is_demo=true where id=${APPOINTMENT}`;
  expect((await read()).entries).toEqual([]);
  expect(await asRole(ACTOR, "select * from appointment_finances")).toHaveLength(0);
  expect(await call("save", input({ expectedRevision: 1 }))).toEqual({
    error: "appointment_not_found",
  });
});
