/** Durable single-attempt claims against an isolated database, never the connected CRM. */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { confirmationDb } from "../../test/confirmation-db";
const ORG = "f07ab3be-7419-4779-a901-ef71c5fc27f0",
  OTHER = "11111111-2222-3333-4444-555555555555";
let db: Awaited<ReturnType<typeof confirmationDb>>, request: string;
beforeAll(async () => {
  db = await confirmationDb();
  await db.query(readFileSync("sql/pending/0013_n8n_bridge_v1.sql", "utf8"));
  await db.query(readFileSync("drizzle/migrations/0014_n8n_bridge_confirmations.sql", "utf8"));
}, 180_000);
afterAll(() => db?.stop());
beforeEach(async () => {
  await db.query(
    "delete from public.n8n_bridge_confirmations; delete from public.n8n_bridge_sends",
  );
  await db.query(
    `insert into public.organizations(id,name) values ('${ORG}','A'),('${OTHER}','B') on conflict do nothing`,
  );
  await db.query(
    `insert into public.ghl_location_bindings(location_id,organization_id) values ('location01','${ORG}') on conflict do nothing`,
  );
  const r = await db.query(
    `insert into public.n8n_bridge_sends(organization_id,ghl_appointment_id,start_time,kind,state,message_id,finished_at,contact_id) values ('${ORG}','appoint01',now()+interval '1 day','req24','accepted','outbound01',now()-interval '2 minutes','contact01') returning id`,
  );
  request = String(r[0]!["c0"]);
});
const claim = (org = ORG, message = "inbound01", source = request) =>
  `select public.n8n_bridge_claim_confirmation('${org}','${source}','${message}',now()-interval '1 minute')`;
const val = (rows: Record<string, unknown>[]) => JSON.parse(String(rows[0]!["c0"]));
describe("confirmation durable claims", () => {
  it("candidate lookup is contact scoped even with many other contacts", async () => {
    await db.query(`insert into public.n8n_bridge_sends(organization_id,ghl_appointment_id,start_time,kind,state,message_id,finished_at,contact_id)
      select '${ORG}','otherappt'||n,now()+interval '1 day','req24','accepted','othermsg'||n,now()-interval '2 minutes','contact02' from generate_series(1,100) n`);
    const r = val(
      await db.query(
        `select public.n8n_bridge_confirmation_requests('${ORG}','contact01',now()-interval '1 minute')`,
      ),
    );
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe(request);
  });
  it("new send overload persists verified contact while legacy sends remain unlinked", async () => {
    const linked = val(
      await db.query(
        `select public.n8n_bridge_claim_send('${ORG}','appoint03',now()+interval '1 day','req24','contact03')`,
      ),
    );
    expect(linked.reserved).toBe(true);
    expect(
      (
        await db.query(`select contact_id from public.n8n_bridge_sends where id='${linked.id}'`)
      )[0]!["c0"],
    ).toBe("contact03");
    const old = val(
      await db.query(
        `select public.n8n_bridge_claim_send('${ORG}','appoint04',now()+interval '1 day','req24')`,
      ),
    );
    await db.query(
      `update public.n8n_bridge_sends set state='accepted',message_id='oldmsg001',finished_at=now()-interval '2 minutes' where id='${old.id}'`,
    );
    expect(
      val(
        await db.query(
          `select public.n8n_bridge_confirmation_requests('${ORG}','contact01',now()-interval '1 minute')`,
        ),
      ),
    ).toHaveLength(1);
    await expect(db.query(claim(ORG, "inbound99", old.id))).rejects.toThrow();
  });

  it("only one of concurrent claims reserves", async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => db.queryAsync!(claim())));
    expect(results.filter((r) => JSON.parse(r).reserved)).toHaveLength(1);
  }, 60_000);
  it("different reply for same appointment cannot reserve again", async () => {
    expect(val(await db.query(claim())).reserved).toBe(true);
    expect(val(await db.query(claim(ORG, "inbound02"))).reserved).toBe(false);
  });
  it("reply cannot be reused on another appointment", async () => {
    const first = val(await db.query(claim()));
    await db.query(
      `select public.n8n_bridge_finish_confirmation('${ORG}','${first.id}','confirmed',null)`,
    );
    const r = await db.query(
      `insert into public.n8n_bridge_sends(organization_id,ghl_appointment_id,start_time,kind,state,message_id,finished_at,contact_id) values ('${ORG}','appoint02',now()+interval '1 day','req24','accepted','outbound02',now()-interval '2 minutes','contact01') returning id`,
    );
    const duplicate = val(await db.query(claim(ORG, "inbound01", String(r[0]!["c0"]))));
    expect(duplicate).toMatchObject({ reserved: false, state: "message_already_used" });
  });
  it("tenant cannot claim other tenant evidence", async () => {
    await expect(db.query(claim(OTHER))).rejects.toThrow();
  });
  it("requires accepted send before inbound, before appointment", async () => {
    await db.query("update public.n8n_bridge_sends set state='unknown'");
    await expect(db.query(claim())).rejects.toThrow();
    await db.query("update public.n8n_bridge_sends set state='accepted',finished_at=now()");
    await expect(db.query(claim())).rejects.toThrow();
  });
  it("unknown cannot transition to confirmed on retry", async () => {
    const r = val(await db.query(claim()));
    expect(
      val(
        await db.query(
          `select public.n8n_bridge_finish_confirmation('${ORG}','${r.id}','unknown','outcome_unknown')`,
        ),
      ).persisted,
    ).toBe(true);
    expect(
      val(
        await db.query(
          `select public.n8n_bridge_finish_confirmation('${ORG}','${r.id}','confirmed',null)`,
        ),
      ).persisted,
    ).toBe(false);
    expect(val(await db.query(claim()))).toMatchObject({ reserved: false, state: "unknown" });
  });
  it("only service role can access tables and functions", async () => {
    expect(
      (
        await db.query(
          "select count(*) from information_schema.role_table_grants where table_name='n8n_bridge_confirmations' and grantee in ('anon','authenticated')",
        )
      )[0]!["c0"],
    ).toBe("0");
    expect(
      (
        await db.query(
          "select has_function_privilege('authenticated','public.n8n_bridge_claim_confirmation(uuid,uuid,text,timestamptz)','execute')",
        )
      )[0]!["c0"],
    ).toBe("f");
  });
});
