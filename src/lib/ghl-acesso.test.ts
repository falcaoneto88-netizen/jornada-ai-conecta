import { describe, expect, it, vi } from "vitest";

import { resolverAcesso, SEM_INTEGRACAO, SEM_PERMISSAO } from "./ghl.functions";
import { contactoPertenceALocation } from "./ghl.server";

const LOCATION_TOKEN = "ok2UHC2QMZsd8UHsAgEa";
const ORG_A = "f07ab3be-7419-4779-a901-ef71c5fc27f0";
const ORG_B = "11111111-2222-3333-4444-555555555555";

type Linha = Record<string, unknown>;

/** Cliente Supabase falso: só devolve as linhas configuradas por tabela. */
function supabaseFalso(dados: { profiles: Linha[]; user_roles: Linha[]; ghl_connections: Linha[] }) {
  return {
    from(tabela: keyof typeof dados) {
      const filtros: Array<[string, unknown]> = [];
      const construtor = {
        select: () => construtor,
        eq: (col: string, val: unknown) => {
          filtros.push([col, val]);
          return construtor;
        },
        maybeSingle: async () => {
          const linha = dados[tabela].find((l) => filtros.every(([c, v]) => l[c] === v));
          return { data: linha ?? null, error: null };
        },
        then: (res: (v: { data: Linha[]; error: null }) => unknown) =>
          res({
            data: dados[tabela].filter((l) => filtros.every(([c, v]) => l[c] === v)),
            error: null,
          }),
      };
      return construtor;
    },
  } as never;
}

const contextoA = {
  supabase: supabaseFalso({
    profiles: [{ id: "user-a", organization_id: ORG_A, full_name: "Admin A" }],
    user_roles: [{ user_id: "user-a", organization_id: ORG_A, role: "administrador" }],
    ghl_connections: [{ organization_id: ORG_A, write_enabled: false }],
  }),
  userId: "user-a",
};

const contextoB = {
  supabase: supabaseFalso({
    profiles: [{ id: "user-b", organization_id: ORG_B, full_name: "Admin B" }],
    user_roles: [{ user_id: "user-b", organization_id: ORG_B, role: "administrador" }],
    ghl_connections: [],
  }),
  userId: "user-b",
};

const contextoAVisualizador = {
  supabase: supabaseFalso({
    profiles: [{ id: "user-v", organization_id: ORG_A, full_name: "Visualizador" }],
    user_roles: [{ user_id: "user-v", organization_id: ORG_A, role: "visualizador" }],
    ghl_connections: [{ organization_id: ORG_A, write_enabled: false }],
  }),
  userId: "user-v",
};

const bindings: Record<string, string> = { [ORG_A]: LOCATION_TOKEN };
const lerBinding = async (org: string) => bindings[org] ?? null;
const locationDoToken = () => LOCATION_TOKEN;

describe("resolverAcesso", () => {
  it("A vinculada e autorizada passa e devolve a location do vínculo", async () => {
    const r = await resolverAcesso(contextoA, ["administrador"], { lerBinding, locationDoToken });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.acesso.orgId).toBe(ORG_A);
      expect(r.acesso.locationId).toBe(LOCATION_TOKEN);
    }
  });

  it("B sem vínculo é recusada antes de qualquer fetch ou uso do token", async () => {
    const fetchEspia = vi.fn();
    vi.stubGlobal("fetch", fetchEspia);
    const tokenLido = vi.fn(() => LOCATION_TOKEN);

    const r = await resolverAcesso(contextoB, ["administrador"], {
      lerBinding,
      locationDoToken: tokenLido,
    });

    expect(r).toMatchObject({ ok: false, code: "not_found", message: SEM_INTEGRACAO });
    expect(fetchEspia).not.toHaveBeenCalled();
    expect(tokenLido).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("recusa quando o vínculo aponta para location diferente do token global", async () => {
    const r = await resolverAcesso(contextoA, ["administrador"], {
      lerBinding,
      locationDoToken: () => "outra-location",
    });
    expect(r).toMatchObject({ ok: false, message: SEM_INTEGRACAO });
  });

  it("recusa quando o token global não está configurado", async () => {
    const r = await resolverAcesso(contextoA, ["administrador"], {
      lerBinding,
      locationDoToken: () => undefined,
    });
    expect(r).toMatchObject({ ok: false, message: SEM_INTEGRACAO });
  });

  it("falta de papel é recusada", async () => {
    const fetchEspia = vi.fn();
    vi.stubGlobal("fetch", fetchEspia);
    const r = await resolverAcesso(contextoAVisualizador, ["administrador"], {
      lerBinding,
      locationDoToken,
    });
    expect(r).toMatchObject({ ok: false, code: "forbidden", message: SEM_PERMISSAO });
    expect(fetchEspia).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("propriedade de recursos", () => {
  it("recusa contacto de outra location", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ contact: { id: "c1", locationId: "outra-location" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const r = await contactoPertenceALocation("token-falso", LOCATION_TOKEN, "c1");
    expect(r.ok).toBe(false);
    vi.unstubAllGlobals();
  });

  it("aceita contacto da location autorizada", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ contact: { id: "c1", locationId: LOCATION_TOKEN } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const r = await contactoPertenceALocation("token-falso", LOCATION_TOKEN, "c1");
    expect(r.ok).toBe(true);
    vi.unstubAllGlobals();
  });
});

describe("parâmetros impostos pelo servidor", () => {
  it("usa location_id em opportunities.search e locationId nas restantes", async () => {
    const { OPERACOES, parametrosDoServidor, ghlFetch, GHL_ORIGIN, GHL_VERSION, filtrarQuery } =
      await import("./ghl.server");

    expect(parametrosDoServidor(OPERACOES["opportunities.search"]!, { locationId: LOCATION_TOKEN, ghlContactId: null }))
      .toEqual({ location_id: LOCATION_TOKEN });
    expect(parametrosDoServidor(OPERACOES["contacts.list"]!, { locationId: LOCATION_TOKEN, ghlContactId: null }))
      .toEqual({ locationId: LOCATION_TOKEN });
    expect(parametrosDoServidor(OPERACOES["conversations.search"]!, { locationId: LOCATION_TOKEN, ghlContactId: "c1" }))
      .toEqual({ locationId: LOCATION_TOKEN, contactId: "c1" });

    // O cliente não pode enviar nenhuma das duas grafias, nem o contacto.
    for (const chave of ["locationId", "location_id", "contactId", "contact_id"]) {
      const r = filtrarQuery(OPERACOES["opportunities.search"]!, { [chave]: "x" });
      expect(r.ok, chave).toBe(false);
    }

    const pedidos: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        pedidos.push(String(url));
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      }),
    );

    const cfg = { baseUrl: GHL_ORIGIN, version: GHL_VERSION, token: "token-falso", locationId: LOCATION_TOKEN };
    const op = OPERACOES["opportunities.search"]!;
    await ghlFetch(cfg, op.path({ locationId: LOCATION_TOKEN, ghlContactId: null }), {
      method: "GET",
      query: { limit: "20", ...parametrosDoServidor(op, { locationId: LOCATION_TOKEN, ghlContactId: null }) },
    });
    const conv = OPERACOES["conversations.search"]!;
    await ghlFetch(cfg, conv.path({ locationId: LOCATION_TOKEN, ghlContactId: "c1" }), {
      method: "GET",
      query: { limit: "10", ...parametrosDoServidor(conv, { locationId: LOCATION_TOKEN, ghlContactId: "c1" }) },
    });

    expect(pedidos[0]).toBe(
      `https://services.leadconnectorhq.com/opportunities/search?limit=20&location_id=${LOCATION_TOKEN}`,
    );
    expect(pedidos[0]).not.toContain("locationId=");
    expect(pedidos[1]).toBe(
      `https://services.leadconnectorhq.com/conversations/search?limit=10&locationId=${LOCATION_TOKEN}&contactId=c1`,
    );
    vi.unstubAllGlobals();
  });

  it("recusa um contacto cujo id devolvido não corresponde ao pedido", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ contact: { id: "outro", locationId: LOCATION_TOKEN } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const r = await contactoPertenceALocation("token-falso", LOCATION_TOKEN, "c1");
    expect(r.ok).toBe(false);
    vi.unstubAllGlobals();
  });
});
