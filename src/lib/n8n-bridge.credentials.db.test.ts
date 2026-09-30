/** Migração 0014 contra Postgres descartável: criação única concorrente e concessões restritas. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { iniciarDb, type Db } from "../../test/pg";

const ORG = "f07ab3be-7419-4779-a901-ef71c5fc27f0";
const USER = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
let db: Db;

const ler = (f: string) => readFileSync(join(process.cwd(), "sql/pending", f), "utf8");

beforeAll(async () => {
  db = await iniciarDb();
  await db.query(ler("0013_n8n_bridge_v1.sql"));
  await db.query(ler("0014_n8n_bridge_credentials.sql"));
}, 180_000);
afterAll(() => db?.stop());

beforeEach(async () => {
  await db.query("delete from public.n8n_bridge_credentials");
  await db.query(
    `insert into public.organizations (id,name) values ('${ORG}','A') on conflict do nothing`,
  );
});

const hex = (i: number) => i.toString(16).padStart(64, "0");

describe("n8n_bridge_credentials", () => {
  it("12 criações simultâneas -> exatamente uma", async () => {
    const outs = await Promise.allSettled(
      Array.from({ length: 12 }, (_, i) =>
        db.queryAsync!(
          `insert into public.n8n_bridge_credentials (organization_id,key_sha256,created_by) values ('${ORG}','${hex(i + 1)}','${USER}')`,
        ),
      ),
    );
    expect(outs.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    const [c] = await db.query("select count(*) from public.n8n_bridge_credentials");
    expect(c!["c0"]).toBe("1");
  });
  it("só aceita digest hex minúsculo de 64", async () => {
    for (const bad of ["abc", hex(1).toUpperCase().replace(/0/g, "A"), `${hex(1)}0`]) {
      await expect(
        db.query(
          `insert into public.n8n_bridge_credentials (organization_id,key_sha256,created_by) values ('${ORG}','${bad}','${USER}')`,
        ),
      ).rejects.toThrow();
    }
  });
  it("sem concessões a anon/authenticated/PUBLIC; RLS ativo; service_role com acesso", async () => {
    const [g] = await db.query(
      "select count(*) from information_schema.role_table_grants where table_name = 'n8n_bridge_credentials' and grantee in ('anon','authenticated','PUBLIC')",
    );
    expect(g!["c0"]).toBe("0");
    const [p] = await db.query(
      "select has_table_privilege('authenticated','public.n8n_bridge_credentials','SELECT'), has_table_privilege('anon','public.n8n_bridge_credentials','INSERT'), has_table_privilege('service_role','public.n8n_bridge_credentials','INSERT')",
    );
    expect(p).toEqual({ c0: "f", c1: "f", c2: "t" });
    const [r] = await db.query(
      "select relrowsecurity from pg_class where oid = 'public.n8n_bridge_credentials'::regclass",
    );
    expect(r!["c0"]).toBe("t");
  });
});
