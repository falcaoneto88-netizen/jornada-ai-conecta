/**
 * Ligação real ao GoHighLevel para os leads do site, limitada às submissões
 * desta integração. Usa o token privado já existente e a versão 2021-07-28.
 *
 * Identidade: apenas a pesquisa exata documentada (POST contacts/search com
 * locationId, page, pageLimit e um único filtro {field, operator:'eq', value},
 * por telefone e por e-mail em chamadas separadas). Nunca se usa `query` nem
 * qualquer listagem ampla. Respostas vazias, truncadas ou malformadas nunca
 * concluem "não existe": bloqueiam.
 *
 * Limitação documentada pelo fornecedor: a pesquisa tem consistência eventual
 * (alterações podem demorar segundos a aparecer). Por isso a dedução de
 * duplicados apoia-se também no ledger durável por identidade, que impede
 * execuções concorrentes, reenvios e retomas de resultado incerto.
 */
import { resolverAcesso } from "./ghl.functions";
import { FALCAO_SLUG, FALCAO_SOURCE_INTEGRACAO } from "./falcao-lead.server";
import {
  digitos,
  processarSubmissaoRemota,
  type ContactoRemoto,
  type DepsRemoto,
  type DesfechoRemoto,
  type OportunidadeRemota,
  type PedidoRemoto,
  type ResultadoRemotoApi,
} from "./falcao-remote.core";
import { GHL_ORIGIN, GHL_VERSION, ghlFetch, readGhlSecrets, type GhlConfig } from "./ghl.server";

type Ctx = Parameters<typeof resolverAcesso>[0];

const LIMITE_LOTE = 10;
/** Limite documentado do valor de um filtro `eq`. */
export const LIMITE_EQ = 75;
/** Página pequena: só serve para detetar resultados múltiplos. */
export const PAGE_LIMIT = 5;

function texto(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/** O resultado tem de bater exatamente no campo pedido. */
function bate(c: ContactoRemoto, campo: "telefone" | "email", valor: string): boolean {
  if (campo === "telefone") {
    const alvo = digitos(valor);
    return alvo !== null && digitos(c.phone) === alvo;
  }
  return (c.email ?? "").trim().toLowerCase() === valor.trim().toLowerCase();
}



/** Identidade estrita. A API pode omitir DND num contacto novo.
 * Ausência permanece desconhecida: este adaptador só regista contacto/oportunidade.
 * O envio de mensagens exige DND explícito no adaptador separado de acolhimento.
 */
export function contactoDaApi(bruto: unknown): ContactoRemoto | null {
  if (!bruto || typeof bruto !== "object") return null;
  const c = bruto as Record<string, unknown>;
  const id = texto(c["id"]);
  const location = texto(c["locationId"]);
  if (!id || !location) return null;
  const dnd = c["dnd"];
  if (dnd != null && typeof dnd !== "boolean") return null;
  const settings = c["dndSettings"];
  if (settings != null && (typeof settings !== "object" || Array.isArray(settings))) return null;
  const entradas = Object.entries((settings ?? {}) as Record<string, unknown>);
  if (
    entradas.some(([, valor]) => {
      if (!valor || typeof valor !== "object" || Array.isArray(valor)) return true;
      const status = (valor as Record<string, unknown>)["status"];
      return status !== "active" && status !== "inactive";
    })
  ) return null;
  const canais = entradas
    .filter(([, valor]) => (valor as Record<string, unknown>)["status"] === "active")
    .map(([canal]) => canal);
  return {
    id,
    locationId: location,
    phone: texto(c["phone"]),
    email: texto(c["email"]),
    dnd: typeof dnd === "boolean" ? dnd : null,
    canaisBloqueados: settings == null ? null : canais,
  };
}

/** Identificador do contacto da oportunidade: aceita forma direta ou aninhada.
 * `conflito` significa que as duas formas divergem — nunca se escolhe uma.
 */
export function contactoDaOportunidade(
  o: Record<string, unknown>,
): { ok: true; id: string | null } | { ok: false } {
  const direto = texto(o["contactId"] ?? o["contact_id"]);
  const aninhadoBruto = o["contact"];
  const aninhado =
    aninhadoBruto && typeof aninhadoBruto === "object" && !Array.isArray(aninhadoBruto)
      ? texto((aninhadoBruto as Record<string, unknown>)["id"])
      : null;
  if (direto && aninhado && direto !== aninhado) return { ok: false };
  return { ok: true, id: direto ?? aninhado };
}

export function oportunidadeDaApi(bruto: unknown): OportunidadeRemota | null {
  if (!bruto || typeof bruto !== "object") return null;
  const o = bruto as Record<string, unknown>;
  const id = texto(o["id"]);
  if (!id) return null;
  const contacto = contactoDaOportunidade(o);
  if (!contacto.ok) return null;
  return {
    id,
    name: texto(o["name"]),
    pipelineId: texto(o["pipelineId"] ?? o["pipeline_id"]),
    stageId: texto(o["pipelineStageId"] ?? o["stageId"] ?? o["pipeline_stage_id"]),
    status: texto(o["status"]),
    contactId: contacto.id,
  };
}


function falha<T>(res: { code: string; message: string }): ResultadoRemotoApi<T> {
  return { ok: false, code: res.code, message: res.message };
}

export function criarDepsGhl(cfg: GhlConfig, rpc: DepsRemoto["concluir"]): DepsRemoto {
  return {
    async procurarExato({ locationId, campo, valor }) {
      // Contrato oficial "Contacts Search": POST contacts/search com locationId,
      // page, pageLimit e um único filtro eq. `query` nunca é usado.
      if (valor.length > LIMITE_EQ) {
        return {
          ok: false,
          code: "valor_acima_do_limite_eq",
          message: "Valor acima do limite da pesquisa exata; nunca truncado.",
        };
      }
      const campoApi = campo === "telefone" ? "phone" : "email";
      const res = await ghlFetch<Record<string, unknown>>(cfg, "contacts/search", {
        method: "POST",
        body: {
          locationId,
          page: 1,
          pageLimit: PAGE_LIMIT,
          filters: [{ field: campoApi, operator: "eq", value: valor }],
        },
      });
      if (!res.ok) return falha(res);
      const corpo = res.data;
      if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) {
        return { ok: false, code: "malformed_response", message: "Resposta inesperada." };
      }
      const lista = corpo["contacts"];
      const total = corpo["total"];
      if (!Array.isArray(lista) || typeof total !== "number" || !Number.isInteger(total) || total < 0) {
        return { ok: false, code: "malformed_response", message: "Resposta sem contacts/total." };
      }
      if (total !== lista.length || lista.length >= PAGE_LIMIT) {
        // Página incompleta: nunca concluir que existe ou não existe.
        return { ok: false, code: "malformed_response", message: "Pesquisa truncada." };
      }
      if (total === 0) return { ok: true, data: null };
      const contactos = lista.map(contactoDaApi);
      if (contactos.some((c) => c === null)) {
        return { ok: false, code: "malformed_response", message: "Contacto sem campos exigidos." };
      }
      const validos = contactos as ContactoRemoto[];
      if (validos.some((c) => c.locationId !== locationId || !bate(c, campo, valor))) {
        return {
          ok: false,
          code: "resultado_nao_corresponde",
          message: "Resultado fora do pedido exato.",
        };
      }
      const unicos = new Set(validos.map((c) => c.id));
      if (unicos.size !== 1) {
        return { ok: false, code: "multiplos_resultados", message: "Mais do que um contacto." };
      }
      return { ok: true, data: validos[0] as ContactoRemoto };
    },

    async lerContacto({ ghlContactId }) {
      const res = await ghlFetch<{ contact?: unknown }>(
        cfg,
        `contacts/${encodeURIComponent(ghlContactId)}`,
      );
      if (!res.ok) return falha(res);
      const contacto = contactoDaApi(res.data?.contact);
      return contacto
        ? { ok: true, data: contacto }
        : { ok: false, code: "malformed_response", message: "Contacto sem campos exigidos." };
    },
    async criarContacto(pedido: PedidoRemoto) {
      const res = await ghlFetch<{ contact?: { id?: unknown } }>(cfg, "contacts/", {
        method: "POST",
        body: {
          locationId: pedido.location_id,
          name: pedido.full_name,
          ...(pedido.phone ? { phone: pedido.phone } : {}),
          ...(pedido.email ? { email: pedido.email } : {}),
          source: FALCAO_SLUG,
        },
      });
      if (!res.ok) return falha(res);
      const id = texto(res.data?.contact?.id);
      return id
        ? { ok: true, data: { id } }
        : { ok: false, code: "outcome_unknown", message: "Resposta sem contacto." };
    },
    async oportunidades({ locationId, ghlContactId }) {
      const res = await ghlFetch<{ opportunities?: unknown[]; meta?: Record<string, unknown> }>(
        cfg,
        "opportunities/search",
        { query: { location_id: locationId, contact_id: ghlContactId, limit: "100" } },
      );
      if (!res.ok) return falha(res);
      const lista = Array.isArray(res.data?.opportunities) ? res.data.opportunities : null;
      if (!lista) {
        return { ok: false, code: "malformed_response", message: "Resposta sem lista." };
      }
      const meta = res.data?.meta;
      if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
        return { ok: false, code: "malformed_response", message: "Paginação não comprovada." };
      }
      const total = meta["total"];
      if (typeof total !== "number" || !Number.isInteger(total) || total < 0) {
        return { ok: false, code: "malformed_response", message: "Total não comprovado." };
      }
      // `nextPageUrl` é informativa e vem sempre; a prova de fim é `nextPage` vazio.
      const proxima = meta["nextPage"];
      const temProxima =
        proxima != null &&
        !(typeof proxima === "string" && proxima.trim() === "");
      if (total !== lista.length || lista.length >= 100 || temProxima) {
        // Paginação incompleta: não é possível concluir que não existe oportunidade.
        return { ok: false, code: "malformed_response", message: "Listagem truncada." };
      }
      const mapeadas = lista.map(oportunidadeDaApi);
      if (mapeadas.some((o) => o === null)) {
        return { ok: false, code: "malformed_response", message: "Oportunidade sem campos." };
      }
      const validas = mapeadas as OportunidadeRemota[];
      const locaisDivergentes = lista.some((bruto) => {
        const l = texto((bruto as Record<string, unknown>)["locationId"]);
        return l !== null && l !== locationId;
      });
      if (locaisDivergentes) {
        return { ok: false, code: "malformed_response", message: "Oportunidade de outra location." };
      }
      if (new Set(validas.map((o) => o.id)).size !== validas.length) {
        return { ok: false, code: "malformed_response", message: "Identificadores repetidos." };
      }
      if (
        validas.some(
          (o) => o.contactId !== ghlContactId || !o.pipelineId || !o.stageId || !o.status,
        )
      ) {
        return { ok: false, code: "malformed_response", message: "Oportunidade sem dados reais." };
      }
      return { ok: true, data: validas };

    },
    async criarOportunidade({ locationId, pipelineId, stageId, ghlContactId, nome }) {
      const res = await ghlFetch<{ opportunity?: unknown }>(cfg, "opportunities/", {
        method: "POST",
        body: {
          locationId,
          pipelineId,
          pipelineStageId: stageId,
          contactId: ghlContactId,
          name: nome,
          status: "open",
        },
      });
      if (!res.ok) return falha(res);
      const oportunidade = oportunidadeDaApi(res.data?.opportunity);
      return oportunidade
        ? { ok: true, data: oportunidade }
        : { ok: false, code: "outcome_unknown", message: "Resposta sem oportunidade." };
    },
    concluir: rpc,
  };
}

type Consulta = {
  eq: (k: string, v: unknown) => Consulta;
  limit: (n: number) => PromiseLike<{ data: unknown; error: unknown }>;
};

export type AdminRemoto = {
  from: (t: string) => { select: (c: string) => Consulta };
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

const ID_REMOTO = /^[A-Za-z0-9_-]{1,128}$/;

/** Só é sucesso quando a base confirma o estado e os identificadores esperados. */
export function reciboRemotoValido(
  data: unknown,
  esperado: {
    submissionId: string;
    estado: "confirmado" | "bloqueado";
    ghlContactId: string | null;
    ghlOpportunityId: string | null;
  },
): boolean {
  if (!data || typeof data !== "object") return false;
  const r = data as Record<string, unknown>;
  if (r["submission_id"] !== esperado.submissionId) return false;
  if (r["remote_state"] !== esperado.estado) return false;
  if (r["persisted"] !== true) return false;
  if (esperado.estado === "confirmado") {
    const contacto = r["ghl_contact_id"];
    const oportunidade = r["ghl_opportunity_id"];
    if (typeof contacto !== "string" || !ID_REMOTO.test(contacto)) return false;
    if (typeof oportunidade !== "string" || !ID_REMOTO.test(oportunidade)) return false;
    if (esperado.ghlContactId && contacto !== esperado.ghlContactId) return false;
    if (esperado.ghlOpportunityId && oportunidade !== esperado.ghlOpportunityId) return false;
  }
  return true;
}

/** Destino já validado (organização, integração e location do binding). */
export type AcessoExecucao = { orgId: string; locationId: string; integrationId: string };

/** Constrói as dependências reais com persistência confirmada pela base. */
export function depsRemotoDe(
  admin: AdminRemoto,
  cfg: GhlConfig,
  criar: typeof criarDepsGhl = criarDepsGhl,
): DepsRemoto {
  return criar(cfg, async (p) => {
    const { data, error: erroRpc } = await admin.rpc("finish_site_lead_remote_v2", {
      _submission: p.submissionId,
      _state: p.estado,
      _reason: p.motivo,
      _ghl_contact: p.ghlContactId,
      _ghl_opportunity: p.oportunidade?.id ?? null,
      _opp_name: p.oportunidade?.name ?? null,
      _opp_pipeline: p.oportunidade?.pipelineId ?? null,
      _opp_stage: p.oportunidade?.stageId ?? null,
      _opp_status: p.oportunidade?.status ?? null,
    });
    if (erroRpc) return { ok: false };
    return {
      ok: reciboRemotoValido(data, {
        submissionId: p.submissionId,
        estado: p.estado,
        ghlContactId: p.ghlContactId,
        ghlOpportunityId: p.oportunidade?.id ?? null,
      }),
    };
  });
}

export function configGhl(token: string, locationId: string): GhlConfig {
  return { baseUrl: GHL_ORIGIN, version: GHL_VERSION, token, locationId };
}

/**
 * Executa exatamente um recibo. `null` significa "não reservado": a reserva
 * falhou, foi bloqueada pela base ou não corresponde ao destino esperado.
 */
export async function executarReciboRemoto(
  admin: AdminRemoto,
  acesso: AcessoExecucao,
  submissionId: string,
  depsGhl: DepsRemoto,
): Promise<DesfechoRemoto | null> {
  const reserva = await admin.rpc("claim_site_lead_remote_v2", {
    _submission: submissionId,
    _source: FALCAO_SOURCE_INTEGRACAO,
  });
  if (reserva.error || !reserva.data || typeof reserva.data !== "object") return null;
  const pedido = reserva.data as PedidoRemoto & { blocked?: boolean };
  if (
    pedido.blocked === true || pedido.submission_id !== submissionId ||
    pedido.organization_id !== acesso.orgId ||
    pedido.integration_id !== acesso.integrationId ||
    pedido.location_id !== acesso.locationId
  ) {
    return null;
  }
  return processarSubmissaoRemota(pedido, depsGhl);
}

/** Executa um lote pequeno. Recibos incertos ficam bloqueados para reconciliação. */
export async function processarLeadsRemoto(
  ctx: Ctx,
  deps?: { admin?: AdminRemoto; criarDeps?: typeof criarDepsGhl },
): Promise<{ ok: boolean; message: string; desfechos: DesfechoRemoto[] }> {
  const acesso = await resolverAcesso(ctx, ["administrador"]);
  if (!acesso.ok) return { ok: false, message: acesso.message, desfechos: [] };
  if (acesso.acesso.conn?.["write_enabled"] !== true) {
    return {
      ok: false,
      message: "A escrita no GoHighLevel está desativada nesta conta.",
      desfechos: [],
    };
  }
  const token = readGhlSecrets().token;
  if (!token) {
    return { ok: false, message: "Credenciais do GoHighLevel indisponíveis.", desfechos: [] };
  }

  const admin =
    deps?.admin ??
    ((await import("@/integrations/supabase/client.server"))
      .supabaseAdmin as unknown as AdminRemoto);

  // A fila é restrita à integração desta origem e a esta organização.
  const integracao = await admin
    .from("site_integrations")
    .select("id")
    .eq("organization_id", acesso.acesso.orgId)
    .eq("source", FALCAO_SOURCE_INTEGRACAO)
    .limit(1);
  const linhaIntegracao = (integracao.data as { id: string }[] | null)?.[0];
  if (integracao.error || !linhaIntegracao) {
    return { ok: false, message: "Integração do site não configurada.", desfechos: [] };
  }

  const { data: pendentes, error } = await admin
    .from("site_lead_submissions")
    .select("id")
    .eq("organization_id", acesso.acesso.orgId)
    .eq("integration_id", linhaIntegracao.id)
    .eq("remote_state", "pendente")
    .limit(LIMITE_LOTE);
  if (error) {
    return { ok: false, message: "Não foi possível ler os recibos pendentes.", desfechos: [] };
  }

  const alvo: AcessoExecucao = {
    orgId: acesso.acesso.orgId,
    locationId: acesso.acesso.locationId,
    integrationId: linhaIntegracao.id,
  };
  const depsGhl = depsRemotoDe(
    admin,
    configGhl(token, acesso.acesso.locationId),
    deps?.criarDeps ?? criarDepsGhl,
  );

  const desfechos: DesfechoRemoto[] = [];
  let ignorados = 0;
  for (const linha of (pendentes as { id: string }[] | null) ?? []) {
    const desfecho = await executarReciboRemoto(admin, alvo, linha.id, depsGhl);
    if (desfecho) desfechos.push(desfecho);
    else ignorados += 1;
  }


  const confirmados = desfechos.filter((d) => d.estado === "confirmado").length;
  const porReconciliar = desfechos.filter((d) => d.estado === "pendente_reconciliacao").length;
  return {
    ok: true,
    message: `Processados ${String(desfechos.length)} recibos: ${String(confirmados)} confirmados, ${String(desfechos.length - confirmados - porReconciliar)} bloqueados para revisão, ${String(porReconciliar)} por reconciliar, ${String(ignorados)} não reservados.`,
    desfechos,
  };
}
