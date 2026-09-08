/**
 * Base de dados Postgres efémera com as migrações REAIS do projeto.
 * Cria um esquema `auth` sintético (nunca dados reais) e os papéis do Supabase,
 * para poder exercitar as políticas RLS com `set role authenticated`.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const RAIZ = process.cwd();

export type Resultado = { ok: boolean; erro: string; linhas: string[][] };

export type DbReal = {
  /** Executa SQL como superutilizador (preparação de cenários). */
  admin: (sql: string) => Resultado;
  /** Executa SQL como utilizador autenticado (RLS ativa) numa transação. */
  comoUtilizador: (userId: string, sql: string) => Resultado;
  /** Executa SQL como service_role (backend de confiança). */
  comoServico: (sql: string) => Resultado;
  stop: () => void;
};

const PREPARACAO = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create or replace function auth.uid() returns uuid language sql stable as $fn$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$fn$;
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
`;

export async function iniciarDbReal(): Promise<DbReal> {
  const base = mkdtempSync(join(tmpdir(), "jornada-rls-"));
  const dados = join(base, "data");
  const socket = base;
  const semPrivilegios = process.getuid?.() === 0;
  const prefixo = semPrivilegios ? ["setpriv", "--reuid=1000", "--regid=1000", "--clear-groups"] : [];
  if (semPrivilegios) execFileSync("chown", ["-R", "1000:1000", base]);
  const correr = (cmd: string, args: string[]) =>
    execFileSync(prefixo[0] ?? cmd, prefixo.length ? [...prefixo.slice(1), cmd, ...args] : args, {
      stdio: "ignore",
    });
  correr("initdb", ["-D", dados, "-U", "postgres", "--auth=trust"]);
  const cmdArgs = ["-D", dados, "-k", socket, "-c", "listen_addresses="];
  const proc = prefixo.length
    ? spawn(prefixo[0]!, [...prefixo.slice(1), "postgres", ...cmdArgs], { stdio: "ignore" })
    : spawn("postgres", cmdArgs, { stdio: "ignore" });

  const psql = (args: string[], input?: string) =>
    execFileSync("psql", ["-h", socket, "-U", "postgres", "-v", "ON_ERROR_STOP=1", ...args], {
      input,
      encoding: "utf8",
    });

  for (let i = 0; i < 80; i++) {
    try {
      psql(["-d", "postgres", "-c", "select 1"]);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  psql(["-d", "postgres", "-c", "create database jornada"]);
  psql(["-d", "jornada"], PREPARACAO);

  const dir = join(RAIZ, "supabase/migrations");
  let primeira = true;
  for (const ficheiro of readdirSync(dir).sort()) {
    psql(["-d", "jornada"], readFileSync(join(dir, ficheiro), "utf8"));
    if (primeira) {
      // A migração do vínculo de confiança refere a organização real da clínica;
      // aqui criamos apenas um marcador sintético para satisfazer a chave externa.
      psql([
        "-d",
        "jornada",
        "-c",
        "insert into public.organizations (id, name) values ('f07ab3be-7419-4779-a901-ef71c5fc27f0', 'Marcador de teste') on conflict do nothing",
      ]);
      primeira = false;
    }
  }

  const executar = (sql: string): Resultado => {
    try {
      const out = execFileSync(
        "psql",
        ["-h", socket, "-U", "postgres", "-d", "jornada", "-v", "ON_ERROR_STOP=1", "-t", "-A", "-F", "\u0001"],
        { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
      );
      const linhas = out
        .split("\n")
        .filter((l) => l.trim() !== "" && !/^(BEGIN|COMMIT|ROLLBACK|SET|DO|INSERT \d|UPDATE \d|DELETE \d|CREATE|GRANT|REVOKE)/.test(l.trim()))
        .map((l) => l.split("\u0001"));
      return { ok: true, erro: "", linhas };
    } catch (e) {
      const err = e as { stderr?: string; message?: string };
      return { ok: false, erro: String(err.stderr ?? err.message ?? e), linhas: [] };
    }
  };

  const envolver = (papel: string, userId: string | null, sql: string) =>
    [
      "begin;",
      userId ? `set local "request.jwt.claim.sub" = '${userId}';` : "",
      `set local role ${papel};`,
      sql.trim().endsWith(";") ? sql : `${sql};`,
      "commit;",
    ]
      .filter(Boolean)
      .join("\n");

  return {
    admin: (sql) => executar(sql),
    comoUtilizador: (userId, sql) => executar(envolver("authenticated", userId, sql)),
    comoServico: (sql) => executar(envolver("service_role", null, sql)),
    stop: () => {
      proc.kill("SIGQUIT");
      if (existsSync(base)) rmSync(base, { recursive: true, force: true });
    },
  };
}
