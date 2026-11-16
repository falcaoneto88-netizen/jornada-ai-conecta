/** Real isolated PostgreSQL. No production URL, key or external workflow execution. */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { confirmationDb } from "../../test/confirmation-db";
const ORG = "11111111-1111-4111-8111-111111111111",
  OTHER = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333",
  FOREIGN = "44444444-4444-4444-8444-444444444444";
const VIEWER = "55555555-5555-4555-8555-555555555555";
let db: Awaited<ReturnType<typeof confirmationDb>>;
beforeAll(async () => {
  db = await confirmationDb();
  await db.query(`create table public.profiles(id uuid primary key,organization_id uuid not null references public.organizations(id));
    create table public.user_roles(user_id uuid not null,organization_id uuid not null,role text not null);
    create table public.ghl_connections(organization_id uuid primary key,location_id text,status text,write_enabled boolean);
    create table public.audit_logs(id uuid primary key default gen_random_uuid(),organization_id uuid,actor_id uuid,
      action text,entity text,entity_id text,metadata jsonb,verified boolean);`);
  await db.query(readFileSync("sql/pending/0013_n8n_bridge_v1.sql", "utf8"));
  // Supabase may grant service_role ALL through defaults; the migration must explicitly narrow it.
  await db.query("alter default privileges grant all on tables to service_role");
  await db.query(readFileSync("drizzle/migrations/0027_n8n_bridge_runtime_policy.sql", "utf8"));
  await db.query(`insert into organizations values('${ORG}','Test A'),('${OTHER}','Test B');
    insert into profiles values('${USER}','${ORG}'),('${FOREIGN}','${OTHER}'),('${VIEWER}','${ORG}');`);
}, 180_000);
afterAll(() => db?.stop());
beforeEach(async () => {
  await db.query(`delete from n8n_bridge_runtime_policies; delete from n8n_bridge_settings; delete from audit_logs;
    delete from ghl_location_bindings; delete from ghl_connections; delete from user_roles;
    insert into user_roles values('${USER}','${ORG}','administrador'),('${FOREIGN}','${OTHER}','administrador'),('${VIEWER}','${ORG}','visualizador');
    insert into ghl_location_bindings values('location01','${ORG}'),('location02','${OTHER}');
    insert into ghl_connections values('${ORG}','location01','conectada',true),('${OTHER}','location02','conectada',true);
    insert into n8n_bridge_settings(organization_id,calendar_id,channel,zaptos_provider_id,clinic_address)
      values('${ORG}','calendar01','whatsapp_zaptos','provider01','Morada sintética'),('${OTHER}','calendar02','whatsapp_zaptos','provider02','Morada sintética');`);
});
type Args = {
  actor?: string;
  mode?: string;
  revision?: number;
  kinds?: string;
  location?: string;
  calendar?: string;
  provider?: string;
  verified?: string;
};
const command = ({
  actor = USER,
  mode = "production",
  revision = 0,
  kinds = "ARRAY['booking','req24','req12']",
  location = "location01",
  calendar = "calendar01",
  provider = "provider01",
  verified = "clock_timestamp()",
}: Args = {}) =>
  `select public.n8n_bridge_set_runtime_policy('${actor}','${mode}',${revision},${kinds},'${location}','${calendar}','${provider}',${verified})`;
const run = async (args: Args = {}) =>
  JSON.parse(String((await db.query(command(args)))[0]!["c0"]));

describe("runtime policy migration and transactional authority", () => {
  it("has no active seed and preserves simulation flags until explicit activation", async () => {
    expect((await db.query("select count(*) from n8n_bridge_runtime_policies"))[0]!["c0"]).toBe(
      "0",
    );
    expect(
      (
        await db.query(
          `select bridge_enabled,live_send_enabled,simulation,channel_verified from n8n_bridge_settings where organization_id='${ORG}'`,
        )
      )[0],
    ).toEqual({ c0: "f", c1: "f", c2: "t", c3: "f" });
  });
  it("RLS isolates the policy; untrusted roles have no table or RPC privileges", async () => {
    expect(
      (
        await db.query(
          "select relrowsecurity from pg_class where oid='public.n8n_bridge_runtime_policies'::regclass",
        )
      )[0]!["c0"],
    ).toBe("t");
    for (const role of ["anon", "authenticated"]) {
      expect(
        (
          await db.query(
            `select has_table_privilege('${role}','public.n8n_bridge_runtime_policies','select,insert,update,delete')`,
          )
        )[0]!["c0"],
      ).toBe("f");
      expect(
        (
          await db.query(
            `select has_function_privilege('${role}','public.n8n_bridge_set_runtime_policy(uuid,text,bigint,text[],text,text,text,timestamptz)','execute')`,
          )
        )[0]!["c0"],
      ).toBe("f");
    }
    expect(
      (
        await db.query(
          "select count(*) from pg_policies where tablename='n8n_bridge_runtime_policies'",
        )
      )[0]!["c0"],
    ).toBe("0");
    expect(
      (
        await db.query(
          "select has_table_privilege('service_role','public.n8n_bridge_runtime_policies','update')",
        )
      )[0]!["c0"],
    ).toBe("f");
  });
  it("atomically persists exact scope, flags, revision and verified audit with service-only RPC", async () => {
    expect(await run()).toEqual({ revision: 1 });
    expect(
      (
        await db.query(
          `select mode,location_id,calendar_id,zaptos_provider_id,revision from n8n_bridge_runtime_policies where organization_id='${ORG}'`,
        )
      )[0],
    ).toEqual({ c0: "production", c1: "location01", c2: "calendar01", c3: "provider01", c4: "1" });
    expect(
      (
        await db.query(
          `select bridge_enabled,live_send_enabled,simulation,channel_verified from n8n_bridge_settings where organization_id='${ORG}'`,
        )
      )[0],
    ).toEqual({ c0: "t", c1: "t", c2: "f", c3: "t" });
    const audit = JSON.parse(String((await db.query("select metadata from audit_logs"))[0]!["c0"]));
    expect(audit).toMatchObject({
      previous_mode: "pilot",
      mode: "production",
      previous_revision: 0,
      revision: 1,
      simulation: false,
    });
    expect(
      (
        await db.query(
          `select live_send_enabled from n8n_bridge_settings where organization_id='${OTHER}'`,
        )
      )[0]!["c0"],
    ).toBe("f");
  });
  it("does not let another org's admin activate this tuple", async () => {
    expect(await run({ actor: FOREIGN })).toMatchObject({ error: "configuration_changed" });
    expect((await db.query("select count(*) from n8n_bridge_runtime_policies"))[0]!["c0"]).toBe(
      "0",
    );
  });
  it("another org's off action cannot revoke this organization's production policy", async () => {
    await run();
    expect(
      await run({ actor: FOREIGN, mode: "off", kinds: "ARRAY[]::text[]", verified: "NULL" }),
    ).toEqual({ revision: 1 });
    expect(
      (
        await db.query(
          `select mode from n8n_bridge_runtime_policies where organization_id='${ORG}'`,
        )
      )[0]!["c0"],
    ).toBe("production");
    expect(
      (
        await db.query(
          `select live_send_enabled from n8n_bridge_settings where organization_id='${ORG}'`,
        )
      )[0]!["c0"],
    ).toBe("t");
  });
  it.each([VIEWER, "66666666-6666-4666-8666-666666666666"])(
    "revalidates actor role and membership %s",
    async (actor) => {
      expect(await run({ actor })).toEqual({ error: "forbidden" });
    },
  );
  it("role revoked after server checks cannot activate", async () => {
    await db.query(`update user_roles set role='visualizador' where user_id='${USER}'`);
    expect(await run()).toEqual({ error: "forbidden" });
    expect((await db.query("select count(*) from audit_logs"))[0]!["c0"]).toBe("0");
  });
  it.each(["calendar_id='other001'", "zaptos_provider_id='other001'", "channel='sms'"])(
    "rejects changed configuration %s",
    async (assignment) => {
      await db.query(`update n8n_bridge_settings set ${assignment} where organization_id='${ORG}'`);
      expect(await run()).toEqual({ error: "configuration_changed" });
    },
  );
  it.each(["write_enabled=false", "status='desconectada'", "location_id='other001'"])(
    "does not override connection changes %s",
    async (assignment) => {
      await db.query(`update ghl_connections set ${assignment} where organization_id='${ORG}'`);
      expect(await run()).toEqual({ error: "binding_unavailable" });
    },
  );
  it.each([
    "ARRAY['confirm']",
    "ARRAY['appointment.confirm']",
    "ARRAY['booking','req24','confirm']",
  ])("does not expand pilot-only actions to production: %s", async (kinds) => {
    expect(await run({ kinds })).toEqual({ error: "invalid_request" });
    expect((await db.query("select count(*) from n8n_bridge_runtime_policies"))[0]!["c0"]).toBe(
      "0",
    );
  });
  it.each([
    "NULL",
    "clock_timestamp()-interval '3 minutes'",
    "clock_timestamp()+interval '1 minute'",
  ])("rejects stale or invented verification timestamp %s", async (verified) => {
    expect(await run({ verified })).toEqual({ error: "verification_expired" });
  });
  it.each([
    "ARRAY[]::text[]",
    "ARRAY['handoff']",
    "ARRAY['booking','booking']",
    "ARRAY['booking',NULL]",
    "ARRAY[['booking'],['req24']]",
  ])("rejects invalid production actions %s", async (kinds) => {
    expect(await run({ kinds })).toEqual({ error: "invalid_request" });
  });
  it("CAS conflict never overwrites a concurrent decision or adds audit", async () => {
    expect(await run()).toEqual({ revision: 1 });
    expect(await run({ mode: "off" })).toEqual({ error: "revision_conflict" });
    expect((await db.query("select count(*) from audit_logs"))[0]!["c0"]).toBe("1");
    expect((await db.query("select mode from n8n_bridge_runtime_policies"))[0]!["c0"]).toBe(
      "production",
    );
  });
  it("concurrent activation has a single CAS winner", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => db.queryAsync(command())));
    expect(results.map((r) => JSON.parse(r)).filter((r) => r.revision === 1)).toHaveLength(1);
    expect(
      results.map((r) => JSON.parse(r)).filter((r) => r.error === "revision_conflict"),
    ).toHaveLength(7);
    expect((await db.query("select count(*) from audit_logs"))[0]!["c0"]).toBe("1");
  }, 60_000);
  it("revocation disables flags even if binding/connection/calendar no longer work", async () => {
    await run();
    await db.query(`delete from ghl_location_bindings; delete from ghl_connections;
      update n8n_bridge_settings set calendar_id=null,zaptos_provider_id=null where organization_id='${ORG}'`);
    expect(
      await run({ mode: "off", revision: 1, kinds: "ARRAY[]::text[]", verified: "NULL" }),
    ).toEqual({ revision: 2 });
    expect(
      (
        await db.query(
          `select bridge_enabled,live_send_enabled,simulation from n8n_bridge_settings where organization_id='${ORG}'`,
        )
      )[0],
    ).toEqual({ c0: "f", c1: "f", c2: "t" });
    expect(
      (
        await db.query(
          "select mode,cardinality(allowed_kinds),verified_at from n8n_bridge_runtime_policies",
        )
      )[0],
    ).toEqual({ c0: "off", c1: "0", c2: null });
  });
  it("returning to pilot never enables real sends or creates a live grant", async () => {
    await run();
    expect(
      await run({ mode: "pilot", revision: 1, kinds: "ARRAY[]::text[]", verified: "NULL" }),
    ).toEqual({ revision: 2 });
    expect(
      (
        await db.query(
          `select bridge_enabled,live_send_enabled,simulation from n8n_bridge_settings where organization_id='${ORG}'`,
        )
      )[0],
    ).toEqual({ c0: "t", c1: "f", c2: "t" });
  });
  it("audit failure rolls back flags and policy together", async () => {
    await db.query(
      "alter table audit_logs add constraint reject_runtime_audit check (action<>'n8n.runtime.policy.changed')",
    );
    try {
      await expect(run()).rejects.toThrow();
      expect((await db.query("select count(*) from n8n_bridge_runtime_policies"))[0]!["c0"]).toBe(
        "0",
      );
      expect(
        (
          await db.query(
            `select live_send_enabled,simulation from n8n_bridge_settings where organization_id='${ORG}'`,
          )
        )[0],
      ).toEqual({ c0: "f", c1: "t" });
    } finally {
      await db.query("alter table audit_logs drop constraint reject_runtime_audit");
    }
  });
});
