/**
 * Lógica pura da ligação de pipelines/oportunidades do GoHighLevel.
 * Não conhece Supabase nem rede: tudo entra por dependências injetadas,
 * o que permite testar paginação, deduplicação e validações a sério.
 */

export type EtapaGhl = { id: string; name: string; position: number };
export type PipelineGhl = { id: string; name: string; stages: EtapaGhl[] };

export type EtapaLocal = {
  key: string;
  name: string;
  position: number;
  ghl_pipeline_id: string | null;
  ghl_stage_id: string | null;
};

export type OportunidadeGhl = {
  id?: string;
  name?: string;
  monetaryValue?: number | null;
  pipelineId?: string;
  pipelineStageId?: string;
  status?: string;
  contactId?: string;
  locationId?: string;
  updatedAt?: string;
};

/** Normaliza um nome para comparação: espaços colapsados, minúsculas. */
export function normalizarNome(valor: string): string {
  return valor.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Chave estável e legível para uma etapa nova vinda do GoHighLevel. */
export function chaveDeEtapa(nome: string): string {
  const base = nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return base || "etapa";
}

const CORES = ["#1f2937", "#334155", "#475569", "#64748b", "#0f766e", "#b45309", "#7c2d12", "#4c1d95"];

export type PlanoEtapas = {
  /** Etapas locais já existentes que passam a apontar para a etapa GHL homónima. */
  atualizar: { key: string; ghl_pipeline_id: string; ghl_stage_id: string; ghl_stage_position: number }[];
  /** Etapas do pipeline sem correspondência inequívoca: entram como etapas novas. */
  criar: {
    key: string;
    name: string;
    position: number;
    color: string;
    ghl_pipeline_id: string;
    ghl_stage_id: string;
    ghl_stage_position: number;
  }[];
  /** stage_id do GHL -> key local. */
  mapa: Record<string, string>;
};

/**
 * Associa apenas etapas com nome exatamente equivalente (espaços/maiúsculas
 * ignorados). Tudo o resto passa a ser uma etapa distinta: nunca equipara
 * pagamento a confirmação nem procedimento realizado a pós-procedimento.
 */
export function planearEtapas(input: {
  pipelineId: string;
  stages: EtapaGhl[];
  locais: EtapaLocal[];
}): PlanoEtapas {
  const porNome = new Map<string, EtapaLocal>();
  for (const l of input.locais) {
    const n = normalizarNome(l.name);
    if (porNome.has(n)) porNome.delete(n); // nome ambíguo localmente: não associa
    else porNome.set(n, l);
  }
  const chavesUsadas = new Set(input.locais.map((l) => l.key));
  let proximaPosicao = input.locais.reduce((m, l) => Math.max(m, l.position), 0) + 1;

  const plano: PlanoEtapas = { atualizar: [], criar: [], mapa: {} };
  const stages = [...input.stages].sort((a, b) => a.position - b.position);

  for (const s of stages) {
    const local = porNome.get(normalizarNome(s.name));
    const jaLigadaAOutra =
      local && local.ghl_stage_id && local.ghl_stage_id !== s.id && local.ghl_pipeline_id === input.pipelineId;
    if (local && !jaLigadaAOutra) {
      plano.atualizar.push({
        key: local.key,
        ghl_pipeline_id: input.pipelineId,
        ghl_stage_id: s.id,
        ghl_stage_position: s.position,
      });
      plano.mapa[s.id] = local.key;
      continue;
    }
    let key = chaveDeEtapa(s.name);
    let n = 2;
    while (chavesUsadas.has(key)) key = `${chaveDeEtapa(s.name)}_${n++}`;
    chavesUsadas.add(key);
    plano.criar.push({
      key,
      name: s.name.replace(/\s+/g, " ").trim(),
      position: proximaPosicao++,
      color: CORES[plano.criar.length % CORES.length]!,
      ghl_pipeline_id: input.pipelineId,
      ghl_stage_id: s.id,
      ghl_stage_position: s.position,
    });
    plano.mapa[s.id] = key;
  }
  return plano;
}

/** Cursor da página seguinte, extraído só de campos validados (nunca do nextPageUrl). */
export function cursorSeguinte(meta: unknown): { startAfter?: string; startAfterId?: string } | null {
  if (!meta || typeof meta !== "object") return null;
  const m = meta as Record<string, unknown>;
  const id = typeof m["startAfterId"] === "string" && m["startAfterId"] ? m["startAfterId"] : null;
  const after =
    typeof m["startAfter"] === "number" && Number.isFinite(m["startAfter"])
      ? String(m["startAfter"])
      : typeof m["startAfter"] === "string" && /^\d+$/.test(m["startAfter"])
        ? m["startAfter"]
        : null;
  if (!id && !after) return null;
  return { ...(after ? { startAfter: after } : {}), ...(id ? { startAfterId: id } : {}) };
}

export const ESTADOS_OPORTUNIDADE = ["open", "won", "lost", "abandoned"] as const;

/** Aceita apenas oportunidades da location e do pipeline autorizados. */
export function validarOportunidade(
  o: OportunidadeGhl,
  ctx: { locationId: string; pipelineId: string },
): { ok: true; id: string } | { ok: false; motivo: string } {
  if (!o.id || typeof o.id !== "string") return { ok: false, motivo: "oportunidade sem identificador" };
  if (o.locationId && o.locationId !== ctx.locationId) return { ok: false, motivo: "location diferente da autorizada" };
  if (o.pipelineId !== ctx.pipelineId) return { ok: false, motivo: "pipeline diferente do configurado" };
  return { ok: true, id: o.id };
}

export type LinhaOportunidade = {
  organization_id: string;
  ghl_opportunity_id: string;
  contact_id: string | null;
  name: string;
  pipeline_id: string;
  stage_id: string | null;
  stage_key: string | null;
  monetary_value: number | null;
  status: string;
  is_demo: false;
};

export function linhaOportunidade(
  o: OportunidadeGhl,
  ctx: { orgId: string; pipelineId: string; mapaEtapas: Record<string, string>; contactoLocal: string | null },
): LinhaOportunidade {
  const status = typeof o.status === "string" && o.status ? o.status : "open";
  const valor = typeof o.monetaryValue === "number" && Number.isFinite(o.monetaryValue) ? o.monetaryValue : null;
  return {
    organization_id: ctx.orgId,
    ghl_opportunity_id: String(o.id),
    contact_id: ctx.contactoLocal,
    name: (o.name ?? "").replace(/\s+/g, " ").trim() || "Oportunidade sem nome",
    pipeline_id: ctx.pipelineId,
    stage_id: o.pipelineStageId ?? null,
    stage_key: (o.pipelineStageId && ctx.mapaEtapas[o.pipelineStageId]) ?? null,
    monetary_value: valor,
    status,
    is_demo: false,
  };
}

/* ------------------------- Motor de sincronização ------------------------- */

export type ContactoNovo = {
  organization_id: string;
  ghl_contact_id: string;
  full_name: string;
  phone: string | null;
  phone_normalized: string | null;
  email: string | null;
  tags: string[];
  source: string;
  stage_key: string;
  is_demo: false;
};

export type LojaSincronizacao = {
  /** ghl_contact_id -> id local (apenas os pedidos). */
  contactosPorGhlId(ids: string[]): Promise<Map<string, string>>;
  /** Insere e devolve o id local; deve tolerar corridas devolvendo o existente. */
  inserirContacto(linha: ContactoNovo): Promise<string>;
  /** ghl_opportunity_id -> id local. */
  oportunidadesPorGhlId(ids: string[]): Promise<Map<string, string>>;
  inserirOportunidade(linha: LinhaOportunidade): Promise<"inserida" | "atualizada">;
  atualizarOportunidade(id: string, linha: LinhaOportunidade): Promise<void>;
};

export type DepsSincronizacao = {
  orgId: string;
  locationId: string;
  pipelineId: string;
  mapaEtapas: Record<string, string>;
  etapaInicialContacto: string;
  loja: LojaSincronizacao;
  /** Página de oportunidades do pipeline (o servidor impõe location/pipeline/status). */
  buscarPagina(cursor: { startAfter?: string; startAfterId?: string }): Promise<
    | { ok: true; oportunidades: OportunidadeGhl[]; meta: unknown }
    | { ok: false; message: string }
  >;
  /** Contacto real do GHL, já validado contra a location autorizada. */
  buscarContacto(ghlContactId: string): Promise<
    | { ok: true; contacto: ContactoNovo }
    | { ok: false; message: string }
  >;
  limitePaginas?: number;
};

export type ResultadoSincronizacao = {
  paginas: number;
  lidas: number;
  inseridas: number;
  atualizadas: number;
  contactosNovos: number;
  contactosLigados: number;
  ignoradas: number;
  truncado: boolean;
  conflitos: string[];
  porEtapa: Record<string, number>;
  completo: boolean;
};

export async function sincronizarOportunidades(deps: DepsSincronizacao): Promise<ResultadoSincronizacao> {
  const r: ResultadoSincronizacao = {
    paginas: 0,
    lidas: 0,
    inseridas: 0,
    atualizadas: 0,
    contactosNovos: 0,
    contactosLigados: 0,
    ignoradas: 0,
    truncado: false,
    conflitos: [],
    porEtapa: {},
    completo: true,
  };

  const limitePaginas = deps.limitePaginas ?? 200;
  let cursor: { startAfter?: string; startAfterId?: string } = {};
  const vistos = new Set<string>();
  const cursoresVistos = new Set<string>();

  while (r.paginas < limitePaginas) {
    const pagina = await deps.buscarPagina(cursor);
    if (!pagina.ok) {
      r.completo = false;
      r.conflitos.push(`Falha ao ler página ${r.paginas + 1}: ${pagina.message}`);
      break;
    }
    r.paginas += 1;
    const lote = pagina.oportunidades.filter((o) => {
      const v = validarOportunidade(o, { locationId: deps.locationId, pipelineId: deps.pipelineId });
      if (!v.ok) {
        r.ignoradas += 1;
        return false;
      }
      if (vistos.has(v.id)) return false;
      vistos.add(v.id);
      return true;
    });
    r.lidas += lote.length;

    if (lote.length > 0) await aplicarLote(lote, deps, r);

    const seguinte = cursorSeguinte(pagina.meta);
    if (!seguinte || pagina.oportunidades.length === 0) break;
    const assinatura = `${seguinte.startAfter ?? ""}:${seguinte.startAfterId ?? ""}`;
    if (cursoresVistos.has(assinatura)) break;
    cursoresVistos.add(assinatura);
    cursor = seguinte;

    if (r.paginas >= limitePaginas) {
      r.truncado = true;
      r.completo = false;
    }
  }

  return r;
}

async function aplicarLote(lote: OportunidadeGhl[], deps: DepsSincronizacao, r: ResultadoSincronizacao) {
  const idsContactos = [...new Set(lote.map((o) => o.contactId).filter((v): v is string => Boolean(v)))];
  const contactos = idsContactos.length > 0 ? await deps.loja.contactosPorGhlId(idsContactos) : new Map();

  for (const ghlContactId of idsContactos) {
    if (contactos.has(ghlContactId)) {
      r.contactosLigados += 1;
      continue;
    }
    const res = await deps.buscarContacto(ghlContactId);
    if (!res.ok) {
      r.completo = false;
      r.conflitos.push(`Contacto não sincronizado: ${res.message}`);
      continue;
    }
    try {
      const id = await deps.loja.inserirContacto({ ...res.contacto, stage_key: deps.etapaInicialContacto });
      contactos.set(ghlContactId, id);
      r.contactosNovos += 1;
    } catch (erro) {
      r.completo = false;
      r.conflitos.push(`Falha ao gravar contacto: ${(erro as Error).message}`);
    }
  }

  const existentes = await deps.loja.oportunidadesPorGhlId(lote.map((o) => String(o.id)));

  for (const o of lote) {
    const linha = linhaOportunidade(o, {
      orgId: deps.orgId,
      pipelineId: deps.pipelineId,
      mapaEtapas: deps.mapaEtapas,
      contactoLocal: (o.contactId && contactos.get(o.contactId)) || null,
    });
    const idLocal = existentes.get(linha.ghl_opportunity_id);
    try {
      if (idLocal) {
        await deps.loja.atualizarOportunidade(idLocal, linha);
        r.atualizadas += 1;
      } else {
        const efeito = await deps.loja.inserirOportunidade(linha);
        if (efeito === "inserida") r.inseridas += 1;
        else r.atualizadas += 1;
      }
      const chave = linha.stage_key ?? "sem_etapa";
      r.porEtapa[chave] = (r.porEtapa[chave] ?? 0) + 1;
    } catch (erro) {
      r.completo = false;
      r.conflitos.push(`Falha ao gravar oportunidade: ${(erro as Error).message}`);
    }
  }
}
