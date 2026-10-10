import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import type { Store } from "../src/lib/commercial-agent/service.server";
import { AgentError } from "../src/lib/commercial-agent/core";

export const ORG = "11111111-1111-4111-8111-111111111111",
  OTHER = "22222222-2222-4222-8222-222222222222",
  ACTOR = "33333333-3333-4333-8333-333333333333",
  FOREIGN = "44444444-4444-4444-8444-444444444444";
export async function startCommercialDb() {
  const bin = process.env["PG_TEST_BINDIR"];
  if (!bin) throw new Error("PG_TEST_BINDIR deve apontar ao PostgreSQL local de testes.");
  const dir = mkdtempSync(join(tmpdir(), "jornada-agent-test-"));
  const password = randomUUID(),
    pw = join(dir, "pw");
  writeFileSync(pw, password, { mode: 0o600 });
  const server = createServer();
  await new Promise<void>((r, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", r);
  });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((r) => server.close(() => r()));
  execFileSync(
    join(bin, "initdb"),
    ["-D", join(dir, "data"), "-U", "postgres", "--auth=scram-sha-256", `--pwfile=${pw}`],
    { stdio: "pipe" },
  );
  execFileSync(
    join(bin, "pg_ctl"),
    [
      "-D",
      join(dir, "data"),
      "-l",
      join(dir, "pg.log"),
      "-o",
      `-p ${port} -h 127.0.0.1 -k ${dir}`,
      "-w",
      "start",
    ],
    { stdio: "pipe" },
  );
  const sql = postgres({
    host: "127.0.0.1",
    port,
    username: "postgres",
    password,
    database: "postgres",
    max: 5,
    onnotice: () => {},
  });
  const stop = async () => {
    await sql.end();
    execFileSync(join(bin, "pg_ctl"), ["-D", join(dir, "data"), "-m", "immediate", "stop"], {
      stdio: "pipe",
    });
    rmSync(dir, { recursive: true, force: true });
  };
  try {
    await sql.unsafe(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;create table auth.users(id uuid primary key);
      create table public.organizations(id uuid primary key);
      create table public.profiles(id uuid primary key references auth.users(id),organization_id uuid);
      create table public.user_roles(user_id uuid,organization_id uuid,role text);
      create table public.ghl_location_bindings(organization_id uuid,location_id text);
      create table public.ghl_connections(organization_id uuid,write_enabled boolean);
      grant usage on schema public,auth to anon,authenticated,service_role;
      insert into auth.users values('${ACTOR}'),('${FOREIGN}');
      insert into organizations values('${ORG}'),('${OTHER}');
      insert into profiles values('${ACTOR}','${ORG}'),('${FOREIGN}','${OTHER}');
      insert into user_roles values('${ACTOR}','${ORG}','comercial'),('${FOREIGN}','${OTHER}','administrador');
      insert into ghl_location_bindings values('${ORG}','loc-test'),('${OTHER}','loc-other');
      insert into ghl_connections values('${ORG}',true),('${OTHER}',true);`);
    const migration = await sql.reserve();
    try {
      await migration.unsafe(
        readFileSync("supabase/migrations/20261003120000_commercial_agent_supervised.sql", "utf8"),
      );
      await migration.unsafe(
        readFileSync("supabase/migrations/20261008180000_commercial_agent_receive_all.sql", "utf8"),
      );
      await migration.unsafe(
        readFileSync("supabase/migrations/20261008190000_commercial_agent_manual.sql", "utf8"),
      );
      await migration.unsafe(
        readFileSync(
          "supabase/migrations/20261010010000_commercial_agent_manual_inbox.sql",
          "utf8",
        ),
      );
    } finally {
      migration.release();
    }
    await sql`insert into commercial_agent_settings(organization_id,location_id,mode,allowed_contacts,allowed_channels) values(${ORG},'loc-test','supervised',array['c-test','c-second'],array['WhatsApp','SMS']),(${OTHER},'loc-other','supervised',array['c-other'],array['WhatsApp'])`;
  } catch (e) {
    await stop();
    throw e;
  }
  const store: Store = {
    async command<T>(op: string, org: string, data: Record<string, unknown> = {}, actor?: string) {
      const rows = op.startsWith("manual_")
        ? await sql`select public.commercial_agent_manual_command(${op},${org}::uuid,${sql.json(data as never)},${actor ?? null}::uuid) as value`
        : await sql`select public.commercial_agent_command(${op},${org}::uuid,${sql.json(data as never)},${actor ?? null}::uuid) as value`;
      const value = rows[0]?.["value"];
      if (value?.error) throw new AgentError(value.error);
      return value as T;
    },
  };
  return { sql, store, stop };
}
