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
const base = await mkdtemp(join(tmpdir(), "jornada-templates-test-")),
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
    manager = randomUUID();
  await db.query(
    "insert into auth.users(id,email) values($1,'a@example.test'),($2,'b@example.test'),($3,'v@example.test'),($4,'m@example.test')",
    [a, b, viewer, manager],
  );
  const orgA = (await db.query("select organization_id from profiles where id=$1", [a])).rows[0]
    .organization_id;
  const orgB = (await db.query("select organization_id from profiles where id=$1", [b])).rows[0]
    .organization_id;
  for (const [user, role] of [
    [viewer, "visualizador"],
    [manager, "gestor"],
  ]) {
    await db.query("update profiles set organization_id=$1 where id=$2", [orgA, user]);
    await db.query("update user_roles set organization_id=$1,role=$3 where user_id=$2", [
      orgA,
      user,
      role,
    ]);
  }
  const seedOrg = "f07ab3be-7419-4779-a901-ef71c5fc27f0";
  check(
    (
      await db.query(
        "select count(*)::int as n from message_templates where organization_id=$1 and lifecycle='draft' and revision=1 and starter_key is not null and not is_demo",
        [seedOrg],
      )
    ).rows[0].n,
    8,
    "oito rascunhos iniciais apenas na organização solicitada",
  );
  check(
    (
      await db.query("select count(*)::int as n from message_templates where organization_id<>$1", [
        seedOrg,
      ])
    ).rows[0].n,
    0,
    "nenhuma biblioteca inicial em outra organização",
  );
  check(
    (
      await db.query(
        "select count(*)::int as n from audit_logs where action='modelo.rascunho_guardado' and verified and organization_id=$1",
        [seedOrg],
      )
    ).rows[0].n,
    8,
    "criação inicial auditada atomicamente",
  );
  await db.query(
    "insert into journey_stages(organization_id,key,name,position) values($1,'valid','Etapa A',100),($2,'foreign','Etapa B',100)",
    [orgA, orgB],
  );
  async function as(role, user, sql, args = []) {
    await db.query("begin");
    try {
      await db.query(`set local role ${role}`);
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [user ?? ""]);
      const r = await db.query(sql, args);
      await db.query("commit");
      return r;
    } catch (e) {
      await db.query("rollback");
      throw e;
    }
  }
  const id = randomUUID();
  const draft = {
    name: "Modelo teste",
    body: "Olá {{contact.name}}, {{appointment.only_start_date}} às {{appointment.only_start_time}} ({{appointment.timezone}}).",
    stage_key: "valid",
    channel: "sms",
    language: "PT-BR",
    usage_note: "Somente teste sintético",
    lifecycle: "draft",
  };
  const call = (d = draft, rev = null, user = a, org = orgA, mid = id, role = "authenticated") =>
    as(role, user, "select public.save_message_template_draft($1,$2,$3,$4) as value", [
      org,
      mid,
      rev,
      d,
    ]);
  async function denied(p, code, label) {
    await assert.rejects(p, (e) => e.code === code);
    n++;
    console.log("PASS", label);
  }
  await denied(call(draft, null, null, orgA, id, "anon"), "42501", "anônimo não cria modelo");
  await denied(call(draft, null, viewer), "42501", "visualizador não cria modelo");
  await denied(call(draft, null, b), "42501", "administrador de outra organização é recusado");
  const created = (await call()).rows[0].value;
  check(created.revision, 1, "administrador cria revisão 1");
  check((await call()).rows[0].value.id, id, "repetição da criação devolve o mesmo modelo");
  check(
    (
      await db.query(
        "select count(*)::int as n from audit_logs where entity='message_templates' and entity_id=$1",
        [id],
      )
    ).rows[0].n,
    1,
    "repetição não cria auditoria duplicada",
  );
  const updated = (await call({ ...draft, body: "Olá {{contact.name}}" }, 1, manager)).rows[0]
    .value;
  check(updated.revision, 2, "gestor atualiza revisão");
  await denied(call(draft, 1), "40001", "edição desatualizada não sobrescreve conteúdo");
  check(
    (await db.query("select body from message_templates where id=$1", [id])).rows[0].body,
    "Olá {{contact.name}}",
    "conflito preserva conteúdo mais recente",
  );
  const archived = (await call({ ...draft, lifecycle: "archived" }, 2)).rows[0].value;
  check(archived.lifecycle, "archived", "modelo arquivado sem exclusão");
  check(
    (await call(draft, 3)).rows[0].value.revision,
    4,
    "restauração preserva ID e avança revisão",
  );
  for (const [body, label] of [
    ["{{appointment.time}}", "variável antiga"],
    ["{{unknown}}", "variável desconhecida"],
    ["{{contact.name}", "variável incompleta"],
    ["{{contact.name}}}", "chave extra"],
  ]) {
    await denied(call({ ...draft, body }, 4), "22023", label + " recusada no banco");
  }
  for (const d of [
    { ...draft, name: 123 },
    { ...draft, stage_key: [] },
    { ...draft, body: 0 },
    { ...draft, usage_note: null },
    { ...draft, unexpected: true },
  ]) {
    await denied(call(d, 4), "22023", "JSON inválido recusado no RPC");
  }
  await denied(
    call({ ...draft, stage_key: "foreign" }, 4),
    "22023",
    "etapa exclusiva de outra organização recusada",
  );
  check(
    (
      await as(
        "authenticated",
        viewer,
        "select count(*)::int as n from message_templates where id=$1",
        [id],
      )
    ).rows[0].n,
    1,
    "visualizador lê modelo da própria organização",
  );
  check(
    (
      await as("authenticated", b, "select count(*)::int as n from message_templates where id=$1", [
        id,
      ])
    ).rows[0].n,
    0,
    "RLS oculta modelo de outra organização",
  );
  check(
    (
      await as(
        "authenticated",
        viewer,
        "update message_templates set body='invasão' where id=$1 returning id",
        [id],
      )
    ).rowCount,
    0,
    "escrita direta do visualizador bloqueada por RLS",
  );
  await denied(
    as("authenticated", a, "update message_templates set organization_id=$1 where id=$2", [
      orgB,
      id,
    ]),
    "P0001",
    "organização do modelo não pode ser transferida",
  );
  await as("authenticated", a, "update message_templates set revision=999 where id=$1", [id]);
  check(
    (await db.query("select revision from message_templates where id=$1", [id])).rows[0].revision,
    5,
    "cliente não pode forjar número de revisão",
  );
  check(
    (
      await db.query(
        "select count(*)::int as n from audit_logs where entity='message_templates' and entity_id=$1 and verified",
        [id],
      )
    ).rows[0].n,
    5,
    "cada alteração real tem auditoria verificada, falhas não contam",
  );
  await db.query(`create function public.reject_template_audit() returns trigger language plpgsql as $$begin if new.entity='message_templates' then raise exception 'Teste falha auditoria';end if;return new;end$$;
  create trigger reject_audit before insert on public.audit_logs for each row execute function public.reject_template_audit();`);
  await denied(
    call({ ...draft, name: "Não pode persistir" }, 5),
    "P0001",
    "falha de auditoria reverte alteração inteira",
  );
  check(
    (await db.query("select name,revision from message_templates where id=$1", [id])).rows[0],
    { name: "Modelo teste", revision: 5 },
    "conteúdo e revisão preservados após rollback",
  );
  console.log(`\n${n} verificações PostgreSQL aprovadas. Dados apenas sintéticos.`);
} finally {
  if (db) await db.end();
  if (started)
    execFileSync(join(bin, "pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"], { stdio: "pipe" });
  await rm(base, { recursive: true, force: true });
}
