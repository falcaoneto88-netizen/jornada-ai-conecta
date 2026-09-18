/**
 * Contrato da ponte Ad Navigator v1: esquema estrito, ausência de PII,
 * allowlist de etapas, recusa de payloads inválidos e estabilidade do
 * snapshot_id.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  AD_NAV_SCOPE,
  calcularSnapshotId,
  ehTokenAdNav,
  jsonEstavel,
  mapearEstado,
  mapearEtapa,
  montarResposta,
  normalizarResumo,
  validarPedidoTroca,
} from "./ad-navigator.core";

const digest = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");

const TOKEN = "A".repeat(43);
const CODE = `jpair_${TOKEN}`;
const TENANT = "11111111-1111-4111-8111-111111111111";
const HASH = "b".repeat(64);

const brutoSql = {
  schema_version: 1,
  grant_id: "22222222-2222-4222-8222-222222222222",
  organization_id: "33333333-3333-4333-8333-333333333333",
  location_id: "ok2UHC2QMZsd8UHsAgEa",
  pipeline_id: "2QGyurvcmwhNhRgq0jCq",
  scope: AD_NAV_SCOPE,
  source: "jornada_local",
  coverage: {
    kind: "local_snapshot",
    upstream_complete: false,
    last_synced_at: "2026-09-18T10:00:00.000Z",
    latest_record_at: "2026-09-18T11:00:00.000Z",
    reason: "upstream_coverage_not_verified",
  },
  counts: {
    opportunities: 3,
    linked_contacts: 2,
    unlinked_opportunities: 1,
    by_status: { open: 2, won: 1, lost: 0, abandoned: 0, unknown: 0 },
    by_stage: { novo_lead: 2, unknown: 1 },
  },
  attribution: { status: "unavailable", reason: "campaign_link_not_available" },
  revenue: { value: null, reason: "financial_source_not_connected" },
};

type Bruto = typeof brutoSql;
const comContagens = (p: Partial<Bruto["counts"]>): unknown => ({
  ...brutoSql,
  counts: { ...brutoSql.counts, ...p },
});

describe("pedido de troca", () => {
  it("aceita apenas o esquema e o formato exatos", () => {
    const r = validarPedidoTroca({ code: CODE, receiver_tenant_id: TENANT, credential_hash: HASH });
    expect(r.ok).toBe(true);
  });

  it("recusa campos extra, tipos errados e códigos fora do formato", () => {
    const casos: unknown[] = [
      null,
      [],
      "texto",
      { code: CODE, receiver_tenant_id: TENANT },
      { code: CODE, receiver_tenant_id: TENANT, credential_hash: HASH, organization_id: TENANT },
      { code: "semprefixo", receiver_tenant_id: TENANT, credential_hash: HASH },
      { code: `jpair_${"A".repeat(42)}`, receiver_tenant_id: TENANT, credential_hash: HASH },
      { code: `jpair_${"A".repeat(44)}`, receiver_tenant_id: TENANT, credential_hash: HASH },
      { code: `jpair_${"A".repeat(42)}+`, receiver_tenant_id: TENANT, credential_hash: HASH },
      { code: CODE, receiver_tenant_id: "nao-uuid", credential_hash: HASH },
      { code: CODE, receiver_tenant_id: TENANT, credential_hash: HASH.toUpperCase() },
      { code: CODE, receiver_tenant_id: TENANT, credential_hash: "b".repeat(63) },
      { code: CODE, receiver_tenant_id: TENANT, credential_hash: 1 },
    ];
    for (const caso of casos) expect(validarPedidoTroca(caso).ok, JSON.stringify(caso)).toBe(false);
  });

  it("aceita como token apenas 43 caracteres base64url", () => {
    expect(ehTokenAdNav(TOKEN)).toBe(true);
    expect(ehTokenAdNav("A".repeat(42))).toBe(false);
    expect(ehTokenAdNav(`${"A".repeat(42)}=`)).toBe(false);
    expect(ehTokenAdNav(CODE)).toBe(false);
    expect(ehTokenAdNav(null)).toBe(false);
  });
});

describe("mapeamentos", () => {
  it("normaliza estados conhecidos e desconhecidos", () => {
    expect(mapearEstado("aberta")).toBe("open");
    expect(mapearEstado("WON")).toBe("won");
    expect(mapearEstado("perdida")).toBe("lost");
    expect(mapearEstado("abandoned")).toBe("abandoned");
    expect(mapearEstado("qualquer-coisa")).toBe("unknown");
    expect(mapearEstado(null)).toBe("unknown");
  });

  it("só aceita etapas da allowlist", () => {
    expect(mapearEtapa("consulta_paga")).toBe("consulta_paga");
    expect(mapearEtapa("etapa inventada")).toBe("unknown");
    expect(mapearEtapa(42)).toBe("unknown");
  });
});

describe("resumo", () => {
  it("devolve o contrato exato, sem campos de pessoas", () => {
    const resumo = normalizarResumo(brutoSql)!;
    expect(Object.keys(resumo).sort()).toEqual(
      [
        "attribution",
        "counts",
        "coverage",
        "grant_id",
        "location_id",
        "organization_id",
        "pipeline_id",
        "revenue",
        "schema_version",
        "scope",
        "source",
      ].sort(),
    );
    const texto = JSON.stringify(resumo);
    for (const proibido of ["name", "phone", "email", "tags", "contact_name", "message"]) {
      expect(texto.includes(proibido)).toBe(false);
    }
    expect(resumo.coverage.upstream_complete).toBe(false);
    expect(resumo.revenue.value).toBeNull();
    expect(resumo.attribution.status).toBe("unavailable");
  });

  it("aceita contagens como texto de bigint sem perda de precisão", () => {
    const resumo = normalizarResumo(
      comContagens({
        opportunities: "3" as unknown as number,
        linked_contacts: "2" as unknown as number,
        unlinked_opportunities: "1" as unknown as number,
      }),
    )!;
    expect(resumo.counts.opportunities).toBe(3);
  });

  it("aceita um funil ainda vazio, desde que coerente", () => {
    const vazio = normalizarResumo({
      ...brutoSql,
      coverage: { ...brutoSql.coverage, last_synced_at: null, latest_record_at: null },
      counts: {
        opportunities: 0,
        linked_contacts: 0,
        unlinked_opportunities: 0,
        by_status: { open: 0, won: 0, lost: 0, abandoned: 0, unknown: 0 },
        by_stage: {},
      },
    })!;
    expect(vazio.counts.opportunities).toBe(0);
    expect(vazio.counts.by_stage).toEqual({});
    expect(vazio.coverage.last_synced_at).toBeNull();
  });

  it("recusa payloads inválidos em vez de inventar zeros", () => {
    const casos: Array<[string, unknown]> = [
      ["nulo", null],
      ["texto", "resumo"],
      ["campo extra", { ...brutoSql, extra: 1 }],
      ["campo desconhecido nas contagens", comContagens({ total: 3 } as never)],
      ["schema inesperado", { ...brutoSql, schema_version: 2 }],
      ["scope inesperado", { ...brutoSql, scope: "tudo:read" }],
      ["source inesperada", { ...brutoSql, source: "outro" }],
      ["grant_id inválido", { ...brutoSql, grant_id: "nao-uuid" }],
      ["organização inválida", { ...brutoSql, organization_id: null }],
      ["funil vazio", { ...brutoSql, pipeline_id: "  " }],
      ["contagem ausente", comContagens({ opportunities: undefined as never })],
      ["contagem nula", comContagens({ opportunities: null as never })],
      ["contagem negativa", comContagens({ opportunities: -1 })],
      ["contagem fracionada", comContagens({ opportunities: 2.5 })],
      ["contagem acima do seguro", comContagens({ opportunities: 1e18 })],
      ["texto não numérico", comContagens({ opportunities: "três" as unknown as number })],
      ["estados incompletos", comContagens({ by_status: { open: 3 } as never })],
      ["etapa fora da allowlist", comContagens({ by_stage: { "Harmonização VIP": 3 } })],
      ["soma de estados diferente do total", comContagens({ opportunities: 4 })],
      [
        "soma de etapas diferente do total",
        comContagens({ by_stage: { novo_lead: 1, unknown: 1 } }),
      ],
      ["soltos acima do total", comContagens({ unlinked_opportunities: 4 })],
      ["ligados acima dos possíveis", comContagens({ linked_contacts: 3 })],
      [
        "cobertura completa declarada",
        { ...brutoSql, coverage: { ...brutoSql.coverage, upstream_complete: true } },
      ],
      [
        "data inválida",
        { ...brutoSql, coverage: { ...brutoSql.coverage, latest_record_at: "ontem" } },
      ],
      ["receita preenchida", { ...brutoSql, revenue: { value: 10, reason: "x" } }],
      [
        "atribuição inesperada",
        { ...brutoSql, attribution: { status: "available", reason: "campaign_link_not_available" } },
      ],
    ];
    for (const [nome, caso] of casos) expect(normalizarResumo(caso), nome).toBeNull();
  });
});

describe("snapshot_id", () => {
  it("é estável para o mesmo conteúdo e ignora generated_at", () => {
    const resumo = normalizarResumo(brutoSql)!;
    const a = montarResposta(resumo, digest, new Date("2026-09-18T12:00:00Z"));
    const b = montarResposta(resumo, digest, new Date("2026-09-18T13:30:00Z"));
    expect(a.snapshot_id).toBe(b.snapshot_id);
    expect(a.generated_at).not.toBe(b.generated_at);
  });

  it("muda quando a frescura ou as contagens mudam", () => {
    const resumo = normalizarResumo(brutoSql)!;
    const base = calcularSnapshotId(resumo, digest);
    const outraFrescura = calcularSnapshotId(
      { ...resumo, coverage: { ...resumo.coverage, latest_record_at: "2026-09-18T12:00:00.000Z" } },
      digest,
    );
    const outraContagem = calcularSnapshotId(
      { ...resumo, counts: { ...resumo.counts, opportunities: 4 } },
      digest,
    );
    expect(outraFrescura).not.toBe(base);
    expect(outraContagem).not.toBe(base);
  });

  it("usa JSON canónico com chaves ordenadas", () => {
    expect(jsonEstavel({ b: 1, a: [2, { d: 4, c: 3 }] })).toBe('{"a":[2,{"c":3,"d":4}],"b":1}');
  });
});
