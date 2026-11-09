// PGlite efémero: migrações reais, dados sintéticos, sem rede/credenciais externas.
// Opcional: ATTRIBUTION_TEST_RUNTIME aponta para diretório local com @electric-sql/pglite.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
const require = createRequire(
  join(resolve(process.env.ATTRIBUTION_TEST_RUNTIME || "."), "package.json"),
);
const { PGlite } = require("@electric-sql/pglite");
const db = new PGlite();
let assertions = 0;
const check = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  assertions++;
  console.log("PASS", label);
};
async function denied(sql, params = [], code = "42501") {
  await assert.rejects(db.query(sql, params), (e) => e.code === code);
  assertions++;
}
const capturedAt = new Date().toISOString();
const attr = () => ({
  version: "2026-11-09.attribution.v1",
  source: "ig",
  medium: "paid_social",
  campaign: "pt-s01-001",
  campaignId: "12345678901",
  adsetId: "12345678902",
  adId: "12345678903",
  capturedAt,
  consent: { analytics: true, version: "2026-11-09.analytics.v1" },
});
const sql =
  "select public.ingest_site_lead_v3($1,$2,$3,$4,$5,$6,null,'2026-09-17.contact.v1',now(),$7,null,$8) as receipt";
const args = (
  id,
  attribution = attr(),
  source = "experiencia-falcao",
  hash = "a".repeat(64),
  phone = "447700900123",
) => [source, id, hash, "Pessoa Sintética", `+${phone}`, phone, "b".repeat(64), attribution];
const ingest = async (...input) => (await db.query(sql, args(...input))).rows[0].receipt;
const scalar = async (query, params = []) =>
  Object.values((await db.query(query, params)).rows[0])[0];

try {
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key default gen_random_uuid(),email text,raw_user_meta_data jsonb not null default '{}',created_at timestamptz default now());
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to anon,authenticated,service_role;`);
  let first = true;
  for (const file of (await readdir("supabase/migrations"))
    .filter((f) => f.endsWith(".sql") && f < "20260912")
    .sort()) {
    await db.exec(await readFile(join("supabase/migrations", file), "utf8"));
    if (first) {
      await db.exec(
        "insert into organizations(id,name) values('f07ab3be-7419-4779-a901-ef71c5fc27f0','Marcador sintético')",
      );
      first = false;
    }
  }
  for (const file of [
    "0000_site_integration_experiencia_falcao.sql",
    "0001_site_lead_serializacao_quota_e_escrita_remota.sql",
    "0002_site_lead_acolhimento_sms_outbox.sql",
    "0003_site_lead_identidade_consentida_locks_e_quota_hmac.sql",
    "0022_site_lead_internal_attribution.sql",
  ])
    await db.exec(await readFile(join("drizzle/migrations", file), "utf8"));
  const orgA = randomUUID(),
    orgB = randomUUID(),
    integrationA = randomUUID(),
    integrationB = randomUUID();
  await db.query(
    "insert into organizations(id,name) values($1,'Org sintética A'),($2,'Org sintética B')",
    [orgA, orgB],
  );
  await db.query(
    "insert into ghl_location_bindings(location_id,organization_id) values('synthetic-a',$1),('synthetic-b',$2)",
    [orgA, orgB],
  );
  await db.query(
    `insert into site_integrations(id,organization_id,slug,source,enabled,ghl_location_id)
    values($1,$2,'experiencia-falcao','experiencia-falcao',true,'synthetic-a'),
      ($3,$4,'site-sintetico-b','site-sintetico-b',true,'synthetic-b')`,
    [integrationA, orgA, integrationB, orgB],
  );

  // Papéis de visitantes não podem ler/escrever nem executar o ingresso.
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    await denied("select * from site_lead_attributions");
    await denied(sql, args(randomUUID()));
    await db.exec("reset role");
  }
  check(
    await scalar(
      "select relrowsecurity from pg_class where oid='public.site_lead_attributions'::regclass",
    ),
    true,
    "RLS ligada",
  );
  check(
    await scalar(
      "select has_table_privilege('service_role','public.site_lead_attributions','INSERT')",
    ),
    false,
    "sem escrita direta service_role",
  );
  check(
    await scalar(
      "select has_table_privilege('service_role','public.site_lead_attributions','UPDATE')",
    ),
    false,
    "sem overwrite direto service_role",
  );
  const functionMeta = (
    await db.query(
      "select prosecdef,proconfig from pg_proc where oid='public.ingest_site_lead_v3(text,uuid,text,text,text,text,text,text,timestamptz,text,text,jsonb)'::regprocedure",
    )
  ).rows[0];
  check(functionMeta.prosecdef, true, "RPC SECURITY DEFINER");
  check(functionMeta.proconfig, ['search_path=""'], "RPC search_path vazio");

  await db.exec("set role service_role");
  const id = randomUUID(),
    firstReceipt = await ingest(id);
  check(firstReceipt.duplicate, false, "primeiro ingresso");
  const stored = (
    await db.query("select * from site_lead_attributions where submission_id=$1", [
      firstReceipt.receipt_id,
    ])
  ).rows[0];
  check(
    [stored.organization_id, stored.integration_id],
    [orgA, integrationA],
    "escopo derivado do recibo",
  );
  check(stored.attribution, attr(), "atribuição persistida exata");
  check(stored.provenance, "site_declared_unverified", "não inventa validação Meta");
  const duplicate = await ingest(id);
  check(
    [duplicate.duplicate, duplicate.receipt_id],
    [true, firstReceipt.receipt_id],
    "reenvio idempotente",
  );
  check(await scalar("select count(*)::integer from site_lead_attributions"), 1, "sem duplicação");
  await denied(sql, args(id, { ...attr(), adId: "99999999" }), "23505");
  await denied(sql, args(id, null), "23505");
  await denied(sql, args(id, attr(), "experiencia-falcao", "c".repeat(64)), "23505");
  check(
    (
      await db.query("select attribution from site_lead_attributions where submission_id=$1", [
        firstReceipt.receipt_id,
      ])
    ).rows[0].attribution,
    attr(),
    "origem imutável após conflitos",
  );

  // Pedidos legados continuam sem atribuição; o RPC não permite backfill por replay.
  const legacy = randomUUID();
  await ingest(legacy, null);
  check((await ingest(legacy, null)).duplicate, true, "legado idempotente");
  await denied(sql, args(legacy), "23505");
  check(
    await scalar("select count(*)::integer from site_lead_attributions"),
    1,
    "sem backfill legado",
  );

  const sameIdOtherOrg = await ingest(id, attr(), "site-sintetico-b");
  const storedB = (
    await db.query(
      "select organization_id,integration_id from site_lead_attributions where submission_id=$1",
      [sameIdOtherOrg.receipt_id],
    )
  ).rows[0];
  check(
    [storedB.organization_id, storedB.integration_id],
    [orgB, integrationB],
    "mesmo requestId isolado por integração",
  );

  for (const extra of [
    { campaign: "harmonizacao" },
    { campaignId: 12345 },
    { adId: "1234" },
    { adsetId: "1".repeat(31) },
    { organizationId: orgB },
    { name: "Pessoa" },
    { url: "https://example.invalid" },
    { fbclid: "click" },
    { consent: { analytics: false, version: "2026-11-09.analytics.v1" } },
    { capturedAt: "2026-02-31T12:00:00Z" },
    { capturedAt: "2026-11-09T12:00:00" },
    { capturedAt: new Date(Date.now() - 25 * 3600000).toISOString() },
    { capturedAt: new Date(Date.now() + 10 * 60000).toISOString() },
  ])
    await denied(sql, args(randomUUID(), { ...attr(), ...extra }), "22023");
  await denied(sql, args(randomUUID(), JSON.stringify("bad")), "22023");
  await denied(sql, args(randomUUID(), "bad"), "22P02");

  // Fixture administrativa simula passagem de 25h desde uma captura válida.
  // Só o relógio/estado do teste é envelhecido; o RPC não atualiza atribuições.
  const oldAttribution = {
    ...attr(),
    capturedAt: new Date(Date.now() - 25 * 3600000).toISOString(),
  };
  await db.exec("reset role");
  await db.query(
    "update site_lead_attributions set attribution=$1,created_at=now()-interval '25 hours' where submission_id=$2",
    [oldAttribution, firstReceipt.receipt_id],
  );
  await db.exec("set role service_role");
  check(
    (await ingest(id, oldAttribution)).duplicate,
    true,
    "reenvio persistido após 24h continua idempotente",
  );
  const staleNewId = randomUUID();
  await denied(sql, args(staleNewId, oldAttribution), "22023");
  check(
    await scalar("select count(*)::integer from site_lead_submissions where request_id=$1", [
      staleNewId,
    ]),
    0,
    "captura nova vencida reverte recibo",
  );

  await db.exec("reset role");
  const before = await scalar("select count(*)::integer from contacts");
  const failureId = randomUUID();
  await db.exec(`create function public.synthetic_fail_attribution() returns trigger language plpgsql as $$begin raise exception 'synthetic_storage_failure'; end$$;
    create trigger synthetic_fail_attribution before insert on public.site_lead_attributions for each row execute function public.synthetic_fail_attribution();`);
  await db.exec("set role service_role");
  await denied(
    sql,
    args(failureId, attr(), "experiencia-falcao", "d".repeat(64), "447700900456"),
    "P0001",
  );
  await db.exec("reset role");
  check(
    await scalar("select count(*)::integer from site_lead_submissions where request_id=$1", [
      failureId,
    ]),
    0,
    "falha atribuição reverte recibo",
  );
  check(
    await scalar("select count(*)::integer from contacts"),
    before,
    "falha atribuição reverte contacto",
  );
  await db.exec(
    "drop trigger synthetic_fail_attribution on public.site_lead_attributions; drop function public.synthetic_fail_attribution()",
  );
  await db.query("delete from site_lead_submissions where id=$1", [firstReceipt.receipt_id]);
  check(
    await scalar("select count(*)::integer from site_lead_attributions where submission_id=$1", [
      firstReceipt.receipt_id,
    ]),
    0,
    "eliminação do recibo elimina atribuição",
  );
  check(
    await scalar(
      "select count(*)::integer from site_integrations where remote_write_state <> 'pendente' or welcome_channel_state <> 'pendente'",
    ),
    0,
    "flags externas inalteradas",
  );
  console.log(`OK ${assertions} assertions; synthetic PGlite, no external effects`);
} finally {
  await db.close();
}
