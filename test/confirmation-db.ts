/** Real isolated PostgreSQL using the existing test runtime; no production URL is read. */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";

type QueryResult = { rows: Record<string, unknown>[] };
const resultRows = (result: QueryResult | QueryResult[]) =>
  Array.isArray(result) ? result.flatMap((r) => r.rows) : result.rows;
type Client = {
  connect: () => Promise<void>;
  end: () => Promise<void>;
  query: (sql: string) => Promise<QueryResult | QueryResult[]>;
};
export async function confirmationDb() {
  const runtime = process.env["BIOREPORT_TEST_RUNTIME"] || resolve("test/bioreport-runtime");
  const require = createRequire(join(runtime, "package.json"));
  const { default: EmbeddedPostgres } = await import(
    pathToFileURL(require.resolve("embedded-postgres")).href
  );
  const { Client: PgClient } = require("pg") as { Client: new (cfg: unknown) => Client };
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("temporary port unavailable");
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  const base = await mkdtemp(join(tmpdir(), "jornada-confirmation-db-"));
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
  await pg.initialise();
  await pg.start();
  const cfg = { host: "127.0.0.1", port, user: "postgres", password, database: "postgres" };
  const client = new PgClient(cfg);
  await client.connect();
  await client.query(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create table public.organizations(id uuid primary key, name text);
    create table public.ghl_location_bindings(location_id text primary key, organization_id uuid not null references public.organizations(id));`);
  return {
    query: async (sql: string) =>
      resultRows(await client.query(sql)).map((row) =>
        Object.fromEntries(
          Object.values(row).map((value, index) => [
            `c${index}`,
            value && typeof value === "object"
              ? JSON.stringify(value)
              : typeof value === "boolean"
                ? value
                  ? "t"
                  : "f"
                : value == null
                  ? null
                  : String(value),
          ]),
        ),
      ),
    queryAsync: async (sql: string) => {
      const concurrent = new PgClient(cfg);
      await concurrent.connect();
      try {
        return JSON.stringify(Object.values(resultRows(await concurrent.query(sql))[0]!)[0]);
      } finally {
        await concurrent.end();
      }
    },
    stop: async () => {
      await client.end();
      await pg.stop();
    },
  };
}
