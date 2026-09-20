/**
 * Testes contra Postgres real (base isolada e efémera) da reconciliação do
 * espelho local de oportunidades na conclusão da escrita remota do site
 * "Experiência Falcão". Nenhum dado real é usado; nada sai da máquina e nada
 * é aplicado na base do projeto: a migração testada está apenas preparada em
 * `sql/pending/0011_site_lead_snapshot_reconciliacao.sql`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { iniciarDbReal, type DbReal } from "../../test/db";

let db: DbReal;

const UID_A = "2a111111-1111-4111-8111-111111111111";
let orgA = "";

const LOCATION = "ok2UHC2QMZsd8UHsAgEa";
const PIPELINE = "2QGyurvcmwhNhRgq0jCq";
const STAGE = "c23ea507-33f5-41b6-933b-fd532ccbb773";

function valor(r: { linhas: string[][] }): string | null {
  return r.linhas.at(-1)?.[0] ?? null;
}

const balde = (v: string) => `md5('q1'||'${v}')||md5('q2'||'${v}')`;

let contador = 0;
/** Cria um recibo novo com identidade própria e devolve o seu id. */
function novoRecibo(): { id: string; contacto: string } {
  contador += 1;
  const telefone = `35190000${String(1000 + contador)}`;
  const pedido = `bbbbbbbb-${String(1000 + contador)}-4111-8111-bbbbbbbbbbbb`;
  const hash = String(contador % 10).repeat(64);
  const r = db.comoServico(
    `select public.ingest_site_lead_v2('experiencia-falcao','${pedido}','${hash}','Pessoa Teste',
      '+${telefone}','${telefone}',null,'2026-09-17.contact.v1', now(), ${balde(telefone)}, null);`,
  );
  expect(r.ok, r.erro).toBe(true);
  const id = valor(
    db.admin(`select id::text from public.site_lead_submissions where request_id='${pedido}';`),
  )!;
  const contacto = valor(
    db.admin(`select contact_id::text from public.site_lead_submissions where id='${id}';`),
  )!;
  expect(
    db.comoServico(`select public.claim_site_lead_remote_v2('${id}','experiencia-falcao');`).ok,
  ).toBe(true);
  return { id, contacto };
}

/** Coloca um espelho local anterior à leitura (ou posterior, se `recente`). */
function espelhoExistente(
  contacto: string,
  oportunidade: string,
  etapa: string,
  estado: string,
  recente = false,
) {
  // O gatilho de `updated_at` é desligado apenas para datar o cenário; a
  // função sob teste continua a correr com o gatilho ativo.
  const r = db.admin(`
    insert into public.opportunities (organization_id, contact_id, ghl_opportunity_id, name, pipeline_id, stage_id, status, is_demo)
      values ('${orgA}','${contacto}','${oportunidade}','Oportunidade','${PIPELINE}','${etapa}','${estado}', false);
    alter table public.opportunities disable trigger trg_opps_updated;
    update public.opportunities set updated_at = now() ${recente ? "+" : "-"} interval '1 hour'
      where organization_id='${orgA}' and ghl_opportunity_id='${oportunidade}';
    alter table public.opportunities enable trigger trg_opps_updated;
  `);
  expect(r.ok, r.erro).toBe(true);
}

const campo = (id: string, coluna: string) =>
  valor(db.admin(`select coalesce(${coluna}::text,'nulo') from public.site_lead_submissions where id='${id}';`));

const ledger = (id: string) =>
  valor(db.admin(`select state from public.site_lead_execution_ledger where first_submission_id='${id}' and scope='remote';`));

const oportunidade = (ghl: string, coluna: string) =>
  valor(db.admin(`select ${coluna}::text from public.opportunities where organization_id='${orgA}' and ghl_opportunity_id='${ghl}';`));

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
    // Migração ainda NÃO aplicada na base do projeto.
    "sql/pending/0011_site_lead_snapshot_reconciliacao.sql",
  ]) {
    const aplicada = db.admin(readFileSync(join(process.cwd(), ficheiro), "utf8"));
    expect(aplicada.ok, aplicada.erro).toBe(true);
  }

  expect(db.admin(`insert into auth.users (id, email) values ('${UID_A}','ra@exemplo.test');`).ok).toBe(true);
  orgA = valor(db.admin(`select organization_id from public.profiles where id='${UID_A}';`))!;

  const preparacao = db.admin(`
    insert into public.ghl_location_bindings (location_id, organization_id) values ('${LOCATION}','${orgA}')
      on conflict (location_id) do update set organization_id = excluded.organization_id;
    insert into public.ghl_connections (organization_id, location_id, status, write_enabled)
      values ('${orgA}','${LOCATION}','conectada', true)
      on conflict do nothing;
    update public.ghl_connections set location_id='${LOCATION}', status='conectada', write_enabled=true
      where organization_id='${orgA}';
    insert into public.journey_stages (organization_id, key, name, position, color)
      values ('${orgA}','novo_lead','Novo Lead', 1, '#000000') on conflict do nothing;
  `);
  expect(preparacao.ok, preparacao.erro).toBe(true);

  const configurada = db.comoUtilizador(
    UID_A,
    `select public.configure_site_integration('${orgA}','experiencia-falcao','experiencia-falcao','novo_lead','${LOCATION}','${PIPELINE}','${STAGE}',true,true);`,
  );
  expect(configurada.ok, configurada.erro).toBe(true);
  expect(
    db.admin(`update public.site_integrations set remote_write_state='habilitado' where organization_id='${orgA}';`).ok,
  ).toBe(true);
}, 180_000);

afterAll(() => db?.stop());

describe("espelho local desatualizado da mesma oportunidade", () => {
  it("aceita a etapa e o estado reais lidos e regista auditoria da alteração", () => {
    const { id, contacto } = novoRecibo();
    espelhoExistente(contacto, "oppStale1", "etapa-antiga", "open");
    const fim = db.comoServico(
      `select public.finish_site_lead_remote_v2('${id}','confirmado','ok','ghlRC1','oppStale1','Lead','${PIPELINE}','etapa-nova','open')::text;`,
    );
    expect(fim.ok, fim.erro).toBe(true);
    expect(valor(fim)).toContain('"remote_state": "confirmado"');
    expect(valor(fim)).toContain('"snapshot_reconciled": true');
    expect(oportunidade("oppStale1", "stage_id")).toBe("etapa-nova");
    expect(ledger(id)).toBe("confirmed");
    expect(
      valor(db.admin(`select count(*) from public.audit_logs where action='site_lead.remote_snapshot_reconciled' and metadata->>'ghl_opportunity_id'='oppStale1';`)),
    ).toBe("1");
  });

  it("preserva o estado fechado devolvido pela API, sem inventar reabertura", () => {
    const { id, contacto } = novoRecibo();
    espelhoExistente(contacto, "oppFechada", "etapa-antiga", "open");
    const fim = db.comoServico(
      `select public.finish_site_lead_remote_v2('${id}','confirmado','ok','ghlRC2','oppFechada','Lead','${PIPELINE}','etapa-ganha','won')::text;`,
    );
    expect(fim.ok, fim.erro).toBe(true);
    expect(oportunidade("oppFechada", "status")).toBe("won");
    expect(oportunidade("oppFechada", "stage_id")).toBe("etapa-ganha");
  });

  it("não toca no carimbo temporal quando o espelho já corresponde", () => {
    const { id, contacto } = novoRecibo();
    espelhoExistente(contacto, "oppIgual", "etapa-igual", "open");
    const antes = oportunidade("oppIgual", "updated_at");
    const fim = db.comoServico(
      `select public.finish_site_lead_remote_v2('${id}','confirmado','ok','ghlRC3','oppIgual','Oportunidade','${PIPELINE}','etapa-igual','open')::text;`,
    );
    expect(fim.ok, fim.erro).toBe(true);
    expect(valor(fim)).toContain('"snapshot_reconciled": false');
    expect(oportunidade("oppIgual", "updated_at")).toBe(antes);
  });
});

describe("guardas que continuam a falhar fechado", () => {
  it("bloqueia quando a linha local foi alterada depois da reserva do recibo", () => {
    const { id, contacto } = novoRecibo();
    espelhoExistente(contacto, "oppRecente", "etapa-antiga", "open", true);
    const fim = db.comoServico(
      `select public.finish_site_lead_remote_v2('${id}','confirmado','ok','ghlRC4','oppRecente','Lead','${PIPELINE}','etapa-nova','won')::text;`,
    );
    expect(fim.ok, fim.erro).toBe(true);
    expect(valor(fim)).toContain("reconciliacao_snapshot_concorrente");
    expect(campo(id, "remote_state")).toBe("bloqueado");
    expect(campo(id, "status")).toBe("em_revisao");
    expect(ledger(id)).toBe("uncertain");
    // Dados potencialmente mais recentes ficam intactos.
    expect(oportunidade("oppRecente", "stage_id")).toBe("etapa-antiga");
    expect(oportunidade("oppRecente", "status")).toBe("open");
  });

  it("bloqueia oportunidade local de outro contacto, sem exceção e com auditoria", () => {
    const { id } = novoRecibo();
    const outro = valor(
      db.admin(`insert into public.contacts (organization_id, full_name, stage_key, is_demo)
        values ('${orgA}','Outra Pessoa','novo_lead', false) returning id::text;`),
    )!;
    espelhoExistente(outro, "oppOutro", "etapa-antiga", "open");
    const fim = db.comoServico(
      `select public.finish_site_lead_remote_v2('${id}','confirmado','ok','ghlRC5','oppOutro','Lead','${PIPELINE}','etapa-nova','open')::text;`,
    );
    expect(fim.ok, fim.erro).toBe(true);
    expect(valor(fim)).toContain("espelho_local_de_outra_identidade");
    expect(campo(id, "status")).toBe("em_revisao");
    expect(ledger(id)).toBe("blocked");
    expect(oportunidade("oppOutro", "stage_id")).toBe("etapa-antiga");
    expect(
      valor(db.admin(`select count(*) from public.audit_logs where action='site_lead.remote_reconciliation_required' and entity_id='${id}';`)),
    ).toBe("1");
  });

  it("bloqueia contacto local com identidade externa divergente", () => {
    const { id, contacto } = novoRecibo();
    expect(db.admin(`update public.contacts set ghl_contact_id='outroGhl' where id='${contacto}';`).ok).toBe(true);
    const fim = db.comoServico(
      `select public.finish_site_lead_remote_v2('${id}','confirmado','ok','ghlRC6','oppDiv','Lead','${PIPELINE}','etapa-nova','open')::text;`,
    );
    expect(fim.ok, fim.erro).toBe(true);
    expect(valor(fim)).toContain("contacto_local_com_identidade_externa_divergente");
    expect(ledger(id)).toBe("blocked");
    expect(valor(db.admin(`select count(*) from public.opportunities where ghl_opportunity_id='oppDiv';`))).toBe("0");
  });

  it("funil diferente do configurado reverte a transação e mantém a reserva", () => {
    const { id } = novoRecibo();
    const falha = db.comoServico(
      `select public.finish_site_lead_remote_v2('${id}','confirmado','x','ghlRC7','oppFunil','Lead','funil-errado','${STAGE}','open');`,
    );
    expect(falha.ok).toBe(false);
    expect(campo(id, "remote_state")).toBe("a_processar");
    expect(ledger(id)).toBe("reserved");
  });

  it("resultado incerto não é sucesso e não repete escrita remota", () => {
    const { id } = novoRecibo();
    const fim = db.comoServico(
      `select public.finish_site_lead_remote_v2('${id}','bloqueado','criacao_incerta','incertoRC',null,null,null,null,null)::text;`,
    );
    expect(fim.ok, fim.erro).toBe(true);
    expect(campo(id, "remote_state")).toBe("bloqueado");
    expect(ledger(id)).toBe("uncertain");
    const repetir = db.comoServico(`select public.claim_site_lead_remote_v2('${id}','experiencia-falcao');`);
    expect(repetir.ok).toBe(false);
  });
});

describe("reserva e privacidade", () => {
  it("mantém uma única execução por pessoa", () => {
    const { id, contacto } = novoRecibo();
    espelhoExistente(contacto, "oppDedup", "etapa-antiga", "open");
    expect(
      db.comoServico(
        `select public.finish_site_lead_remote_v2('${id}','confirmado','ok','ghlRC8','oppDedup','Lead','${PIPELINE}','etapa-nova','open');`,
      ).ok,
    ).toBe(true);
    const repetido = db.comoServico(
      `select public.finish_site_lead_remote_v2('${id}','confirmado','ok','ghlRC8','oppDedup','Lead','${PIPELINE}','etapa-nova','open');`,
    );
    expect(repetido.ok).toBe(false);
  });

  it("a auditoria da reconciliação não contém dados pessoais", () => {
    expect(
      valor(
        db.admin(
          `select count(*) from public.audit_logs
             where action in ('site_lead.remote_snapshot_reconciled','site_lead.remote_reconciliation_required')
               and (metadata::text ilike '%Pessoa%' or metadata::text ilike '%3519%' or metadata::text ilike '%@%');`,
        ),
      ),
    ).toBe("0");
  });
});
