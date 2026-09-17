/**
 * Testes do processamento remoto com duplos: nenhum contacto real é usado e
 * nenhuma chamada verdadeira ao GoHighLevel é feita.
 */
import { describe, expect, it, vi } from "vitest";

import {
  processarSubmissaoRemota,
  validarContacto,
  type ContactoRemoto,
  type DepsRemoto,
  type OportunidadeRemota,
  type PedidoRemoto,
} from "./falcao-remote.core";
import { contactoDaApi, reciboRemotoValido } from "./falcao-remote.server";

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

const contacto = (p: Partial<ContactoRemoto> & { id: string }): ContactoRemoto => ({
  locationId: "loc",
  phone: "+351900000000",
  email: null,
  dnd: false,
  canaisBloqueados: [],
  ...p,
});

const oportunidade = (p: Partial<OportunidadeRemota> & { id: string }): OportunidadeRemota => ({
  name: "Lead",
  pipelineId: "pipe",
  stageId: "stage",
  status: "open",
  contactId: "c-novo",
  ...p,
});

function deps(over: Partial<DepsRemoto> = {}) {
  const concluir = vi.fn(async () => ({ ok: true }));
  const base: DepsRemoto = {
    procurarExato: async () => ({ ok: true, data: null }),
    lerContacto: async ({ ghlContactId }) => ({ ok: true, data: contacto({ id: ghlContactId }) }),
    criarContacto: async () => ({ ok: true, data: { id: "c-novo" } }),
    oportunidades: async () => ({ ok: true, data: [] }),
    criarOportunidade: async () => ({ ok: true, data: oportunidade({ id: "o-nova" }) }),
    concluir,
    ...over,
  };
  return { deps: base, concluir: (over.concluir ?? concluir) as ReturnType<typeof vi.fn> };
}

describe("validação exata do contacto remoto", () => {
  it("recusa contacto de outra location", () => {
    expect(validarContacto(contacto({ id: "a", locationId: "outra" }), pedido)).toMatchObject({
      motivo: "contacto_de_outra_location",
    });
  });

  it("recusa telefone divergente", () => {
    expect(validarContacto(contacto({ id: "a", phone: "+351999999999" }), pedido)).toMatchObject({
      motivo: "identidade_nao_exata",
    });
  });

  it("recusa e-mail divergente quando ambos existem", () => {
    const alvo = { ...pedido, email: "a@exemplo.test" };
    const remoto = contacto({ id: "a", email: "b@exemplo.test" });
    expect(validarContacto(remoto, alvo)).toMatchObject({ motivo: "email_divergente" });
  });

  it("recusa DND e canais bloqueados", () => {
    expect(validarContacto(contacto({ id: "a", dnd: true }), pedido)).toMatchObject({
      motivo: "contacto_com_dnd",
    });
    expect(validarContacto(contacto({ id: "a", canaisBloqueados: ["SMS"] }), pedido)).toMatchObject({
      motivo: "canal_bloqueado",
    });
  });
});

describe("leitura estrita da API", () => {
  it("recusa contacto sem location ou sem DND explícito", () => {
    expect(contactoDaApi({ id: "a", dnd: false })).toBeNull();
    expect(contactoDaApi({ id: "a", locationId: "loc" })).toBeNull();
    expect(contactoDaApi({ id: "a", locationId: "loc", dnd: false })).not.toBeNull();
  });
});

describe("processamento remoto de um recibo", () => {
  it("cria contacto e oportunidade no funil fixo", async () => {
    const { deps: d, concluir } = deps();
    const r = await processarSubmissaoRemota(pedido, d);
    expect(r).toMatchObject({
      estado: "confirmado",
      ghlContactId: "c-novo",
      ghlOpportunityId: "o-nova",
    });
    expect(concluir).toHaveBeenCalledWith(
      expect.objectContaining({ estado: "confirmado", oportunidade: expect.anything() }),
    );
  });

  it("relê e valida o identificador remoto já guardado antes de escrever", async () => {
    const lerContacto = vi.fn(async () => ({
      ok: true as const,
      data: contacto({ id: "ghl-antigo", phone: "+351911111111" }),
    }));
    const criarOportunidade = vi.fn();
    const { deps: d } = deps({ lerContacto, criarOportunidade: criarOportunidade as never });
    const r = await processarSubmissaoRemota({ ...pedido, ghl_contact_id: "ghl-antigo" }, d);
    expect(lerContacto).toHaveBeenCalledTimes(1);
    expect(criarOportunidade).not.toHaveBeenCalled();
    expect(r).toMatchObject({ estado: "bloqueado", motivo: "identidade_nao_exata" });
  });

  it("bloqueia DND mesmo quando o identificador remoto já estava guardado", async () => {
    const { deps: d } = deps({
      lerContacto: async () => ({ ok: true, data: contacto({ id: "ghl-antigo", dnd: true }) }),
    });
    const r = await processarSubmissaoRemota({ ...pedido, ghl_contact_id: "ghl-antigo" }, d);
    expect(r).toMatchObject({ estado: "bloqueado", motivo: "contacto_com_dnd" });
  });

  it("não duplica nem move a oportunidade que já existe no funil", async () => {
    const criarOportunidade = vi.fn();
    const { deps: d, concluir } = deps({
      oportunidades: async () => ({
        ok: true,
        data: [oportunidade({ id: "o-antiga", status: "won", stageId: "outro" })],
      }),
      criarOportunidade: criarOportunidade as never,
    });
    const r = await processarSubmissaoRemota(pedido, d);
    expect(criarOportunidade).not.toHaveBeenCalled();
    expect(r).toMatchObject({ estado: "confirmado", ghlOpportunityId: "o-antiga" });
    // Espelha o estado real, sem inventar "open" nem a etapa Novo Lead.
    expect(concluir).toHaveBeenCalledWith(
      expect.objectContaining({
        oportunidade: expect.objectContaining({ status: "won", stageId: "outro" }),
      }),
    );
  });

  it("bloqueia ambiguidade entre telefone e e-mail sem escrever nada", async () => {
    const criarContacto = vi.fn();
    const { deps: d } = deps({
      procurarExato: async ({ campo }) => ({
        ok: true,
        data: contacto({ id: campo === "telefone" ? "a" : "b" }),
      }),
      criarContacto: criarContacto as never,
    });
    const r = await processarSubmissaoRemota({ ...pedido, email: "a@exemplo.test" }, d);
    expect(criarContacto).not.toHaveBeenCalled();
    expect(r).toMatchObject({ estado: "bloqueado", motivo: "identidade_ambigua" });
  });

  it("resposta malformada da procura bloqueia em vez de criar duplicado", async () => {
    const criarContacto = vi.fn();
    const { deps: d } = deps({
      procurarExato: async () => ({
        ok: false,
        code: "malformed_response",
        message: "sem campos",
      }),
      criarContacto: criarContacto as never,
    });
    const r = await processarSubmissaoRemota(pedido, d);
    expect(criarContacto).not.toHaveBeenCalled();
    expect(r.motivo).toContain("procura_falhou");
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

  it("oportunidade criada com identificadores incoerentes não é sucesso", async () => {
    const { deps: d } = deps({
      criarOportunidade: async () => ({
        ok: true,
        data: oportunidade({ id: "o-x", pipelineId: "outro-funil" }),
      }),
    });
    const r = await processarSubmissaoRemota(pedido, d);
    expect(r).toMatchObject({ estado: "bloqueado", motivo: "oportunidade_criada_incoerente" });
  });

  it("falha de gravação depois do sucesso na API fica por reconciliar", async () => {
    const { deps: d } = deps({ concluir: async () => ({ ok: false }) });
    const r = await processarSubmissaoRemota(pedido, d);
    expect(r.estado).toBe("pendente_reconciliacao");
    expect(r.motivo).toContain("persistencia_falhou");
  });

  it("permissão em falta bloqueia sem criar oportunidade", async () => {
    const criarOportunidade = vi.fn();
    const { deps: d } = deps({
      procurarExato: async () => ({ ok: false, code: "forbidden", message: "sem escopo" }),
      criarOportunidade: criarOportunidade as never,
    });
    const r = await processarSubmissaoRemota(pedido, d);
    expect(criarOportunidade).not.toHaveBeenCalled();
    expect(r.estado).toBe("bloqueado");
    expect(r.motivo).toContain("forbidden");
  });
});

describe("validação do recibo da base de dados", () => {
  const base = {
    submissionId: pedido.submission_id,
    estado: "confirmado" as const,
    ghlContactId: "c-novo",
    ghlOpportunityId: "o-nova",
  };

  it("recusa recibo vazio, incompleto ou de outro recibo", () => {
    expect(reciboRemotoValido({}, base)).toBe(false);
    expect(
      reciboRemotoValido(
        { submission_id: pedido.submission_id, remote_state: "confirmado", persisted: true },
        base,
      ),
    ).toBe(false);
    expect(
      reciboRemotoValido(
        {
          submission_id: "outro",
          remote_state: "confirmado",
          persisted: true,
          ghl_contact_id: "c-novo",
          ghl_opportunity_id: "o-nova",
        },
        base,
      ),
    ).toBe(false);
  });

  it("aceita recibo completo e consistente", () => {
    expect(
      reciboRemotoValido(
        {
          submission_id: pedido.submission_id,
          remote_state: "confirmado",
          persisted: true,
          ghl_contact_id: "c-novo",
          ghl_opportunity_id: "o-nova",
        },
        base,
      ),
    ).toBe(true);
  });
});
