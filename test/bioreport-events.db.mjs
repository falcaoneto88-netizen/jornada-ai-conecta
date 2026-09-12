// Banco descartável com migrações reais. Nunca usa URL ou credenciais de produção.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { readFile, readdir, mkdtemp } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "node:net";

const runtime = process.env.BIOREPORT_TEST_RUNTIME || resolve("test/bioreport-runtime");
const require = createRequire(join(runtime, "package.json"));
const { default: EmbeddedPostgres } = await import(
  pathToFileURL(require.resolve("embedded-postgres"))
);
const { Client } = require("pg");
const portServer = createServer();
await new Promise((r) => portServer.listen(0, "127.0.0.1", r));
const port = portServer.address().port;
await new Promise((r) => portServer.close(r));
const base = await mkdtemp(join(tmpdir(), "bioreport-jornada-db-"));
const password = randomUUID();
const pg = new EmbeddedPostgres({
  databaseDir: join(base, "db"),
  port,
  user: "postgres",
  password,
  persistent: false,
  postgresFlags: ["-c", "listen_addresses=127.0.0.1", "-c", "log_statement=none"],
  onLog: () => {},
  onError: () => {},
});
let db;
let count = 0;
const check = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  count++;
  console.log("PASS", label);
};
try {
  await pg.initialise();
  await pg.start();
  db = new Client({ host: "127.0.0.1", port, user: "postgres", password, database: "postgres" });
  await db.connect();
  await db.query(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users(id uuid primary key default gen_random_uuid(),email text,raw_user_meta_data jsonb not null default '{}',created_at timestamptz default now());
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
    viewer = randomUUID();
  await db.query(
    "insert into auth.users(id,email) values($1,'admin-a@example.test'),($2,'admin-b@example.test'),($3,'viewer@example.test')",
    [a, b, viewer],
  );
  const orgA = (await db.query("select organization_id from profiles where id=$1", [a])).rows[0]
    .organization_id;
  const orgB = (await db.query("select organization_id from profiles where id=$1", [b])).rows[0]
    .organization_id;
  await db.query("update profiles set organization_id=$1 where id=$2", [orgA, viewer]);
  await db.query("update user_roles set organization_id=$1,role='visualizador' where user_id=$2", [
    orgA,
    viewer,
  ]);
  const contact = randomUUID();
  await db.query(
    "insert into contacts(id,organization_id,ghl_contact_id,full_name) values($1,$2,'contact-a','Sintético A'),(gen_random_uuid(),$3,'contact-b','Sintético B'),(gen_random_uuid(),$2,'contact-a2','Sintético A2')",
    [contact, orgA, orgB],
  );
  await db.query(
    "insert into ghl_location_bindings(location_id,organization_id) values('location-a',$1),('location-b',$2)",
    [orgA, orgB],
  );
  const secret = "a".repeat(64);
  await db.query(
    "insert into bioreport_private.signing_keys(organization_id,key_id,secret) values($1,'test-v1',$2)",
    [orgA, secret],
  );
  const configEnv = {
    ...process.env,
    BIOREPORT_TEST_RUNTIME: runtime,
    BIOREPORT_JORNADA_SIGNING_SECRET: secret,
    BIOREPORT_JORNADA_KEY_ID: "test-v1",
    JORNADA_AI_ORGANIZATION_ID: orgA,
    GHL_LOCATION_ID: "location-a",
    JORNADA_DATABASE_URL: `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`,
  };
  const configured = execFileSync(
    process.execPath,
    ["scripts/configure-bioreport-integration.mjs", "--apply"],
    { env: configEnv, encoding: "utf8" },
  );
  check(
    configured.includes(secret) || configured.includes(password),
    false,
    "configuração idempotente não imprime credenciais",
  );
  let refused = false;
  try {
    execFileSync(process.execPath, ["scripts/configure-bioreport-integration.mjs", "--apply"], {
      env: { ...configEnv, BIOREPORT_JORNADA_SIGNING_SECRET: "b".repeat(64) },
      stdio: "pipe",
    });
  } catch (e) {
    refused = e.status === 1 && !String(e.stderr).includes("b".repeat(64));
  }
  check(refused, true, "configuração recusa substituir chave sem expor seu valor");
  const record = randomUUID(),
    patient = randomUUID(),
    consultation = randomUUID();
  const event = {
    version: 1,
    issuer: "https://jf-bio-insight.lovable.app",
    audience: "https://jornada-ai-conecta.lovable.app",
    key_id: "test-v1",
    organization_id: orgA,
    location_id: "location-a",
    event_id: `anamnese_recebida:${record}`,
    event_type: "anamnese_recebida",
    consultation_id: consultation,
    patient_id: patient,
    record_id: record,
    ghl_contact_id: "contact-a",
    occurred_at: new Date(Date.now() - 1000).toISOString(),
    issued_at: Math.floor(Date.now() / 1000),
  };
  const sign = (body) => createHmac("sha256", secret).update(body).digest("hex");
  async function as(role, user, sql, args = []) {
    await db.query("begin");
    try {
      await db.query(`set local role ${role}`);
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [user ?? ""]);
      const result = await db.query(sql, args);
      await db.query("commit");
      return result;
    } catch (e) {
      await db.query("rollback");
      throw e;
    }
  }
  const setupSql = "select configure_bioreport_integration($1,$2,$3,$4,$5) as result";
  const setupArgs = [orgA, "admin-setup", secret, "location-a", true];
  for (const [role, user, args, code, label] of [
    ["anon", null, setupArgs, "42501", "anônimo não cadastra chave"],
    ["authenticated", null, setupArgs, "42501", "sem sessão não cadastra chave"],
    ["authenticated", viewer, setupArgs, "42501", "visualizador não cadastra chave"],
    ["authenticated", b, setupArgs, "42501", "admin de outra organização não cadastra chave"],
    ["authenticated", a, [...setupArgs.slice(0,4),false], "22023", "cadastro exige confirmação"],
    ["authenticated", a, [orgA,"admin-setup",secret,"location-b",true], "42501", "cadastro verifica location vinculada"],
    ["authenticated", a, [orgA,"admin-setup","invalid","location-a",true], "22023", "cadastro valida formato da chave"],
  ]) {
    await assert.rejects(as(role,user,setupSql,args), e => e.code === code);
    count++;
    console.log("PASS", label);
  }
  check((await as("authenticated",a,setupSql,setupArgs)).rows[0].result,
    { configured: true }, "admin cadastra sem retorno de credenciais");
  check((await as("authenticated",a,setupSql,setupArgs)).rows[0].result,
    { configured: true }, "cadastro repetido é idempotente");
  await assert.rejects(as("authenticated",a,setupSql,[orgA,"admin-setup","b".repeat(64),"location-a",true]),
    e => e.code === "23505");
  count++; console.log("PASS", "admin não substitui silenciosamente uma chave");
  check((await db.query("select count(*)::int as n from audit_logs where action='bioreport.integration_configured' and verified")).rows[0].n,
    1,"cadastro tem auditoria verificada sem duplicação");
  await db.query("update bioreport_private.signing_keys set enabled=false where key_id='admin-setup'");
  await assert.rejects(as("authenticated",a,setupSql,setupArgs), e => e.code === "23505");
  count++; console.log("PASS", "admin não reativa chave revogada");
  await db.query("alter table audit_logs add constraint setup_atomic check(action <> 'bioreport.integration_configured') not valid");
  await assert.rejects(as("authenticated",a,setupSql,[orgA,"rollback-setup",secret,"location-a",true]), e => e.code === "23514");
  check((await db.query("select count(*)::int as n from bioreport_private.signing_keys where key_id='rollback-setup'")).rows[0].n,
    0,"falha de auditoria desfaz cadastro privado");
  await db.query("alter table audit_logs drop constraint setup_atomic");
  const receive = async (p = event, signature) => {
    const body = JSON.stringify(p);
    return (
      await as("anon", null, "select receive_bioreport_event($1,$2) as receipt", [
        body,
        signature ?? sign(body),
      ])
    ).rows[0].receipt;
  };
  async function denied(p, code, label, signature) {
    await assert.rejects(receive(p, signature), (e) => e.code === code);
    count++;
    console.log("PASS", label);
  }
  await denied(event, "28000", "assinatura inválida recusada", "0".repeat(64));
  await denied({ ...event, issued_at: event.issued_at - 301 }, "28000", "replay vencido recusado");
  await denied(
    { ...event, issued_at: event.issued_at + 120 },
    "28000",
    "assinatura futura recusada",
  );
  await denied(
    { ...event, audience: "https://attacker.invalid" },
    "22023",
    "destino inválido recusado",
  );
  await denied(
    { ...event, answers: { medication: "never-store" } },
    "22023",
    "conteúdo clínico extra recusado",
  );
  await denied(
    { ...event, location_id: "location-b" },
    "28000",
    "location de outra organização recusada",
  );
  await denied(
    { ...event, ghl_contact_id: "contact-b" },
    "23503",
    "contato de outra organização recusado",
  );
  check((await receive()).status, "received", "evento assinado real recebido com HMAC PostgreSQL");
  check(
    (await receive({ ...event, issued_at: event.issued_at + 1 })).status,
    "duplicate",
    "repetição não duplica o evento",
  );
  check(
    (
      await db.query(
        "select count(*)::int as n from audit_logs where action='bioreport.event_received' and verified",
      )
    ).rows[0].n,
    1,
    "auditoria verificada gravada uma única vez",
  );
  await denied(
    { ...event, ghl_contact_id: "contact-a2" },
    "23505",
    "mesmo evento não pode mudar de contato",
  );
  const nextRecord = randomUUID();
  await denied(
    {
      ...event,
      record_id: nextRecord,
      event_id: `anamnese_recebida:${nextRecord}`,
      ghl_contact_id: "contact-a2",
    },
    "23505",
    "paciente vinculado não pode mudar de contato",
  );
  await denied(
    {
      ...event,
      record_id: nextRecord,
      event_id: `anamnese_recebida:${nextRecord}`,
      patient_id: randomUUID(),
    },
    "23505",
    "contato não é vinculado a dois pacientes",
  );
  check(
    (await as("authenticated", a, "select count(*)::int as n from bioreport_events")).rows[0].n,
    1,
    "admin da organização consulta o evento",
  );
  for (const user of [b, viewer])
    check(
      (await as("authenticated", user, "select count(*)::int as n from bioreport_events")).rows[0]
        .n,
      0,
      "outra organização e visualizador não leem eventos",
    );
  for (const role of ["anon", "authenticated"]) {
    for (const sql of [
      "select * from bioreport_private.signing_keys",
      "insert into bioreport_events default values",
      "delete from bioreport_events",
    ]) {
      await assert.rejects(as(role, a, sql), (e) => e.code === "42501");
      count++;
      console.log("PASS", "escrita direta ou chave privada bloqueada", role);
    }
  }
  await db.query(
    "alter table audit_logs add constraint test_atomic check(action <> 'bioreport.event_received') not valid",
  );
  await denied(
    {
      ...event,
      event_type: "relatorio_disponivel",
      record_id: nextRecord,
      event_id: `relatorio_disponivel:${nextRecord}`,
    },
    "23514",
    "falha de auditoria desfaz o evento",
  );
  await db.query("alter table audit_logs drop constraint test_atomic");
  check(
    (await db.query("select count(*)::int as n from bioreport_events")).rows[0].n,
    1,
    "sem evento parcial após falha",
  );
  check(
    (await db.query("select stage_key from contacts where id=$1", [contact])).rows[0].stage_key,
    "novo_lead",
    "nenhuma etapa alterada",
  );
  check(
    (await db.query("select count(*)::int as n from messages")).rows[0].n,
    0,
    "nenhuma mensagem criada",
  );
  const concurrentRecord = randomUUID();
  const concurrentEvent = {
    ...event,
    record_id: concurrentRecord,
    event_id: `anamnese_recebida:${concurrentRecord}`,
    issued_at: Math.floor(Date.now() / 1000),
  };
  const simultaneous = await Promise.all(
    [1, 2].map(async () => {
      const session = new Client({
        host: "127.0.0.1",
        port,
        user: "postgres",
        password,
        database: "postgres",
      });
      await session.connect();
      try {
        await session.query("set role anon");
        const body = JSON.stringify(concurrentEvent);
        return (
          await session.query("select receive_bioreport_event($1,$2) as r", [body, sign(body)])
        ).rows[0].r.status;
      } finally {
        await session.end();
      }
    }),
  );
  check(
    simultaneous.sort(),
    ["duplicate", "received"],
    "requisições concorrentes produzem um único evento",
  );
  await db.query("update bioreport_private.signing_keys set enabled=false");
  await denied(concurrentEvent, "28000", "chave revogada não aceita nem repetições");
  console.log(`${count} verificações de integração PostgreSQL aprovadas`);
} finally {
  if (db) await db.end();
  await pg.stop();
}
