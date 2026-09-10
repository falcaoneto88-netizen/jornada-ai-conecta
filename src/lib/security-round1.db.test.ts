import { sincronizarContactos, ErroContacto } from "./ghl-contacts.core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { iniciarDbReal, type DbReal, type Resultado } from "../../test/db";

let db: DbReal;
const a = "11111111-1111-4111-8111-111111111111";
const b = "22222222-2222-4222-8222-222222222222";
let orgA: string;
let orgB: string;
let ca: string;
let cb: string;
const value = (r: Resultado) => {
  expect(r.ok, r.erro).toBe(true);
  return r.linhas.at(-1)![0]!;
};
const ok = (r: Resultado) => expect(r.ok, r.erro).toBe(true);

beforeAll(async () => {
  db = await iniciarDbReal();
  ok(
    db.admin(
      `insert into auth.users (id,email) values ('${a}','a@example.test'), ('${b}','b@example.test');`,
    ),
  );
  orgA = value(db.admin(`select organization_id from profiles where id='${a}'`));
  orgB = value(db.admin(`select organization_id from profiles where id='${b}'`));
  ca = value(
    db.admin(`insert into contacts(organization_id,full_name) values ('${orgA}','A') returning id`),
  );
  cb = value(
    db.admin(`insert into contacts(organization_id,full_name) values ('${orgB}','B') returning id`),
  );
  ok(
    db.admin(`insert into ghl_location_bindings(location_id,organization_id) values ('loc-teste','${orgA}');
    update ghl_connections set status='conectada' where organization_id='${orgA}';`),
  );
}, 120_000);
afterAll(() => db?.stop());

describe("agenda e auditoria atómica", () => {
  it("aceita agendamento sem contacto ou com contacto da mesma organização", () => {
    ok(
      db.comoUtilizador(
        a,
        `insert into appointments(organization_id,contact_id,start_at)
      values ('${orgA}',null,now()),('${orgA}','${ca}',now())`,
      ),
    );
  });
  it("bloqueia vínculo entre organizações no INSERT e UPDATE", () => {
    expect(
      db.comoUtilizador(
        a,
        `insert into appointments(organization_id,contact_id,start_at)
      values ('${orgA}','${cb}',now())`,
      ).ok,
    ).toBe(false);
    expect(
      db.comoUtilizador(
        a,
        `update appointments set contact_id='${cb}' where organization_id='${orgA}'`,
      ).ok,
    ).toBe(false);
    expect(
      value(
        db.admin(`select count(*) from appointments a join contacts c on c.id=a.contact_id
      where a.organization_id<>c.organization_id`),
      ),
    ).toBe("0");
  });
  it("também bloqueia vínculo incorreto no service role", () => {
    expect(
      db.comoServico(`insert into appointments(organization_id,contact_id,start_at)
      values ('${orgA}','${cb}',now())`).ok,
    ).toBe(false);
  });
  it("movimenta e grava um único evento com identidade derivada do JWT", () => {
    const etapa = value(
      db.admin(
        `select key from journey_stages where organization_id='${orgA}' and key<>'novo_lead' order by position limit 1`,
      ),
    );
    ok(db.comoUtilizador(a, `update contacts set stage_key='${etapa}' where id='${ca}'`));
    ok(db.comoUtilizador(a, `update contacts set stage_key='${etapa}' where id='${ca}'`));
    expect(
      value(
        db.admin(
          `select count(*) from audit_logs where entity_id='${ca}' and verified and actor_id='${a}'`,
        ),
      ),
    ).toBe("1");
    expect(
      db.comoUtilizador(a, `update contacts set stage_key='inexistente' where id='${ca}'`).ok,
    ).toBe(false);
  });
  it("falha na auditoria desfaz a mudança de etapa", () => {
    const anterior = value(db.admin(`select stage_key from contacts where id='${ca}'`));
    ok(
      db.admin(
        `alter table audit_logs add constraint teste_falha_log check (action <> 'contacto.mover_etapa') not valid`,
      ),
    );
    try {
      expect(
        db.comoUtilizador(a, `update contacts set stage_key='novo_lead' where id='${ca}'`).ok,
      ).toBe(false);
      expect(value(db.admin(`select stage_key from contacts where id='${ca}'`))).toBe(anterior);
    } finally {
      ok(db.admin("alter table audit_logs drop constraint teste_falha_log"));
    }
  });
  it("cliente não falsifica evento verificado e não vê logs de outra organização", () => {
    expect(
      db.comoUtilizador(
        a,
        `insert into audit_logs(organization_id,actor_id,action,entity,verified)
      values ('${orgA}','${a}','contacto.mover_etapa','contacts',true)`,
      ).ok,
    ).toBe(false);
    expect(
      value(
        db.comoUtilizador(b, `select count(*) from audit_logs where organization_id='${orgA}'`),
      ),
    ).toBe("0");
  });
});

function snapshot(
  id: string,
  at = "2026-09-10T10:00:00Z",
  phone: string | null = null,
  nome = "Fictício",
) {
  const json = JSON.stringify({
    id,
    locationId: "loc-teste",
    dateUpdated: at,
    firstName: nome,
    phone,
  }).replaceAll("'", "''");
  return `select public.ghl_apply_contact_snapshot('${orgA}','loc-teste','${a}','${json}'::jsonb)`;
}
describe("snapshot de contacto seguro", () => {
  it("RPC não pode ser chamada diretamente por cliente autenticado", () => {
    expect(db.comoUtilizador(a, snapshot("negado")).ok).toBe(false);
  });
  it("valida vínculo e ator mesmo no service role", () => {
    expect(
      db.comoServico(snapshot("negado").replace(`'loc-teste','${a}'`, `'outra','${a}'`)).ok,
    ).toBe(false);
    expect(db.comoServico(snapshot("negado").replace(`'${a}'`, `'${b}'`)).ok).toBe(false);
  });
  it("preserva etapa local e ignora versões iguais/antigas", () => {
    expect(value(db.comoServico(snapshot("versao")))).toContain("aplicado");
    ok(
      db.comoUtilizador(
        a,
        `update contacts set stage_key=(select key from journey_stages where organization_id='${orgA}' and key<>'novo_lead' limit 1)
      where ghl_contact_id='versao'`,
      ),
    );
    const etapa = value(db.admin("select stage_key from contacts where ghl_contact_id='versao'"));
    expect(
      value(db.comoServico(snapshot("versao", "2026-09-09T10:00:00Z", null, "Antigo"))),
    ).toContain("ignorado");
    expect(value(db.comoServico(snapshot("versao")))).toContain("ignorado");
    expect(value(db.admin("select full_name from contacts where ghl_contact_id='versao'"))).toBe(
      "Fictício",
    );
    expect(value(db.admin("select stage_key from contacts where ghl_contact_id='versao'"))).toBe(
      etapa,
    );
  });
  it("não funde contactos com telefone duplicado", () => {
    expect(value(db.comoServico(snapshot("fone-a", undefined, "+55 11 999999999")))).toContain(
      "aplicado",
    );
    expect(value(db.comoServico(snapshot("fone-b", undefined, "+55 11 999999999")))).toContain(
      "conflito_telefone",
    );
    expect(value(db.admin("select count(*) from contacts where ghl_contact_id='fone-b'"))).toBe(
      "0",
    );
  });
  it("falha de log desfaz a importação inteira daquele contacto", () => {
    ok(
      db.admin(
        `alter table audit_logs add constraint teste_falha_sync check (action <> 'ghl.sync.contacto') not valid`,
      ),
    );
    try {
      expect(db.comoServico(snapshot("rollback")).ok).toBe(false);
      expect(value(db.admin("select count(*) from contacts where ghl_contact_id='rollback'"))).toBe(
        "0",
      );
    } finally {
      ok(db.admin("alter table audit_logs drop constraint teste_falha_sync"));
    }
  });
  it("duas importações simultâneas criam um contacto e um log", async () => {
    const results = await Promise.all([
      db.adminAsync(snapshot("concorrente")),
      db.adminAsync(snapshot("concorrente")),
    ]);
    results.forEach(ok);
    expect(
      value(db.admin("select count(*) from contacts where ghl_contact_id='concorrente'")),
    ).toBe("1");
    expect(
      value(
        db.admin(
          "select count(*) from audit_logs where entity_id=(select id::text from contacts where ghl_contact_id='concorrente') and action='ghl.sync.contacto'",
        ),
      ),
    ).toBe("1");
  });
  it("concorrência de versões preserva a mais recente", async () => {
    const results = await Promise.all([
      db.adminAsync(snapshot("corrida", "2026-09-10T12:00:00Z", null, "Novo")),
      db.adminAsync(snapshot("corrida", "2026-09-10T11:00:00Z", null, "Antigo")),
    ]);
    results.forEach(ok);
    expect(value(db.admin("select full_name from contacts where ghl_contact_id='corrida'"))).toBe(
      "Novo",
    );
  });
  it("sincronização e webhook concorrentes preservam a versão mais recente", async () => {
    const claim = JSON.parse(
      value(
        db.comoServico(`select public.ghl_claim_delivery(
      '${orgA}','loc-teste','evento-ficticio','ContactUpdate','evento-ficticio','v:2026-09-10T13:00:00Z',
      '{}'::jsonb,'corrida-webhook',false)`),
      ),
    );
    expect(claim.outcome).toBe("claimed");
    const webhook = `select public.ghl_apply_contact_event_v2('${claim.inbox_id}',${claim.fence},'${orgA}',
      'corrida-webhook','Novo pelo webhook',null,null,null,'{}'::text[],'Teste',
      '2026-09-10T13:00:00Z','ContactUpdate','v:2026-09-10T13:00:00Z')`;
    const results = await Promise.all([
      db.adminAsync(webhook),
      db.adminAsync(snapshot("corrida-webhook", "2026-09-10T12:00:00Z", null, "Antigo pela lista")),
    ]);
    results.forEach(ok);
    expect(
      value(db.admin("select full_name from contacts where ghl_contact_id='corrida-webhook'")),
    ).toBe("Novo pelo webhook");
    expect(
      value(db.admin("select count(*) from contacts where ghl_contact_id='corrida-webhook'")),
    ).toBe("1");
  });
  it("carimbo de conclusão não avança quando o resumo falha", () => {
    const before = value(
      db.admin(
        `select coalesce(last_sync_at::text,'ausente') from ghl_connections where organization_id='${orgA}'`,
      ),
    );
    ok(
      db.admin(
        `alter table audit_logs add constraint teste_falha_fim check (action <> 'ghl.sync.leitura') not valid`,
      ),
    );
    try {
      expect(
        db.comoServico(`select public.ghl_finish_contact_sync('${orgA}','loc-teste','${a}',1,0)`)
          .ok,
      ).toBe(false);
      expect(
        value(
          db.admin(
            `select coalesce(last_sync_at::text,'ausente') from ghl_connections where organization_id='${orgA}'`,
          ),
        ),
      ).toBe(before);
    } finally {
      ok(db.admin("alter table audit_logs drop constraint teste_falha_fim"));
    }
    ok(db.comoServico(`select public.ghl_finish_contact_sync('${orgA}','loc-teste','${a}',1,0)`));
  });
});

describe("homologação isolada R1/R2", () => {
  it("lote misto preserva pendentes, grava seguros e não marca conclusão", async () => {
    ok(
      db.admin(
        `insert into contacts(organization_id,ghl_contact_id,full_name) values ('${orgA}','pendente-data','Preservar');`,
      ),
    );
    const stamp = value(
      db.admin(
        `select coalesce(last_sync_at::text,'ausente') from ghl_connections where organization_id='${orgA}'`,
      ),
    );
    const r = await sincronizarContactos({
      locationId: "loc-teste",
      pagina: async () => ({
        contacts: [{ id: "pendente-data" }, { id: "pendente-fone" }, { id: "lote-seguro" }],
        meta: { total: 3 },
      }),
      detalhe: async (id) => ({
        id,
        locationId: "loc-teste",
        firstName: "Alterado",
        ...(id === "pendente-data" ? {} : { dateUpdated: "2026-09-10T14:00:00Z" }),
        phone: id === "pendente-fone" ? "+55 11 999999999" : null,
      }),
      aplicar: async (c) => {
        const estado = JSON.parse(
          value(
            db.comoServico(snapshot(c.id, c.dateUpdated, c.phone ?? null, c.firstName ?? "Teste")),
          ),
        )["estado"];
        if (estado === "aplicado" || estado === "ignorado") return estado;
        throw new ErroContacto(estado, "Conflito de contacto.");
      },
    });
    expect(r).toMatchObject({
      ok: false,
      importados: 1,
      pendencias: [
        { contactId: "pendente-data", code: "sem_versao" },
        { contactId: "pendente-fone", code: "conflito_telefone" },
      ],
    });
    expect(
      value(db.admin("select full_name from contacts where ghl_contact_id='pendente-data'")),
    ).toBe("Preservar");
    expect(
      value(db.admin("select count(*) from contacts where ghl_contact_id='lote-seguro'")),
    ).toBe("1");
    expect(
      value(
        db.admin(
          `select coalesce(last_sync_at::text,'ausente') from ghl_connections where organization_id='${orgA}'`,
        ),
      ),
    ).toBe(stamp);
  });
});
