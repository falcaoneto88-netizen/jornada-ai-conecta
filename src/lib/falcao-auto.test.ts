import { describe, expect, it, vi } from "vitest";

import { executarReciboFalcao } from "./falcao-auto.server";
import type { AdminAuto } from "./falcao-auto.server";

const ORG = "11111111-1111-4111-8111-111111111111";
const INTEG = "22222222-2222-4222-8222-222222222222";
const SUB = "33333333-3333-4333-8333-333333333333";
const LOC = "ok2UHC2QMZsd8UHsAgEa";

type Tabelas = Record<string, { data: unknown; error: unknown }>;

function criarAdmin(
  tabelas: Tabelas,
  rpc: (fn: string, args: Record<string, unknown>) => { data: unknown; error: unknown },
): { admin: AdminAuto; chamadas: string[] } {
  const chamadas: string[] = [];
  const consulta = (tabela: string) => {
    const self = {
      eq: () => self,
      limit: () =>
        Promise.resolve(tabelas[tabela] ?? { data: [], error: null }),
    };
    return self;
  };
  const admin = {
    from: (t: string) => ({ select: () => consulta(t) }),
    rpc: (fn: string, args: Record<string, unknown>) => {
      chamadas.push(fn);
      return Promise.resolve(rpc(fn, args) as { data: unknown; error: null });
    },
  } as unknown as AdminAuto;
  return { admin, chamadas };
}

const integracao = (extra: Record<string, unknown> = {}) => ({
  data: [
    {
      id: INTEG,
      organization_id: ORG,
      enabled: true,
      remote_write_state: "habilitado",
      welcome_channel_state: "configurado",
      ghl_location_id: LOC,
      ...extra,
    },
  ],
  error: null,
});

const ligacao = (extra: Record<string, unknown> = {}) => ({
  data: [{ write_enabled: true, status: "conectada", ...extra }],
  error: null,
});

const recibo = { data: [{ id: SUB, organization_id: ORG, integration_id: INTEG }], error: null };

const claimRemoto = {
  submission_id: SUB,
  organization_id: ORG,
  integration_id: INTEG,
  location_id: LOC,
  pipeline_id: "pipe",
  stage_id: "stage",
  contact_id: "local",
  full_name: "Ana",
  phone: "+351900000000",
  phone_normalized: "+351900000000",
  email: null,
  ghl_contact_id: null,
  blocked: false,
};

const claimAcolhimento = {
  submission_id: SUB,
  organization_id: ORG,
  integration_id: INTEG,
  location_id: LOC,
  ghl_contact_id: "c-novo",
  first_name: "Ana",
  phone_normalized: "+351900000000",
  email: null,
  consent_version: "2026-09-17.contact.v1",
  blocked: false,
};

const contactoOk = {
  id: "c-novo",
  locationId: LOC,
  phone: "+351900000000",
  email: null,
  dnd: false,
  canaisBloqueados: [] as string[],
};

const depsRemotoFalsos = () =>
  vi.fn(() => ({
    procurarExato: async () => ({ ok: true as const, data: null }),
    lerContacto: async () => ({ ok: true as const, data: contactoOk }),
    criarContacto: async () => ({ ok: true as const, data: { id: "c-novo" } }),
    oportunidades: async () => ({ ok: true as const, data: [] }),
    criarOportunidade: async () => ({
      ok: true as const,
      data: {
        id: "o-nova",
        name: "Ana",
        pipelineId: "pipe",
        stageId: "stage",
        status: "open",
        contactId: "c-novo",
      },
    }),
    concluir: async () => ({ ok: true }),
  })) as never;

const depsAcolhimentoFalsos = (enviar = vi.fn(async () => ({
  ok: true as const,
  data: { messageId: "m1", status: "queued" },
}))) => ({
  criar: vi.fn(() => ({
    estadoContacto: async () => ({ ok: true as const, data: contactoOk }),
    enviar,
    concluir: async () => ({ ok: true }),
  })) as never,
  enviar,
});

const rpcFeliz = (fn: string) => {
  if (fn === "claim_site_lead_remote_v2") return { data: claimRemoto, error: null };
  if (fn === "claim_site_lead_welcome_v2") return { data: claimAcolhimento, error: null };
  if (fn === "finish_site_lead_remote_v2") {
    return {
      data: {
        submission_id: SUB,
        remote_state: "confirmado",
        persisted: true,
        ghl_contact_id: "c-novo",
        ghl_opportunity_id: "o-nova",
      },
      error: null,
    };
  }
  return {
    data: {
      submission_id: SUB,
      welcome_state: "enviado",
      persisted: true,
      delivered: false,
      welcome_message_id: "m1",
    },
    error: null,
  };
};

describe("execução automática por recibo", () => {
  it("não faz nada sem credenciais", async () => {
    const { admin, chamadas } = criarAdmin({}, rpcFeliz);
    const r = await executarReciboFalcao(SUB, { admin, token: null });
    expect(r).toMatchObject({ executado: false, motivo: "credenciais_indisponiveis" });
    expect(chamadas).toEqual([]);
  });

  it("não executa com a integração desligada", async () => {
    const { admin, chamadas } = criarAdmin(
      { site_integrations: integracao({ enabled: false }) },
      rpcFeliz,
    );
    const r = await executarReciboFalcao(SUB, { admin, token: "t" });
    expect(r).toMatchObject({ executado: false, motivo: "integracao_desligada" });
    expect(chamadas).toEqual([]);
  });

  it("não executa com a escrita remota por habilitar", async () => {
    const { admin } = criarAdmin(
      { site_integrations: integracao({ remote_write_state: "pendente" }) },
      rpcFeliz,
    );
    expect(await executarReciboFalcao(SUB, { admin, token: "t" })).toMatchObject({
      motivo: "integracao_desligada",
    });
  });

  it("não executa sem escrita ativa na ligação", async () => {
    const { admin, chamadas } = criarAdmin(
      {
        site_integrations: integracao(),
        ghl_connections: ligacao({ write_enabled: false }),
      },
      rpcFeliz,
    );
    const r = await executarReciboFalcao(SUB, { admin, token: "t" });
    expect(r).toMatchObject({ executado: false, motivo: "escrita_desativada" });
    expect(chamadas).toEqual([]);
  });

  it("recusa recibo de outra integração", async () => {
    const { admin, chamadas } = criarAdmin(
      {
        site_integrations: integracao(),
        ghl_connections: ligacao(),
        site_lead_submissions: {
          data: [{ id: SUB, organization_id: ORG, integration_id: "outra" }],
          error: null,
        },
      },
      rpcFeliz,
    );
    const r = await executarReciboFalcao(SUB, { admin, token: "t" });
    expect(r).toMatchObject({ executado: false, motivo: "recibo_fora_da_integracao" });
    expect(chamadas).toEqual([]);
  });

  it("com tudo ligado processa apenas este recibo e acolhe uma vez", async () => {
    const { admin, chamadas } = criarAdmin(
      {
        site_integrations: integracao(),
        ghl_connections: ligacao(),
        site_lead_submissions: recibo,
      },
      rpcFeliz,
    );
    const acolher = depsAcolhimentoFalsos();
    const r = await executarReciboFalcao(SUB, {
      admin,
      token: "t",
      criarRemoto: depsRemotoFalsos(),
      criarAcolhimento: acolher.criar,
    });
    expect(r.remoto).toMatchObject({ submissionId: SUB, estado: "confirmado" });
    expect(r.acolhimento).toMatchObject({ estado: "enviado", entregue: false });
    expect(acolher.enviar).toHaveBeenCalledTimes(1);
    expect(chamadas.filter((c) => c === "claim_site_lead_remote_v2")).toHaveLength(1);
    expect(chamadas.filter((c) => c === "claim_site_lead_welcome_v2")).toHaveLength(1);
  });

  it("não acolhe quando o canal ainda não está configurado", async () => {
    const { admin, chamadas } = criarAdmin(
      {
        site_integrations: integracao({ welcome_channel_state: "pendente" }),
        ghl_connections: ligacao(),
        site_lead_submissions: recibo,
      },
      rpcFeliz,
    );
    const acolher = depsAcolhimentoFalsos();
    const r = await executarReciboFalcao(SUB, {
      admin,
      token: "t",
      criarRemoto: depsRemotoFalsos(),
      criarAcolhimento: acolher.criar,
    });
    expect(r.motivo).toBe("canal_de_acolhimento_pendente");
    expect(acolher.enviar).not.toHaveBeenCalled();
    expect(chamadas).not.toContain("claim_site_lead_welcome_v2");
  });

  it("não acolhe nem repete quando o remoto não foi confirmado", async () => {
    const { admin, chamadas } = criarAdmin(
      {
        site_integrations: integracao(),
        ghl_connections: ligacao(),
        site_lead_submissions: recibo,
      },
      (fn) =>
        fn === "claim_site_lead_remote_v2"
          ? { data: { blocked: true, reason: "execucao_remota_ja_registada_para_a_mesma_pessoa" }, error: null }
          : rpcFeliz(fn),
    );
    const acolher = depsAcolhimentoFalsos();
    const r = await executarReciboFalcao(SUB, {
      admin,
      token: "t",
      criarRemoto: depsRemotoFalsos(),
      criarAcolhimento: acolher.criar,
    });
    expect(r).toMatchObject({ motivo: "remoto_nao_confirmado", remoto: null, acolhimento: null });
    expect(acolher.enviar).not.toHaveBeenCalled();
    expect(chamadas).toEqual(["claim_site_lead_remote_v2"]);
  });

  it("falha de infraestrutura não produz sucesso", async () => {
    const { admin } = criarAdmin({ site_integrations: { data: null, error: { message: "x" } } }, rpcFeliz);
    expect(await executarReciboFalcao(SUB, { admin, token: "t" })).toMatchObject({
      executado: false,
      motivo: "integracao_nao_configurada",
    });
  });
});
