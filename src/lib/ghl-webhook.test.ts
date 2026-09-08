import { describe, expect, it, vi } from "vitest";

import {
  processarWebhook,
  type Claim,
  type ContactoGhl,
  type WebhookDeps,
  type WebhookStore,
} from "./ghl-webhook.core";

const SEGREDO = "segredo-de-teste-1234567890";
const LOCATION = "ok2UHC2QMZsd8UHsAgEa";
const ORG = "f07ab3be-7419-4779-a901-ef71c5fc27f0";

type Contacto = {
  id: string;
  ghlContactId: string;
  fullName: string;
  phoneNormalized: string | null;
  stageKey: string;
};

type Entrega = {
  id: string;
  key: string;
  status: "a_processar" | "processado" | "falhado";
  attempts: number;
  processedAt: string | null;
  error: string | null;
};

/** Store em memória que reproduz as regras reais (idempotência, etapas, auditoria). */
class StoreFalso implements WebhookStore {
  contactos: Contacto[] = [];
  entregas: Entrega[] = [];
  auditoria: { action: string; contactId: string }[] = [];
  falharProximoApply = false;
  etapaInicial = "novo_lead";
  private seq = 0;

  async findOrganization(locationId: string) {
    return locationId === LOCATION ? ORG : null;
  }

  async claim(input: { idempotencyKey: string }): Promise<Claim> {
    const existente = this.entregas.find((e) => e.key === input.idempotencyKey);
    if (!existente) {
      const nova: Entrega = {
        id: `inbox-${++this.seq}`,
        key: input.idempotencyKey,
        status: "a_processar",
        attempts: 1,
        processedAt: null,
        error: null,
      };
      this.entregas.push(nova);
      return { outcome: "claimed", inboxId: nova.id };
    }
    if (existente.status === "processado") return { outcome: "duplicate" };
    if (existente.status === "a_processar") return { outcome: "in_flight" };
    existente.status = "a_processar";
    existente.attempts += 1;
    return { outcome: "claimed", inboxId: existente.id };
  }

  async applyContact(input: {
    inboxId: string;
    contacto: { ghlContactId: string; fullName: string; phoneNormalized: string | null };
    eventType: string;
  }) {
    if (this.falharProximoApply) {
      this.falharProximoApply = false;
      throw new Error("falha simulada da base de dados");
    }
    let contacto = this.contactos.find((c) => c.ghlContactId === input.contacto.ghlContactId);
    let created = false;
    if (!contacto && input.contacto.phoneNormalized) {
      const porTelefone = this.contactos.find((c) => c.phoneNormalized === input.contacto.phoneNormalized);
      if (porTelefone) {
        porTelefone.ghlContactId = input.contacto.ghlContactId;
        contacto = porTelefone;
      }
    }
    if (!contacto) {
      contacto = {
        id: `contact-${++this.seq}`,
        ghlContactId: input.contacto.ghlContactId,
        fullName: input.contacto.fullName,
        phoneNormalized: input.contacto.phoneNormalized,
        stageKey: this.etapaInicial,
      };
      this.contactos.push(contacto);
      created = true;
    } else {
      contacto.fullName = input.contacto.fullName; // stageKey preservado
    }
    const entrega = this.entregas.find((e) => e.id === input.inboxId);
    if (entrega) {
      entrega.status = "processado";
      entrega.processedAt = new Date().toISOString();
      entrega.error = null;
    }
    this.auditoria.push({
      action: created ? "ghl.webhook.contacto_criado" : "ghl.webhook.contacto_atualizado",
      contactId: contacto.id,
    });
    return { contactId: contacto.id, created };
  }

  async markFailed(inboxId: string, message: string) {
    const entrega = this.entregas.find((e) => e.id === inboxId);
    if (entrega) {
      entrega.status = "falhado";
      entrega.processedAt = null;
      entrega.error = message;
    }
  }
}

function contactoGhl(over: Partial<ContactoGhl> = {}): ContactoGhl {
  return {
    id: "ghl-123",
    locationId: LOCATION,
    firstName: "Maria",
    lastName: "Silva",
    phone: "+351 912 345 678",
    email: "maria@exemplo.pt",
    tags: ["lead"],
    source: "Formulário",
    dateUpdated: "2026-09-08T10:00:00.000Z",
    ...over,
  };
}

function deps(store: StoreFalso, contacto: ContactoGhl = contactoGhl()): WebhookDeps {
  return {
    secret: SEGREDO,
    tokenPresente: true,
    locationEsperada: LOCATION,
    store,
    fetchContact: vi.fn(async () => ({ ok: true as const, contact: contacto })),
  };
}

function corpo(over: Record<string, unknown> = {}) {
  return JSON.stringify({
    type: "contact.created",
    locationId: LOCATION,
    contactId: "ghl-123",
    ...over,
  });
}

describe("recetor de Custom Webhook do GoHighLevel", () => {
  it("sincroniza um contacto válido e regista auditoria", async () => {
    const store = new StoreFalso();
    const res = await processarWebhook({ corpo: corpo(), segredoRecebido: SEGREDO }, deps(store));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, estado: "processado", criado: true });
    expect(store.contactos).toHaveLength(1);
    expect(store.contactos[0]!.fullName).toBe("Maria Silva");
    expect(store.contactos[0]!.stageKey).toBe("novo_lead");
    expect(store.auditoria).toEqual([
      { action: "ghl.webhook.contacto_criado", contactId: store.contactos[0]!.id },
    ]);
    expect(store.entregas[0]!.status).toBe("processado");
    expect(store.entregas[0]!.processedAt).not.toBeNull();
  });

  it("preserva a etapa da jornada num contact.updated", async () => {
    const store = new StoreFalso();
    await processarWebhook({ corpo: corpo(), segredoRecebido: SEGREDO }, deps(store));
    store.contactos[0]!.stageKey = "consulta_agendada";

    const atualizado = contactoGhl({ firstName: "Maria", lastName: "Silva Costa", dateUpdated: "2026-09-08T12:00:00.000Z" });
    const res = await processarWebhook(
      { corpo: corpo({ type: "contact.updated" }), segredoRecebido: SEGREDO },
      deps(store, atualizado),
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ criado: false });
    expect(store.contactos).toHaveLength(1);
    expect(store.contactos[0]!.fullName).toBe("Maria Silva Costa");
    expect(store.contactos[0]!.stageKey).toBe("consulta_agendada");
  });

  it("rejeita segredo errado sem tocar na base de dados", async () => {
    const store = new StoreFalso();
    const res = await processarWebhook({ corpo: corpo(), segredoRecebido: "errado" }, deps(store));
    expect(res.status).toBe(401);
    expect(store.entregas).toHaveLength(0);
    expect(store.contactos).toHaveLength(0);
  });

  it("rejeita location não autorizada", async () => {
    const store = new StoreFalso();
    const res = await processarWebhook(
      { corpo: corpo({ locationId: "outra-location" }), segredoRecebido: SEGREDO },
      deps(store),
    );
    expect(res.status).toBe(403);
    expect(store.entregas).toHaveLength(0);
  });

  it("rejeita contacto que pertence a outra location", async () => {
    const store = new StoreFalso();
    const res = await processarWebhook(
      { corpo: corpo(), segredoRecebido: SEGREDO },
      deps(store, contactoGhl({ locationId: "outra-location" })),
    );
    expect(res.status).toBe(403);
    expect(store.entregas).toHaveLength(0);
  });

  it("rejeita payload malformado e location/contact em falta", async () => {
    const store = new StoreFalso();
    expect((await processarWebhook({ corpo: "{", segredoRecebido: SEGREDO }, deps(store))).status).toBe(400);
    expect((await processarWebhook({ corpo: "[]", segredoRecebido: SEGREDO }, deps(store))).status).toBe(400);
    expect(
      (await processarWebhook({ corpo: corpo({ contactId: "" }), segredoRecebido: SEGREDO }, deps(store))).status,
    ).toBe(400);
    expect(
      (await processarWebhook({ corpo: corpo({ locationId: undefined }), segredoRecebido: SEGREDO }, deps(store)))
        .status,
    ).toBe(400);
    expect(store.entregas).toHaveLength(0);
  });

  it("rejeita evento não suportado em vez de o marcar processado", async () => {
    const store = new StoreFalso();
    const res = await processarWebhook(
      { corpo: corpo({ type: "opportunity.stage.updated" }), segredoRecebido: SEGREDO },
      deps(store),
    );
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ erro: "evento_nao_suportado" });
    expect(store.entregas).toHaveLength(0);
  });

  it("não duplica em entregas repetidas da mesma versão", async () => {
    const store = new StoreFalso();
    await processarWebhook({ corpo: corpo(), segredoRecebido: SEGREDO }, deps(store));
    const repetida = await processarWebhook({ corpo: corpo(), segredoRecebido: SEGREDO }, deps(store));

    expect(repetida.status).toBe(200);
    expect(repetida.body).toMatchObject({ estado: "duplicado" });
    expect(store.contactos).toHaveLength(1);
    expect(store.entregas).toHaveLength(1);
    expect(store.auditoria).toHaveLength(1);
  });

  it("deduplica por eventId quando fornecido, mas aceita nova versão do registo", async () => {
    const store = new StoreFalso();
    await processarWebhook({ corpo: corpo({ eventId: "evt-1" }), segredoRecebido: SEGREDO }, deps(store));
    const mesmoEvento = await processarWebhook(
      { corpo: corpo({ eventId: "evt-1" }), segredoRecebido: SEGREDO },
      deps(store),
    );
    expect(mesmoEvento.body).toMatchObject({ estado: "duplicado" });

    const novaVersao = await processarWebhook(
      { corpo: corpo({ type: "contact.updated" }), segredoRecebido: SEGREDO },
      deps(store, contactoGhl({ dateUpdated: "2026-09-09T08:00:00.000Z" })),
    );
    expect(novaVersao.body).toMatchObject({ estado: "processado", criado: false });
    expect(store.entregas).toHaveLength(2);
    expect(store.contactos).toHaveLength(1);
  });

  it("responde 409 retentável a entregas concorrentes", async () => {
    const store = new StoreFalso();
    const [a, b] = await Promise.all([
      processarWebhook({ corpo: corpo(), segredoRecebido: SEGREDO }, deps(store)),
      processarWebhook({ corpo: corpo(), segredoRecebido: SEGREDO }, deps(store)),
    ]);
    const estados = [a.status, b.status].sort();
    expect(estados).toEqual([200, 409]);
    expect(store.contactos).toHaveLength(1);
    expect(store.auditoria).toHaveLength(1);
  });

  it("marca falha sanitizada e permite nova tentativa", async () => {
    const store = new StoreFalso();
    store.falharProximoApply = true;

    const falha = await processarWebhook({ corpo: corpo(), segredoRecebido: SEGREDO }, deps(store));
    expect(falha.status).toBe(500);
    expect(falha.body).toMatchObject({ erro: "falha_ao_processar", retentavel: true });
    expect(store.entregas[0]!.status).toBe("falhado");
    expect(store.entregas[0]!.processedAt).toBeNull();
    expect(store.contactos).toHaveLength(0);

    const retry = await processarWebhook({ corpo: corpo(), segredoRecebido: SEGREDO }, deps(store));
    expect(retry.status).toBe(200);
    expect(store.entregas).toHaveLength(1);
    expect(store.entregas[0]!.status).toBe("processado");
    expect(store.entregas[0]!.attempts).toBe(2);
    expect(store.contactos).toHaveLength(1);
  });

  it("devolve 502 retentável quando o GoHighLevel falha, sem criar entrada órfã", async () => {
    const store = new StoreFalso();
    const d = deps(store);
    d.fetchContact = vi.fn(async () => ({ ok: false as const, status: 500, message: "erro do GHL" }));
    const res = await processarWebhook({ corpo: corpo(), segredoRecebido: SEGREDO }, d);
    expect(res.status).toBe(502);
    expect(store.entregas).toHaveLength(0);
  });
});
