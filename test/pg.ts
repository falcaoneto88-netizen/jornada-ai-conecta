/**
 * Base de dados Postgres efémera para testes: cria um cluster temporário,
 * aplica o esquema sintético e a migração real das funções do webhook.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type Db = {
  query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
  stop: () => void;
};

const RAIZ = process.cwd();

function migracaoWebhook(): string {
  const dir = join(RAIZ, "supabase/migrations");
  const ficheiro = readdirSync(dir)
    .sort()
    .reverse()
    .find((f) => readFileSync(join(dir, f), "utf8").includes("ghl_claim_delivery"));
  if (!ficheiro) throw new Error("migração das funções do webhook não encontrada");
  const sql = readFileSync(join(dir, ficheiro), "utf8");
  // A revogação da função antiga (v1) não se aplica ao esquema sintético.
  return sql.replace(/revoke all on function public\.ghl_apply_contact_event\(uuid, uuid[^;]*;/g, "");

}

export async function iniciarDb(): Promise<Db> {
  const base = mkdtempSync(join(tmpdir(), "jornada-pg-"));
  const dados = join(base, "data");
  const socket = base;
  // O Postgres recusa correr como root; usamos um uid sem privilégios.
  const semPrivilegios = process.getuid?.() === 0;
  const prefixo = semPrivilegios
    ? ["setpriv", "--reuid=1000", "--regid=1000", "--clear-groups"]
    : [];
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

  for (let i = 0; i < 60; i++) {
    try {
      psql(["-d", "postgres", "-c", "select 1"]);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  psql(["-d", "postgres", "-c", "create database jornada"]);
  psql(["-d", "jornada", "-f", join(RAIZ, "test/fixtures/schema.sql")]);
  psql(["-d", "jornada"], migracaoWebhook());

  const query = async (sql: string, params: unknown[] = []) => {
    const texto = params.length
      ? sql.replace(/\$(\d+)/g, (_m, n: string) => {
          const v = params[Number(n) - 1];
          if (v === null || v === undefined) return "null";
          if (typeof v === "number") return String(v);
          if (typeof v === "boolean") return v ? "true" : "false";
          return `'${String(v).replace(/'/g, "''")}'`;
        })
      : sql;
    const out = psql(["-d", "jornada", "-t", "-A", "-F", "\u0001", "-c", texto]);
    const linhas = out.split("\n").filter((l) => l.trim() !== "");
    return linhas.map((l) => {
      const cols = l.split("\u0001");
      const obj: Record<string, unknown> = {};
      cols.forEach((c, i) => {
        obj[`c${i}`] = c === "" ? null : c;
      });
      return obj;
    });
  };

  return {
    query,
    stop: () => {
      proc.kill("SIGQUIT");
      if (existsSync(base)) rmSync(base, { recursive: true, force: true });
    },
  };
}
