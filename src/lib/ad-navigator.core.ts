/**
 * Ponte Jornada -> Ad Navigator (v1) — contrato puro e testável.
 *
 * Só indicadores comerciais agregados. Nenhuma função deste ficheiro conhece
 * nomes, telefones, emails, tags, conversas ou dados clínicos.
 */

export const AD_NAV_SCHEMA_VERSION = 1 as const;
export const AD_NAV_SCOPE = "commercial_summary:read" as const;
export const AD_NAV_SOURCE = "jornada_local" as const;
export const AD_NAV_CODE_PREFIX = "jpair_";
export const AD_NAV_CODE_TTL_SEGUNDOS = 600;
export const AD_NAV_LIMITE_BYTES = 2048;

/** Única lista de etapas aceite na resposta. Tudo o resto soma em `unknown`. */
export const AD_NAV_ETAPAS = [
  "novo_lead",
  "em_atendimento",
  "consulta_agendada",
  "consulta_confirmada",
  "consulta_realizada",
  "orcamento_enviado",
  "procedimento_agendado",
  "pos_procedimento",
  "follow_up",
  "reativacao",
  "consulta_nao_paga",
  "consulta_paga",
  "nao_compareceu",
  "follow_up_2",
  "depoimento_indicacao",
  "perdido_desqualificado",
  "procedimento_realizado",
  "unknown",
] as const;

export type EtapaAdNav = (typeof AD_NAV_ETAPAS)[number];
export type EstadoAdNav = "open" | "won" | "lost" | "abandoned" | "unknown";

const ESTADOS: Record<string, EstadoAdNav> = {
  aberta: "open",
  aberto: "open",
  open: "open",
  ganha: "won",
  ganho: "won",
  won: "won",
  perdida: "lost",
  perdido: "lost",
  lost: "lost",
  abandonada: "abandoned",
  abandonado: "abandoned",
  abandoned: "abandoned",
};

/** Espelho em TypeScript do mapeamento aplicado no SQL (mantidos em par). */
export function mapearEstado(bruto: unknown): EstadoAdNav {
  if (typeof bruto !== "string") return "unknown";
  return ESTADOS[bruto.trim().toLowerCase()] ?? "unknown";
}

export function mapearEtapa(bruto: unknown): EtapaAdNav {
  if (typeof bruto !== "string") return "unknown";
  const chave = bruto.trim();
  return (AD_NAV_ETAPAS as readonly string[]).includes(chave) && chave !== "unknown"
    ? (chave as EtapaAdNav)
    : "unknown";
}

export const HEX64 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PedidoTroca = { code: string; receiver_tenant_id: string; credential_hash: string };

/** Esquema estrito: só estes três campos, com estes tipos exatos. */
export function validarPedidoTroca(
  bruto: unknown,
): { ok: true; pedido: PedidoTroca } | { ok: false } {
  if (bruto === null || typeof bruto !== "object" || Array.isArray(bruto)) return { ok: false };
  const o = bruto as Record<string, unknown>;
  const chaves = Object.keys(o).sort();
  if (chaves.join(",") !== "code,credential_hash,receiver_tenant_id") return { ok: false };
  const { code, receiver_tenant_id: tenant, credential_hash: hash } = o;
  if (typeof code !== "string" || code.length < 16 || code.length > 128) return { ok: false };
  if (!code.startsWith(AD_NAV_CODE_PREFIX)) return { ok: false };
  if (!/^jpair_[A-Za-z0-9_-]{16,120}$/.test(code)) return { ok: false };
  if (typeof tenant !== "string" || !UUID.test(tenant)) return { ok: false };
  if (typeof hash !== "string" || !HEX64.test(hash)) return { ok: false };
  return { ok: true, pedido: { code, receiver_tenant_id: tenant, credential_hash: hash } };
}

export type CoberturaAdNav = {
  kind: "local_snapshot";
  upstream_complete: false;
  last_synced_at: string | null;
  latest_record_at: string | null;
  reason: "upstream_coverage_not_verified";
};

export type ContagensAdNav = {
  opportunities: number;
  linked_contacts: number;
  unlinked_opportunities: number;
  by_status: Record<EstadoAdNav, number>;
  by_stage: Record<string, number>;
};

export type ResumoEstavel = {
  schema_version: 1;
  grant_id: string;
  organization_id: string;
  location_id: string;
  pipeline_id: string;
  scope: typeof AD_NAV_SCOPE;
  source: typeof AD_NAV_SOURCE;
  coverage: CoberturaAdNav;
  counts: ContagensAdNav;
  attribution: { status: "unavailable"; reason: "campaign_link_not_available" };
  revenue: { value: null; reason: "financial_source_not_connected" };
};

export type RespostaResumo = ResumoEstavel & { snapshot_id: string; generated_at: string };

function numero(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
}

function iso(v: unknown): string | null {
  if (typeof v !== "string" || v === "") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Normaliza a saída bruta do SQL para o contrato exato, com etapas restritas à
 * allowlist (chaves desconhecidas somam em `unknown`) e sem texto livre.
 */
export function normalizarResumo(bruto: unknown): ResumoEstavel | null {
  if (bruto === null || typeof bruto !== "object") return null;
  const o = bruto as Record<string, unknown>;
  const contagens = (o["counts"] ?? {}) as Record<string, unknown>;
  const cobertura = (o["coverage"] ?? {}) as Record<string, unknown>;
  const estadosBrutos = (contagens["by_status"] ?? {}) as Record<string, unknown>;
  const etapasBrutas = (contagens["by_stage"] ?? {}) as Record<string, unknown>;

  for (const campo of ["grant_id", "organization_id", "location_id", "pipeline_id"]) {
    if (typeof o[campo] !== "string" || (o[campo] as string) === "") return null;
  }

  const by_stage: Record<string, number> = {};
  for (const [chave, valor] of Object.entries(etapasBrutas)) {
    const etapa = mapearEtapa(chave);
    by_stage[etapa] = (by_stage[etapa] ?? 0) + numero(valor);
  }

  return {
    schema_version: AD_NAV_SCHEMA_VERSION,
    grant_id: o["grant_id"] as string,
    organization_id: o["organization_id"] as string,
    location_id: o["location_id"] as string,
    pipeline_id: o["pipeline_id"] as string,
    scope: AD_NAV_SCOPE,
    source: AD_NAV_SOURCE,
    coverage: {
      kind: "local_snapshot",
      upstream_complete: false,
      last_synced_at: iso(cobertura["last_synced_at"]),
      latest_record_at: iso(cobertura["latest_record_at"]),
      reason: "upstream_coverage_not_verified",
    },
    counts: {
      opportunities: numero(contagens["opportunities"]),
      linked_contacts: numero(contagens["linked_contacts"]),
      unlinked_opportunities: numero(contagens["unlinked_opportunities"]),
      by_status: {
        open: numero(estadosBrutos["open"]),
        won: numero(estadosBrutos["won"]),
        lost: numero(estadosBrutos["lost"]),
        abandoned: numero(estadosBrutos["abandoned"]),
        unknown: numero(estadosBrutos["unknown"]),
      },
      by_stage,
    },
    attribution: { status: "unavailable", reason: "campaign_link_not_available" },
    revenue: { value: null, reason: "financial_source_not_connected" },
  };
}

/** JSON canónico (chaves ordenadas) para que o mesmo conteúdo dê o mesmo id. */
export function jsonEstavel(valor: unknown): string {
  if (valor === null || typeof valor !== "object") return JSON.stringify(valor) ?? "null";
  if (Array.isArray(valor)) return `[${valor.map(jsonEstavel).join(",")}]`;
  const entradas = Object.entries(valor as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entradas.map(([k, v]) => `${JSON.stringify(k)}:${jsonEstavel(v)}`).join(",")}}`;
}

/** `snapshot_id` cobre todo o conteúdo estável, incluindo frescura; nunca `generated_at`. */
export function calcularSnapshotId(
  resumo: ResumoEstavel,
  digest: (texto: string) => string,
): string {
  return digest(jsonEstavel(resumo));
}

export function montarResposta(
  resumo: ResumoEstavel,
  digest: (texto: string) => string,
  agora: Date,
): RespostaResumo {
  return {
    ...resumo,
    snapshot_id: calcularSnapshotId(resumo, digest),
    generated_at: agora.toISOString(),
  };
}
