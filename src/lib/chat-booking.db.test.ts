/** Real project migrations in an isolated database, synthetic contacts, no GHL calls. */
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { startCommercialDb } from "../../test/commercial-agent-db";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ACTOR = "33333333-3333-4333-8333-333333333333";
const FOREIGN = "44444444-4444-4444-8444-444444444444";
const VIEWER = "55555555-5555-4555-8555-555555555555";
const COLLEAGUE = "66666666-6666-4666-8666-666666666666";
const CONTACT = "77777777-7777-4777-8777-777777777777";
const CONTACT_B = "88888888-8888-4888-8888-888888888888";
let db: Awaited<ReturnType<typeof startCommercialDb>>;
const quote = (v: string) => "'" + v.replace(/'/g, "''") + "'";
const sqlCommand = (op: string, org: string, actor: string, data: unknown) =>
  `select public.chat_booking_command(${quote(op)},${quote(org)}::uuid,${quote(actor)}::uuid,${quote(JSON.stringify(data))}::jsonb) as value`;
async function asRole(role: string, statement: string) {
  return db.sql.begin(async (tx) => {
    await tx.unsafe(`set local role ${role}`);
    return tx.unsafe(statement);
  });
}
const call = async (op: string, data: unknown, actor = ACTOR, org = ORG) =>
  (await asRole("service_role", sqlCommand(op, org, actor, data)))[0]?.["value"];
const input = (patch: Record<string, unknown> = {}) => ({
  requestId: randomUUID(),
  ghlContactId: "booking-contact",
  contactId: CONTACT,
  locationId: "booking-location",
  calendarId: "booking-calendar",
  calendarName: "Consulta inicial",
  timezone: "Europe/Lisbon",
  startAt: "2099-01-02T10:00:00.000Z",
  endAt: "2099-01-02T10:30:00.000Z",
  notify: false,
  dispatchId: randomUUID(),
  ...patch,
});
const identity = (data: ReturnType<typeof input>) => ({
  requestId: data.requestId,
  ghlContactId: data.ghlContactId,
});
const outcome = (data: ReturnType<typeof input>, patch: Record<string, unknown> = {}) => ({
  ...identity(data),
  dispatchId: data.dispatchId,
  ...patch,
});

beforeAll(async () => {
  db = await startCommercialDb();
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
    insert into organizations(id,name,timezone) values('${ORG}','Booking A','Europe/Lisbon'),('${OTHER}','Booking B','Europe/Lisbon');
    alter table auth.users disable trigger on_auth_user_created;
    insert into auth.users(id,email) values('${ACTOR}','actor@example.test'),('${FOREIGN}','foreign@example.test'),('${VIEWER}','viewer@example.test'),('${COLLEAGUE}','colleague@example.test');
    alter table auth.users enable trigger on_auth_user_created;
    insert into profiles(id,organization_id,full_name) values('${ACTOR}','${ORG}','Atendente sintético'),('${FOREIGN}','${OTHER}','Outro tenant'),('${VIEWER}','${ORG}','Leitor'),('${COLLEAGUE}','${ORG}','Gestor');
    insert into user_roles(user_id,organization_id,role) values('${ACTOR}','${ORG}','comercial'),('${FOREIGN}','${OTHER}','administrador'),('${VIEWER}','${ORG}','visualizador'),('${COLLEAGUE}','${ORG}','gestor');
    insert into ghl_location_bindings(organization_id,location_id) values('${ORG}','booking-location'),('${OTHER}','booking-other-location');
  `);
}, 120000);
afterAll(async () => db?.stop());
beforeEach(async () => {
  await db.sql.unsafe(`
    delete from chat_booking_requests;
    delete from chat_booking_abandoned_requests;
    delete from appointments where organization_id in ('${ORG}','${OTHER}');
    delete from contacts where organization_id in ('${ORG}','${OTHER}');
    delete from audit_logs where organization_id in ('${ORG}','${OTHER}');
    delete from ghl_connections where organization_id in ('${ORG}','${OTHER}');
    insert into ghl_connections(organization_id,location_id,calendar_id,status,write_enabled)
      values('${ORG}','booking-location','booking-calendar','conectada',true),('${OTHER}','booking-other-location','booking-other-calendar','conectada',true);
    insert into contacts(id,organization_id,ghl_contact_id,full_name,notes,is_demo)
      values('${CONTACT}','${ORG}','booking-contact','Nome sintético','NOTA CLÍNICA PRIVADA',false),('${CONTACT_B}','${OTHER}','booking-other-contact','Outro contato','NOTA PRIVADA B',false);
  `);
});

it("keeps Supabase and Drizzle copies identical", () => {
  expect(readFileSync("drizzle/migrations/0026_chat_booking_requests.sql", "utf8")).toBe(
    readFileSync("supabase/migrations/20261113150000_chat_booking_requests.sql", "utf8"),
  );
});
it("claims once before any provider write and returns only a minimal scoped receipt", async () => {
  const data = input();
  expect(await call("read", identity(data))).toEqual({ request: null });
  const claimed = await call("claim", data);
  expect(claimed.claimed).toBe(true);
  expect(claimed.request).toMatchObject({
    requestId: data.requestId,
    state: "pending",
    notify: false,
    appointmentId: null,
    cacheSynced: false,
  });
  expect(JSON.stringify(claimed)).not.toMatch(/NOTA|CLÍNICA|PRIVADA|Nome sintético/);
  expect(await call("read", identity(data))).toEqual({ request: claimed.request });
});
it("serializes concurrent retries of a request and ignores a replacement dispatch ID", async () => {
  const data = input();
  const results = await Promise.all([
    call("claim", data),
    call("claim", { ...data, dispatchId: randomUUID() }),
  ]);
  expect(results.filter((r) => r.claimed)).toHaveLength(1);
  expect(results[0].request.dispatchId).toBe(results[1].request.dispatchId);
  const retry = await call("claim", { ...data, dispatchId: randomUUID() });
  expect(retry.claimed).toBe(false);
  expect(retry.request).toEqual(results[0].request);
});

it("treats equivalent offset timestamps as the same immutable request", async () => {
  const data = input();
  const first = await call("claim", data);
  const retry = await call("claim", {
    ...data,
    startAt: "2099-01-02T11:00:00+01:00",
    endAt: "2099-01-02T11:30:00+01:00",
  });
  expect(retry).toEqual({ request: first.request, claimed: false });
});

it("does not erase a known remote ID when recording an uncertain result", async () => {
  const data = input();
  await call("claim", data);
  await call("ack", outcome(data, { appointmentId: "event-1" }));
  expect(
    (await call("finish", outcome(data, { state: "unknown", errorCode: "verification_failed" })))
      .request,
  ).toMatchObject({ state: "unknown", appointmentId: "event-1", cacheSynced: false });
});
it("blocks different request IDs for the same contact/calendar/instant, including unknown outcomes", async () => {
  const data = input();
  const results = await Promise.all([call("claim", data), call("claim", input())]);
  expect(results.filter((r) => r.claimed)).toHaveLength(1);
  expect(results.filter((r) => r.error === "duplicate_slot")).toHaveLength(1);
  const winner = results.find((r) => r.claimed).request;
  await call("finish", {
    requestId: winner.requestId,
    ghlContactId: winner.ghlContactId,
    dispatchId: winner.dispatchId,
    state: "unknown",
    errorCode: "outcome_unknown",
  });
  expect(await call("claim", input())).toEqual({ error: "duplicate_slot" });
});
it("refuses changed immutable input and actor/contact replay", async () => {
  const data = input();
  await call("claim", data);
  for (const patch of [
    { notify: true },
    { endAt: "2099-01-02T11:00:00.000Z" },
    { calendarName: "Outro" },
  ])
    expect(await call("claim", { ...data, ...patch })).toEqual({ error: "request_mismatch" });
  expect(await call("read", identity(data), COLLEAGUE)).toEqual({ error: "request_mismatch" });
  expect(await call("read", { ...identity(data), ghlContactId: "other" })).toEqual({
    error: "request_mismatch",
  });
});
it("enforces organization membership and read/write roles", async () => {
  for (const actor of [FOREIGN, VIEWER, randomUUID()]) {
    expect(await call("claim", input(), actor)).toEqual({ error: "forbidden" });
    expect(await call("read", identity(input()), actor)).toEqual({ error: "forbidden" });
  }
  expect(await call("claim", input(), ACTOR, OTHER)).toEqual({ error: "forbidden" });
});
it("refuses foreign/demo/unmapped contacts and disabled writes", async () => {
  expect(await call("claim", input({ contactId: CONTACT_B }))).toEqual({
    error: "contact_not_found",
  });
  expect(await call("claim", input({ ghlContactId: "unknown" }))).toEqual({
    error: "contact_not_found",
  });
  await db.sql`update contacts set is_demo=true where id=${CONTACT}`;
  expect(await call("claim", input())).toEqual({ error: "contact_not_found" });
  await db.sql`update contacts set is_demo=false where id=${CONTACT}`;
  await db.sql`update ghl_connections set write_enabled=false where organization_id=${ORG}`;
  expect(await call("claim", input())).toEqual({ error: "write_disabled" });
});
it("checks the configured binding, calendar, timezone and connection status", async () => {
  for (const patch of [{ locationId: "other" }, { calendarId: "other" }, { timezone: "UTC" }])
    expect(await call("claim", input(patch))).toEqual({ error: "configuration_changed" });
  await db.sql`update ghl_connections set status='erro' where organization_id=${ORG}`;
  expect(await call("claim", input())).toEqual({ error: "configuration_changed" });
});
it("rejects malformed/minimal/extra input, past time and non-boolean notifications", async () => {
  for (const data of [
    null,
    [],
    {},
    input({ description: "private" }),
    input({ requestId: "x" }),
    input({ startAt: "2099-01-02T10:00:00" }),
    input({ startAt: "2099-02-31T10:00:00Z" }),
    input({ startAt: "2000-01-02T10:00:00Z", endAt: "2000-01-02T10:30:00Z" }),
    input({ endAt: "2099-01-02T09:30:00Z" }),
    input({ notify: "false" }),
    input({ notify: null }),
  ])
    expect(await call("claim", data), JSON.stringify(data)).toEqual({ error: "invalid_input" });
});
it("requires matching dispatch and durable acknowledgement before confirming", async () => {
  const data = input();
  await call("claim", data);
  expect(
    await call("ack", outcome(data, { dispatchId: randomUUID(), appointmentId: "event-1" })),
  ).toEqual({ error: "request_mismatch" });
  expect(
    await call("finish", outcome(data, { state: "confirmed", appointmentId: "event-1" })),
  ).toEqual({ error: "request_mismatch" });
  const ack = await call("ack", outcome(data, { appointmentId: "event-1" }));
  expect(ack.request).toMatchObject({ state: "unknown", appointmentId: "event-1" });
  expect(await call("ack", outcome(data, { appointmentId: "event-other" }))).toEqual({
    error: "request_mismatch",
  });
});
it("persists the verified provider receipt and one cache row/audit without creating contacts", async () => {
  const data = input();
  await call("claim", data);
  await call("ack", outcome(data, { appointmentId: "event-1" }));
  const finished = await call("finish", outcome(data, { state: "confirmed", rawStatus: "new" }));
  expect(finished.request).toMatchObject({
    state: "confirmed",
    appointmentId: "event-1",
    cacheSynced: true,
  });
  expect(await call("finish", outcome(data, { state: "confirmed", rawStatus: "new" }))).toEqual(
    finished,
  );
  const rows = await db.sql`select * from appointments where organization_id=${ORG}`;
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    contact_id: CONTACT,
    ghl_appointment_id: "event-1",
    ghl_calendar_id: "booking-calendar",
    status: "confirmada",
    notes: null,
  });
  expect(await db.sql`select id from contacts where organization_id=${ORG}`).toHaveLength(1);
  const audits =
    await db.sql`select metadata from audit_logs where action='appointment.booking.confirmed' and organization_id=${ORG}`;
  expect(audits).toHaveLength(1);
  expect(audits[0]?.["metadata"]).toMatchObject({ patient_confirmation_verified: false });
  expect(JSON.stringify(audits)).not.toMatch(/NOTA|CLÍNICA|PRIVADA/);
});
it("preserves existing appointment notes and handles a concurrent imported event without duplicates", async () => {
  const data = input();
  await call("claim", data);
  await call("ack", outcome(data, { appointmentId: "event-1" }));
  await db.sql`insert into appointments(organization_id,contact_id,ghl_appointment_id,ghl_calendar_id,title,start_at,notes,assigned_user_name)
    values(${ORG},${CONTACT},'event-1','booking-calendar','Importada','2099-01-02T10:00:00Z','NOTA EXISTENTE','Responsável')`;
  expect((await call("finish", outcome(data, { state: "confirmed" }))).request.cacheSynced).toBe(
    true,
  );
  const rows = await db.sql`select * from appointments where organization_id=${ORG}`;
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ notes: "NOTA EXISTENTE", assigned_user_name: "Responsável" });
});
it("keeps a confirmed receipt with cache pending if the existing appointment mapping disagrees", async () => {
  const data = input();
  await call("claim", data);
  await call("ack", outcome(data, { appointmentId: "event-1" }));
  await db.sql`insert into appointments(organization_id,contact_id,ghl_appointment_id,ghl_calendar_id,title,start_at)
    values(${ORG},${CONTACT},'event-1','different-calendar','Importada','2099-01-02T10:00:00Z')`;
  expect((await call("finish", outcome(data, { state: "confirmed" }))).request).toMatchObject({
    state: "confirmed",
    cacheSynced: false,
  });
  expect(
    (await db.sql`select ghl_calendar_id from appointments where organization_id=${ORG}`)[0]?.[
      "ghl_calendar_id"
    ],
  ).toBe("different-calendar");
});
it("finishes/read/replays an already dispatched request after write access is switched off", async () => {
  const data = input();
  await call("claim", data);
  await db.sql`update ghl_connections set write_enabled=false where organization_id=${ORG}`;
  expect((await call("claim", data)).claimed).toBe(false);
  await call("ack", outcome(data, { appointmentId: "event-1" }));
  const final = await call("finish", outcome(data, { state: "confirmed" }));
  expect(final.request.state).toBe("confirmed");
  expect(await call("read", identity(data))).toEqual(final);
});
it("never downgrades a verified success or rejects a known remote event", async () => {
  const data = input();
  await call("claim", data);
  await call("ack", outcome(data, { appointmentId: "event-1" }));
  expect(await call("finish", outcome(data, { state: "rejected" }))).toEqual({
    error: "request_mismatch",
  });
  await call("finish", outcome(data, { state: "confirmed" }));
  expect(await call("finish", outcome(data, { state: "unknown" }))).toEqual({
    error: "request_mismatch",
  });
  expect((await call("ack", outcome(data, { appointmentId: "event-1" }))).request.state).toBe(
    "confirmed",
  );
});
it("allows a new request only after a definitive rejection and cannot reclaim the old request", async () => {
  const data = input();
  await call("claim", data);
  await call("finish", outcome(data, { state: "rejected", errorCode: "slot_unavailable" }));
  expect((await call("claim", data)).claimed).toBe(false);
  expect((await call("claim", input())).claimed).toBe(true);
});
it("denies direct table/RPC access to authenticated users and anonymous callers", async () => {
  for (const role of ["authenticated", "anon"]) {
    await expect(asRole(role, "select * from public.chat_booking_requests")).rejects.toThrow();
    await expect(
      asRole(role, "select * from public.chat_booking_abandoned_requests"),
    ).rejects.toThrow();
    await expect(asRole(role, sqlCommand("claim", ORG, ACTOR, input()))).rejects.toThrow();
  }
  const [row] =
    await db.sql`select relrowsecurity from pg_class where oid='public.chat_booking_requests'::regclass`;
  expect(row?.["relrowsecurity"]).toBe(true);
});

it("abandons an unclaimed request durably and prevents its delayed handler from dispatching", async () => {
  const data = input();
  expect(await call("abandon", identity(data))).toEqual({ request: null, abandoned: true });
  expect(await call("abandon", identity(data))).toEqual({ request: null, abandoned: true });
  expect(await call("read", identity(data))).toEqual({ request: null, abandoned: true });
  expect(await call("claim", data)).toEqual({ error: "request_abandoned" });
  expect(await db.sql`select * from chat_booking_requests`).toHaveLength(0);
  expect(await db.sql`select * from appointments where organization_id=${ORG}`).toHaveLength(0);
  expect(
    await db.sql`select * from audit_logs where action='appointment.booking.abandoned'`,
  ).toHaveLength(1);
});

it("never abandons an existing pending or uncertain remote dispatch", async () => {
  const data = input();
  const claimed = await call("claim", data);
  expect(await call("abandon", identity(data))).toEqual({ request: claimed.request });
  const acknowledged = await call("ack", outcome(data, { appointmentId: "event-1" }));
  expect(await call("abandon", identity(data))).toEqual(acknowledged);
  expect(await db.sql`select * from chat_booking_abandoned_requests`).toHaveLength(0);
});

it("serializes an abandonment racing a delayed claim with at most one dispatch winner", async () => {
  const data = input();
  const [abandoned, claimed] = await Promise.all([
    call("abandon", identity(data)),
    call("claim", data),
  ]);
  const ledger = await db.sql`select * from chat_booking_requests`;
  const tombstones = await db.sql`select * from chat_booking_abandoned_requests`;
  expect(ledger.length + tombstones.length).toBe(1);
  if (abandoned.abandoned) {
    expect(claimed).toEqual({ error: "request_abandoned" });
    expect(ledger).toHaveLength(0);
  } else {
    expect(claimed.claimed).toBe(true);
    expect(abandoned.request).toEqual(claimed.request);
    expect(tombstones).toHaveLength(0);
  }
});

it("keeps abandonment scoped to the actor and exact existing contact", async () => {
  const data = input();
  expect(await call("abandon", { ...identity(data), ghlContactId: "missing-contact" })).toEqual({
    error: "contact_not_found",
  });
  expect(await call("abandon", identity(data), VIEWER)).toEqual({ error: "forbidden" });
  await call("abandon", identity(data));
  expect(await call("read", identity(data), COLLEAGUE)).toEqual({ error: "request_mismatch" });
  expect(await call("abandon", identity(data), COLLEAGUE)).toEqual({ error: "request_mismatch" });
  expect(await call("claim", data, COLLEAGUE)).toEqual({ error: "request_mismatch" });
  expect((await call("claim", input())).claimed).toBe(true);
});
it("keeps equal request IDs isolated across organizations", async () => {
  const data = input();
  await call("claim", data);
  const other = {
    ...data,
    contactId: CONTACT_B,
    ghlContactId: "booking-other-contact",
    locationId: "booking-other-location",
    calendarId: "booking-other-calendar",
  };
  expect((await call("claim", other, FOREIGN, OTHER)).claimed).toBe(true);
  expect((await call("read", identity(data))).request.contactId).toBe(CONTACT);
  expect((await call("read", identity(other), FOREIGN, OTHER)).request.contactId).toBe(CONTACT_B);
});
