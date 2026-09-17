/**
 * Testes contra Postgres real (migrações verdadeiras) do registo durável do
 * teste da API de Conversões da Meta. Nada sai da máquina e nenhum evento é
 * enviado: aqui só se exercitam permissões, NULLs e concorrência.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { iniciarDbReal, type DbReal } from "../../test/db";

let db: DbReal;

const UID_A = "2a111111-1111-4111-8111-111111111111"; // administrador org A
const UID_B = "2b222222-2222-4222-8222-222222222222"; // administrador org B
const UID_V = "2c333333-3333-4333-8333-333333333333"; // visualizador org A

let orgA = "";
let orgB = "";

const LOCATION = "ok2UHC2QMZsd8UHsAgEa";
const PIPELINE = "2QGyurvcmwhNhRgq0jCq";
const STAGE = "c23ea507-33f5-41b6-933b-fd532ccbb773";
const DATASET = "1810411136960763";
const CODIGO = "TEST53467";
const PEDIDO_1 = "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb";
const PEDIDO_2 = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const EVENTO_1 = `jornada-capi-teste-${PEDIDO_1}`;
const EVENTO_2 = `jornada-capi-teste-${PEDIDO_2}`;

function valor(r: { linhas: string[][] }): string | null {
  return r.linhas.at(-1)?.[0] ?? null;
}

const reservar = (
  uid: string,
  codigo = CODIGO,
  pedido = PEDIDO_1,
  evento = EVENTO_1,
  dataset = DATASET,
) =>
  db.comoUtilizador(
    uid,
    `select public.meta_capi_test_reserve('${dataset}','${codigo}','${pedido}','${evento}',true)::text;`,
  );

beforeAll(async () => {
  db = await iniciarDbReal();
  for (const ficheiro of [
    "drizzle/migrations/0000_site_integration_experiencia_falcao.sql",
    "drizzle/migrations/0001_site_lead_serializacao_quota_e_escrita_remota.sql",
    "drizzle/migrations/0002_site_lead_acolhimento_sms_outbox.sql",
    "drizzle/migrations/0003_site_lead_identidade_consentida_locks_e_quota_hmac.sql",
    "drizzle/migrations/0004_site_lead_durable_execution_ledger.sql",
    "drizzle/migrations/0005_site_lead_flags_v2.sql",
    "drizzle/migrations/0006_site_lead_flags_v2_null_guard.sql",
    "drizzle/migrations/0007_meta_capi_test_ledger.sql",
  ]) {
    const aplicada = db.admin(readFileSync(join(process.cwd(), ficheiro), "utf8"));
    expect(aplicada.ok, aplicada.erro).toBe(true);
  }

  for (const [uid, email] of [
    [UID_A, "ma@exemplo.test"],
    [UID_B, "mb@exemplo.test"],
    [UID_V, "mv@exemplo.test"],
  ] as const) {
    expect(db.admin(`insert into auth.users (id, email) values ('${uid}','${email}');`).ok).toBe(true);
  }
  orgA = valor(db.admin(`select organization_id from public.profiles where id = '${UID_A}';`))!;
  orgB = valor(db.admin(`select organization_id from public.profiles where id = '${UID_B}';`))!;

  const preparacao = db.admin(`
    update public.profiles set organization_id = '${orgA}' where id = '${UID_V}';
    delete from public.user_roles where user_id = '${UID_V}';
    insert into public.user_roles (user_id, organization_id, role) values ('${UID_V}','${orgA}','visualizador');
    insert into public.ghl_location_bindings (location_id, organization_id) values ('${LOCATION}','${orgA}')
      on conflict (location_id) do update set organization_id = excluded.organization_id;
    insert into public.site_integrations
      (organization_id, slug, source, local_stage_key, ghl_location_id, ghl_pipeline_id, ghl_stage_id, enabled)
      values ('${orgA}','experiencia-falcao','experiencia-falcao','novo_lead','${LOCATION}','${PIPELINE}','${STAGE}',false)
      on conflict do nothing;
  `);
  expect(preparacao.ok, preparacao.erro).toBe(true);
}, 180_000);

afterAll(() => db?.stop());

describe("reserva da tentativa Meta", () => {
  it("recusa visualizador e outra organização", () => {
    expect(reservar(UID_V).ok).toBe(false);
    expect(reservar(UID_B).ok).toBe(false);
    expect(valor(db.admin("select count(*) from public.meta_capi_test_attempts;"))).toBe("0");
  });

  it("recusa parâmetros nulos, dataset diferente e código malformado", () => {
    for (const sql of [
      `public.meta_capi_test_reserve(null,'${CODIGO}','${PEDIDO_1}','${EVENTO_1}',true)`,
      `public.meta_capi_test_reserve('${DATASET}',null,'${PEDIDO_1}','${EVENTO_1}',true)`,
      `public.meta_capi_test_reserve('${DATASET}','${CODIGO}',null,'${EVENTO_1}',true)`,
      `public.meta_capi_test_reserve('${DATASET}','${CODIGO}','${PEDIDO_1}',null,true)`,
      `public.meta_capi_test_reserve('${DATASET}','${CODIGO}','${PEDIDO_1}','${EVENTO_1}',null)`,
      `public.meta_capi_test_reserve('${DATASET}','${CODIGO}','${PEDIDO_1}','${EVENTO_1}',false)`,
      `public.meta_capi_test_reserve('999','${CODIGO}','${PEDIDO_1}','${EVENTO_1}',true)`,
      `public.meta_capi_test_reserve('${DATASET}','test53467','${PEDIDO_1}','${EVENTO_1}',true)`,
    ]) {
      const r = db.comoUtilizador(UID_A, `select ${sql};`);
      expect(r.ok, sql).toBe(false);
    }
    expect(valor(db.admin("select count(*) from public.meta_capi_test_attempts;"))).toBe("0");
  });

  it("o administrador reserva uma vez e a repetição é recusada", () => {
    const primeira = reservar(UID_A);
    expect(primeira.ok, primeira.erro).toBe(true);
    expect(valor(primeira)).toContain('"status": "in_progress"');

    // Duplo clique/reload com outro pedido, mesmo dataset e código: sem segundo envio.
    const segunda = reservar(UID_A, CODIGO, PEDIDO_2, EVENTO_2);
    expect(segunda.ok).toBe(false);
    expect(valor(db.admin("select count(*) from public.meta_capi_test_attempts;"))).toBe("1");
  });

  it("o administrador lê apenas as tentativas da sua organização", () => {
    expect(
      valor(db.comoUtilizador(UID_A, "select count(*) from public.meta_capi_test_attempts;")),
    ).toBe("1");
    expect(
      valor(db.comoUtilizador(UID_B, "select count(*) from public.meta_capi_test_attempts;")),
    ).toBe("0");
    expect(
      valor(db.comoUtilizador(UID_V, "select count(*) from public.meta_capi_test_attempts;")),
    ).toBe("0");
  });
});

describe("finalização da tentativa", () => {
  const idTentativa = () =>
    valor(db.admin(`select id from public.meta_capi_test_attempts limit 1;`))!;

  it("uma sessão autenticada não pode declarar o desfecho", () => {
    const r = db.comoUtilizador(
      UID_A,
      `select public.meta_capi_test_finish('${idTentativa()}','api_accepted',1,'Abc','ok');`,
    );
    expect(r.ok).toBe(false);
    expect(valor(db.admin("select status from public.meta_capi_test_attempts limit 1;"))).toBe(
      "in_progress",
    );
  });

  it("recusa estado desconhecido, nulos e aceitação sem exatamente um evento", () => {
    for (const sql of [
      `public.meta_capi_test_finish('${idTentativa()}','entregue',1,null,null)`,
      `public.meta_capi_test_finish('${idTentativa()}',null,1,null,null)`,
      `public.meta_capi_test_finish(null,'api_accepted',1,null,null)`,
      `public.meta_capi_test_finish('${idTentativa()}','api_accepted',2,null,null)`,
      `public.meta_capi_test_finish('${idTentativa()}','api_accepted',null,null,null)`,
    ]) {
      expect(db.comoServico(`select ${sql};`).ok, sql).toBe(false);
    }
    expect(valor(db.admin("select status from public.meta_capi_test_attempts limit 1;"))).toBe(
      "in_progress",
    );
  });

  it("o servidor de confiança finaliza uma única vez", () => {
    const id = idTentativa();
    const r = db.comoServico(
      `select public.meta_capi_test_finish('${id}','api_accepted',1,'Abc123','aceite')::text;`,
    );
    expect(r.ok, r.erro).toBe(true);
    expect(valor(r)).toContain('"persisted": true');
    expect(
      db.comoServico(`select public.meta_capi_test_finish('${id}','rejected',null,null,'x');`).ok,
    ).toBe(false);
    expect(valor(db.admin("select status from public.meta_capi_test_attempts limit 1;"))).toBe(
      "api_accepted",
    );
  });
});
