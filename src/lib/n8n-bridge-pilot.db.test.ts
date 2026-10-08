/** Local embedded PostgreSQL only; no production URL, credentials or seed. */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { confirmationDb } from "../../test/confirmation-db";
const ORG = "11111111-1111-4111-8111-111111111111",
  OTHER = "22222222-2222-4222-8222-222222222222";
let db: Awaited<ReturnType<typeof confirmationDb>>;
beforeAll(async () => {
  db = await confirmationDb();
  await db.query(readFileSync("sql/pending/0013_n8n_bridge_v1.sql", "utf8"));
  await db.query(readFileSync("drizzle/migrations/0014_n8n_bridge_confirmations.sql", "utf8"));
  await db.query(readFileSync("drizzle/migrations/0015_n8n_bridge_pilot_grants.sql", "utf8"));
  await db.query(
    `insert into public.organizations(id,name) values ('${ORG}','Test A'),('${OTHER}','Test B')`,
  );
  await db.query(
    `insert into public.ghl_location_bindings(location_id,organization_id) values ('location01','${ORG}')`,
  );
}, 180_000);
afterAll(() => db?.stop());
beforeEach(async () => {
  await db.query(
    "delete from public.n8n_bridge_pilot_grants; delete from public.n8n_bridge_confirmations; delete from public.n8n_bridge_sends",
  );
});
const insert = (extra = "", org = ORG) =>
  `insert into public.n8n_bridge_pilot_grants(organization_id,contact_id,ghl_appointment_id,start_time,expires_at,updated_by${extra ? ",enabled,allowed_kinds" : ""}) values('${org}','contact01','appoint01',now()+interval '1 day',now()+interval '1 hour','${ORG}'${extra})`;
describe("pilot schema isolation and existing reservation semantics", () => {
  it("migration has no enabled row and preserves default off/empty kinds", async () => {
    expect((await db.query("select count(*) from public.n8n_bridge_pilot_grants"))[0]!["c0"]).toBe(
      "0",
    );
    await db.query(insert());
    expect(
      (
        await db.query(
          "select enabled, cardinality(allowed_kinds) from public.n8n_bridge_pilot_grants",
        )
      )[0],
    ).toEqual({ c0: "f", c1: "0" });
  });
  it("only service role has table privileges; RLS is enabled with no public policy", async () => {
    expect(
      (
        await db.query(
          "select relrowsecurity from pg_class where oid='public.n8n_bridge_pilot_grants'::regclass",
        )
      )[0]!["c0"],
    ).toBe("t");
    for (const role of ["anon", "authenticated"]) {
      expect(
        (
          await db.query(
            `select has_table_privilege('${role}','public.n8n_bridge_pilot_grants','select,insert,update,delete')`,
          )
        )[0]!["c0"],
      ).toBe("f");
    }
    expect(
      (
        await db.query(
          "select has_table_privilege('service_role','public.n8n_bridge_pilot_grants','select,insert,update,delete')",
        )
      )[0]!["c0"],
    ).toBe("t");
    expect(
      (
        await db.query("select count(*) from pg_policies where tablename='n8n_bridge_pilot_grants'")
      )[0]!["c0"],
    ).toBe("0");
  });
  it("one exact grant per organization, without cross-org overwrite", async () => {
    await db.query(insert(",true,ARRAY['booking','req24','appointment.confirm','confirm']"));
    await db.query(insert(",true,ARRAY['booking']", OTHER));
    await expect(db.query(insert(",true,ARRAY['booking']"))).rejects.toThrow();
    expect((await db.query("select count(*) from public.n8n_bridge_pilot_grants"))[0]!["c0"]).toBe(
      "2",
    );
  });
  it.each([
    "ARRAY[]::text[]",
    "ARRAY['handoff']",
    "ARRAY['anything']",
    "ARRAY['booking',NULL]",
    "ARRAY[['booking'],['req24']]",
  ])("rejects invalid enabled actions %s", async (kinds) => {
    await expect(db.query(insert(`,true,${kinds}`))).rejects.toThrow();
  });
  it.each(["updated_at", "updated_at + interval '25 hours'", "start_time + interval '1 second'"])(
    "rejects invalid active expiry %s",
    async (expr) => {
      await db.query(insert(",true,ARRAY['booking']"));
      await expect(
        db.query(`update public.n8n_bridge_pilot_grants set expires_at=${expr}`),
      ).rejects.toThrow();
    },
  );
  it("revocation is possible after expiry", async () => {
    await db.query(insert(",true,ARRAY['booking']"));
    await db.query(
      "update public.n8n_bridge_pilot_grants set enabled=false, updated_at=now()+interval '2 hours'",
    );
    expect((await db.query("select enabled from public.n8n_bridge_pilot_grants"))[0]!["c0"]).toBe(
      "f",
    );
  });
  it("existing exact send claim remains single-winner under concurrency", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        db.queryAsync(
          `select public.n8n_bridge_claim_send('${ORG}','appoint01','2026-10-09T10:00:00Z','booking','contact01')`,
        ),
      ),
    );
    expect(results.filter((r) => JSON.parse(r).reserved)).toHaveLength(1);
  }, 60_000);
  it("unknown existing outcome never becomes resendable", async () => {
    const query = `select public.n8n_bridge_claim_send('${ORG}','appoint01','2026-10-09T10:00:00Z','booking','contact01')`;
    const first = JSON.parse(String((await db.query(query))[0]!["c0"]));
    await db.query(
      `select public.n8n_bridge_finish_send('${ORG}','${first.id}','unknown',null,'outcome_unknown')`,
    );
    expect(JSON.parse(String((await db.query(query))[0]!["c0"]))).toMatchObject({
      reserved: false,
      state: "unknown",
    });
  });
});
