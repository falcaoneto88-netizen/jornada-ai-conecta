/** Full real migrations; all identities, appointment data and credentials below are fictional. */
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import { startCommercialDb } from "../../test/commercial-agent-db";
import { attendanceWorkspaceSchema } from "./attendance-workspace.core";
const ORG = "11111111-1111-4111-8111-111111111111",
  OTHER = "22222222-2222-4222-8222-222222222222",
  ACTOR = "33333333-3333-4333-8333-333333333333",
  SECOND = "44444444-4444-4444-8444-444444444444",
  VIEWER = "55555555-5555-4555-8555-555555555555",
  FOREIGN = "66666666-6666-4666-8666-666666666666";
let db: Awaited<ReturnType<typeof startCommercialDb>>;
const quote = (v: string) => "'" + v.replace(/'/g, "''") + "'";
async function read(
  owner = "all",
  view = "all",
  page = 0,
  size = 25,
  actor = ACTOR,
  org = ORG,
  at = "2026-10-13T12:00:00Z",
) {
  const [row] =
    await db.sql`select attendance_workspace_read(${org}::uuid,${actor}::uuid,${owner},${view},${page},${size},${at}::timestamptz) as value`;
  return row?.["value"];
}
beforeAll(async () => {
  db = await startCommercialDb();
  await db.sql
    .unsafe(`drop schema public cascade; drop schema auth cascade; create schema public; create schema auth;
 create table auth.users(id uuid primary key default gen_random_uuid(),email text,raw_user_meta_data jsonb not null default '{}',created_at timestamptz not null default now());
 create function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $f$;
 grant usage on schema public,auth to anon,authenticated,service_role;`);
  const connection = await db.sql.reserve();
  try {
    let first = true;
    for (const file of readdirSync("supabase/migrations").sort()) {
      await connection.unsafe(readFileSync(`supabase/migrations/${file}`, "utf8"));
      if (first) {
        await connection.unsafe(
          "insert into organizations(id,name) values('f07ab3be-7419-4779-a901-ef71c5fc27f0','Marcador fictício')",
        );
        first = false;
      }
    }
  } finally {
    connection.release();
  }
  await db.sql.unsafe(`
 insert into organizations(id,name,timezone) values('${ORG}','Teste A','Europe/Lisbon'),('${OTHER}','Teste B','Europe/Lisbon');
 alter table auth.users disable trigger on_auth_user_created;
 insert into auth.users(id) values('${ACTOR}'),('${SECOND}'),('${VIEWER}'),('${FOREIGN}');
 alter table auth.users enable trigger on_auth_user_created;
 insert into profiles(id,organization_id,full_name) values('${ACTOR}','${ORG}','Operador'),('${SECOND}','${ORG}','Outro operador'),('${VIEWER}','${ORG}','Leitor'),('${FOREIGN}','${OTHER}','Estrangeiro');
 insert into user_roles(user_id,organization_id,role) values('${ACTOR}','${ORG}','comercial'),('${SECOND}','${ORG}','gestor'),('${VIEWER}','${ORG}','visualizador'),('${FOREIGN}','${OTHER}','administrador');
 insert into ghl_connections(organization_id,last_sync_at) values('${ORG}','2026-10-13T09:00:00Z');
 insert into contacts(id,organization_id,ghl_contact_id,full_name,attendance_owner_id,next_action,next_action_at,notes)
 select ('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'${ORG}','ghl-'||i,'Homônimo fictício',case when i%3=1 then '${ACTOR}'::uuid when i%3=2 then '${SECOND}'::uuid else null end,
   'Retornar ligação',case when i<=400 then '2026-10-12T12:00:00Z'::timestamptz when i<=800 then '2026-10-13T10:00:00Z'::timestamptz when i<=1100 then '2026-10-13T15:00:00Z'::timestamptz else '2026-10-14T12:00:00Z'::timestamptz end,'NOTA CLÍNICA'
 from generate_series(1,1105) i;
 insert into contacts(id,organization_id,ghl_contact_id,full_name,next_action,next_action_at) values('77777777-7777-4777-8777-777777777777'::uuid,'${OTHER}','ghl-1','Mesmo nome','Retorno estrangeiro','2026-10-13T10:00:00Z');
 insert into contacts(organization_id,ghl_contact_id,full_name,next_action,next_action_at,is_demo) values('${ORG}','demo','Demo','Demo retorno','2026-10-13T10:00:00Z',true);
 insert into contacts(organization_id,full_name,next_action,next_action_at) values('${ORG}','Sem vínculo','Retorno sem GHL','2026-10-13T10:00:00Z');
 insert into appointments(id,organization_id,contact_id,ghl_appointment_id,title,start_at,status,notes)
 select ('10000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'${ORG}',('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'appt-'||i,'Consulta fictícia','2026-10-13T09:00:00Z'::timestamptz+i*interval '1 minute',
 case when i<=60 then 'confirmada' when i=61 then 'cancelada' when i=62 then 'realizada' when i=63 then 'faltou' else 'invalid' end,'NOTA CONSULTA' from generate_series(1,64) i;
 insert into appointments(organization_id,contact_id,title,start_at,status) values('${ORG}','00000000-0000-4000-8000-000000000001'::uuid,'Consulta local','2026-10-13T20:00:00Z','confirmada'),('${ORG}','00000000-0000-4000-8000-000000000001'::uuid,'Amanhã','2026-10-13T23:00:00Z','confirmada'),('${ORG}',null,'Sem contato','2026-10-13T20:00:00Z','confirmada');
 `);
}, 120000);
afterAll(async () => db?.stop());

it("counts all 1105 contacts server-side rather than the first page and labels reply coverage unavailable", async () => {
  const result = attendanceWorkspaceSchema.parse(await read());
  expect(result.counts).toEqual({
    awaitingResponse: null,
    returnsToday: 700,
    returnsOverdue: 800,
    appointmentsToday: 61,
  });
  expect(result.page).toEqual({ index: 0, size: 25, totalItems: 1161, hasMore: true });
  expect(result.rows).toHaveLength(25);
  expect(result.awaitingResponseUnavailableReason).toBe("message_coverage_unavailable");
  expect(result.source).toMatchObject({ kind: "local", coverage: "linked_contacts" });
  expect(JSON.stringify(result)).not.toMatch(/NOTA|Estrangeiro|Demo retorno|Retorno sem GHL/);
});
it("uses exact owners, permits existing viewer reads, and never escapes tenant", async () => {
  const mine = await read("mine"),
    unassigned = await read("unassigned"),
    all = await read(),
    second = await read("mine", "all", 0, 25, SECOND);
  expect(mine.rows.every((r: { owner: { id: string } }) => r.owner.id === ACTOR)).toBe(true);
  expect(unassigned.rows.every((r: { owner: null }) => r.owner === null)).toBe(true);
  expect(
    mine.counts.returnsToday + unassigned.counts.returnsToday + second.counts.returnsToday,
  ).toBe(all.counts.returnsToday);
  expect(await read("all", "all", 0, 25, ACTOR, OTHER)).toEqual({ error: "forbidden" });
  const foreign = await read("all", "all", 0, 25, FOREIGN, OTHER);
  expect(foreign.counts.returnsToday).toBe(1);
  expect(foreign.rows[0].nextAction).toBe("Retorno estrangeiro");
  expect((await read("all", "all", 0, 25, VIEWER)).counts).toEqual(all.counts);
  expect((await read("mine", "all", 0, 25, VIEWER)).page.totalItems).toBe(0);
});
it("stable pagination has no overlap, supports size 50, and keeps unfiltered counts when selecting a card", async () => {
  const a = await read("all", "all", 0, 50),
    b = await read("all", "all", 1, 50);
  expect(new Set([...a.rows, ...b.rows].map((r: { id: string }) => r.id)).size).toBe(100);
  expect(b.counts).toEqual(a.counts);
  const today = await read("all", "returns_today"),
    overdue = await read("all", "overdue");
  expect(today.page.totalItems).toBe(700);
  expect(overdue.page.totalItems).toBe(800);
  expect(today.rows[0].reason).toBe("return_overdue");
  expect(today.counts).toEqual(a.counts);
  const end = await read("all", "all", 46, 25);
  expect(end.rows).toHaveLength(11);
  expect(end.page.hasMore).toBe(false);
});
it("counts appointment IDs, excludes closed/canceled and distinguishes local from imported evidence", async () => {
  const a = await read("all", "appointments_today", 0, 50),
    b = await read("all", "appointments_today", 1, 50);
  const rows = [...a.rows, ...b.rows];
  expect(rows).toHaveLength(61);
  expect(rows.filter((r) => r.evidence.source === "jornada")).toHaveLength(1);
  expect(
    rows.every(
      (r) => r.reason === "appointment_today" && r.appointment.id && r.nextAction === null,
    ),
  ).toBe(true);
  expect(new Set(rows.map((r) => r.id)).size).toBe(61);
});
it.each([
  ["2026-03-29T12:00:00Z", "2026-03-29T00:00:00Z", "2026-03-29T23:00:00Z", 23],
  ["2026-10-25T12:00:00Z", "2026-10-24T23:00:00Z", "2026-10-26T00:00:00Z", 25],
])("uses organization day across DST for %s", async (at, start, end, hours) => {
  const result = await read("all", "all", 0, 25, ACTOR, ORG, at);
  expect(Date.parse(result.day.startAt)).toBe(Date.parse(start));
  expect(Date.parse(result.day.endAt)).toBe(Date.parse(end));
  expect(Date.parse(result.day.endAt) - Date.parse(result.day.startAt)).toBe(
    Number(hours) * 3600000,
  );
});
it("rejects invalid filters and direct authenticated RPC invocation", async () => {
  expect(await read("bad")).toEqual({ error: "invalid_input" });
  expect(await read("all", "all", 0, 100)).toEqual({ error: "invalid_input" });
  await expect(
    db.sql.begin(async (tx) => {
      await tx.unsafe(
        `set local "request.jwt.claim.sub"=${quote(ACTOR)};set local role authenticated;`,
      );
      return tx`select attendance_workspace_read(${ORG}::uuid,${ACTOR}::uuid)`;
    }),
  ).rejects.toThrow();
});
it("read snapshot ignores an uncommitted completion and changes only after it commits", async () => {
  const tx = await db.sql.reserve();
  try {
    await tx.unsafe("begin");
    await tx`update contacts set next_action=null,next_action_at=null where id='00000000-0000-4000-8000-000000000001'::uuid`;
    expect((await read()).counts.returnsOverdue).toBe(800);
    await tx.unsafe("commit");
    expect((await read()).counts.returnsOverdue).toBe(799);
  } finally {
    await tx.unsafe("rollback");
    tx.release();
  }
});
