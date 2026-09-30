/** Reserva durável contra Postgres descartável, com concorrência real (ligações separadas). */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { iniciarDb, type Db } from "../../test/pg";

const ORG = "f07ab3be-7419-4779-a901-ef71c5fc27f0";
const OUTRA = "11111111-2222-3333-4444-555555555555";
let db: Db;

beforeAll(async () => {
  db = await iniciarDb();
  await db.query(readFileSync(join(process.cwd(), "sql/pending/0013_n8n_bridge_v1.sql"), "utf8"));
}, 180_000);
afterAll(() => db?.stop());

beforeEach(async () => {
  await db.query("delete from public.n8n_bridge_sends");
  await db.query("delete from public.n8n_bridge_rate");
  await db.query("delete from public.n8n_bridge_settings");
  await db.query("delete from public.ghl_location_bindings");
  await db.query("delete from public.audit_logs");
  await db.query("delete from public.webhooks_inbox");
  await db.query("delete from public.contacts");
  await db.query("delete from public.journey_stages");
  await db.query("delete from public.organizations");
  await db.query(
    `insert into public.organizations (id,name) values ('${ORG}','A'),('${OUTRA}','B')`,
  );
  await db.query(
    `insert into public.ghl_location_bindings (location_id, organization_id) values ('ok2UHC2QMZsd8UHsAgEa','${ORG}')`,
  );
});

const claim = (org = ORG, start = "2026-10-02T10:00:00.400Z", kind = "req24") =>
  `select public.n8n_bridge_claim_send('${org}'::uuid,'appt0001','${start}'::timestamptz,'${kind}')`;

describe("n8n bridge DB", () => {
  it("defaults desligados", async () => {
    await db.query(`insert into public.n8n_bridge_settings (organization_id) values ('${ORG}')`);
    const [r] = await db.query(
      "select bridge_enabled, live_send_enabled, simulation, channel, clinic_address, fallback_user_id from public.n8n_bridge_settings",
    );
    expect(r).toEqual({ c0: "f", c1: "f", c2: "t", c3: null, c4: null, c5: null });
  });

  it("channel_verified nasce false e sms nunca pode estar verificado", async () => {
    await db.query(`insert into public.n8n_bridge_settings (organization_id) values ('${ORG}')`);
    const [r] = await db.query("select channel_verified, zaptos_provider_id from public.n8n_bridge_settings");
    expect(r).toEqual({ c0: "f", c1: null });
    await expect(
      db.query("update public.n8n_bridge_settings set channel = 'sms', channel_verified = true"),
    ).rejects.toThrow();
  });

  it("concorrência real: 12 reservas simultâneas -> exatamente uma", async () => {
    const outs = await Promise.all(Array.from({ length: 12 }, () => db.queryAsync!(claim())));
    const reservados = outs.filter((o) => JSON.parse(o).reserved === true);
    expect(reservados).toHaveLength(1);
    const [n] = await db.query("select count(*) from public.n8n_bridge_sends");
    expect(n?.["c0"]).toBe("1");
  }, 60_000);

  it("horário normalizado ao segundo; kind distinto separa", async () => {
    await db.query(claim());
    const dup = JSON.parse(
      String((await db.query(claim(ORG, "2026-10-02T11:00:00.900+01:00")))[0]!["c0"]),
    );
    expect(dup.reserved).toBe(false);
    const outro = JSON.parse(
      String((await db.query(claim(ORG, "2026-10-02T10:00:00Z", "req12")))[0]!["c0"]),
    );
    expect(outro.reserved).toBe(true);
  });

  it("isolamento: org sem binding recusada", async () => {
    await expect(db.query(claim(OUTRA))).rejects.toThrow();
  });

  it("finish só uma vez; accepted exige id; duplicado só vê id se accepted", async () => {
    const r = JSON.parse(String((await db.query(claim()))[0]!["c0"]));
    await expect(
      db.query(`select public.n8n_bridge_finish_send('${ORG}','${r.id}','accepted',null,null)`),
    ).rejects.toThrow();
    const u = JSON.parse(
      String(
        (
          await db.query(
            `select public.n8n_bridge_finish_send('${ORG}','${r.id}','unknown',null,'outcome_unknown')`,
          )
        )[0]!["c0"],
      ),
    );
    expect(u.persisted).toBe(true);
    const again = JSON.parse(
      String(
        (
          await db.query(
            `select public.n8n_bridge_finish_send('${ORG}','${r.id}','accepted','m1',null)`,
          )
        )[0]!["c0"],
      ),
    );
    expect(again.persisted).toBe(false);
    const dup = JSON.parse(String((await db.query(claim()))[0]!["c0"]));
    expect(dup).toMatchObject({ reserved: false, state: "unknown", message_id: null });
  });

  it("finish de outra org não altera", async () => {
    const r = JSON.parse(String((await db.query(claim()))[0]!["c0"]));
    const x = JSON.parse(
      String(
        (
          await db.query(
            `select public.n8n_bridge_finish_send('${OUTRA}','${r.id}','accepted','m1',null)`,
          )
        )[0]!["c0"],
      ),
    );
    expect(x.persisted).toBe(false);
  });

  it("sem privilégios de escrita para anon/authenticated", async () => {
    const rows = await db.query(
      "select count(*) from information_schema.role_table_grants where table_name like 'n8n_bridge_%' and grantee in ('anon','authenticated')",
    );
    expect(rows[0]?.["c0"]).toBe("0");
    const [f] = await db.query(
      "select has_function_privilege('authenticated','public.n8n_bridge_claim_send(uuid,text,timestamptz,text)','execute')",
    );
    expect(f?.["c0"]).toBe("f");
  });

  it("quota por minuto", async () => {
    const r = [];
    for (let i = 0; i < 3; i++)
      r.push((await db.query(`select public.n8n_bridge_hit('${ORG}',2)`))[0]!["c0"]);
    expect(r).toEqual(["t", "t", "f"]);
  });
});
