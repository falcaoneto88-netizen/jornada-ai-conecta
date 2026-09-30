/** Credencial por organização: autenticação da ponte, criação admin (CSRF/papel/org) e prontidão. */
import { createHash } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { criarChaveBridge, lerEstadoPonte, type Sessao } from "./n8n-bridge.admin.server";
import { CONFIG_PADRAO, digestIgual, processarBridge, type DepsBridge } from "./n8n-bridge.core";
import type { ClienteBridge } from "./n8n-bridge.server";

const LOC = "ok2UHC2QMZsd8UHsAgEa";
const ORG = "f07ab3be-7419-4779-a901-ef71c5fc27f0";
const OUTRA = "11111111-2222-3333-4444-555555555555";
const USER = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const PROD = "https://jornada-ai-conecta.lovable.app";
const CHAVE = "c".repeat(64); // sintética
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

type Tabelas = Record<string, Record<string, unknown>[]>;

function cliente(t: Tabelas, o: { falhaInsert?: boolean } = {}): ClienteBridge {
  return {
    from: (tabela) => ({
      select: () => {
        const filtros: [string, unknown][] = [];
        const f = {
          eq: (k: string, v: unknown) => (filtros.push([k, v]), f),
          maybeSingle: async () => {
            const rows = t[tabela];
            if (!rows) return { data: null, error: { code: "42P01", message: "x" } };
            const r = rows.filter((row) => filtros.every(([k, v]) => row[k] === v));
            return { data: r[0] ?? null, error: null };
          },
        };
        return f;
      },
      upsert: async () => ({ data: null, error: null }),
      insert: async (v) => {
        const rows = t[tabela];
        if (!rows || o.falhaInsert) return { data: null, error: { code: "42P01" } };
        if (rows.some((r) => r["organization_id"] === v["organization_id"]))
          return { data: null, error: { code: "23505" } };
        rows.push(v);
        return { data: null, error: null };
      },
    }),
    rpc: async () => ({ data: null, error: null }),
  };
}

const tabelas = (extra: Tabelas = {}): Tabelas => ({
  ghl_location_bindings: [{ location_id: LOC, organization_id: ORG }],
  ghl_connections: [
    { organization_id: ORG, location_id: LOC, status: "conectada", write_enabled: true },
  ],
  n8n_bridge_settings: [{ organization_id: ORG, bridge_enabled: false, simulation: true }],
  n8n_bridge_credentials: [],
  ...extra,
});

function sessao(o: { admin?: boolean; org?: string; user?: string | null } = {}): Sessao {
  return {
    userId: USER,
    supabase: {
      auth: {
        getUser: async () => ({
          data: { user: o.user === null ? null : { id: o.user ?? USER } },
          error: null,
        }),
      },
      rpc: async () => ({ data: o.admin ?? true, error: null }),
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { organization_id: o.org ?? ORG }, error: null }),
          }),
        }),
      }),
    },
  };
}

const cab = (origin: string | null, site?: string) => {
  const h = new Headers();
  if (origin) h.set("origin", origin);
  if (site) h.set("sec-fetch-site", site);
  return h;
};

beforeEach(() => {
  vi.stubEnv("GHL_PRIVATE_TOKEN", "token-sintetico");
  vi.stubEnv("GHL_LOCATION_ID", LOC);
  vi.stubEnv("JORNADA_AI_ORGANIZATION_ID", "");
  vi.stubEnv("N8N_JORNADA_BRIDGE_TOKEN", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("criarChaveBridge", () => {
  it("cria uma vez: guarda só o SHA-256 e devolve a chave em claro uma vez", async () => {
    const t = tabelas();
    const r = await criarChaveBridge(sessao(), cab(PROD, "same-origin"), cliente(t), () =>
      Buffer.alloc(32, 7),
    );
    expect(r.ok).toBe(true);
    const key = r.ok ? r.key : "";
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    const row = t["n8n_bridge_credentials"]![0]!;
    expect(row).toEqual({ organization_id: ORG, key_sha256: sha(key), created_by: USER });
    expect(JSON.stringify(t)).not.toContain(key);
    const again = await criarChaveBridge(sessao(), cab(PROD), cliente(t));
    expect(again).toMatchObject({ ok: false, code: "exists" });
    expect(JSON.stringify(again)).not.toContain(row["key_sha256"] as string);
  });
  it("CSRF: origem ausente, desconhecida ou cross-site recusada sem tocar na BD", async () => {
    const t = tabelas();
    for (const h of [cab(null), cab("https://evil.example"), cab(PROD, "cross-site")]) {
      expect(await criarChaveBridge(sessao(), h, cliente(t))).toMatchObject({
        code: "untrusted_origin",
      });
    }
    expect(
      (
        await criarChaveBridge(
          sessao(),
          cab("https://id-preview--36345211-2616-42f7-bb9e-e78a9d00ca22.lovable.app"),
          cliente(t),
        )
      ).ok,
    ).toBe(true);
  });
  it("não admin, outra organização ou sessão inválida: recusado", async () => {
    const t = tabelas();
    for (const s of [sessao({ admin: false }), sessao({ org: OUTRA }), sessao({ user: null })]) {
      const r = await criarChaveBridge(s, cab(PROD), cliente(t));
      expect(r.ok).toBe(false);
    }
    expect(t["n8n_bridge_credentials"]).toHaveLength(0);
  });
  it("token de ambiente presente tem precedência: criação indisponível", async () => {
    vi.stubEnv("N8N_JORNADA_BRIDGE_TOKEN", "e".repeat(40));
    const t = tabelas();
    expect(await criarChaveBridge(sessao(), cab(PROD), cliente(t))).toMatchObject({
      code: "unavailable",
    });
    expect(t["n8n_bridge_credentials"]).toHaveLength(0);
  });
  it("schema em falta ou falha ao gravar: nenhuma chave devolvida", async () => {
    const semTabela = tabelas();
    delete semTabela["n8n_bridge_credentials"];
    const a = await criarChaveBridge(sessao(), cab(PROD), cliente(semTabela));
    expect(a.ok).toBe(false);
    expect("key" in a).toBe(false);
    const b = await criarChaveBridge(
      sessao(),
      cab(PROD),
      cliente(tabelas(), { falhaInsert: true }),
    );
    expect(b.ok).toBe(false);
    expect("key" in b).toBe(false);
  });
});

describe("lerEstadoPonte (prontidão)", () => {
  it("só booleanos; nunca digest nem chave", async () => {
    const t = tabelas({
      n8n_bridge_credentials: [{ organization_id: ORG, key_sha256: sha(CHAVE) }],
    });
    const e = await lerEstadoPonte(sessao(), cliente(t));
    expect(e).toMatchObject({
      tokenPresente: true,
      podeCriarChave: false,
      credentialSchemaAvailable: true,
    });
    const txt = JSON.stringify(e);
    expect(txt).not.toContain(sha(CHAVE));
    expect(txt).not.toContain(CHAVE);
  });
  it("sem credencial: por criar e criação disponível; schema em falta: indisponível", async () => {
    expect(await lerEstadoPonte(sessao(), cliente(tabelas()))).toMatchObject({
      tokenPresente: false,
      podeCriarChave: true,
    });
    const s = tabelas();
    delete s["n8n_bridge_credentials"];
    expect(await lerEstadoPonte(sessao(), cliente(s))).toMatchObject({
      tokenPresente: false,
      podeCriarChave: false,
      credentialSchemaAvailable: false,
    });
  });
  it("não admin: nada", async () => {
    expect(await lerEstadoPonte(sessao({ admin: false }), cliente(tabelas()))).toMatchObject({
      autorizado: false,
      tokenPresente: false,
    });
  });
});

describe("autenticação da ponte com credencial por organização", () => {
  const base = (o: Partial<DepsBridge> = {}): DepsBridge => ({
    token: undefined,
    credencial: async (org) => ({ ok: true, digest: org === ORG ? sha(CHAVE) : null }),
    now: () => Date.now(),
    resolver: async () => ({
      orgId: ORG,
      locationId: LOC,
      writeEnabled: true,
      integracaoConectada: true,
    }),
    lerConfig: async () => ({ ok: true, cfg: CONFIG_PADRAO }),
    hit: async () => true,
    contacto: async () => ({ ok: false, code: "x" }),
    consulta: async () => ({ ok: false, code: "x" }),
    utilizadorNaLocation: async () => null,
    enviar: vi.fn(),
    claim: async () => null,
    finish: async () => false,
    ...o,
  });
  const chamar = (d: DepsBridge, body: unknown, auth: string | null = `Bearer ${CHAVE}`) =>
    processarBridge(
      new Request("http://x/api/public/n8n/bridge", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(auth ? { authorization: auth } : {}),
        },
        body: JSON.stringify(body),
      }),
      d,
    );

  it("chave válida autentica health com a ponte desligada; leituras continuam bloqueadas", async () => {
    expect((await chamar(base(), { op: "health" })).status).toBe(200);
    const r = await chamar(base(), { op: "contact.get", contactId: "contact01" });
    expect(r.status).toBe(403);
  });
  it("chave errada, ausente ou com prefixo duplicado: 401", async () => {
    expect((await chamar(base(), { op: "health" }, `Bearer ${"d".repeat(64)}`)).status).toBe(401);
    expect((await chamar(base(), { op: "health" }, null)).status).toBe(401);
    expect((await chamar(base(), { op: "health" }, `Bearer Bearer ${CHAVE}`)).status).toBe(401);
  });
  it("chave de outra organização (binding resolve outra org): recusada", async () => {
    const d = base({
      resolver: async () => ({
        orgId: OUTRA,
        locationId: LOC,
        writeEnabled: true,
        integracaoConectada: true,
      }),
    });
    expect((await chamar(d, { op: "health" })).status).toBe(503);
  });
  it("tabela em falta, sem credencial ou sem binding: fail-closed 503", async () => {
    expect(
      (await chamar(base({ credencial: async () => ({ ok: false }) }), { op: "health" })).status,
    ).toBe(503);
    expect(
      (
        await chamar(base({ credencial: async () => ({ ok: true, digest: null }) }), {
          op: "health",
        })
      ).status,
    ).toBe(503);
    expect((await chamar(base({ resolver: async () => null }), { op: "health" })).status).toBe(503);
    expect(
      (await chamar({ ...base(), credencial: undefined } as DepsBridge, { op: "health" })).status,
    ).toBe(503);
  });
  it("token de ambiente válido tem precedência: a chave da BD deixa de valer", async () => {
    const env = "e".repeat(40);
    const d = base({ token: env });
    expect((await chamar(d, { op: "health" })).status).toBe(401);
    expect((await chamar(d, { op: "health" }, `Bearer ${env}`)).status).toBe(200);
    // Token de ambiente curto (inválido) bloqueia tudo, sem cair na BD.
    expect((await chamar(base({ token: "curto" }), { op: "health" })).status).toBe(503);
  });
  it("digestIgual rejeita digest malformado", () => {
    expect(digestIgual("XYZ", CHAVE)).toBe(false);
    expect(digestIgual(sha(CHAVE).toUpperCase(), CHAVE)).toBe(false);
    expect(digestIgual(sha(CHAVE), CHAVE)).toBe(true);
  });
});
