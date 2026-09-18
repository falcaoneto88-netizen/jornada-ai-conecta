/**
 * Ponte Jornada -> Ad Navigator (v1) — contrato puro e testável.
 *
 * Só indicadores comerciais agregados. Nenhuma função deste ficheiro conhece
 * nomes, telefones, emails, tags, conversas ou dados clínicos.
 *
 * Regra de ouro da validação: nada é "corrigido". Um payload incompleto,
 * negativo, fracionado, incoerente ou com campos a mais é recusado — nunca
 * transformado em zero nem em identidade inventada.
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

/** 32 bytes em base64url = exatamente 43 caracteres, sem preenchimento. */
export const AD_NAV_CODE_REGEX = /^jpair_[A-Za-z0-9_-]{43}$/;
export const AD_NAV_TOKEN_REGEX = /^[A-Za-z0-9_-]{43}$/;

export function ehTokenAdNav(bruto: unknown): bruto is string {
  return typeof bruto === "string" && AD_NAV_TOKEN_REGEX.test(bruto);
}

export type PedidoTroca = { code: string; receiver_tenant_id: string; credential_hash: string };

/** Esquema estrito: só estes três campos, com estes tipos e formatos exatos. */
export function validarPedidoTroca(
  bruto: unknown,
): { ok: true; pedido: PedidoTroca } | { ok: false } {
  if (bruto === null || typeof bruto !== "object" || Array.isArray(bruto)) return { ok: false };
  const o = bruto as Record<string, unknown>;
  if (Object.keys(o).sort().join(",") !== "code,credential_hash,receiver_tenant_id") {
    return { ok: false };
  }
  const { code, receiver_tenant_id: tenant, credential_hash: hash } = o;
  if (typeof code !== "string" || !AD_NAV_CODE_REGEX.test(code)) return { ok: false };
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

/**
 * Contagem válida: número JSON inteiro e seguro, ou string de dígitos (bigint
 * do Postgres) dentro do intervalo seguro. Ausente, nulo, negativo, fracionado
 * ou acima de 2^53-1 é recusado — nunca convertido em zero.
 */
function contagem(v: unknown): number | null {
  if (typeof v === "number") {
    return Number.isSafeInteger(v) && v >= 0 ? v : null;
  }
  if (typeof v === "string" && /^[0-9]{1,16}$/.test(v)) {
    const n = Number(v);
    return Number.isSafeInteger(n) ? n : null;
  }
  return null;
}

function textoNaoVazio(v: unknown, max = 128): v is string {
  return typeof v === "string" && v.trim() !== "" && v.length <= max;
}

/** Data: `null` explícito ou ISO válido. Texto inválido recusa o payload. */
function data(v: unknown): { ok: true; valor: string | null } | { ok: false } {
  if (v === null) return { ok: true, valor: null };
  if (typeof v !== "string" || v === "") return { ok: false };
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? { ok: false } : { ok: true, valor: d.toISOString() };
}

function chavesExatas(o: Record<string, unknown>, esperadas: string[]): boolean {
  return Object.keys(o).sort().join(",") === [...esperadas].sort().join(",");
}

function objeto(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/**
 * Normaliza (e valida) a saída bruta do SQL. Devolve `null` a qualquer desvio
 * do contrato: campos em falta ou a mais, contagens inválidas, totais
 * incoerentes, identidades malformadas ou escopo/origem inesperados.
 */
export function normalizarResumo(bruto: unknown): ResumoEstavel | null {
  const o = objeto(bruto);
  if (!o) return null;
  if (
    !chavesExatas(o, [
      "schema_version",
      "grant_id",
      "organization_id",
      "location_id",
      "pipeline_id",
      "scope",
      "source",
      "coverage",
      "counts",
      "attribution",
      "revenue",
    ])
  ) {
    return null;
  }
  if (o["schema_version"] !== AD_NAV_SCHEMA_VERSION) return null;
  if (o["scope"] !== AD_NAV_SCOPE || o["source"] !== AD_NAV_SOURCE) return null;
  if (typeof o["grant_id"] !== "string" || !UUID.test(o["grant_id"])) return null;
  if (typeof o["organization_id"] !== "string" || !UUID.test(o["organization_id"])) return null;
  if (!textoNaoVazio(o["location_id"], 64) || !textoNaoVazio(o["pipeline_id"], 64)) return null;

  const cobertura = objeto(o["coverage"]);
  if (
    !cobertura ||
    !chavesExatas(cobertura, [
      "kind",
      "upstream_complete",
      "last_synced_at",
      "latest_record_at",
      "reason",
    ]) ||
    cobertura["kind"] !== "local_snapshot" ||
    cobertura["upstream_complete"] !== false ||
    cobertura["reason"] !== "upstream_coverage_not_verified"
  ) {
    return null;
  }
  const sincronizado = data(cobertura["last_synced_at"]);
  const ultimo = data(cobertura["latest_record_at"]);
  if (!sincronizado.ok || !ultimo.ok) return null;

  const contagens = objeto(o["counts"]);
  if (
    !contagens ||
    !chavesExatas(contagens, [
      "opportunities",
      "linked_contacts",
      "unlinked_opportunities",
      "by_status",
      "by_stage",
    ])
  ) {
    return null;
  }
  const total = contagem(contagens["opportunities"]);
  const ligados = contagem(contagens["linked_contacts"]);
  const soltos = contagem(contagens["unlinked_opportunities"]);
  if (total === null || ligados === null || soltos === null) return null;

  const estadosBrutos = objeto(contagens["by_status"]);
  if (!estadosBrutos || !chavesExatas(estadosBrutos, ["open", "won", "lost", "abandoned", "unknown"]))
    return null;
  const by_status = {} as Record<EstadoAdNav, number>;
  let somaEstados = 0;
  for (const chave of ["open", "won", "lost", "abandoned", "unknown"] as const) {
    const n = contagem(estadosBrutos[chave]);
    if (n === null) return null;
    by_status[chave] = n;
    somaEstados += n;
  }

  const etapasBrutas = objeto(contagens["by_stage"]);
  if (!etapasBrutas) return null;
  const by_stage: Record<string, number> = {};
  let somaEtapas = 0;
  for (const [chave, valor] of Object.entries(etapasBrutas)) {
    if (!(AD_NAV_ETAPAS as readonly string[]).includes(chave)) return null;
    const n = contagem(valor);
    if (n === null) return null;
    by_stage[chave] = n;
    somaEtapas += n;
  }

  // Coerência: os cortes têm de somar o total, e os ligados/soltos cabem nele.
  if (somaEstados !== total || somaEtapas !== total) return null;
  if (soltos > total || ligados > total - soltos) return null;

  const atribuicao = objeto(o["attribution"]);
  if (
    !atribuicao ||
    !chavesExatas(atribuicao, ["status", "reason"]) ||
    atribuicao["status"] !== "unavailable" ||
    atribuicao["reason"] !== "campaign_link_not_available"
  ) {
    return null;
  }
  const receita = objeto(o["revenue"]);
  if (
    !receita ||
    !chavesExatas(receita, ["value", "reason"]) ||
    receita["value"] !== null ||
    receita["reason"] !== "financial_source_not_connected"
  ) {
    return null;
  }

  return {
    schema_version: AD_NAV_SCHEMA_VERSION,
    grant_id: o["grant_id"],
    organization_id: o["organization_id"],
    location_id: o["location_id"],
    pipeline_id: o["pipeline_id"],
    scope: AD_NAV_SCOPE,
    source: AD_NAV_SOURCE,
    coverage: {
      kind: "local_snapshot",
      upstream_complete: false,
      last_synced_at: sincronizado.valor,
      latest_record_at: ultimo.valor,
      reason: "upstream_coverage_not_verified",
    },
    counts: {
      opportunities: total,
      linked_contacts: ligados,
      unlinked_opportunities: soltos,
      by_status,
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
