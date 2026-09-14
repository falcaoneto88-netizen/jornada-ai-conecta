// PostgreSQL descartável, sem URL, dados ou credenciais de produção.
// Requer PG_TEST_BINDIR (initdb/pg_ctl) e PG_TEST_RUNTIME (pacote pg).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
const bin = process.env.PG_TEST_BINDIR;
if (!bin || !process.env.PG_TEST_RUNTIME)
  throw new Error("Configure somente os caminhos locais PG_TEST_BINDIR e PG_TEST_RUNTIME.");
const require = createRequire(join(resolve(process.env.PG_TEST_RUNTIME), "package.json"));
const { Client } = require("pg");
const base = await mkdtemp(join(tmpdir(), "jornada-followup-test-")),
  data = join(base, "db");
const password = randomUUID(),
  pwfile = join(base, "pw");
await writeFile(pwfile, password, { mode: 0o600 });
const server = createServer();
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
await new Promise((r) => server.close(r));
const cfg = { host: "127.0.0.1", port, user: "postgres", password, database: "postgres" };
let db,
  started = false,
  n = 0;
const check = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  n++;
  console.log("PASS", label);
};
try {
  execFileSync(
    join(bin, "initdb"),
    ["-D", data, "-U", "postgres", "--auth=scram-sha-256", `--pwfile=${pwfile}`],
    { stdio: "pipe" },
  );
  execFileSync(
    join(bin, "pg_ctl"),
    [
      "-D",
      data,
      "-l",
      join(base, "postgres.log"),
      "-o",
      `-p ${port} -h 127.0.0.1 -k ${base}`,
      "-w",
      "start",
    ],
    { stdio: "pipe" },
  );
  started = true;
  db = new Client(cfg);
  await db.connect();
  await db.query(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
 create schema auth;create table auth.users(id uuid primary key default gen_random_uuid(),email text,raw_user_meta_data jsonb not null default '{}',created_at timestamptz default now());
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,public to anon,authenticated,service_role;`);
  let first = true;
  for (const file of (await readdir("supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.query(await readFile(join("supabase/migrations", file), "utf8"));
    if (first) {
      await db.query(
        "insert into organizations(id,name) values('f07ab3be-7419-4779-a901-ef71c5fc27f0','Marcador sintético')",
      );
      first = false;
    }
  }
  const a = randomUUID(),
    b = randomUUID(),
    viewer = randomUUID(),
    contact = randomUUID(),
    appt = randomUUID(),
    second = randomUUID();
  await db.query(
    "insert into auth.users(id,email) values($1,'operator-a@example.test'),($2,'operator-b@example.test'),($3,'viewer@example.test')",
    [a, b, viewer],
  );
  const orgA = (await db.query("select organization_id from profiles where id=$1", [a])).rows[0]
      .organization_id,
    orgB = (await db.query("select organization_id from profiles where id=$1", [b])).rows[0]
      .organization_id;
  await db.query("update profiles set organization_id=$1 where id=$2", [orgA, viewer]);
  await db.query("update user_roles set organization_id=$1,role='visualizador' where user_id=$2", [
    orgA,
    viewer,
  ]);
  await db.query(
    "insert into contacts(id,organization_id,ghl_contact_id,full_name) values($1,$2,'contact-a','Sintético A')",
    [contact, orgA],
  );
  await db.query(
    "insert into ghl_location_bindings(location_id,organization_id) values('location-a',$1),('location-b',$2)",
    [orgA, orgB],
  );
  const start = new Date(Date.now() + 86400000).toISOString(),
    end = new Date(Date.now() + 88200000).toISOString();
  await db.query(
    "insert into appointments(id,organization_id,contact_id,ghl_appointment_id,ghl_calendar_id,title,start_at,end_at,status) values($1,$2,$3,'appt-a','calendar-a','Sintética',$4,$5,'confirmada'),($6,$2,$3,'appt-b','calendar-a','Sintética 2',$4,$5,'confirmada')",
    [appt, orgA, contact, start, end, second],
  );
  const dt = new Date(Date.now() - 60000).toISOString();
  const event = {
    state: "aguardando_resposta",
    message_id: "sent-a",
    conversation_id: "conv-a",
    message_at: dt,
    message_text: "Confirma sua consulta?",
    message_type: "SMS",
    message_status: "delivered",
    message_direction: "outbound",
    deadline_at: new Date(Date.parse(dt) + 86400000).toISOString(),
    appointment_start_at: start,
    appointment_end_at: end,
    ghl_appointment_id: "appt-a",
    contact_id: contact,
    ghl_contact_id: "contact-a",
    location_id: "location-a",
    previous_id: null,
  };
  async function as(role, user, sql, args = [], client = db) {
    await client.query("begin");
    try {
      await client.query(`set local role ${role}`);
      await client.query("select set_config('request.jwt.claim.sub',$1,true)", [user ?? ""]);
      const r = await client.query(sql, args);
      await client.query("commit");
      return r;
    } catch (e) {
      await client.query("rollback");
      throw e;
    }
  }
  const sql = "select record_appointment_followup($1,$2,$3,$4,$5) as id";
  const request = randomUUID();
  const call = (e = event, options = {}) =>
    as(
      options.role ?? "service_role",
      options.user ?? null,
      sql,
      [
        options.actor ?? a,
        options.org ?? orgA,
        options.appointment ?? appt,
        options.request ?? request,
        e,
      ],
      options.client ?? db,
    );
  async function denied(e, options, code, label) {
    await assert.rejects(call(e, options), (error) => error.code === code);
    n++;
    console.log("PASS", label);
  }
  await denied(event, { role: "anon" }, "42501", "anônimo não registra evidência");
  await denied(
    event,
    { role: "authenticated", user: a },
    "42501",
    "navegador administrador não fabrica evidência via RPC",
  );
  await denied(event, { actor: viewer }, "42501", "visualizador não registra pelo backend");
  await denied(event, { actor: b }, "42501", "ator de outra organização recusado");
  await denied(
    { ...event, location_id: "location-b" },
    {},
    "23503",
    "vínculo de outra location recusado",
  );
  await denied({ ...event, ghl_contact_id: "outro" }, {}, "23503", "contato divergente recusado");
  await denied(
    { ...event, appointment_start_at: new Date(Date.parse(start) + 3600000).toISOString() },
    {},
    "40001",
    "snapshot obsoleto recusado",
  );
  await denied({ ...event, extra: "não autorizado" }, {}, "22023", "payload extra recusado");
  await denied(
    { ...event, state: "presenca_confirmada", message_direction: "inbound", deadline_at: null },
    {},
    "22023",
    "resposta sem solicitação recusada",
  );
  const firstId = (await call()).rows[0].id;
  check((await call()).rows[0].id, firstId, "repetição idempotente retorna mesmo recibo");
  check(
    (await as("authenticated", a, "select count(*)::int as n from appointment_followup_events"))
      .rows[0].n,
    1,
    "operador lê sua organização",
  );
  check(
    (
      await as(
        "authenticated",
        viewer,
        "select count(*)::int as n from appointment_followup_events",
      )
    ).rows[0].n,
    1,
    "visualizador lê evidência da própria organização",
  );
  check(
    (await as("authenticated", b, "select count(*)::int as n from appointment_followup_events"))
      .rows[0].n,
    0,
    "outra organização não lê evidência",
  );
  for (const action of [
    "update appointment_followup_events set state='falha'",
    "delete from appointment_followup_events",
    "insert into appointment_followup_events(id) values(gen_random_uuid())",
  ]) {
    await assert.rejects(as("authenticated", a, action), (e) => e.code === "42501");
    n++;
    console.log("PASS", action.split(" ")[0], "direto bloqueado");
  }
  await denied(
    { ...event, message_text: "Divergente" },
    {},
    "23505",
    "request repetido com corpo divergente recusado",
  );
  await denied(
    { ...event, ghl_appointment_id: "appt-b" },
    { appointment: second, request: randomUUID() },
    "23505",
    "mesma mensagem não confirma duas consultas",
  );
  const response = {
    ...event,
    state: "presenca_confirmada",
    message_id: "reply-a",
    message_text: "SIM",
    message_direction: "inbound",
    message_at: new Date(Date.now() - 30000).toISOString(),
    deadline_at: null,
    previous_id: firstId,
  };
  await denied(
    { ...response, conversation_id: "outra" },
    { request: randomUUID() },
    "22023",
    "resposta de outra conversa recusada",
  );
  await denied(
    { ...response, previous_id: null },
    { request: randomUUID() },
    "40001",
    "concorrência com revisão obsoleta recusada",
  );
  const c1 = new Client(cfg),
    c2 = new Client(cfg);
  await c1.connect();
  await c2.connect();
  let outcomes;
  try {
    outcomes = await Promise.allSettled([
      call(response, { request: randomUUID(), client: c1 }),
      call({ ...response, message_id: "reply-b" }, { request: randomUUID(), client: c2 }),
    ]);
  } finally {
    await c1.end();
    await c2.end();
  }
  check(
    outcomes.filter((r) => r.status === "fulfilled").length,
    1,
    "duas revisões concorrentes geram somente uma confirmação",
  );
  check(
    outcomes.filter((r) => r.status === "rejected").map((r) => r.reason.code),
    ["40001"],
    "concorrente atrasado recebe conflito explícito",
  );
  check(
    (
      await db.query(
        "select count(*)::int as n from audit_logs where action='appointment.followup.linked' and verified",
      )
    ).rows[0].n,
    2,
    "auditoria verificada acompanha exatamente os dois registros",
  );
  await db.query(
    "alter table audit_logs add constraint followup_atomic check(action <> 'appointment.followup.linked') not valid",
  );
  await denied(
    { ...event, message_id: "sent-b", ghl_appointment_id: "appt-b" },
    { appointment: second, request: randomUUID() },
    "23514",
    "falha da auditoria impede sucesso parcial",
  );
  check(
    (
      await db.query(
        "select count(*)::int as n from appointment_followup_events where appointment_id=$1",
        [second],
      )
    ).rows[0].n,
    0,
    "falha de auditoria desfaz a evidência",
  );
  await db.query("alter table audit_logs drop constraint followup_atomic");
  await call(
    {
      ...event,
      state: "falha",
      message_status: "failed",
      deadline_at: null,
      message_id: "failed-b",
      ghl_appointment_id: "appt-b",
    },
    { appointment: second, request: randomUUID() },
  );
  check(
    (
      await db.query("select state from appointment_followup_events where appointment_id=$1", [
        second,
      ])
    ).rows[0].state,
    "falha",
    "falha real de mensagem persistida",
  );
  console.log(`\n${n} verificações PostgreSQL aprovadas. Dados apenas sintéticos.`);
} finally {
  if (db) await db.end();
  if (started)
    execFileSync(join(bin, "pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"], { stdio: "pipe" });
  await rm(base, { recursive: true, force: true });
}
