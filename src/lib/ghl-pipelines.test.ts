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
      const m = new Map<string, { id: string; contactId: string | null }>();
      for (const id of ids)
        if (oportunidades.has(id)) m.set(id, { id: `op-${id}`, contactId: oportunidades.get(id)!.contact_id });
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

describe("regressões de paginação e vínculos", () => {
  it("não declara completo quando o total anunciado não é alcançado", async () => {
    const { loja } = lojaMemoria();
    const base = deps([[op(1), op(2)]], loja);
    const r = await sincronizarOportunidades({
      ...base,
      limitePagina: 100,
      buscarPagina: async () => ({ ok: true as const, oportunidades: [op(1), op(2)], meta: { total: 39 } }),
    });
    expect(r.total).toBe(39);
    expect(r.completo).toBe(false);
    expect(r.conflitos.join(" ")).toContain("39");
  });

  it("interrompe e sinaliza cursor repetido", async () => {
    const { loja } = lojaMemoria();
    const base = deps([[op(1)]], loja);
    const r = await sincronizarOportunidades({
      ...base,
      buscarPagina: async () => ({
        ok: true as const,
        oportunidades: [op(1)],
        meta: { startAfter: 10, startAfterId: "sempre-o-mesmo" },
      }),
    });
    expect(r.paginas).toBe(2);
    expect(r.completo).toBe(false);
    expect(r.conflitos.join(" ")).toContain("cursor");
  });

  it("sinaliza página cheia sem cursor seguinte", async () => {
    const cheia = Array.from({ length: 5 }, (_, i) => op(i + 1));
    const { loja } = lojaMemoria();
    const base = deps([cheia], loja);
    const r = await sincronizarOportunidades({
      ...base,
      limitePagina: 5,
      buscarPagina: async () => ({ ok: true as const, oportunidades: cheia, meta: {} }),
    });
    expect(r.completo).toBe(false);
    expect(r.conflitos.join(" ")).toContain("sem cursor");
  });

  it("recusa cursores mal formados e nunca segue URLs", () => {
    expect(cursorSeguinte({ startAfterId: "a".repeat(200) })).toBeNull();
    expect(cursorSeguinte({ startAfterId: "https://evil.example/x?a=1" })).toBeNull();
    expect(cursorSeguinte({ startAfter: "não-numérico" })).toBeNull();
    expect(cursorSeguinte({ nextPageUrl: "https://evil.example" })).toBeNull();
  });

  it("recusa oportunidade sem location declarada", () => {
    const semLocation = { ...op(1) };
    delete (semLocation as { locationId?: string }).locationId;
    expect(validarOportunidade(semLocation, { locationId: LOCATION, pipelineId: PIPELINE }).ok).toBe(false);
  });

  it("registos ignorados contam como inconsistência", async () => {
    const { loja } = lojaMemoria();
    const r = await sincronizarOportunidades(deps([[op(1), op(2, { pipelineId: "outro" })]], loja));
    expect(r.ignoradas).toBe(1);
    expect(r.completo).toBe(false);
  });

  it("não apaga o vínculo anterior quando o contacto falha numa atualização", async () => {
    const { loja, oportunidades } = lojaMemoria();
    await sincronizarOportunidades(deps([[op(1)]], loja));
    const antes = oportunidades.get("opp-1")!.contact_id;
    expect(antes).not.toBeNull();
    const r = await sincronizarOportunidades(deps([[op(1)]], loja, new Set(["ghl-c-1"])));
    expect(oportunidades.get("opp-1")!.contact_id).toBe(antes);
    expect(r.adiadas).toBe(1);
    expect(r.atualizadas).toBe(0);
  });

  it("assinala etapa fora do funil real", async () => {
    const { loja } = lojaMemoria();
    const base = deps([[op(1, { pipelineStageId: "stage-fantasma" })]], loja);
    const r = await sincronizarOportunidades({ ...base, etapasValidas: ["stage-1", "stage-2"] });
    expect(r.completo).toBe(false);
    expect(r.conflitos.join(" ")).toContain("não existe no funil");
  });
});

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

  it("mantém o vínculo por stageId mesmo que o GHL renomeie a etapa", () => {
    const plano = planearEtapas({
      pipelineId: PIPELINE,
      stages: [{ id: "s1", name: "Novo Lead (2026)", position: 0 }],
      locais: [{ key: "novo_lead", name: "Novo Lead", position: 1, ghl_pipeline_id: PIPELINE, ghl_stage_id: "s1" }],
    });
    expect(plano.criar).toHaveLength(0);
    expect(plano.atualizar[0]!.key).toBe("novo_lead");
  });

  it("repetir a configuração mantém as mesmas chaves", () => {
    const stagesReais = [
      { id: "s1", name: "Novo Lead", position: 0 },
      { id: "s2", name: "Consulta Paga", position: 1 },
    ];
    const primeiro = planearEtapas({ pipelineId: PIPELINE, stages: stagesReais, locais: [] });
    const locais = primeiro.criar.map((c) => ({
      key: c.key,
      name: c.name,
      position: c.position,
      ghl_pipeline_id: c.ghl_pipeline_id,
      ghl_stage_id: c.ghl_stage_id,
    }));
    const segundo = planearEtapas({ pipelineId: PIPELINE, stages: stagesReais, locais });
    expect(segundo.criar).toHaveLength(0);
    expect(segundo.atualizar.map((a) => a.key)).toEqual(locais.map((l) => l.key));
  });

  it("não rouba etapa ligada a outro funil nem resolve nomes ambíguos", () => {
    const plano = planearEtapas({
      pipelineId: PIPELINE,
      stages: [
        { id: "s1", name: "Consulta", position: 0 },
        { id: "s2", name: "Follow up", position: 1 },
      ],
      locais: [
        { key: "consulta_outra", name: "Consulta", position: 1, ghl_pipeline_id: "outro-funil", ghl_stage_id: "x1" },
        { key: "follow_a", name: "Follow up", position: 2, ghl_pipeline_id: null, ghl_stage_id: null },
        { key: "follow_b", name: "follow up", position: 3, ghl_pipeline_id: null, ghl_stage_id: null },
        { key: "follow_c", name: "Follow  Up", position: 4, ghl_pipeline_id: null, ghl_stage_id: null },
      ],
    });
    expect(plano.atualizar).toHaveLength(0);
    expect(plano.criar).toHaveLength(2);
    expect(plano.mapa["s1"]).not.toBe("consulta_outra");
  });

  it("reserva cada etapa local só uma vez", () => {
    const plano = planearEtapas({
      pipelineId: PIPELINE,
      stages: [
        { id: "s1", name: "Consulta", position: 0 },
        { id: "s2", name: "Consulta", position: 1 },
      ],
      locais: [{ key: "consulta", name: "Consulta", position: 1, ghl_pipeline_id: null, ghl_stage_id: null }],
    });
    expect(plano.atualizar).toHaveLength(1);
    expect(plano.criar).toHaveLength(1);
    expect(new Set(Object.values(plano.mapa)).size).toBe(2);
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
    expect(r.contactosLigados).toBe(0);
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
    expect(r.conflitos.some((c) => c.includes("Contacto não sincronizado"))).toBe(true);
    expect(r.adiadas).toBe(1);
    expect(r.inseridas).toBe(0);
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
