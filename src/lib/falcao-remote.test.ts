/**
 * Testes do processamento remoto com duplos: nenhum contacto real é usado e
 * nenhuma chamada verdadeira ao GoHighLevel é feita.
 */
import { describe, expect, it, vi } from "vitest";

import {
  corresponderExato,
  processarSubmissaoRemota,
  type ContactoRemoto,
  type DepsRemoto,
  type PedidoRemoto,
} from "./falcao-remote.core";

const pedido: PedidoRemoto = {
  submission_id: "11111111-1111-4111-8111-111111111111",
  organization_id: "22222222-2222-4222-8222-222222222222",
  location_id: "loc",
  pipeline_id: "pipe",
  stage_id: "stage",
  contact_id: "33333333-3333-4333-8333-333333333333",
  full_name: "Pessoa Fictícia",
  phone: "+351900000000",
  phone_normalized: "351900000000",
  email: null,
  ghl_contact_id: null,
};

function deps(over: Partial<DepsRemoto> = {}) {
  const concluir = vi.fn(async () => undefined);
  const base: DepsRemoto = {
    procurar: async () => ({ ok: true, data: [] }),
    criarContacto: async () => ({
      ok: true,
      data: { id: "c-novo", phoneNormalized: "351900000000", email: null, dnd: false },
    }),
    oportunidades: async () => ({ ok: true, data: [] }),
    criarOportunidade: async () => ({ ok: true, data: { id: "o-nova" } }),
    concluir,
    ...over,
  };
  return { deps: base, concluir: (over.concluir ?? concluir) as ReturnType<typeof vi.fn> };
}

const contacto = (p: Partial<ContactoRemoto> & { id: string }): ContactoRemoto => ({
  phoneNormalized: null,
  email: null,
  dnd: false,
  ...p,
});

describe("correspondência exata de identidade", () => {
  it("ignora aproximações devolvidas pela procura", () => {
    const r = corresponderExato(
      [contacto({ id: "a", phoneNormalized: "351999999999" })],
      { telefone: "351900000000", email: null },
    );
    expect(r.tipo).toBe("nenhum");
  });

  it("marca ambiguidade quando duas pessoas correspondem", () => {
    const r = corresponderExato(
      [
        contacto({ id: "a", phoneNormalized: "+351 900 000 000" }),
        contacto({ id: "b", email: "x@exemplo.test" }),
      ],
      { telefone: "351900000000", email: "X@Exemplo.test" },
    );
    expect(r.tipo).toBe("ambiguo");
  });
});

describe("processamento remoto de um recibo", () => {
  it("cria contacto e oportunidade no funil fixo", async () => {
    const { deps: d, concluir } = deps();
    const r = await processarSubmissaoRemota(pedido, d);
    expect(r).toMatchObject({ estado: "confirmado", ghlContactId: "c-novo", ghlOpportunityId: "o-nova" });
    expect(concluir).toHaveBeenCalledWith(
      expect.objectContaining({ estado: "confirmado", ghlOpportunityId: "o-nova" }),
    );
  });

  it("não duplica nem move a oportunidade que já existe no funil", async () => {
    const criarOportunidade = vi.fn();
    const { deps: d } = deps({
      oportunidades: async () => ({
        ok: true,
        data: [{ id: "o-antiga", pipelineId: "pipe", status: "won" }],
      }),
      criarOportunidade: criarOportunidade as never,
    });
    const r = await processarSubmissaoRemota(pedido, d);
    expect(criarOportunidade).not.toHaveBeenCalled();
    expect(r).toMatchObject({ estado: "confirmado", ghlOpportunityId: "o-antiga" });
  });

  it("bloqueia identidade ambígua sem escrever nada", async () => {
    const criarContacto = vi.fn();
    const { deps: d } = deps({
      procurar: async () => ({
        ok: true,
        data: [
          contacto({ id: "a", phoneNormalized: "351900000000" }),
          contacto({ id: "b", phoneNormalized: "351900000000" }),
        ],
      }),
      criarContacto: criarContacto as never,
    });
    const r = await processarSubmissaoRemota(pedido, d);
    expect(criarContacto).not.toHaveBeenCalled();
    expect(r).toMatchObject({ estado: "bloqueado", motivo: "identidade_ambigua" });
  });

  it("bloqueia contactos com DND e não cria oportunidade", async () => {
    const criarOportunidade = vi.fn();
    const { deps: d } = deps({
      procurar: async () => ({
        ok: true,
        data: [contacto({ id: "a", phoneNormalized: "351900000000", dnd: true })],
      }),
      criarOportunidade: criarOportunidade as never,
    });
    const r = await processarSubmissaoRemota(pedido, d);
    expect(criarOportunidade).not.toHaveBeenCalled();
    expect(r).toMatchObject({ estado: "bloqueado", motivo: "contacto_com_dnd" });
  });

  it("resultado incerto bloqueia para reconciliação e nunca repete a escrita", async () => {
    const criarContacto = vi.fn(async () => ({
      ok: false as const,
      code: "outcome_unknown",
      message: "sem confirmação",
    }));
    const { deps: d } = deps({ criarContacto });
    const r = await processarSubmissaoRemota(pedido, d);
    expect(criarContacto).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ estado: "bloqueado", motivo: "criacao_incerta" });
  });

  it("permissão em falta bloqueia sem criar oportunidade", async () => {
    const criarOportunidade = vi.fn();
    const { deps: d } = deps({
      procurar: async () => ({ ok: false, code: "forbidden", message: "sem escopo" }),
      criarOportunidade: criarOportunidade as never,
    });
    const r = await processarSubmissaoRemota(pedido, d);
    expect(criarOportunidade).not.toHaveBeenCalled();
    expect(r.estado).toBe("bloqueado");
    expect(r.motivo).toContain("forbidden");
  });
});
