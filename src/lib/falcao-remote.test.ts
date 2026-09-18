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
import { contactoDaApi, criarDepsGhl, reciboRemotoValido } from "./falcao-remote.server";

const pedido: PedidoRemoto = {
  submission_id: "11111111-1111-4111-8111-111111111111",
  organization_id: "22222222-2222-4222-8222-222222222222",
  integration_id: "44444444-4444-4444-8444-444444444444",
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
      motivo: "telefone_divergente",
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
    expect(validarContacto(contacto({ id: "a", canaisBloqueados: ["SMS"] }), pedido)).toMatchObject(
      {
        motivo: "canal_bloqueado",
      },
    );
  });
});

describe("leitura estrita da API", () => {
  it("exige location e preserva DND omitido como desconhecido", () => {
    expect(contactoDaApi({ id: "a", dnd: false })).toBeNull();
    expect(contactoDaApi({ id: "a", locationId: "loc" })).toMatchObject({ dnd: null, canaisBloqueados: null });
    expect(contactoDaApi({ id: "a", locationId: "loc", dnd: false })).toMatchObject({ dnd: false, canaisBloqueados: null });
    expect(contactoDaApi({ id: "a", locationId: "loc", dnd: false, dndSettings: {} })).not.toBeNull();
  });

  it("recusa DND malformado ou com estado desconhecido", () => {
    expect(contactoDaApi({ id: "a", locationId: "loc", dnd: false, dndSettings: [] })).toBeNull();
    expect(contactoDaApi({ id: "a", locationId: "loc", dnd: false, dndSettings: { SMS: {} } })).toBeNull();
    expect(contactoDaApi({ id: "a", locationId: "loc", dnd: false, dndSettings: { SMS: { status: "misterioso" } } })).toBeNull();
  });
});

describe("adaptador HTTP fail-closed", () => {
  const cfg = { baseUrl: "https://services.leadconnectorhq.com", version: "2021-07-28", token: "teste", locationId: "loc" };
  const resposta = (body: unknown) => vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));

  const procurar = (campo: "telefone" | "email" = "telefone", valor = "+351900000000") =>
    criarDepsGhl(cfg, async () => ({ ok: true })).procurarExato({ locationId: "loc", campo, valor });

  const achado = {
    id: "c1",
    locationId: "loc",
    phone: "+351900000000",
    email: "a@b.pt",
    dnd: false,
    dndSettings: {},
  };

  it("envia o pedido literal documentado (POST contacts/search com filtro eq)", async () => {
    const fetchMock = resposta({ contacts: [achado], total: 1 });
    const r = await procurar();
    expect(r).toMatchObject({ ok: true, data: { id: "c1" } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://services.leadconnectorhq.com/contacts/search");
    expect(init.method).toBe("POST");
    const corpo = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(corpo).toMatchObject({
      locationId: "loc",
      page: 1,
      filters: [{ field: "phone", operator: "eq", value: "+351900000000" }],
    });
    expect(typeof corpo["pageLimit"]).toBe("number");
    expect(corpo["query"]).toBeUndefined();
    fetchMock.mockRestore();
  });

  it.each([{}, [], { contacts: [] }, { total: 0 }, { contacts: {}, total: 0 }, { contacts: [], total: -1 }])(
    "bloqueia resposta malformada: %j",
    async (body) => {
      const fetchMock = resposta(body);
      expect(await procurar()).toMatchObject({ ok: false, code: "malformed_response" });
      fetchMock.mockRestore();
    },
  );

  it("só aceita ausência com total 0 e lista vazia", async () => {
    const fetchMock = resposta({ contacts: [], total: 0 });
    expect(await procurar()).toEqual({ ok: true, data: null });
    fetchMock.mockRestore();
  });

  it("bloqueia total incoerente com a lista devolvida", async () => {
    const fetchMock = resposta({ contacts: [achado], total: 7 });
    expect(await procurar()).toMatchObject({ ok: false, code: "malformed_response" });
    fetchMock.mockRestore();
  });

  it("bloqueia múltiplos resultados para o mesmo pedido exato", async () => {
    const fetchMock = resposta({ contacts: [achado, { ...achado, id: "c2" }], total: 2 });
    expect(await procurar()).toMatchObject({ ok: false, code: "multiplos_resultados" });
    fetchMock.mockRestore();
  });

  it("bloqueia resultado cujo telefone ou location não corresponde", async () => {
    const fetchMock = resposta({ contacts: [{ ...achado, phone: "+351999999999" }], total: 1 });
    expect(await procurar()).toMatchObject({ ok: false, code: "resultado_nao_corresponde" });
    fetchMock.mockRestore();
    const outra = resposta({ contacts: [{ ...achado, locationId: "outra" }], total: 1 });
    expect(await procurar()).toMatchObject({ ok: false, code: "resultado_nao_corresponde" });
    outra.mockRestore();
  });

  it("recusa e-mail acima do limite de 75 caracteres sem truncar nem chamar a API", async () => {
    const fetchMock = resposta({ contacts: [], total: 0 });
    const longo = `${"a".repeat(70)}@exemplo.pt`;
    expect(await procurar("email", longo)).toMatchObject({ ok: false, code: "valor_acima_do_limite_eq" });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });


  it("lê identidade com DND incompleto sem presumir autorização de mensagens", async () => {
    const fetchMock = resposta({ contact: { id: "c1", locationId: "loc", phone: "+351900000000", dnd: false } });
    const depsGhl = criarDepsGhl(cfg, async () => ({ ok: true }));
    const r = await depsGhl.lerContacto({ locationId: "loc", ghlContactId: "c1" });
    expect(r).toMatchObject({ ok: true, data: { id: "c1", dnd: false, canaisBloqueados: null } });
    fetchMock.mockRestore();
  });

  it("recusa oportunidades sem prova completa de paginação", async () => {
    const fetchMock = resposta({ opportunities: [] });
    const depsGhl = criarDepsGhl(cfg, async () => ({ ok: true }));
    const r = await depsGhl.oportunidades({ locationId: "loc", ghlContactId: "c1" });
    expect(r).toMatchObject({ ok: false, code: "malformed_response" });
    fetchMock.mockRestore();
  });

  it("recusa página cheia mesmo quando total declara apenas o limite", async () => {
    const oportunidades = Array.from({ length: 100 }, (_, i) => ({
      id: `o${String(i)}`,
      name: "Lead",
      pipelineId: "pipe",
      pipelineStageId: "stage",
      status: "open",
      contactId: "c1",
    }));
    const fetchMock = resposta({ opportunities: oportunidades, meta: { total: 100 } });
    const depsGhl = criarDepsGhl(cfg, async () => ({ ok: true }));
    const r = await depsGhl.oportunidades({ locationId: "loc", ghlContactId: "c1" });
    expect(r).toMatchObject({ ok: false, code: "malformed_response" });
    fetchMock.mockRestore();
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
    expect(r).toMatchObject({ estado: "bloqueado", motivo: "telefone_divergente" });
  });

  it("recusa quando a releitura devolve outro ID", async () => {
    const criarOportunidade = vi.fn();
    const { deps: d } = deps({
      lerContacto: async () => ({ ok: true, data: contacto({ id: "outro" }) }),
      criarOportunidade: criarOportunidade as never,
    });
    const r = await processarSubmissaoRemota({ ...pedido, ghl_contact_id: "esperado" }, d);
    expect(criarOportunidade).not.toHaveBeenCalled();
    expect(r.motivo).toBe("contacto_nao_corresponde");
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

  it("recusa oportunidade existente de outro contacto ou resposta ambígua", async () => {
    const criarOportunidade = vi.fn();
    const { deps: d } = deps({
      oportunidades: async () => ({ ok: true, data: [oportunidade({ id: "o-x", contactId: "outro" })] }),
      criarOportunidade: criarOportunidade as never,
    });
    const diferente = await processarSubmissaoRemota(pedido, d);
    expect(diferente.motivo).toBe("oportunidade_existente_sem_dados_reais");
    const { deps: ambiguas } = deps({
      oportunidades: async () => ({ ok: true, data: [oportunidade({ id: "o-1" }), oportunidade({ id: "o-2" })] }),
      criarOportunidade: criarOportunidade as never,
    });
    expect((await processarSubmissaoRemota(pedido, ambiguas)).motivo).toBe("oportunidades_ambiguas");
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
