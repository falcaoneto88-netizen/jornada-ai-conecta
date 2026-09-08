/**
 * Testes de integração contra as funções SQL reais, numa base de dados
 * Postgres efémera criada só para o teste. Todos os dados são sintéticos.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { processarWebhook, type ContactoGhl, type WebhookDeps } from "./ghl-webhook.core";
import { criarStore } from "./ghl-webhook.server";
import { iniciarDb, type Db } from "../../test/pg";
import { criarClienteRpc } from "../../test/rpc";

const SEGREDO = "segredo-de-teste-1234567890";
const LOCATION = "ok2UHC2QMZsd8UHsAgEa";
const ORG = "f07ab3be-7419-4779-a901-ef71c5fc27f0";
const OUTRA_ORG = "11111111-2222-3333-4444-555555555555";

let db: Db;

function deps(
  contactos: Record<string, ContactoGhl>,
  falha?: { status: number; message: string },
): WebhookDeps {
  return {
    secret: SEGREDO,
    tokenPresente: true,
    locationEsperada: LOCATION,
    store: criarStore(criarClienteRpc(db)),
    fetchContact: async (id) => {
      if (falha) return { ok: false, status: falha.status, message: falha.message };
      const c = contactos[id];
      return c ? { ok: true, contact: c } : { ok: false, status: 404, message: "não encontrado" };
    },
  };
}

function corpo(extra: Record<string, unknown> = {}) {
  return JSON.stringify({ type: "contact.created", locationId: LOCATION, contactId: "c1", ...extra });
}

async function tabela(sql: string) {
  return db.query(sql);
}

beforeAll(async () => {
  db = await iniciarDb();
}, 180_000);

afterAll(() => db?.stop());

beforeEach(async () => {
  await tabela("delete from public.audit_logs");
  await tabela("delete from public.webhooks_inbox");
  await tabela("delete from public.contacts");
  await tabela("delete from public.ghl_location_bindings");
  await tabela("delete from public.journey_stages");
  await tabela("delete from public.organizations");
  await tabela(
    `insert into public.organizations (id, name) values ('${ORG}','Clínica'), ('${OUTRA_ORG}','Outra')`,
  );
  await tabela(
    `insert into public.journey_stages (organization_id, key, name, position) values ('${ORG}','novo_lead','Novo Lead',1), ('${ORG}','follow_up','Follow-up',2)`,
  );
  await tabela(
    `insert into public.ghl_location_bindings (location_id, organization_id) values ('${LOCATION}','${ORG}')`,
  );
});

describe("recetor sobre SQL real", () => {
  it("sincroniza um contacto novo na primeira etapa", async () => {
    const r = await processarWebhook(
      { corpo: corpo(), segredoRecebido: SEGREDO },
      deps({
        c1: {
          id: "c1",
          locationId: LOCATION,
          firstName: "Ana",
          phone: "+351911111111",
          email: "ana@ex.pt",
          dateUpdated: "2026-09-01T10:00:00Z",
        },
      }),
    );
    expect(r.status).toBe(200);
    const [c] = await tabela(
      "select full_name, stage_key, phone_normalized, ghl_contact_id from public.contacts",
    );
    expect(c).toMatchObject({ c0: "Ana", c1: "novo_lead", c2: "351911111111", c3: "c1" });
    const [inbox] = await tabela("select status, processed_at is not null from public.webhooks_inbox");
    expect(inbox).toMatchObject({ c0: "processado", c1: "t" });
  });

  it("preserva a etapa e sincroniza remoções de telefone e email", async () => {
    const c1 = (dateUpdated: string, phone: string | null, email: string | null): ContactoGhl => ({
      id: "c1",
      locationId: LOCATION,
      firstName: "Ana",
      phone,
      email,
      dateUpdated,
    });
    await processarWebhook(
      { corpo: corpo(), segredoRecebido: SEGREDO },
      deps({ c1: c1("2026-09-01T10:00:00Z", "+351911111111", "ana@ex.pt") }),
    );
    await tabela("update public.contacts set stage_key = 'follow_up'");
    const r = await processarWebhook(
      { corpo: corpo({ type: "contact.updated" }), segredoRecebido: SEGREDO },
      deps({ c1: c1("2026-09-02T10:00:00Z", null, null) }),
    );
    expect(r.status).toBe(200);
    const [c] = await tabela(
      "select stage_key, phone, phone_normalized, email from public.contacts",
    );
    expect(c).toEqual({ c0: "follow_up", c1: null, c2: null, c3: null });
  });

  it("nunca funde dois contactos GHL distintos com o mesmo telefone", async () => {
    const base = (id: string, nome: string): ContactoGhl => ({
      id,
      locationId: LOCATION,
      firstName: nome,
      phone: "+351911111111",
      dateUpdated: "2026-09-01T10:00:00Z",
    });
    await processarWebhook(
      { corpo: corpo(), segredoRecebido: SEGREDO },
      deps({ c1: base("c1", "Ana") }),
    );
    const r = await processarWebhook(
      { corpo: corpo({ contactId: "c2" }), segredoRecebido: SEGREDO },
      deps({ c2: base("c2", "Bruno") }),
    );
    expect(r.status).toBe(200);
    const linhas = await tabela(
      "select ghl_contact_id, full_name, phone, phone_normalized from public.contacts order by full_name",
    );
    expect(linhas).toEqual([
      { c0: "c1", c1: "Ana", c2: "+351911111111", c3: "351911111111" },
      { c0: "c2", c1: "Bruno", c2: "+351911111111", c3: null },
    ]);
  });

  it("entrega repetida não duplica contacto nem auditoria", async () => {
    const d = deps({
      c1: { id: "c1", locationId: LOCATION, firstName: "Ana", dateUpdated: "2026-09-01T10:00:00Z" },
    });
    const a = await processarWebhook({ corpo: corpo(), segredoRecebido: SEGREDO }, d);
    const b = await processarWebhook({ corpo: corpo(), segredoRecebido: SEGREDO }, d);
    expect(a.body["estado"]).toBe("processado");
    expect(b.body["estado"]).toBe("duplicado");
    expect(await tabela("select count(*) from public.contacts")).toEqual([{ c0: "1" }]);
    expect(await tabela("select count(*) from public.audit_logs")).toEqual([{ c0: "1" }]);
  });

  it("reserva expirada só é adquirida por um worker e bloqueia o worker antigo", async () => {
    const store = criarStore(criarClienteRpc(db));
    const entrada = {
      idempotencyKey: "k1",
      organizationId: ORG,
      locationId: LOCATION,
      eventType: "contact.created" as const,
      eventId: null,
      sourceVersion: "v:1",
      ghlContactId: "c1",
      contentFallback: false,
      payload: {},
    };
    const primeiro = await store.claim(entrada);
    expect(primeiro.outcome).toBe("claimed");
    expect((await store.claim(entrada)).outcome).toBe("in_flight");

    await tabela("update public.webhooks_inbox set locked_at = now() - interval '1 hour'");
    const segundo = await store.claim(entrada);
    expect(segundo).toMatchObject({ outcome: "claimed", fence: 2 });

    const contacto = {
      ghlContactId: "c1",
      fullName: "Ana",
      phone: null,
      phoneNormalized: null,
      email: null,
      tags: [],
      source: "GoHighLevel",
      lastInteractionAt: null,
    };
    if (primeiro.outcome !== "claimed" || segundo.outcome !== "claimed") throw new Error("claim");

    // worker antigo (fence 1) não pode aplicar
    expect(
      await store.applyContact({
        inboxId: primeiro.inboxId,
        fence: primeiro.fence,
        organizationId: ORG,
        eventType: "contact.created",
        sourceVersion: "v:1",
        contacto,
      }),
    ).toEqual({ estado: "reserva_expirada" });

    // worker atual aplica
    expect(
      (
        await store.applyContact({
          inboxId: segundo.inboxId,
          fence: segundo.fence,
          organizationId: ORG,
          eventType: "contact.created",
          sourceVersion: "v:1",
          contacto,
        })
      ).estado,
    ).toBe("processado");

    // worker antigo não pode marcar como falhado depois do sucesso
    expect(
      await store.markFailed({ inboxId: primeiro.inboxId, fence: 1, organizationId: ORG, message: "x" }),
    ).toBe(false);
    expect(await tabela("select status from public.webhooks_inbox")).toEqual([{ c0: "processado" }]);
    expect(await tabela("select count(*) from public.contacts")).toEqual([{ c0: "1" }]);
  });

  it("recusa aplicar uma entrega de outra organização", async () => {
    const store = criarStore(criarClienteRpc(db));
    const claim = await store.claim({
      idempotencyKey: "k2",
      organizationId: ORG,
      locationId: LOCATION,
      eventType: "contact.created",
      eventId: null,
      sourceVersion: "v:1",
      ghlContactId: "c1",
      contentFallback: false,
      payload: {},
    });
    if (claim.outcome !== "claimed") throw new Error("claim");
    expect(
      await store.applyContact({
        inboxId: claim.inboxId,
        fence: claim.fence,
        organizationId: OUTRA_ORG,
        eventType: "contact.created",
        sourceVersion: "v:1",
        contacto: {
          ghlContactId: "c1",
          fullName: "Ana",
          phone: null,
          phoneNormalized: null,
          email: null,
          tags: [],
          source: null,
          lastInteractionAt: null,
        },
      }),
    ).toEqual({ estado: "organizacao_divergente" });

    // e a reserva não é aceite para uma location ligada a outra organização
    expect(
      (
        await store.claim({
          idempotencyKey: "k3",
          organizationId: OUTRA_ORG,
          locationId: LOCATION,
          eventType: "contact.created",
          eventId: null,
          sourceVersion: "v:1",
          ghlContactId: "c1",
          contentFallback: false,
          payload: {},
        })
      ).outcome,
    ).toBe("mismatch");
  });

  it("A→B→A sem dateUpdated volta a aplicar o estado anterior", async () => {
    const estado = (nome: string): ContactoGhl => ({ id: "c1", locationId: LOCATION, firstName: nome });
    const enviar = (nome: string) =>
      processarWebhook(
        { corpo: corpo({ type: "contact.updated" }), segredoRecebido: SEGREDO },
        deps({ c1: estado(nome) }),
      );
    expect((await enviar("Ana")).body["estado"]).toBe("processado");
    expect((await enviar("Ana")).body["estado"]).toBe("duplicado");
    expect((await enviar("Bruno")).body["estado"]).toBe("processado");
    expect((await enviar("Ana")).body["estado"]).toBe("processado");
    expect(await tabela("select full_name from public.contacts")).toEqual([{ c0: "Ana" }]);
  });

  it("ignora uma versão de origem mais antiga", async () => {
    const c = (nome: string, dateUpdated: string): ContactoGhl => ({
      id: "c1",
      locationId: LOCATION,
      firstName: nome,
      dateUpdated,
    });
    await processarWebhook(
      { corpo: corpo({ type: "contact.updated" }), segredoRecebido: SEGREDO },
      deps({ c1: c("Nova", "2026-09-05T10:00:00Z") }),
    );
    const r = await processarWebhook(
      { corpo: corpo({ type: "contact.updated" }), segredoRecebido: SEGREDO },
      deps({ c1: c("Antiga", "2026-09-01T10:00:00Z") }),
    );
    expect(r.body["estado"]).toBe("versao_antiga_ignorada");
    expect(await tabela("select full_name from public.contacts")).toEqual([{ c0: "Nova" }]);
  });

  it("regista falha ao obter o contacto no GoHighLevel", async () => {
    const r = await processarWebhook(
      { corpo: corpo(), segredoRecebido: SEGREDO },
      deps({}, { status: 500, message: "indisponível" }),
    );
    expect(r.status).toBe(502);
    const [inbox] = await tabela(
      "select status, processed_at, error_message from public.webhooks_inbox",
    );
    expect(inbox?.["c0"]).toBe("falhado");
    expect(inbox?.["c1"]).toBeNull();
    expect(String(inbox?.["c2"])).toContain("falha ao obter contacto");
    expect(await tabela("select count(*) from public.contacts")).toEqual([{ c0: "0" }]);
  });

  it("recusa segredo errado, location errada, evento não suportado e JSON inválido", async () => {
    const d = deps({});
    expect((await processarWebhook({ corpo: corpo(), segredoRecebido: "errado" }, d)).status).toBe(401);
    expect(
      (await processarWebhook({ corpo: corpo({ locationId: "outra" }), segredoRecebido: SEGREDO }, d))
        .status,
    ).toBe(403);
    expect(
      (await processarWebhook({ corpo: corpo({ type: "opportunity.created" }), segredoRecebido: SEGREDO }, d))
        .status,
    ).toBe(422);
    expect((await processarWebhook({ corpo: "{", segredoRecebido: SEGREDO }, d)).status).toBe(400);
    expect(
      (await processarWebhook({ corpo: corpo({ contactId: null }), segredoRecebido: SEGREDO }, d)).status,
    ).toBe(400);
    expect(await tabela("select count(*) from public.webhooks_inbox")).toEqual([{ c0: "0" }]);
  });
});
