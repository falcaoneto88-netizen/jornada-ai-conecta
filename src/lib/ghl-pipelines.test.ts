import { describe, expect, it } from "vitest";

import {
  chaveDeEtapa,
  cursorSeguinte,
  linhaOportunidade,
  planearEtapas,
  sincronizarOportunidades,
  validarOportunidade,
  type ContactoNovo,
  type LinhaOportunidade,
  type LojaSincronizacao,
  type OportunidadeGhl,
} from "./ghl-pipelines.core";

const ORG = "f07ab3be-7419-4779-a901-ef71c5fc27f0";
const LOCATION = "ok2UHC2QMZsd8UHsAgEa";
const PIPELINE = "2QGyurvcmwhNhRgq0jCq";

/** Loja em memória com os mesmos invariantes dos índices únicos parciais. */
function lojaMemoria() {
  const contactos = new Map<string, string>(); // ghl_contact_id -> id local
  const oportunidades = new Map<string, LinhaOportunidade>(); // ghl_opportunity_id -> linha
  const telefones = new Set<string>();
  let seq = 0;

  const loja: LojaSincronizacao = {
    async contactosPorGhlId(ids) {
      const m = new Map<string, string>();
      for (const id of ids) if (contactos.has(id)) m.set(id, contactos.get(id)!);
      return m;
    },
    async inserirContacto(linha: ContactoNovo) {
      if (contactos.has(linha.ghl_contact_id)) return contactos.get(linha.ghl_contact_id)!;
      if (linha.phone_normalized) {
        if (telefones.has(linha.phone_normalized)) throw new Error("telefone duplicado");
        telefones.add(linha.phone_normalized);
      }
      const id = `local-${++seq}`;
      contactos.set(linha.ghl_contact_id, id);
      return id;
    },
    async oportunidadesPorGhlId(ids) {
      const m = new Map<string, string>();
      for (const id of ids) if (oportunidades.has(id)) m.set(id, `op-${id}`);
      return m;
    },
    async inserirOportunidade(linha) {
      if (oportunidades.has(linha.ghl_opportunity_id)) {
        oportunidades.set(linha.ghl_opportunity_id, linha);
        return "atualizada";
      }
      oportunidades.set(linha.ghl_opportunity_id, linha);
      return "inserida";
    },
    async atualizarOportunidade(id, linha) {
      oportunidades.set(linha.ghl_opportunity_id, linha);
      expect(id).toBe(`op-${linha.ghl_opportunity_id}`);
    },
  };
  return { loja, contactos, oportunidades };
}

function op(i: number, extra: Partial<OportunidadeGhl> = {}): OportunidadeGhl {
  return {
    id: `opp-${i}`,
    name: `Oportunidade ${i}`,
    monetaryValue: 100 * i,
    pipelineId: PIPELINE,
    pipelineStageId: "stage-1",
    status: "open",
    contactId: `ghl-c-${i}`,
    locationId: LOCATION,
    ...extra,
  };
}

function deps(paginas: OportunidadeGhl[][], loja: LojaSincronizacao, contactosFalha = new Set<string>()) {
  return {
    orgId: ORG,
    locationId: LOCATION,
    pipelineId: PIPELINE,
    mapaEtapas: { "stage-1": "novo_lead", "stage-2": "consulta_paga" },
    etapaInicialContacto: "novo_lead",
    loja,
    buscarPagina: async (cursor: { startAfterId?: string }) => {
      const idx = cursor.startAfterId ? Number(cursor.startAfterId) : 0;
      const pagina = paginas[idx] ?? [];
      const ultima = idx >= paginas.length - 1;
      return {
        ok: true as const,
        oportunidades: pagina,
        meta: ultima ? {} : { startAfter: String(idx + 1), startAfterId: String(idx + 1) },
      };
    },
    buscarContacto: async (ghlContactId: string) => {
      if (contactosFalha.has(ghlContactId)) return { ok: false as const, message: "contacto de outra localização" };
      return {
        ok: true as const,
        contacto: {
          organization_id: ORG,
          ghl_contact_id: ghlContactId,
          full_name: `Cliente ${ghlContactId}`,
          phone: null,
          phone_normalized: null,
          email: null,
          tags: [],
          source: "GoHighLevel",
          stage_key: "novo_lead",
          is_demo: false as const,
        },
      };
    },
  };
}

describe("planearEtapas", () => {
  const stages = [
    { id: "s1", name: "Novo Lead", position: 0 },
    { id: "s2", name: "Consulta Paga", position: 1 },
    { id: "s3", name: "Procedimento Realizado", position: 2 },
  ];

  it("associa só nomes exatamente equivalentes e cria as restantes", () => {
    const plano = planearEtapas({
      pipelineId: PIPELINE,
      stages,
      locais: [
        { key: "novo_lead", name: "novo lead", position: 1, ghl_pipeline_id: null, ghl_stage_id: null },
        { key: "pos_procedimento", name: "Pós-procedimento", position: 2, ghl_pipeline_id: null, ghl_stage_id: null },
      ],
    });
    expect(plano.atualizar.map((a) => a.key)).toEqual(["novo_lead"]);
    expect(plano.criar.map((c) => c.name)).toEqual(["Consulta Paga", "Procedimento Realizado"]);
    // Nunca equipara "Procedimento Realizado" a "Pós-procedimento".
    expect(plano.mapa["s3"]).not.toBe("pos_procedimento");
    expect(plano.criar.every((c) => c.ghl_pipeline_id === PIPELINE)).toBe(true);
    expect(plano.criar.map((c) => c.ghl_stage_position)).toEqual([1, 2]);
  });

  it("gera chaves distintas quando a chave derivada já existe", () => {
    const plano = planearEtapas({
      pipelineId: PIPELINE,
      stages: [{ id: "s9", name: "Follow UP", position: 0 }],
      locais: [{ key: "follow_up", name: "Reativação", position: 1, ghl_pipeline_id: null, ghl_stage_id: null }],
    });
    expect(plano.criar[0]!.key).toBe("follow_up_2");
    expect(chaveDeEtapa("Não compareceu")).toBe("nao_compareceu");
  });
});

describe("validação e cursores", () => {
  it("recusa oportunidades de outra location ou pipeline", () => {
    expect(validarOportunidade(op(1, { locationId: "outra" }), { locationId: LOCATION, pipelineId: PIPELINE }).ok).toBe(
      false,
    );
    expect(validarOportunidade(op(1, { pipelineId: "outro" }), { locationId: LOCATION, pipelineId: PIPELINE }).ok).toBe(
      false,
    );
    expect(validarOportunidade(op(1), { locationId: LOCATION, pipelineId: PIPELINE }).ok).toBe(true);
  });

  it("extrai apenas cursores validados e ignora nextPageUrl", () => {
    expect(cursorSeguinte({ nextPageUrl: "https://evil.example/x" })).toBeNull();
    expect(cursorSeguinte({ startAfter: 1735000000000, startAfterId: "abc" })).toEqual({
      startAfter: "1735000000000",
      startAfterId: "abc",
    });
  });

  it("mantém estado, valor e etapa reais na linha gravada", () => {
    const linha = linhaOportunidade(op(2, { status: "won", pipelineStageId: "stage-2" }), {
      orgId: ORG,
      pipelineId: PIPELINE,
      mapaEtapas: { "stage-2": "consulta_paga" },
      contactoLocal: "local-1",
    });
    expect(linha).toMatchObject({
      status: "won",
      monetary_value: 200,
      stage_key: "consulta_paga",
      stage_id: "stage-2",
      contact_id: "local-1",
      is_demo: false,
    });
  });
});

describe("sincronizarOportunidades", () => {
  it("pagina acima de 100 oportunidades sem duplicar", async () => {
    const p1 = Array.from({ length: 100 }, (_, i) => op(i + 1));
    const p2 = Array.from({ length: 40 }, (_, i) => op(i + 101));
    const { loja, oportunidades } = lojaMemoria();
    const r = await sincronizarOportunidades(deps([p1, p2], loja));
    expect(r.paginas).toBe(2);
    expect(r.lidas).toBe(140);
    expect(r.inseridas).toBe(140);
    expect(oportunidades.size).toBe(140);
    expect(r.completo).toBe(true);
  });

  it("repetir a importação atualiza sem duplicar", async () => {
    const paginas = [[op(1), op(2)]];
    const { loja, oportunidades } = lojaMemoria();
    await sincronizarOportunidades(deps(paginas, loja));
    const r2 = await sincronizarOportunidades(deps(paginas, loja));
    expect(r2.inseridas).toBe(0);
    expect(r2.atualizadas).toBe(2);
    expect(oportunidades.size).toBe(2);
  });

  it("mantém distintas duas oportunidades do mesmo contacto", async () => {
    const paginas = [[op(1), op(2, { contactId: "ghl-c-1" })]];
    const { loja, oportunidades, contactos } = lojaMemoria();
    const r = await sincronizarOportunidades(deps(paginas, loja));
    expect(oportunidades.size).toBe(2);
    expect(contactos.size).toBe(1);
    expect(r.contactosNovos).toBe(1);
    expect(r.contactosLigados).toBe(1);
    const ids = [...oportunidades.values()].map((l) => l.contact_id);
    expect(new Set(ids).size).toBe(1);
  });

  it("ignora registos de outra location ou pipeline", async () => {
    const paginas = [[op(1), op(2, { locationId: "outra" }), op(3, { pipelineId: "outro" })]];
    const { loja, oportunidades } = lojaMemoria();
    const r = await sincronizarOportunidades(deps(paginas, loja));
    expect(r.ignoradas).toBe(2);
    expect(oportunidades.size).toBe(1);
  });

  it("não reporta sucesso completo quando um contacto falha", async () => {
    const { loja } = lojaMemoria();
    const r = await sincronizarOportunidades(deps([[op(1)]], loja, new Set(["ghl-c-1"])));
    expect(r.completo).toBe(false);
    expect(r.conflitos).toHaveLength(1);
    expect([...r.conflitos][0]).toContain("Contacto não sincronizado");
  });

  it("não reporta sucesso completo quando uma página falha", async () => {
    const { loja } = lojaMemoria();
    const base = deps([[op(1)]], loja);
    const r = await sincronizarOportunidades({
      ...base,
      buscarPagina: async () => ({ ok: false as const, message: "rate limit" }),
    });
    expect(r.completo).toBe(false);
    expect(r.lidas).toBe(0);
  });
});
