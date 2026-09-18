/**
 * Ponte Ad Navigator v1 contra Postgres real (migrações verdadeiras).
 * Nada sai da máquina: aqui só se exercitam permissões, consumo único,
 * revogação, concorrência e a forma exata dos agregados.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { iniciarDbReal, type DbReal } from "../../test/db";

let db: DbReal;

const UID_A = "4a111111-1111-4111-8111-111111111111"; // administrador org A
const UID_B = "4b222222-2222-4222-8222-222222222222"; // administrador org B
const UID_V = "4c333333-3333-4333-8333-333333333333"; // visualizador org A

let orgA = "";
let orgB = "";

const LOCATION = "ok2UHC2QMZsd8UHsAgEa";
const PIPELINE = "2QGyurvcmwhNhRgq0jCq";
const STAGE = "c23ea507-33f5-41b6-933b-fd532ccbb773";
const TENANT = "55555555-5555-4555-8555-555555555555";

const hash = (v: string) => createHash("sha256").update(v, "utf8").digest("hex");

function valor(r: { linhas: string[][] }): string | null {
  return r.linhas.at(-1)?.[0] ?? null;
}

const criar = (uid: string, codigo: string, ttl = 600) =>
  db.comoUtilizador(
    uid,
    `select public.ad_navigator_create_pairing('${hash(codigo)}',${ttl},true)::text;`,
  );

const trocar = (codigo: string, credencial: string, tenant = TENANT) =>
  db.comoServico(
    `select public.ad_navigator_exchange('${hash(codigo)}','${tenant}','${hash(credencial)}')::text;`,
  );

const resumo = (credencial: string) =>
  db.comoServico(`select public.ad_navigator_summary('${hash(credencial)}')::text;`);

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
    // 0009 é a definição autoritativa e autossuficiente da ponte (v1.1).
    "drizzle/migrations/0009_ad_navigator_bridge_v1_1_definitivo.sql",
  ]) {
    const aplicada = db.admin(readFileSync(join(process.cwd(), ficheiro), "utf8"));
    expect(aplicada.ok, aplicada.erro).toBe(true);
  }

  for (const [uid, email] of [
    [UID_A, "na@exemplo.test"],
    [UID_B, "nb@exemplo.test"],
    [UID_V, "nv@exemplo.test"],
  ] as const) {
    expect(db.admin(`insert into auth.users (id, email) values ('${uid}','${email}');`).ok).toBe(
      true,
    );
  }
  orgA = valor(db.admin(`select organization_id from public.profiles where id = '${UID_A}';`))!;
  orgB = valor(db.admin(`select organization_id from public.profiles where id = '${UID_B}';`))!;

  const preparacao = db.admin(`
    update public.profiles set organization_id = '${orgA}' where id = '${UID_V}';
    update public.organizations set is_demo = false where id in ('${orgA}','${orgB}');
    delete from public.user_roles where user_id = '${UID_V}';
    insert into public.user_roles (user_id, organization_id, role) values ('${UID_V}','${orgA}','visualizador');
    insert into public.ghl_location_bindings (location_id, organization_id) values ('${LOCATION}','${orgA}')
      on conflict (location_id) do update set organization_id = excluded.organization_id;
    insert into public.ghl_connections (organization_id, location_id, default_pipeline_id, status, write_enabled)
      values ('${orgA}','${LOCATION}','${PIPELINE}','conectada', true)
      on conflict (organization_id) do update set location_id = excluded.location_id,
        default_pipeline_id = excluded.default_pipeline_id, status = 'conectada';
    insert into public.site_integrations
      (organization_id, slug, source, local_stage_key, ghl_location_id, ghl_pipeline_id, ghl_stage_id, enabled)
      values ('${orgA}','experiencia-falcao','experiencia-falcao','novo_lead','${LOCATION}','${PIPELINE}','${STAGE}',true)
      on conflict do nothing;
  `);
  expect(preparacao.ok, preparacao.erro).toBe(true);
}, 240_000);

afterAll(() => db?.stop());

describe("pareamento", () => {
  it("recusa visualizador e administrador de outra organização", () => {
    expect(criar(UID_V, "jpair_v").ok).toBe(false);
    expect(criar(UID_B, "jpair_b").ok).toBe(false);
    expect(valor(db.admin("select count(*) from public.ad_navigator_pairings;"))).toBe("0");
  });

  it("recusa parâmetros nulos, hash malformado e TTL fora do intervalo", () => {
    for (const args of [
      `null,600,true`,
      `'${hash("x")}',null,true`,
      `'${hash("x")}',600,null`,
      `'${hash("x")}',600,false`,
      `'NAOHEX',600,true`,
      `'${hash("x")}',5,true`,
      `'${hash("x")}',100000,true`,
    ]) {
      expect(
        db.comoUtilizador(UID_A, `select public.ad_navigator_create_pairing(${args});`).ok,
        args,
      ).toBe(false);
    }
    expect(valor(db.admin("select count(*) from public.ad_navigator_pairings;"))).toBe("0");
  });

  it("nega acesso direto às tabelas a anon e authenticated", () => {
    expect(db.comoUtilizador(UID_A, "select * from public.ad_navigator_pairings;").ok).toBe(false);
    expect(db.comoUtilizador(UID_A, "select * from public.ad_navigator_grants;").ok).toBe(false);
    expect(
      db.comoUtilizador(UID_A, `select public.ad_navigator_summary('${"a".repeat(64)}');`).ok,
    ).toBe(false);
    expect(
      db.comoUtilizador(
        UID_A,
        `select public.ad_navigator_exchange('${"a".repeat(64)}','${TENANT}','${"b".repeat(64)}');`,
      ).ok,
    ).toBe(false);
  });

  it("guarda só o hash do código e resolve location/funil no servidor", () => {
    const codigo = "jpair_teste_um";
    const r = criar(UID_A, codigo);
    expect(r.ok, r.erro).toBe(true);
    expect(valor(r)).toContain(LOCATION);
    expect(valor(r)).not.toContain(codigo);
    const linha = db.admin(
      `select code_sha256, location_id, pipeline_id from public.ad_navigator_pairings order by created_at desc limit 1;`,
    );
    expect(linha.linhas.at(-1)).toEqual([hash(codigo), LOCATION, PIPELINE]);
  });
});

describe("troca do código", () => {
  it("consome exatamente uma vez e recusa repetição", () => {
    const codigo = "jpair_troca_um";
    expect(criar(UID_A, codigo).ok).toBe(true);
    const primeira = trocar(codigo, "bearer-um");
    expect(primeira.ok, primeira.erro).toBe(true);
    expect(valor(primeira)).toContain("commercial_summary:read");
    expect(trocar(codigo, "bearer-dois").ok).toBe(false);
    expect(valor(db.admin("select count(*) from public.ad_navigator_grants;"))).toBe("1");
  });

  it("recusa código expirado", () => {
    const codigo = "jpair_expirado";
    expect(criar(UID_A, codigo).ok).toBe(true);
    db.admin(
      `update public.ad_navigator_pairings set expires_at = now() - interval '1 minute' where code_sha256 = '${hash(codigo)}';`,
    );
    expect(trocar(codigo, "bearer-expirado").ok).toBe(false);
  });

  it("em corrida só uma troca vence", async () => {
    const codigo = "jpair_corrida";
    expect(criar(UID_A, codigo).ok).toBe(true);
    const antes = Number(valor(db.admin("select count(*) from public.ad_navigator_grants;")));
    const [a, b] = await Promise.all([
      db.adminAsync(
        `set role service_role; select public.ad_navigator_exchange('${hash(codigo)}','${TENANT}','${hash("corrida-a")}');`,
      ),
      db.adminAsync(
        `set role service_role; select public.ad_navigator_exchange('${hash(codigo)}','${TENANT}','${hash("corrida-b")}');`,
      ),
    ]);
    expect([a.ok, b.ok].filter(Boolean).length).toBe(1);
    expect(Number(valor(db.admin("select count(*) from public.ad_navigator_grants;")))).toBe(
      antes + 1,
    );
  });

  it("recusa quando o vínculo deixa de coincidir", () => {
    const codigo = "jpair_binding";
    expect(criar(UID_A, codigo).ok).toBe(true);
    db.admin(
      `update public.ghl_connections set status = 'nao_testada' where organization_id = '${orgA}';`,
    );
    expect(trocar(codigo, "bearer-binding").ok).toBe(false);
    db.admin(
      `update public.ghl_connections set status = 'conectada' where organization_id = '${orgA}';`,
    );
  });

  it("recusa quando o emissor deixa de ser administrador", () => {
    const codigo = "jpair_papel";
    expect(criar(UID_A, codigo).ok).toBe(true);
    db.admin(
      `update public.user_roles set role = 'visualizador' where user_id = '${UID_A}' and organization_id = '${orgA}';`,
    );
    expect(trocar(codigo, "bearer-papel").ok).toBe(false);
    db.admin(
      `update public.user_roles set role = 'administrador' where user_id = '${UID_A}' and organization_id = '${orgA}';`,
    );
  });
});

describe("resumo agregado", () => {
  const CRED = "bearer-resumo";

  beforeAll(() => {
    const codigo = "jpair_resumo";
    expect(criar(UID_A, codigo).ok).toBe(true);
    expect(trocar(codigo, CRED).ok).toBe(true);
    // 1200 linhas: acima do limite de 1000 do PostgREST, contadas no próprio Postgres.
    const preparar = db.admin(`
      insert into public.contacts (organization_id, full_name, is_demo)
        values ('${orgA}','Ficha tecnica A', false), ('${orgA}','Ficha tecnica B', false);
      insert into public.opportunities (organization_id, contact_id, name, pipeline_id, stage_key, status, is_demo)
        select '${orgA}', (select id from public.contacts where organization_id='${orgA}' and full_name='Ficha tecnica A' limit 1),
               'op-'||g, '${PIPELINE}', 'novo_lead', 'aberta', false
        from generate_series(1,1200) g;
      insert into public.opportunities (organization_id, contact_id, name, pipeline_id, stage_key, status, is_demo)
        select '${orgA}', (select id from public.contacts where organization_id='${orgA}' and full_name='Ficha tecnica B' limit 1),
               'op-ganha', '${PIPELINE}', 'consulta_paga', 'won', false;
      insert into public.opportunities (organization_id, contact_id, name, pipeline_id, stage_key, status, is_demo)
        values ('${orgA}', null, 'op-solta', '${PIPELINE}', 'etapa_inexistente', 'zzz', false);
      insert into public.opportunities (organization_id, contact_id, name, pipeline_id, stage_key, status, is_demo)
        values ('${orgA}', null, 'op-demo', '${PIPELINE}', 'novo_lead', 'aberta', true);
      insert into public.opportunities (organization_id, contact_id, name, pipeline_id, stage_key, status, is_demo)
        values ('${orgA}', null, 'op-outro-funil', 'outro-funil', 'novo_lead', 'aberta', false);
    `);
    expect(preparar.ok, preparar.erro).toBe(true);
  });

  it("conta tudo sem limite de páginas e distingue ligados de soltos", () => {
    const r = resumo(CRED);
    expect(r.ok, r.erro).toBe(true);
    const payload = JSON.parse(valor(r)!) as {
      counts: {
        opportunities: number;
        linked_contacts: number;
        unlinked_opportunities: number;
        by_status: Record<string, number>;
        by_stage: Record<string, number>;
      };
      coverage: { upstream_complete: boolean; reason: string };
      attribution: { status: string };
      revenue: { value: null };
    };
    expect(payload.counts.opportunities).toBe(1202);
    expect(payload.counts.linked_contacts).toBe(2);
    expect(payload.counts.unlinked_opportunities).toBe(1);
    expect(payload.counts.by_status["open"]).toBe(1200);
    expect(payload.counts.by_status["won"]).toBe(1);
    expect(payload.counts.by_status["unknown"]).toBe(1);
    expect(payload.counts.by_stage["etapa_inexistente"]).toBeUndefined();
    expect(payload.counts.by_stage["unknown"]).toBe(1);
    expect(payload.coverage.upstream_complete).toBe(false);
    expect(payload.coverage.reason).toBe("upstream_coverage_not_verified");
    expect(payload.attribution.status).toBe("unavailable");
    expect(payload.revenue.value).toBeNull();
  });

  it("não devolve nenhum campo de pessoas", () => {
    const texto = valor(resumo(CRED))!;
    for (const proibido of ["Ficha tecnica", "full_name", "phone", "email", "tags"]) {
      expect(texto.includes(proibido)).toBe(false);
    }
  });

  it("recusa credencial desconhecida, revogada e expirada", () => {
    expect(resumo("bearer-inexistente").ok).toBe(false);
    db.admin(
      `update public.ad_navigator_grants set revoked_at = now() where credential_hash = '${hash(CRED)}';`,
    );
    expect(resumo(CRED).ok).toBe(false);
    db.admin(
      `update public.ad_navigator_grants set revoked_at = null, expires_at = now() - interval '1 day' where credential_hash = '${hash(CRED)}';`,
    );
    expect(resumo(CRED).ok).toBe(false);
    db.admin(
      `update public.ad_navigator_grants set expires_at = now() + interval '90 days' where credential_hash = '${hash(CRED)}';`,
    );
    expect(resumo(CRED).ok).toBe(true);
  });

  it("recusa leitura quando o funil padrão da ligação GHL muda, mesmo com o site intacto", () => {
    db.admin(
      `update public.ghl_connections set default_pipeline_id = 'outro-funil-ghl' where organization_id = '${orgA}';`,
    );
    const siteAntes = valor(
      db.admin(
        `select ghl_pipeline_id from public.site_integrations where organization_id = '${orgA}';`,
      ),
    );
    expect(siteAntes).toBe(PIPELINE); // o site continua a apontar para o funil antigo
    expect(resumo(CRED).ok).toBe(false);
    db.admin(
      `update public.ghl_connections set default_pipeline_id = '${PIPELINE}' where organization_id = '${orgA}';`,
    );
    expect(resumo(CRED).ok).toBe(true);
  });

  it("lê pelo vínculo GHL mesmo sem qualquer integração de site", () => {
    const apagado = db.admin(
      `delete from public.site_integrations where organization_id = '${orgA}';`,
    );
    expect(apagado.ok, apagado.erro).toBe(true);
    expect(resumo(CRED).ok, "o resumo não pode depender do site").toBe(true);
    const reposto = db.admin(`
      insert into public.site_integrations
        (organization_id, slug, source, local_stage_key, ghl_location_id, ghl_pipeline_id, ghl_stage_id, enabled)
        values ('${orgA}','experiencia-falcao','experiencia-falcao','novo_lead','${LOCATION}','${PIPELINE}','${STAGE}',true);
    `);
    expect(reposto.ok, reposto.erro).toBe(true);
  });

  it("recusa leitura de organização marcada como demonstração", () => {
    db.admin(`update public.organizations set is_demo = true where id = '${orgA}';`);
    expect(resumo(CRED).ok).toBe(false);
    db.admin(`update public.organizations set is_demo = false where id = '${orgA}';`);
    expect(resumo(CRED).ok).toBe(true);
  });

  it("recusa leitura quando o emissor deixa de pertencer à organização", () => {
    db.admin(`delete from public.user_roles where user_id = '${UID_A}';`);
    expect(resumo(CRED).ok).toBe(false);
    db.admin(
      `insert into public.user_roles (user_id, organization_id, role) values ('${UID_A}','${orgA}','administrador');`,
    );
    expect(resumo(CRED).ok).toBe(true);
  });

  it("uma leitura concorrente com revogação nunca devolve dados depois de revogada", async () => {
    const codigo = "jpair_concorrente";
    const cred = "bearer-concorrente";
    expect(criar(UID_A, codigo).ok).toBe(true);
    expect(trocar(codigo, cred).ok).toBe(true);
    const [leitura, revogacao] = await Promise.all([
      db.adminAsync(`set role service_role; select public.ad_navigator_summary('${hash(cred)}');`),
      db.adminAsync(
        `set role service_role; update public.ad_navigator_grants set revoked_at = now() where credential_hash = '${hash(cred)}';`,
      ),
    ]);
    expect(revogacao.ok, revogacao.erro).toBe(true);
    expect(typeof leitura.ok).toBe("boolean");
    // Depois de concluída a revogação, nenhuma leitura posterior passa.
    expect(resumo(cred).ok).toBe(false);
  });
});

describe("revogação e limite de abuso", () => {
  it("o administrador revoga tudo e a leitura deixa de funcionar", () => {
    const r = db.comoUtilizador(UID_A, "select public.ad_navigator_revoke_access(true)::text;");
    expect(r.ok, r.erro).toBe(true);
    expect(resumo("bearer-resumo").ok).toBe(false);
    expect(
      valor(db.admin("select count(*) from public.ad_navigator_grants where revoked_at is null;")),
    ).toBe("0");
  });

  it("recusa revogação sem confirmação e por não administrador", () => {
    expect(db.comoUtilizador(UID_A, "select public.ad_navigator_revoke_access(false);").ok).toBe(
      false,
    );
    expect(db.comoUtilizador(UID_A, "select public.ad_navigator_revoke_access(null);").ok).toBe(
      false,
    );
    expect(db.comoUtilizador(UID_V, "select public.ad_navigator_revoke_access(true);").ok).toBe(
      false,
    );
  });

  const bater = (chave: string, limite = 2, teto = 1000, rota = "summary") =>
    db.comoServico(
      `select public.ad_navigator_rate_hit_v2('${rota}','${chave}',${limite},${teto},60)::text;`,
    );

  it("conta pedidos na janela e bloqueia acima do limite do balde", () => {
    const chave = hash("bucket-teste");
    expect(valor(bater(chave))).toBe("true");
    expect(valor(bater(chave))).toBe("true");
    expect(valor(bater(chave))).toBe("false");
    expect(
      db.comoUtilizador(
        UID_A,
        `select public.ad_navigator_rate_hit_v2('summary','${chave}',2,1000,60);`,
      ).ok,
    ).toBe(false);
  });

  it("o teto da rota trava chaves aleatórias antes de criar baldes", () => {
    const antes = Number(
      valor(db.admin("select count(*) from public.ad_navigator_rate_limits;")) ?? "0",
    );
    let permitidos = 0;
    for (let i = 0; i < 12; i += 1) {
      if (valor(bater(hash(`aleatoria-${i}`), 30, 5, "exchange")) === "true") permitidos += 1;
    }
    expect(permitidos).toBe(5);
    const depois = Number(
      valor(db.admin("select count(*) from public.ad_navigator_rate_limits;")) ?? "0",
    );
    // Só os pedidos dentro do teto chegam a criar balde: a tabela não cresce
    // à velocidade das chaves inventadas pelo atacante.
    expect(depois - antes).toBe(5);
  });
});
