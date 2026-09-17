/**
 * Testes contra Postgres real (migrações verdadeiras) do ingresso de leads do
 * site "Experiência Falcão". Nenhum dado real é usado e nada sai da máquina.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { iniciarDbReal, type DbReal } from "../../test/db";

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

function ingerir(pedido: string, hash: string, telefone: string, email: string | null) {
  return db.comoServico(
    `select public.ingest_site_lead('experiencia-falcao','${pedido}','${hash}','Pessoa Teste',
      '+${telefone}','${telefone}',${email ? `'${email}'` : "null"},'2026-09-17.contact.v1', now());`,
  );
}

beforeAll(async () => {
  db = await iniciarDbReal();
  for (const ficheiro of [
    "drizzle/migrations/0000_site_integration_experiencia_falcao.sql",
    "drizzle/migrations/0001_site_lead_serializacao_quota_e_escrita_remota.sql",
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
      `select public.ingest_site_lead('experiencia-falcao','${PEDIDO_1}','${HASH_1}','X','+351900000001','351900000001',null,'2026-09-17.contact.v1', now());`,
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
    const sql = `set role service_role; select public.ingest_site_lead('experiencia-falcao','${pedido}','${HASH_1}','Pessoa','+351900000333','351900000333',null,'2026-09-17.contact.v1', now())::text;`;
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
      `set role service_role; select public.ingest_site_lead('experiencia-falcao','${pedido}','${hash}','Pessoa','+351900000444','351900000444',null,'2026-09-17.contact.v1', now())::text;`;
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
    const r = db.comoServico(`select public.claim_site_lead_remote('${recibo()}');`);
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
    const r = db.comoServico(`select public.claim_site_lead_remote('${recibo()}');`);
    expect(r.ok).toBe(false);
    expect(r.erro).toContain("Escrita no GoHighLevel desativada");
  });

  it("reserva uma única vez e confirma os identificadores devolvidos", () => {
    expect(
      db.admin(
        `update public.ghl_connections set write_enabled=true where organization_id='${orgA}';`,
      ).ok,
    ).toBe(true);
    const id = recibo();
    const reserva = db.comoServico(`select public.claim_site_lead_remote('${id}')::text;`);
    expect(reserva.ok, reserva.erro).toBe(true);
    expect(valor(reserva)).toContain(PIPELINE);

    const segunda = db.comoServico(`select public.claim_site_lead_remote('${id}');`);
    expect(segunda.ok).toBe(false);

    const fim = db.comoServico(
      `select public.finish_site_lead_remote('${id}','confirmado','contacto_e_oportunidade_confirmados','ghlC1','ghlO1')::text;`,
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
      `select public.finish_site_lead_remote('${id}','confirmado','x','ghlC1','ghlO1');`,
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
