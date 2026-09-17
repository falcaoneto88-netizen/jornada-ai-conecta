/**
 * Testes contra Postgres real (migrações verdadeiras) do ingresso de leads do
 * site "Experiência Falcão". Nenhum dado real é usado e nada sai da máquina.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { iniciarDbReal, type DbReal } from "../../test/db";
import { executarReciboFalcao, type AdminAuto } from "./falcao-auto.server";

let db: DbReal;

const UID_A = "1a111111-1111-4111-8111-111111111111"; // administrador org A
const UID_B = "1b222222-2222-4222-8222-222222222222"; // administrador org B
const UID_V = "1c333333-3333-4333-8333-333333333333"; // visualizador org A

let orgA = "";
let orgB = "";

const LOCATION = "ok2UHC2QMZsd8UHsAgEa";
const PIPELINE = "2QGyurvcmwhNhRgq0jCq";
const STAGE = "c23ea507-33f5-41b6-933b-fd532ccbb773";

const HASH_1 = "1".repeat(64);
const HASH_2 = "2".repeat(64);
const PEDIDO_1 = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const PEDIDO_2 = "aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa";

function valor(r: { linhas: string[][] }): string | null {
  return r.linhas.at(-1)?.[0] ?? null;
}

/** Baldes de quota: no servidor são HMAC do segredo; aqui, valores opacos fixos. */
const balde = (valor: string) => `md5('q1'||'${valor}')||md5('q2'||'${valor}')`;

function ingerir(pedido: string, hash: string, telefone: string, email: string | null) {
  return db.comoServico(
    `select public.ingest_site_lead_v2('experiencia-falcao','${pedido}','${hash}','Pessoa Teste',
      '+${telefone}','${telefone}',${email ? `'${email}'` : "null"},'2026-09-17.contact.v1', now(),
      ${balde(telefone)}, ${email ? balde(email) : "null"});`,
  );
}

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
  ]) {
    const aplicada = db.admin(readFileSync(join(process.cwd(), ficheiro), "utf8"));
    expect(aplicada.ok, aplicada.erro).toBe(true);
  }

  for (const [uid, email] of [
    [UID_A, "fa@exemplo.test"],
    [UID_B, "fb@exemplo.test"],
    [UID_V, "fv@exemplo.test"],
  ] as const) {
    expect(db.admin(`insert into auth.users (id, email) values ('${uid}','${email}');`).ok).toBe(
      true,
    );
  }
  orgA = valor(db.admin(`select organization_id from public.profiles where id = '${UID_A}';`))!;
  orgB = valor(db.admin(`select organization_id from public.profiles where id = '${UID_B}';`))!;

  const preparacao = db.admin(`
      update public.profiles set organization_id = '${orgA}' where id = '${UID_V}';
      delete from public.user_roles where user_id = '${UID_V}';
      insert into public.user_roles (user_id, organization_id, role) values ('${UID_V}','${orgA}','visualizador');
      insert into public.ghl_location_bindings (location_id, organization_id) values ('${LOCATION}','${orgA}')
        on conflict (location_id) do update set organization_id = excluded.organization_id;
      update public.ghl_connections set location_id='${LOCATION}', status='conectada', write_enabled=false
        where organization_id='${orgA}';
      insert into public.journey_stages (organization_id, key, name, position, color)
        values ('${orgA}','novo_lead','Novo Lead', 1, '#000000')
        on conflict do nothing;
    `);
  expect(preparacao.ok, preparacao.erro).toBe(true);
}, 180_000);

afterAll(() => db?.stop());

describe("configuração administrativa", () => {
  it("recusa quem não é administrador", () => {
    const r = db.comoUtilizador(
      UID_V,
      `select public.configure_site_integration('${orgA}','experiencia-falcao','experiencia-falcao','novo_lead','${LOCATION}','${PIPELINE}','${STAGE}',true,true);`,
    );
    expect(r.ok).toBe(false);
  });

  it("recusa destino que não pertence à organização", () => {
    const r = db.comoUtilizador(
      UID_B,
      `select public.configure_site_integration('${orgB}','experiencia-falcao','experiencia-falcao','novo_lead','${LOCATION}','${PIPELINE}','${STAGE}',true,true);`,
    );
    expect(r.ok).toBe(false);
  });

  it("o administrador liga a integração após verificar o destino", () => {
    const r = db.comoUtilizador(
      UID_A,
      `select public.configure_site_integration('${orgA}','experiencia-falcao','experiencia-falcao','novo_lead','${LOCATION}','${PIPELINE}','${STAGE}',true,true)::text;`,
    );
    expect(r.ok, r.erro).toBe(true);
    expect(valor(r)).toContain('"configured": true');
  });
});

describe("ingresso do lead", () => {
  it("o público e os utilizadores autenticados não podem executar o ingresso", () => {
    const autenticado = db.comoUtilizador(
      UID_A,
      `select public.ingest_site_lead_v2('experiencia-falcao','${PEDIDO_1}','${HASH_1}','X','+351900000001','351900000001',null,'2026-09-17.contact.v1', now(), ${balde("351900000001")}, null);`,
    );
    expect(autenticado.ok).toBe(false);
  });

  it("cria o contacto na etapa novo_lead e devolve estados distintos", () => {
    const r = ingerir(PEDIDO_1, HASH_1, "351900000111", null);
    expect(r.ok, r.erro).toBe(true);
    const texto = valor(r) ?? "";
    expect(texto).toContain('"local_state": "contacto_criado"');
    expect(texto).toContain('"remote_state": "pendente"');
    expect(texto).toContain('"welcome_state": "pendente"');
    expect(
      valor(
        db.admin(
          `select stage_key from public.contacts where organization_id='${orgA}' and phone_normalized='351900000111';`,
        ),
      ),
    ).toBe("novo_lead");
  });

  it("o reenvio idêntico devolve o mesmo recibo sem duplicar contactos", () => {
    const r = ingerir(PEDIDO_1, HASH_1, "351900000111", null);
    expect(r.ok, r.erro).toBe(true);
    expect(valor(r)).toContain('"duplicate": true');
    expect(
      valor(
        db.admin(
          `select count(*) from public.contacts where organization_id='${orgA}' and phone_normalized='351900000111';`,
        ),
      ),
    ).toBe("1");
  });

  it("o mesmo pedido com outros dados é recusado", () => {
    const r = ingerir(PEDIDO_1, HASH_2, "351900000111", null);
    expect(r.ok).toBe(false);
    expect(r.erro).toContain("outros dados");
  });

  it("não rebaixa a etapa de um contacto já existente", () => {
    const promocao = db.admin(`
      insert into public.journey_stages (organization_id, key, name, position, color)
        values ('${orgA}','agendado','Agendado', 9, '#111111') on conflict do nothing;
      update public.contacts set stage_key='agendado'
        where organization_id='${orgA}' and phone_normalized='351900000111';
    `);
    expect(promocao.ok, promocao.erro).toBe(true);
    const r = ingerir(PEDIDO_2, HASH_2, "351900000111", null);
    expect(r.ok, r.erro).toBe(true);
    expect(valor(r)).toContain('"local_state": "contacto_existente"');
    expect(
      valor(
        db.admin(
          `select stage_key from public.contacts where organization_id='${orgA}' and phone_normalized='351900000111';`,
        ),
      ),
    ).toBe("agendado");
  });

  it("envia para revisão quando telefone e e-mail apontam para pessoas diferentes", () => {
    db.admin(`
      insert into public.contacts (organization_id, full_name, phone_normalized) values ('${orgA}','Pessoa Um','351900000222');
      insert into public.contacts (organization_id, full_name, email) values ('${orgA}','Pessoa Dois','dois@exemplo.test');
    `);
    const antes = valor(
      db.admin(`select count(*) from public.contacts where organization_id='${orgA}';`),
    );
    const r = ingerir(
      "aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa",
      HASH_1,
      "351900000222",
      "dois@exemplo.test",
    );
    expect(r.ok, r.erro).toBe(true);
    expect(valor(r)).toContain('"status": "em_revisao"');
    expect(
      valor(db.admin(`select count(*) from public.contacts where organization_id='${orgA}';`)),
    ).toBe(antes);
  });

  it("pedidos simultâneos idênticos devolvem ambos o mesmo recibo e um só contacto", async () => {
    const pedido = "aaaaaaaa-4444-4444-8444-aaaaaaaaaaaa";
    const sql = `set role service_role; select public.ingest_site_lead_v2('experiencia-falcao','${pedido}','${HASH_1}','Pessoa','+351900000333','351900000333',null,'2026-09-17.contact.v1', now(), ${balde("351900000333")}, null)::text;`;
    const [a, b] = await Promise.all([db.adminAsync(sql), db.adminAsync(sql)]);
    expect(a.ok, a.erro).toBe(true);
    expect(b.ok, b.erro).toBe(true);
    const recibos = [valor(a) ?? "", valor(b) ?? ""].map(
      (t) => /"receipt_id": "([0-9a-f-]+)"/.exec(t)?.[1] ?? "",
    );
    expect(recibos[0]).toBeTruthy();
    expect(recibos[0]).toBe(recibos[1]);
    expect([valor(a), valor(b)].filter((t) => (t ?? "").includes('"duplicate": true')).length).toBe(
      1,
    );
    expect(
      valor(
        db.admin(`select count(*) from public.site_lead_submissions where request_id='${pedido}';`),
      ),
    ).toBe("1");
    expect(
      valor(
        db.admin(
          `select count(*) from public.contacts where organization_id='${orgA}' and phone_normalized='351900000333';`,
        ),
      ),
    ).toBe("1");
  });

  it("pedidos distintos simultâneos da mesma pessoa não duplicam o contacto", async () => {
    const um = "aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa";
    const dois = "aaaaaaaa-6666-4666-8666-aaaaaaaaaaaa";
    const sql = (pedido: string, hash: string) =>
      `set role service_role; select public.ingest_site_lead_v2('experiencia-falcao','${pedido}','${hash}','Pessoa','+351900000444','351900000444',null,'2026-09-17.contact.v1', now(), ${balde("351900000444")}, null)::text;`;
    const [a, b] = await Promise.all([
      db.adminAsync(sql(um, HASH_1)),
      db.adminAsync(sql(dois, HASH_2)),
    ]);
    expect(a.ok, a.erro).toBe(true);
    expect(b.ok, b.erro).toBe(true);
    expect(
      valor(
        db.admin(
          `select count(*) from public.contacts where organization_id='${orgA}' and phone_normalized='351900000444';`,
        ),
      ),
    ).toBe("1");
    const estados = [valor(a) ?? "", valor(b) ?? ""].join(" ");
    expect(estados).toContain('"local_state": "contacto_criado"');
    expect(estados).toContain('"local_state": "contacto_existente"');
  });

  it("o mesmo pedido com dados diferentes é recusado sem alterar o recibo", () => {
    const antes = valor(
      db.admin(
        `select payload_hash from public.site_lead_submissions where request_id='${PEDIDO_1}';`,
      ),
    );
    const r = ingerir(PEDIDO_1, "3".repeat(64), "351900000111", null);
    expect(r.ok).toBe(false);
    expect(
      valor(
        db.admin(
          `select payload_hash from public.site_lead_submissions where request_id='${PEDIDO_1}';`,
        ),
      ),
    ).toBe(antes);
  });

  it("aplica limite por identidade dentro da janela", () => {
    const resultados = [1, 2, 3, 4, 5, 6].map((n) =>
      ingerir(`aaaaaaaa-77${String(n)}7-4777-8777-aaaaaaaaaaaa`, HASH_1, "351900000555", null),
    );
    expect(resultados.slice(0, 5).every((r) => r.ok)).toBe(true);
    expect(resultados[5]?.ok).toBe(false);
    expect(resultados[5]?.erro).toContain("Limite");
  });

  it("não regista dados pessoais na auditoria", () => {
    const r = db.admin(
      `select count(*) from public.audit_logs where action='site_lead.received' and metadata::text ilike '%Pessoa%';`,
    );
    expect(valor(r)).toBe("0");
  });
});

describe("isolamento das novas tabelas", () => {
  it("a outra organização não vê a integração nem os recibos", () => {
    expect(valor(db.comoUtilizador(UID_B, "select count(*) from public.site_integrations;"))).toBe(
      "0",
    );
    expect(
      valor(db.comoUtilizador(UID_B, "select count(*) from public.site_lead_submissions;")),
    ).toBe("0");
  });

  it("a própria organização lê, mas não escreve, os recibos", () => {
    expect(
      Number(valor(db.comoUtilizador(UID_A, "select count(*) from public.site_lead_submissions;"))),
    ).toBeGreaterThan(0);
    const escrita = db.comoUtilizador(
      UID_A,
      `update public.site_lead_submissions set remote_state='enviado';`,
    );
    expect(escrita.ok).toBe(false);
  });
});

describe("escrita remota reservada e auditada", () => {
  const recibo = () =>
    valor(
      db.admin(
        `select id::text from public.site_lead_submissions where request_id='${PEDIDO_1}' and organization_id='${orgA}';`,
      ),
    )!;

  it("não reserva enquanto a escrita remota não estiver habilitada", () => {
    const r = db.comoServico(
      `select public.claim_site_lead_remote_v2('${recibo()}','experiencia-falcao');`,
    );
    expect(r.ok).toBe(false);
    expect(r.erro).toContain("Escrita remota não habilitada");
  });

  it("não reserva sem write_enabled na ligação ao GoHighLevel", () => {
    expect(
      db.admin(
        `update public.site_integrations set remote_write_state='habilitado' where organization_id='${orgA}';
         insert into public.ghl_connections (organization_id, write_enabled) values ('${orgA}', false)
           on conflict do nothing;`,
      ).ok,
    ).toBe(true);
    const r = db.comoServico(
      `select public.claim_site_lead_remote_v2('${recibo()}','experiencia-falcao');`,
    );
    expect(r.ok).toBe(false);
    expect(r.erro).toContain("escrita desativada");
  });

  it("reserva uma única vez e confirma os identificadores devolvidos", () => {
    expect(
      db.admin(
        `update public.ghl_connections set write_enabled=true where organization_id='${orgA}';`,
      ).ok,
    ).toBe(true);
    const id = recibo();
    const reserva = db.comoServico(
      `select public.claim_site_lead_remote_v2('${id}','experiencia-falcao')::text;`,
    );
    expect(reserva.ok, reserva.erro).toBe(true);
    expect(valor(reserva)).toContain(PIPELINE);

    const segunda = db.comoServico(
      `select public.claim_site_lead_remote_v2('${id}','experiencia-falcao');`,
    );
    expect(segunda.ok).toBe(false);

    const fim = db.comoServico(
      `select public.finish_site_lead_remote_v2('${id}','confirmado','contacto_e_oportunidade_confirmados','ghlC1','ghlO1','Lead','${PIPELINE}','${STAGE}','won')::text;`,
    );
    expect(fim.ok, fim.erro).toBe(true);
    expect(valor(fim)).toContain('"remote_state": "confirmado"');
    expect(
      valor(
        db.admin(
          `select count(*) from public.opportunities where organization_id='${orgA}' and ghl_opportunity_id='ghlO1';`,
        ),
      ),
    ).toBe("1");
    expect(
      valor(
        db.admin(
          `select count(*) from public.contacts where organization_id='${orgA}' and ghl_contact_id='ghlC1';`,
        ),
      ),
    ).toBe("1");

    const repetido = db.comoServico(
      `select public.finish_site_lead_remote_v2('${id}','confirmado','x','ghlC1','ghlO1','Lead','${PIPELINE}','${STAGE}','won');`,
    );
    expect(repetido.ok).toBe(false);
  });

  it("a auditoria da escrita remota não contém dados pessoais", () => {
    expect(
      valor(
        db.admin(
          `select count(*) from public.audit_logs where action like 'site_lead.remote_%' and metadata::text ilike '%Pessoa%';`,
        ),
      ),
    ).toBe("0");
  });
});

describe("acolhimento pelo canal existente", () => {
  const recibo = () =>
    valor(
      db.admin(
        `select id::text from public.site_lead_submissions where request_id='${PEDIDO_1}' and organization_id='${orgA}';`,
      ),
    )!;

  it("não reserva enquanto o canal não estiver ativado pelo administrador", () => {
    const r = db.comoServico(
      `select public.claim_site_lead_welcome_v2('${recibo()}','experiencia-falcao');`,
    );
    expect(r.ok).toBe(false);
    expect(r.erro).toContain("Canal de acolhimento não configurado");
  });

  it("só o administrador liga os interruptores da integração", () => {
    const negado = db.comoUtilizador(
      UID_V,
      `select public.set_site_integration_flags('${orgA}','habilitado','configurado',true);`,
    );
    expect(negado.ok).toBe(false);
    const ok = db.comoUtilizador(
      UID_A,
      `select public.set_site_integration_flags('${orgA}','habilitado','configurado',true)::text;`,
    );
    expect(ok.ok, ok.erro).toBe(true);
    expect(valor(ok)).toContain('"welcome_channel_state": "configurado"');
  });

  it("uma única tentativa: envio aceite não é entrega e não se repete", () => {
    const id = recibo();
    const reserva = db.comoServico(
      `select public.claim_site_lead_welcome_v2('${id}','experiencia-falcao')::text;`,
    );
    expect(reserva.ok, reserva.erro).toBe(true);
    expect(valor(reserva)).toContain('"consent_version": "2026-09-17.contact.v1"');

    const segunda = db.comoServico(
      `select public.claim_site_lead_welcome_v2('${id}','experiencia-falcao');`,
    );
    expect(segunda.ok).toBe(false);

    const fim = db.comoServico(
      `select public.finish_site_lead_welcome_v2('${id}','enviado','aceite_pela_api:accepted','msg1')::text;`,
    );
    expect(fim.ok, fim.erro).toBe(true);
    expect(valor(fim)).toContain('"delivered": false');
    expect(
      valor(db.admin(`select welcome_state from public.site_lead_submissions where id='${id}';`)),
    ).toBe("enviado");
    expect(
      valor(
        db.admin(
          `select coalesce(welcome_delivered_at::text,'nulo') from public.site_lead_submissions where id='${id}';`,
        ),
      ),
    ).toBe("nulo");
  });

  it("entrega só com recibo real do provedor para a mesma mensagem", () => {
    const id = recibo();
    const errada = db.comoServico(
      `select public.record_site_lead_welcome_delivery('${id}','outra', now());`,
    );
    expect(errada.ok).toBe(false);
    const certa = db.comoServico(
      `select public.record_site_lead_welcome_delivery('${id}','msg1', now())::text;`,
    );
    expect(certa.ok, certa.erro).toBe(true);
    expect(
      valor(db.admin(`select welcome_state from public.site_lead_submissions where id='${id}';`)),
    ).toBe("entregue");
  });

  it("a auditoria do acolhimento regista intenção e não guarda a mensagem nem dados pessoais", () => {
    expect(
      Number(
        valor(
          db.admin(
            `select count(*) from public.audit_logs where action='site_lead.welcome_intent';`,
          ),
        ),
      ),
    ).toBeGreaterThan(0);
    expect(
      valor(
        db.admin(
          `select count(*) from public.audit_logs where action like 'site_lead.welcome%' and (metadata::text ilike '%Pessoa%' or metadata::text ilike '%Olá%');`,
        ),
      ),
    ).toBe("0");
  });
});

describe("identidade consentida e exclusão mútua por pessoa", () => {
  const TEL = "351900000777";
  const P1 = "aaaaaaaa-8881-4888-8888-aaaaaaaaaaaa";
  const P2 = "aaaaaaaa-8882-4888-8888-aaaaaaaaaaaa";

  it("guarda a identidade do formulário e impede alterá-la", () => {
    const a = ingerir(P1, HASH_1, TEL, null);
    expect(a.ok, a.erro).toBe(true);
    const b = ingerir(P2, HASH_2, TEL, null);
    expect(b.ok, b.erro).toBe(true);
    expect(
      valor(
        db.admin(
          `select count(*) from public.site_lead_identities where phone_normalized='${TEL}';`,
        ),
      ),
    ).toBe("2");
    const alterar = db.admin(
      `update public.site_lead_identities set phone_normalized='351900000999' where phone_normalized='${TEL}';`,
    );
    expect(alterar.ok).toBe(false);
  });

  it("duas submissões da mesma pessoa não são executadas ao mesmo tempo", () => {
    const ids = db
      .admin(
        `select id::text from public.site_lead_submissions where request_id in ('${P1}','${P2}') order by created_at;`,
      )
      .linhas.map((l) => l[0]!);
    expect(ids.length).toBe(2);
    const primeira = db.comoServico(
      `select public.claim_site_lead_remote_v2('${ids[0]!}','experiencia-falcao')::text;`,
    );
    expect(primeira.ok, primeira.erro).toBe(true);
    expect(valor(primeira)).toContain('"blocked": false');
    const segunda = db.comoServico(
      `select public.claim_site_lead_remote_v2('${ids[1]!}','experiencia-falcao')::text;`,
    );
    expect(segunda.ok, segunda.erro).toBe(true);
    expect(valor(segunda)).toContain("execucao_remota_ja_registada_para_a_mesma_pessoa");
    expect(
      valor(
        db.admin(`select remote_state from public.site_lead_submissions where id='${ids[1]!}';`),
      ),
    ).toBe("pendente");

    // Confirmação exige dados reais da oportunidade lida no GoHighLevel.
    const semDados = db.comoServico(
      `select public.finish_site_lead_remote_v2('${ids[0]!}','confirmado','x','ghlC7','ghlO7',null,null,null,null);`,
    );
    expect(semDados.ok).toBe(false);
    const fim = db.comoServico(
      `select public.finish_site_lead_remote_v2('${ids[0]!}','confirmado','x','ghlC7','ghlO7','Lead','${PIPELINE}','etapa-real','abandoned')::text;`,
    );
    expect(fim.ok, fim.erro).toBe(true);
    expect(valor(fim)).toContain('"persisted": true');
    // Espelho fiel: nada de 'open' nem etapa Novo Lead inventados.
    expect(
      valor(
        db.admin(
          `select status || '|' || stage_id from public.opportunities where ghl_opportunity_id='ghlO7';`,
        ),
      ),
    ).toBe("abandoned|etapa-real");
    // O ledger é durável: a segunda submissão nunca executa de novo.
    const terceira = db.comoServico(
      `select public.claim_site_lead_remote_v2('${ids[1]!}','experiencia-falcao')::text;`,
    );
    expect(terceira.ok, terceira.erro).toBe(true);
    expect(valor(terceira)).toContain("execucao_remota_ja_registada_para_a_mesma_pessoa");
  });

  it("mantém tombstone remoto após resultado incerto e nunca vincula ID não validado", () => {
    const tel = "351900000779";
    const p1 = "aaaaaaaa-8891-4888-8888-aaaaaaaaaaaa";
    const p2 = "aaaaaaaa-8892-4888-8888-aaaaaaaaaaaa";
    expect(ingerir(p1, "4".repeat(64), tel, null).ok).toBe(true);
    expect(ingerir(p2, "5".repeat(64), tel, null).ok).toBe(true);
    const ids = db.admin(`select id::text from public.site_lead_submissions where request_id in ('${p1}','${p2}') order by request_id;`).linhas.map((l) => l[0]!);
    expect(db.comoServico(`select public.claim_site_lead_remote_v2('${ids[0]}','experiencia-falcao');`).ok).toBe(true);
    const fim = db.comoServico(`select public.finish_site_lead_remote_v2('${ids[0]}','bloqueado','criacao_incerta','incertoC',null,null,null,null,null);`);
    expect(fim.ok, fim.erro).toBe(true);
    expect(valor(db.admin(`select coalesce(ghl_contact_id,'nulo') from public.contacts where id=(select contact_id from public.site_lead_submissions where id='${ids[0]}');`))).toBe("nulo");
    expect(valor(db.admin(`select remote_observed_contact_id from public.site_lead_submissions where id='${ids[0]}';`))).toBe("incertoC");
    const segunda = db.comoServico(`select public.claim_site_lead_remote_v2('${ids[1]}','experiencia-falcao')::text;`);
    expect(segunda.ok, segunda.erro).toBe(true);
    expect(valor(segunda)).toContain("execucao_remota_ja_registada_para_a_mesma_pessoa");
  });

  it("rollback de persistência não confirma nem perde o ledger", () => {
    const tel = "351900000780";
    const p = "aaaaaaaa-8893-4888-8888-aaaaaaaaaaaa";
    expect(ingerir(p, "6".repeat(64), tel, null).ok).toBe(true);
    const id = valor(db.admin(`select id::text from public.site_lead_submissions where request_id='${p}';`))!;
    expect(db.comoServico(`select public.claim_site_lead_remote_v2('${id}','experiencia-falcao');`).ok).toBe(true);
    const falha = db.comoServico(`select public.finish_site_lead_remote_v2('${id}','confirmado','x','cRollback','oRollback','Lead','funil-errado','${STAGE}','open');`);
    expect(falha.ok).toBe(false);
    expect(valor(db.admin(`select remote_state from public.site_lead_submissions where id='${id}';`))).toBe("a_processar");
    expect(valor(db.admin(`select state from public.site_lead_execution_ledger where first_submission_id='${id}' and scope='remote';`))).toBe("reserved");
  });

  it("acolhimento aceite bloqueia para sempre o segundo requestId da mesma pessoa", () => {
    const segundo = valor(db.admin(`select id::text from public.site_lead_submissions where request_id='${PEDIDO_2}';`))!;
    const preparado = db.admin(`
      update public.site_lead_submissions s set remote_state='confirmado', ghl_contact_id='ghlC1'
        where s.id='${segundo}';
    `);
    expect(preparado.ok, preparado.erro).toBe(true);
    const r = db.comoServico(`select public.claim_site_lead_welcome_v2('${segundo}','experiencia-falcao')::text;`);
    expect(r.ok, r.erro).toBe(true);
    expect(valor(r)).toContain("acolhimento_ja_registado_para_a_mesma_pessoa");
  });

  it("acolhimento incerto mantém tombstone e bloqueia requestId posterior", () => {
    const tel = "351900000781";
    const p1 = "aaaaaaaa-8894-4888-8888-aaaaaaaaaaaa";
    const p2 = "aaaaaaaa-8895-4888-8888-aaaaaaaaaaaa";
    expect(ingerir(p1, "7".repeat(64), tel, null).ok).toBe(true);
    expect(ingerir(p2, "8".repeat(64), tel, null).ok).toBe(true);
    const ids = db.admin(`select id::text from public.site_lead_submissions where request_id in ('${p1}','${p2}') order by request_id;`).linhas.map((l) => l[0]!);
    const contacto = valor(db.admin(`select contact_id::text from public.site_lead_submissions where id='${ids[0]}';`))!;
    expect(db.admin(`update public.contacts set ghl_contact_id='ghlW2' where id='${contacto}'; update public.site_lead_submissions set remote_state='confirmado',ghl_contact_id='ghlW2' where id in ('${ids[0]}','${ids[1]}');`).ok).toBe(true);
    expect(db.comoServico(`select public.claim_site_lead_welcome_v2('${ids[0]}','experiencia-falcao');`).ok).toBe(true);
    const incerto = db.comoServico(`select public.finish_site_lead_welcome_v2('${ids[0]}','bloqueado','envio_incerto',null);`);
    expect(incerto.ok, incerto.erro).toBe(true);
    expect(valor(db.admin(`select state from public.site_lead_execution_ledger where first_submission_id='${ids[0]}' and scope='welcome';`))).toBe("uncertain");
    const segundo = db.comoServico(`select public.claim_site_lead_welcome_v2('${ids[1]}','experiencia-falcao')::text;`);
    expect(segundo.ok, segundo.erro).toBe(true);
    expect(valor(segundo)).toContain("acolhimento_ja_registado_para_a_mesma_pessoa");
  });

  it("divergência com a identidade consentida vai para revisão sem mesclar", () => {
    const pedido = "aaaaaaaa-9999-4999-8999-aaaaaaaaaaaa";
    expect(ingerir(pedido, HASH_1, "351900000888", null).ok).toBe(true);
    const id = valor(
      db.admin(`select id::text from public.site_lead_submissions where request_id='${pedido}';`),
    )!;
    expect(
      db.admin(
        `update public.contacts set phone_normalized='351900000000', phone='+351900000000'
           where id = (select contact_id from public.site_lead_submissions where id='${id}');`,
      ).ok,
    ).toBe(true);
    const r = db.comoServico(
      `select public.claim_site_lead_remote_v2('${id}','experiencia-falcao')::text;`,
    );
    expect(r.ok, r.erro).toBe(true);
    expect(valor(r)).toContain("divergencia_com_identidade_consentida");
    expect(
      valor(db.admin(`select status from public.site_lead_submissions where id='${id}';`)),
    ).toBe("em_revisao");
  });

  it("origem diferente da esperada nunca reserva", () => {
    const id = valor(
      db.admin(`select id::text from public.site_lead_submissions where request_id='${P2}';`),
    )!;
    const r = db.comoServico(`select public.claim_site_lead_remote_v2('${id}','outra-origem');`);
    expect(r.ok).toBe(false);
  });
});

/**
 * Ponta a ponta: o ingresso assinado e persistido dispara o processamento
 * DESTE recibo (dependências GHL simuladas, base real isolada). Nada sai da
 * máquina e nenhum contacto real é usado.
 */
describe("execução automática de um recibo (base real)", () => {
  const LOC_OK = LOCATION;

  function adminSobreDb(): AdminAuto {
    const lit = (v: unknown) => (v === null ? "null" : `'${String(v).replace(/'/g, "''")}'`);
    return {
      from: (tabela: string) => ({
        select: (colunas: string) => {
          const onde: string[] = [];
          const consulta = {
            eq: (campo: string, v: unknown) => {
              onde.push(`${campo} = ${lit(v)}`);
              return consulta;
            },
            limit: (n: number) => {
              const sql = `select coalesce(json_agg(x)::text,'[]') from (select ${colunas} from public.${tabela}${
                onde.length ? ` where ${onde.join(" and ")}` : ""
              } limit ${String(n)}) x;`;
              const r = db.admin(sql);
              return Promise.resolve(
                r.ok
                  ? { data: JSON.parse(valor(r) ?? "[]") as unknown, error: null }
                  : { data: null, error: { message: r.erro } },
              );
            },
          };
          return consulta;
        },
      }),
      rpc: (fn: string, args: Record<string, unknown>) => {
        const nomeados = Object.entries(args)
          .map(([k, v]) => `${k} => ${lit(v)}`)
          .join(", ");
        const r = db.comoServico(`select coalesce(public.${fn}(${nomeados})::text,'null');`);
        return Promise.resolve(
          r.ok
            ? { data: JSON.parse(valor(r) ?? "null") as unknown, error: null }
            : { data: null, error: { message: r.erro } },
        );
      },
    } as unknown as AdminAuto;
  }

  const contactoGhl = (telefone: string, id = "ghlAuto1") => ({
    id,
    locationId: LOC_OK,
    phone: `+${telefone}`,
    email: null,
    dnd: false,
    canaisBloqueados: [] as string[],
  });

  function simulado(telefone: string) {
    const criarContacto = vi.fn(async () => ({ ok: true as const, data: { id: "ghlAuto1" } }));
    const enviar = vi.fn(async () => ({
      ok: true as const,
      data: { messageId: "mAuto1", status: "queued" },
    }));
    const criarRemoto = ((_cfg: unknown, concluir: unknown) => ({
      concluir,
      procurarExato: async () => ({ ok: true as const, data: null }),
      lerContacto: async () => ({ ok: true as const, data: contactoGhl(telefone) }),
      criarContacto,
      oportunidades: async () => ({ ok: true as const, data: [] }),
      criarOportunidade: async () => ({
        ok: true as const,
        data: {
          id: "ghlOppAuto1",
          name: "Lead",
          pipelineId: PIPELINE,
          stageId: STAGE,
          status: "open",
          contactId: "ghlAuto1",
        },
      }),
    })) as never;
    const criarAcolhimento = ((_cfg: unknown, concluir: unknown) => ({
      concluir,
      estadoContacto: async () => ({ ok: true as const, data: contactoGhl(telefone) }),
      enviar,
    })) as never;
    return { criarRemoto, criarAcolhimento, criarContacto, enviar };
  }

  function ingerirNovo(pedido: string, hash: string, telefone: string) {
    expect(ingerir(pedido, hash, telefone, null).ok).toBe(true);
    return valor(
      db.admin(`select id::text from public.site_lead_submissions where request_id='${pedido}';`),
    )!;
  }

  it("com os interruptores desligados não executa nada", async () => {
    expect(
      db.admin(
        `update public.site_integrations set remote_write_state='pendente' where organization_id='${orgA}';`,
      ).ok,
    ).toBe(true);
    const id = ingerirNovo("aaaaaaaa-7001-4777-8777-aaaaaaaaaaaa", "a".repeat(64), "351900000901");
    const sim = simulado("351900000901");
    const r = await executarReciboFalcao(id, {
      admin: adminSobreDb(),
      token: "token-de-teste",
      criarRemoto: sim.criarRemoto,
      criarAcolhimento: sim.criarAcolhimento,
    });
    expect(r).toMatchObject({ executado: false, motivo: "integracao_desligada" });
    expect(sim.criarContacto).not.toHaveBeenCalled();
    expect(sim.enviar).not.toHaveBeenCalled();
    expect(
      valor(db.admin(`select remote_state from public.site_lead_submissions where id='${id}';`)),
    ).toBe("pendente");
  });

  it("com tudo habilitado processa só este recibo e acolhe uma vez", async () => {
    expect(
      db.admin(
        `update public.site_integrations set enabled=true, remote_write_state='habilitado',
           welcome_channel_state='configurado' where organization_id='${orgA}';
         update public.ghl_connections set location_id='${LOC_OK}', status='conectada', write_enabled=true
           where organization_id='${orgA}';`,
      ).ok,
    ).toBe(true);
    const tel = "351900000902";
    const id = ingerirNovo("aaaaaaaa-7002-4777-8777-aaaaaaaaaaaa", "b".repeat(64), tel);
    const sim = simulado(tel);
    const r = await executarReciboFalcao(id, {
      admin: adminSobreDb(),
      token: "token-de-teste",
      criarRemoto: sim.criarRemoto,
      criarAcolhimento: sim.criarAcolhimento,
    });
    expect(r.remoto).toMatchObject({ estado: "confirmado" });
    expect(r.acolhimento).toMatchObject({ estado: "enviado", entregue: false });
    expect(sim.criarContacto).toHaveBeenCalledTimes(1);
    expect(sim.enviar).toHaveBeenCalledTimes(1);
    expect(
      valor(db.admin(`select remote_state from public.site_lead_submissions where id='${id}';`)),
    ).toBe("confirmado");
    expect(
      valor(
        db.admin(
          `select count(*)::text from public.site_lead_execution_ledger where first_submission_id='${id}';`,
        ),
      ),
    ).toBe("2");

    // Segundo recibo da MESMA pessoa: nenhuma chamada externa adicional.
    const id2 = ingerirNovo("aaaaaaaa-7003-4777-8777-aaaaaaaaaaaa", "c".repeat(64), tel);
    const sim2 = simulado(tel);
    const r2 = await executarReciboFalcao(id2, {
      admin: adminSobreDb(),
      token: "token-de-teste",
      criarRemoto: sim2.criarRemoto,
      criarAcolhimento: sim2.criarAcolhimento,
    });
    expect(r2.motivo).toBe("remoto_nao_confirmado");
    expect(sim2.criarContacto).not.toHaveBeenCalled();
    expect(sim2.enviar).not.toHaveBeenCalled();
  });
});

describe("controlos separados de escrita remota e acolhimento", () => {
  const flags = () =>
    valor(
      db.admin(
        `select remote_write_state || '/' || welcome_channel_state from public.site_integrations where organization_id='${orgA}';`,
      ),
    );
  const ligar = (uid: string, scope: string, estado: string) =>
    db.comoUtilizador(uid, `select public.set_site_integration_flags_v2('${scope}','${estado}',true);`);

  it("recusa quem não é administrador e recusa outra organização", () => {
    expect(ligar(UID_V, "remote_write", "ligado").ok).toBe(false);
    expect(ligar(UID_B, "remote_write", "ligado").ok).toBe(false);
  });

  it("não habilita a escrita com a escrita global desativada", () => {
    db.admin(
      `update public.ghl_connections set write_enabled=false, status='conectada' where organization_id='${orgA}';
       update public.site_integrations set remote_write_state='pendente', welcome_channel_state='pendente' where organization_id='${orgA}';`,
    );
    expect(ligar(UID_A, "remote_write", "ligado").ok).toBe(false);
    expect(flags()).toBe("pendente/pendente");
  });

  it("habilita a escrita e só depois permite o acolhimento", () => {
    db.admin(
      `update public.ghl_connections set write_enabled=true, status='conectada' where organization_id='${orgA}';`,
    );
    expect(ligar(UID_A, "welcome_channel", "ligado").ok).toBe(false);
    expect(ligar(UID_A, "remote_write", "ligado").ok, "escrita").toBe(true);
    expect(ligar(UID_A, "welcome_channel", "ligado").ok, "acolhimento").toBe(true);
    expect(flags()).toBe("habilitado/configurado");
  });

  it("desligar a escrita desliga também o acolhimento, sem mexer no ledger", () => {
    const antes = valor(db.admin(`select count(*)::text from public.site_lead_execution_ledger;`));
    db.admin(
      `update public.ghl_connections set write_enabled=false, status='desconectada' where organization_id='${orgA}';`,
    );
    const r = ligar(UID_A, "remote_write", "desligado");
    expect(r.ok, r.erro).toBe(true);
    expect(flags()).toBe("pendente/pendente");
    expect(valor(db.admin(`select count(*)::text from public.site_lead_execution_ledger;`))).toBe(
      antes,
    );
  });

  it("recusa qualquer parâmetro nulo sem tocar em flags, auditoria ou ledger", () => {
    db.admin(
      `update public.ghl_connections set write_enabled=true, status='conectada' where organization_id='${orgA}';
       update public.site_integrations set remote_write_state='habilitado', welcome_channel_state='pendente' where organization_id='${orgA}';`,
    );
    const auditoria = () =>
      valor(
        db.admin(
          `select count(*)::text from public.audit_logs where action='site_integration.flags_v2';`,
        ),
      );
    const ledger = () =>
      valor(db.admin(`select count(*)::text from public.site_lead_execution_ledger;`));
    const antesAudit = auditoria();
    const antesLedger = ledger();
    for (const sql of [
      "public.set_site_integration_flags_v2(null,'ligado',true)",
      "public.set_site_integration_flags_v2('welcome_channel',null,true)",
      "public.set_site_integration_flags_v2('remote_write','ligado',null)",
      "public.set_site_integration_flags_v2(null,null,null)",
    ]) {
      const r = db.comoUtilizador(UID_A, `select ${sql};`);
      expect(r.ok, sql).toBe(false);
      expect(r.erro ?? "", sql).toContain("22023");
    }
    expect(flags()).toBe("habilitado/pendente");
    expect(auditoria()).toBe(antesAudit);
    expect(ledger()).toBe(antesLedger);
    db.admin(
      `update public.site_integrations set remote_write_state='pendente', welcome_channel_state='pendente' where organization_id='${orgA}';
       update public.ghl_connections set write_enabled=false, status='desconectada' where organization_id='${orgA}';`,
    );
  });

  it("recusa âmbito ou estado desconhecido e falta de confirmação", () => {
    expect(ligar(UID_A, "tudo", "ligado").ok).toBe(false);
    expect(ligar(UID_A, "remote_write", "talvez").ok).toBe(false);
    expect(
      db.comoUtilizador(
        UID_A,
        `select public.set_site_integration_flags_v2('remote_write','ligado',false);`,
      ).ok,
    ).toBe(false);
  });
});
