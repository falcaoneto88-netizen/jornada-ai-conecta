/**
 * Testes de isolamento entre organizações contra Postgres real, aplicando as
 * migrações e políticas verdadeiras do projeto. Nenhum dado real é usado.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { iniciarDbReal, type DbReal } from "../../test/db";

let db: DbReal;

const UID_A = "11111111-1111-4111-8111-111111111111"; // administrador org A
const UID_B = "22222222-2222-4222-8222-222222222222"; // administrador org B
const UID_G = "33333333-3333-4333-8333-333333333333"; // gestor org A
const UID_C = "44444444-4444-4444-8444-444444444444"; // comercial org A
const UID_V = "55555555-5555-4555-8555-555555555555"; // visualizador org A

let orgA = "";
let orgB = "";
let contactoA = "";
let contactoB = "";

function valor(r: { linhas: string[][] }): string | null {
  const ultima = r.linhas.at(-1);
  return ultima?.[0] ?? null;
}

beforeAll(async () => {
  db = await iniciarDbReal();

  for (const [uid, email] of [
    [UID_A, "a@exemplo.test"],
    [UID_B, "b@exemplo.test"],
    [UID_G, "g@exemplo.test"],
    [UID_C, "c@exemplo.test"],
    [UID_V, "v@exemplo.test"],
  ] as const) {
    const r = db.admin(`insert into auth.users (id, email) values ('${uid}', '${email}');`);
    expect(r.ok, r.erro).toBe(true);
  }

  orgA = valor(db.admin(`select organization_id from public.profiles where id = '${UID_A}';`))!;
  orgB = valor(db.admin(`select organization_id from public.profiles where id = '${UID_B}';`))!;

  // Coloca gestor/comercial/visualizador na organização A com o papel correto.
  for (const [uid, papel] of [
    [UID_G, "gestor"],
    [UID_C, "comercial"],
    [UID_V, "visualizador"],
  ] as const) {
    const r = db.admin(`
      update public.profiles set organization_id = '${orgA}' where id = '${uid}';
      delete from public.user_roles where user_id = '${uid}';
      insert into public.user_roles (user_id, organization_id, role) values ('${uid}', '${orgA}', '${papel}');
    `);
    expect(r.ok, r.erro).toBe(true);
  }

  db.admin(`
    insert into public.contacts (organization_id, full_name) values ('${orgA}', 'Cliente A');
    insert into public.contacts (organization_id, full_name) values ('${orgB}', 'Cliente B');
    insert into public.ghl_location_bindings (location_id, organization_id)
      values ('loc-sintetica-A', '${orgA}');
  `);
  contactoA = valor(db.admin(`select id from public.contacts where organization_id = '${orgA}' limit 1;`))!;
  contactoB = valor(db.admin(`select id from public.contacts where organization_id = '${orgB}' limit 1;`))!;
}, 120_000);

afterAll(() => db?.stop());

describe("isolamento entre organizações", () => {
  it("A só vê os contactos da própria organização", () => {
    const r = db.comoUtilizador(UID_A, "select count(*) from public.contacts;");
    expect(r.ok, r.erro).toBe(true);
    expect(valor(r)).toBe("1");
    const so = db.comoUtilizador(UID_A, `select count(*) from public.contacts where id = '${contactoB}';`);
    expect(valor(so)).toBe("0");
  });

  it("A não consegue alterar nem apagar dados de B", () => {
    const upd = db.comoUtilizador(
      UID_A,
      `with x as (update public.contacts set full_name = 'invadido' where id = '${contactoB}' returning 1)
       select count(*) from x;`,
    );
    expect(valor(upd)).toBe("0");
    const ins = db.comoUtilizador(
      UID_A,
      `insert into public.contacts (organization_id, full_name) values ('${orgB}', 'intruso');`,
    );
    expect(ins.ok).toBe(false);
    expect(ins.erro).toMatch(/row-level security/i);
  });

  it("A não muda a organização do próprio perfil", () => {
    const r = db.comoUtilizador(UID_A, `update public.profiles set organization_id = '${orgB}' where id = '${UID_A}';`);
    expect(r.ok).toBe(false);
    expect(r.erro).toMatch(/organizacao nao permitida|row-level security|permission denied for (column|table)/i);
    expect(valor(db.admin(`select organization_id from public.profiles where id = '${UID_A}';`))).toBe(orgA);
  });

  it("A pode atualizar o nome apresentado no próprio perfil", () => {
    const r = db.comoUtilizador(UID_A, `update public.profiles set full_name = 'Dr. A' where id = '${UID_A}';`);
    expect(r.ok, r.erro).toBe(true);
    expect(valor(db.admin(`select full_name from public.profiles where id = '${UID_A}';`))).toBe("Dr. A");
  });

  it("ninguém se auto-eleva em user_roles", () => {
    const r = db.comoUtilizador(
      UID_V,
      `insert into public.user_roles (user_id, organization_id, role) values ('${UID_V}', '${orgA}', 'administrador');`,
    );
    expect(r.ok).toBe(false);
    expect(r.erro).toMatch(/permission denied|row-level security/i);
  });

  it("cada utilizador só vê os próprios papéis", () => {
    const r = db.comoUtilizador(UID_C, "select count(*) from public.user_roles;");
    expect(valor(r)).toBe("1");
  });

  it("não é possível ligar filhos a pais de outra organização", () => {
    const r = db.comoUtilizador(
      UID_A,
      `insert into public.conversations (organization_id, contact_id) values ('${orgA}', '${contactoB}');`,
    );
    expect(r.ok).toBe(false);
    expect(r.erro).toMatch(/relacao invalida/i);
  });

  it("um registo não pode mudar de organização", () => {
    const r = db.comoUtilizador(
      UID_A,
      `update public.contacts set organization_id = '${orgB}' where id = '${contactoA}';`,
    );
    expect(r.ok).toBe(false);
    expect(r.erro).toMatch(/mudar o registo de organizacao|row-level security/i);
  });
});

describe("permissões por papel", () => {
  it("visualizador lê mas não escreve", () => {
    expect(valor(db.comoUtilizador(UID_V, "select count(*) from public.contacts;"))).toBe("1");
    const upd = db.comoUtilizador(
      UID_V,
      `with x as (update public.contacts set full_name = 'x' where id = '${contactoA}' returning 1)
       select count(*) from x;`,
    );
    expect(valor(upd)).toBe("0");
    const ins = db.comoUtilizador(
      UID_V,
      `insert into public.contacts (organization_id, full_name) values ('${orgA}', 'novo');`,
    );
    expect(ins.ok).toBe(false);
  });

  it("comercial opera contactos mas não cria automações", () => {
    const upd = db.comoUtilizador(
      UID_C,
      `with x as (update public.contacts set stage_key = 'em_atendimento' where id = '${contactoA}' returning 1)
       select count(*) from x;`,
    );
    expect(valor(upd)).toBe("1");
    const auto = db.comoUtilizador(
      UID_C,
      `insert into public.automations (organization_id, name) values ('${orgA}', 'proibida');`,
    );
    expect(auto.ok).toBe(false);
  });

  it("gestor gere automações e modelos", () => {
    const auto = db.comoUtilizador(
      UID_G,
      `insert into public.automations (organization_id, name) values ('${orgA}', 'reativação');`,
    );
    expect(auto.ok, auto.erro).toBe(true);
    const modelo = db.comoUtilizador(
      UID_G,
      `insert into public.message_templates (organization_id, name, body) values ('${orgA}', 'm', 'olá');`,
    );
    expect(modelo.ok, modelo.erro).toBe(true);
  });

  it("só o administrador altera a organização e a ligação", () => {
    const gestor = db.comoUtilizador(
      UID_G,
      `with x as (update public.organizations set name = 'renomeada' where id = '${orgA}' returning 1)
       select count(*) from x;`,
    );
    expect(valor(gestor)).toBe("0");
    const admin = db.comoUtilizador(
      UID_A,
      `with x as (update public.organizations set name = 'Clínica A' where id = '${orgA}' returning 1)
       select count(*) from x;`,
    );
    expect(valor(admin)).toBe("1");
  });
});

describe("integração e auditoria", () => {
  it("o vínculo de location é inacessível a utilizadores autenticados", () => {
    const r = db.comoUtilizador(UID_A, "select count(*) from public.ghl_location_bindings;");
    expect(r.ok).toBe(false);
    expect(r.erro).toMatch(/permission denied/i);
  });

  it("a organização B não tem vínculo e por isso não usa a credencial global", () => {
    const r = db.comoServico(
      `select count(*) from public.ghl_location_bindings where organization_id = '${orgB}';`,
    );
    expect(valor(r)).toBe("0");
    const a = db.comoServico(
      `select location_id from public.ghl_location_bindings where organization_id = '${orgA}';`,
    );
    expect(valor(a)).toBe("loc-sintetica-A");
  });

  it("o cliente não altera o endereço, a versão nem a location da API", () => {
    for (const campo of ["api_base_url = 'https://atacante.example'", "api_version = '9999-01-01'", "location_id = 'outra'", `organization_id = '${orgB}'`]) {
      const r = db.comoUtilizador(UID_A, `update public.ghl_connections set ${campo} where organization_id = '${orgA}';`);
      expect(r.ok, `devia recusar: ${campo}`).toBe(false);
      expect(r.erro).toMatch(/permission denied for (column|table)|row-level security/i);
    }
    const linha = db.admin(
      `select api_base_url, api_version, coalesce(location_id,'-') from public.ghl_connections where organization_id = '${orgA}';`,
    );
    expect(linha.linhas.at(-1)).toEqual(["https://services.leadconnectorhq.com", "2021-07-28", "-"]);
  });

  it("o administrador continua a poder gerir os campos operacionais da ligação", () => {
    const r = db.comoUtilizador(
      UID_A,
      `with x as (update public.ghl_connections set write_enabled = true, default_pipeline_id = 'pipe_1'
         where organization_id = '${orgA}' returning 1) select count(*) from x;`,
    );
    expect(valor(r)).toBe("1");
  });

  it("o administrador não pode apagar e reinserir a ligação com valores arbitrários", () => {
    const antes = db.admin(
      `select api_base_url, coalesce(location_id,'-') from public.ghl_connections where organization_id = '${orgA}';`,
    ).linhas.at(-1);

    const del = db.comoUtilizador(
      UID_A,
      `delete from public.ghl_connections where organization_id = '${orgA}';`,
    );
    expect(del.ok).toBe(false);
    expect(del.erro).toMatch(/permission denied|row-level security/i);

    const ins = db.comoUtilizador(
      UID_A,
      `insert into public.ghl_connections (organization_id, api_base_url, api_version, location_id)
         values ('${orgA}', 'https://atacante.example', '9999-01-01', 'loc-roubada');`,
    );
    expect(ins.ok).toBe(false);
    expect(ins.erro).toMatch(/permission denied|row-level security/i);

    const depois = db.admin(
      `select api_base_url, coalesce(location_id,'-') from public.ghl_connections where organization_id = '${orgA}';`,
    ).linhas.at(-1);
    expect(depois).toEqual(antes);
  });

  it("o cliente não escreve em papéis nem no vínculo de location", () => {
    const papel = db.comoUtilizador(
      UID_A,
      `insert into public.user_roles (user_id, organization_id, role) values ('${UID_A}', '${orgA}', 'administrador');`,
    );
    expect(papel.ok).toBe(false);
    expect(papel.erro).toMatch(/permission denied|row-level security/i);

    const vinculo = db.comoUtilizador(
      UID_A,
      `insert into public.ghl_location_bindings (location_id, organization_id) values ('loc-roubada', '${orgA}');`,
    );
    expect(vinculo.ok).toBe(false);
    expect(vinculo.erro).toMatch(/permission denied|row-level security/i);
  });

  it("o backend de confiança mantém a capacidade de provisionar e atualizar", () => {
    const r = db.comoServico(
      `with x as (update public.ghl_connections set location_id = 'loc-sintetica-A'
         where organization_id = '${orgA}' returning 1) select count(*) from x;`,
    );
    expect(valor(r)).toBe("1");
    const b = db.comoServico(
      `with x as (insert into public.ghl_location_bindings (location_id, organization_id)
         values ('loc-provisionada-B', '${orgB}')
         on conflict (location_id) do nothing returning 1) select count(*) from x;`,
    );
    expect(valor(b)).toBe("1");
    db.comoServico(`delete from public.ghl_location_bindings where location_id = 'loc-provisionada-B';`);
  });


  it("privilégios por coluna protegem o perfil em qualquer via de acesso", () => {
    for (const campo of ["email = 'novo@exemplo.test'", "id = gen_random_uuid()", "created_at = now()"]) {
      const r = db.comoUtilizador(UID_A, `update public.profiles set ${campo} where id = '${UID_A}';`);
      expect(r.ok, `devia recusar: ${campo}`).toBe(false);
    }
    expect(valor(db.admin(`select email from public.profiles where id = '${UID_A}';`))).toBe("a@exemplo.test");
  });

  it("as consultas de papéis só respondem sobre a própria identidade e organização", () => {
    const proprio = db.comoUtilizador(UID_A, `select public.has_role('${UID_A}', 'administrador');`);
    expect(valor(proprio)).toBe("t");
    const alheio = db.comoUtilizador(UID_C, `select public.has_role('${UID_A}', 'administrador');`);
    expect(valor(alheio)).toBe("f");
    const outraOrg = db.comoUtilizador(UID_A, `select public.has_org_role('${UID_B}', '${orgB}', 'administrador');`);
    expect(valor(outraOrg)).toBe("f");
    const backend = db.comoServico(`select public.has_org_role('${UID_B}', '${orgB}', 'administrador');`);
    expect(valor(backend)).toBe("t");
  });

  it("a auditoria não aceita identidades de outras pessoas", () => {
    const alheia = db.comoUtilizador(
      UID_C,
      `insert into public.audit_logs (organization_id, actor_id, action) values ('${orgA}', '${UID_A}', 'falsa');`,
    );
    expect(alheia.ok).toBe(false);
    const propria = db.comoUtilizador(
      UID_C,
      `insert into public.audit_logs (organization_id, actor_id, action) values ('${orgA}', '${UID_C}', 'legitima');`,
    );
    expect(propria.ok, propria.erro).toBe(true);
  });

  it("A não vê a auditoria nem os webhooks de B", () => {
    db.admin(`insert into public.audit_logs (organization_id, action) values ('${orgB}', 'privada');`);
    db.admin(
      `insert into public.webhooks_inbox (organization_id, idempotency_key) values ('${orgB}', 'k-b');`,
    );
    expect(valor(db.comoUtilizador(UID_A, "select count(*) from public.webhooks_inbox;"))).toBe("0");
    expect(
      valor(db.comoUtilizador(UID_A, "select count(*) from public.audit_logs where action = 'privada';")),
    ).toBe("0");
  });
});
