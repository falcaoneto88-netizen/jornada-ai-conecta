/**
 * Testes do motor da agenda: normalização, janela temporal, associação ao
 * cliente e deduplicação. Nenhuma chamada real ao GoHighLevel.
 */
import { describe, expect, it } from "vitest";

import {
  estadoMarcacao,
  normalizarEvento,
  sincronizarAgenda,
  type ContactoNovoAgenda,
  type LinhaMarcacao,
  type LojaAgenda,
} from "./ghl-agenda.core";

const CTX = {
  calendarId: "nPXR1Fyp0r3CpaMMGSki",
  locationId: "ok2UHC2QMZsd8UHsAgEa",
  inicio: "2026-01-01T00:00:00.000Z",
  fim: "2026-12-31T00:00:00.000Z",
};

function lojaFalsa(inicial: { contactos?: Record<string, string>; marcacoes?: Record<string, string> } = {}) {
  const contactos = new Map(Object.entries(inicial.contactos ?? {}));
  const marcacoes = new Map(Object.entries(inicial.marcacoes ?? {}));
  const gravadas: LinhaMarcacao[] = [];
  const atualizadas: { id: string; linha: LinhaMarcacao }[] = [];
  const criados: ContactoNovoAgenda[] = [];

  const loja: LojaAgenda = {
    async contactosPorGhlId(ids) {
      return new Map(ids.filter((i) => contactos.has(i)).map((i) => [i, contactos.get(i)!]));
    },
    async inserirContacto(linha) {
      criados.push(linha);
      const id = `local-${linha.ghl_contact_id}`;
      contactos.set(linha.ghl_contact_id, id);
      return id;
    },
    async marcacoesPorGhlId(ids) {
      return new Map(
        ids.filter((i) => marcacoes.has(i)).map((i) => [i, { id: marcacoes.get(i)!, contactId: "existente" }]),
      );
    },
    async inserirMarcacao(linha) {
      gravadas.push(linha);
      return "inserida";
    },
    async atualizarMarcacao(id, linha) {
      atualizadas.push({ id, linha });
    },
  };

  return { loja, gravadas, atualizadas, criados };
}

describe("normalização de eventos", () => {
  it("aceita um evento válido e traduz o estado", () => {
    const r = normalizarEvento(
      {
        id: "evt1",
        calendarId: CTX.calendarId,
        locationId: CTX.locationId,
        contactId: "c1",
        title: "Consulta",
        appointmentStatus: "noshow",
        startTime: "2026-03-10T10:00:00.000Z",
        endTime: "2026-03-10T11:00:00.000Z",
      },
      CTX,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.evento.status).toBe("faltou");
      expect(r.evento.contactoGhlId).toBe("c1");
    }
  });

  it("recusa evento de outra agenda, de outra localização e fora do período", () => {
    expect(normalizarEvento({ id: "e", calendarId: "outra", startTime: "2026-03-10T10:00:00Z" }, CTX).ok).toBe(false);
    expect(
      normalizarEvento({ id: "e", locationId: "outra-loc", startTime: "2026-03-10T10:00:00Z" }, CTX).ok,
    ).toBe(false);
    expect(normalizarEvento({ id: "e", startTime: "2020-01-01T10:00:00Z" }, CTX).ok).toBe(false);
    expect(normalizarEvento({ id: "e", startTime: "não é data" }, CTX).ok).toBe(false);
    expect(normalizarEvento({ startTime: "2026-03-10T10:00:00Z" }, CTX).ok).toBe(false);
  });

  it("mapeia os estados conhecidos", () => {
    expect(estadoMarcacao("confirmed")).toBe("confirmada");
    expect(estadoMarcacao("showed")).toBe("realizada");
    expect(estadoMarcacao("cancelled")).toBe("cancelada");
    expect(estadoMarcacao(undefined)).toBe("confirmada");
  });
});

describe("sincronização da agenda", () => {
  const base = {
    orgId: "org",
    locationId: CTX.locationId,
    calendarId: CTX.calendarId,
    inicio: CTX.inicio,
    fim: CTX.fim,
    etapaInicialContacto: "novo_lead",
  };

  it("cria o cliente em falta e grava a marcação uma única vez", async () => {
    const { loja, gravadas, criados } = lojaFalsa();
    const evento = {
      id: "evt1",
      calendarId: CTX.calendarId,
      contactId: "c1",
      title: "Harmonização",
      startTime: "2026-03-10T10:00:00.000Z",
    };
    const r = await sincronizarAgenda({
      ...base,
      eventos: [evento, { ...evento }],
      loja,
      buscarContacto: async (id) => ({
        ok: true,
        contacto: {
          organization_id: "org",
          ghl_contact_id: id,
          full_name: "Cliente Teste",
          phone: null,
          phone_normalized: null,
          email: null,
          tags: [],
          source: "GoHighLevel",
          stage_key: "novo_lead",
          is_demo: false,
        },
      }),
    });
    expect(r.inseridas).toBe(1);
    expect(r.contactosNovos).toBe(1);
    expect(gravadas).toHaveLength(1);
    expect(criados).toHaveLength(1);
    expect(r.completo).toBe(true);
  });

  it("atualiza em vez de duplicar quando a marcação já existe", async () => {
    const { loja, gravadas, atualizadas } = lojaFalsa({
      contactos: { c1: "local-1" },
      marcacoes: { evt1: "marc-1" },
    });
    const r = await sincronizarAgenda({
      ...base,
      eventos: [{ id: "evt1", contactId: "c1", startTime: "2026-03-10T10:00:00.000Z" }],
      loja,
      buscarContacto: async () => ({ ok: false, message: "não devia ser chamado" }),
    });
    expect(r.atualizadas).toBe(1);
    expect(gravadas).toHaveLength(0);
    expect(atualizadas[0]!.id).toBe("marc-1");
  });

  it("não grava marcação sem cliente e reporta a ocorrência", async () => {
    const { loja, gravadas } = lojaFalsa();
    const r = await sincronizarAgenda({
      ...base,
      eventos: [{ id: "evt1", startTime: "2026-03-10T10:00:00.000Z" }],
      loja,
      buscarContacto: async () => ({ ok: false, message: "sem contacto" }),
    });
    expect(gravadas).toHaveLength(0);
    expect(r.adiadas).toBe(1);
    expect(r.completo).toBe(false);
    expect(r.conflitos[0]).toMatch(/por associar/i);
  });

  it("preserva o registo anterior quando o cliente não pode ser validado", async () => {
    const { loja, gravadas, atualizadas } = lojaFalsa({ marcacoes: { evt1: "marc-1" } });
    const r = await sincronizarAgenda({
      ...base,
      eventos: [{ id: "evt1", contactId: "c9", startTime: "2026-03-10T10:00:00.000Z" }],
      loja,
      buscarContacto: async () => ({ ok: false, message: "contacto de outra localização" }),
    });
    expect(gravadas).toHaveLength(0);
    expect(atualizadas).toHaveLength(0);
    expect(r.adiadas).toBe(1);
    expect(r.conflitos[0]).toMatch(/preservado/i);
  });

  it("trata evento de outra agenda como ocorrência, não como sucesso", async () => {
    const { loja } = lojaFalsa({ contactos: { c1: "local-1" } });
    const r = await sincronizarAgenda({
      ...base,
      eventos: [{ id: "evt1", calendarId: "outra", contactId: "c1", startTime: "2026-03-10T10:00:00.000Z" }],
      loja,
      buscarContacto: async () => ({ ok: false, message: "n/a" }),
    });
    expect(r.ignoradas).toBe(1);
    expect(r.completo).toBe(false);
  });
});
