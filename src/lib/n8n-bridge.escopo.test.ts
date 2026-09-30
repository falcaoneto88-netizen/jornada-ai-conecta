/** Adaptador real resolverEscopo contra um cliente falso com as tabelas/colunas reais. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

import { resolverEscopo, type ClienteBridge } from "./n8n-bridge.server";

const LOC = "ok2UHC2QMZsd8UHsAgEa";
const ORG = "f07ab3be-7419-4779-a901-ef71c5fc27f0";

type Tabelas = Record<string, Record<string, unknown>[]>;

function cliente(t: Tabelas, lidas: { tabela: string; colunas: string }[] = []): ClienteBridge {
  return {
    from: (tabela) => ({
      select: (colunas) => {
        lidas.push({ tabela, colunas });
        const filtros: [string, unknown][] = [];
        const f = {
          eq: (k: string, v: unknown) => (filtros.push([k, v]), f),
          maybeSingle: async () => {
            const rows = t[tabela];
            if (!rows)
              return { data: null, error: { code: "42P01", message: "relation does not exist" } };
            const r = rows.filter((row) => filtros.every(([k, v]) => row[k] === v));
            return { data: r[0] ?? null, error: null };
          },
        };
        return f;
      },
      upsert: async () => ({ data: null, error: null }),
      insert: async () => ({ data: null, error: null }),
    }),
    rpc: async () => ({ data: null, error: null }),
  };
}

// Linha com a forma exata de public.ghl_connections.
const conexao = (extra: Record<string, unknown> = {}) => ({
  id: "0e1f",
  organization_id: ORG,
  api_base_url: "https://services.leadconnectorhq.com",
  api_version: "2021-07-28",
  location_id: LOC,
  default_pipeline_id: "pipe",
  calendar_id: "nPXR1Fyp0r3CpaMMGSki",
  mode: "conectado",
  status: "conectada",
  last_test_at: null,
  last_test_message: null,
  last_sync_at: null,
  write_enabled: true,
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
  ...extra,
});
const base = (extra: Record<string, unknown> = {}): Tabelas => ({
  ghl_location_bindings: [
    { location_id: LOC, organization_id: ORG, created_at: "x", updated_at: "x" },
  ],
  ghl_connections: [conexao(extra)],
});

beforeEach(() => {
  vi.stubEnv("GHL_PRIVATE_TOKEN", "token-sintetico");
  vi.stubEnv("GHL_LOCATION_ID", LOC);
});
afterEach(() => vi.unstubAllEnvs());

describe("resolverEscopo", () => {
  it("lê ghl_location_bindings e ghl_connections (nunca ghl_integrations)", async () => {
    const lidas: { tabela: string; colunas: string }[] = [];
    const r = await resolverEscopo(cliente(base(), lidas), { orgId: undefined });
    expect(r).toEqual({
      orgId: ORG,
      locationId: LOC,
      writeEnabled: true,
      integracaoConectada: true,
    });
    expect(lidas.map((l) => l.tabela)).toEqual(["ghl_location_bindings", "ghl_connections"]);
    expect(lidas[1]!.colunas).toBe("location_id,status,write_enabled");
  });
  it("org de ambiente presente e igual: aceita; diferente: recusa", async () => {
    expect(await resolverEscopo(cliente(base()), { orgId: ORG })).not.toBeNull();
    expect(
      await resolverEscopo(cliente(base()), { orgId: "11111111-2222-3333-4444-555555555555" }),
    ).toBeNull();
  });
  it("status/write reais mapeados", async () => {
    const r = await resolverEscopo(
      cliente(base({ status: "nao_testada", write_enabled: false })),
      {},
    );
    expect(r).toMatchObject({ writeEnabled: false, integracaoConectada: false });
  });
  it("location divergente, sem binding, tabela inexistente ou sem secrets: null", async () => {
    expect(await resolverEscopo(cliente(base({ location_id: null })), {})).toBeNull();
    expect(await resolverEscopo(cliente({ ...base(), ghl_location_bindings: [] }), {})).toBeNull();
    expect(
      await resolverEscopo(
        cliente({ ghl_location_bindings: base()["ghl_location_bindings"]! }),
        {},
      ),
    ).toBeNull();
    vi.stubEnv("GHL_LOCATION_ID", "");
    expect(await resolverEscopo(cliente(base()), {})).toBeNull();
  });
});
