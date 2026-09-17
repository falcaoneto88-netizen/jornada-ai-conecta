/**
 * Ligação real ao GoHighLevel para os leads do site, limitada às submissões
 * desta integração. Usa o token privado já existente e a versão 2021-07-28.
 *
 * Identidade: apenas o duplicate check documentado
 * (GET contacts/search/duplicate com locationId + number OU email, em
 * chamadas separadas). Não há qualquer listagem ampla de contactos. Respostas
 * vazias, malformadas ou com erro nunca concluem "não existe": bloqueiam.
 */
import { resolverAcesso } from "./ghl.functions";
import { FALCAO_SLUG, FALCAO_SOURCE_INTEGRACAO } from "./falcao-lead.server";
import {
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

function texto(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/** Contacto estrito: sem id, location ou DND explícitos a resposta é malformada. */
export function contactoDaApi(bruto: unknown): ContactoRemoto | null {
  if (!bruto || typeof bruto !== "object") return null;
  const c = bruto as Record<string, unknown>;
  const id = texto(c["id"]);
  const location = texto(c["locationId"]);
  if (!id || !location || typeof c["dnd"] !== "boolean") return null;
  const settings = c["dndSettings"];
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return null;
  const entradas = Object.entries(settings as Record<string, unknown>);
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
    dnd: c["dnd"],
    canaisBloqueados: canais,
  };
}

export function oportunidadeDaApi(bruto: unknown): OportunidadeRemota | null {
  if (!bruto || typeof bruto !== "object") return null;
  const o = bruto as Record<string, unknown>;
  const id = texto(o["id"]);
  if (!id) return null;
  return {
    id,
    name: texto(o["name"]),
    pipelineId: texto(o["pipelineId"] ?? o["pipeline_id"]),
    stageId: texto(o["pipelineStageId"] ?? o["stageId"] ?? o["pipeline_stage_id"]),
    status: texto(o["status"]),
    contactId: texto(o["contactId"] ?? o["contact_id"]),
  };
}

function falha<T>(res: { code: string; message: string }): ResultadoRemotoApi<T> {
  return { ok: false, code: res.code, message: res.message };
}

export function criarDepsGhl(cfg: GhlConfig, rpc: DepsRemoto["concluir"]): DepsRemoto {
  return {
    async procurarExato({ locationId, campo, valor }) {
      const res = await ghlFetch<Record<string, unknown>>(cfg, "contacts/search/duplicate", {
        query: {
          locationId,
          ...(campo === "telefone" ? { number: valor } : { email: valor }),
        },
      });
      if (!res.ok) return falha(res);
      const corpo = res.data;
      if (!corpo || typeof corpo !== "object") {
        return { ok: false, code: "malformed_response", message: "Resposta inesperada." };
      }
       if (!("contact" in corpo) || corpo["contact"] == null) {
         // A documentação desta versão não define a forma de "sem duplicado".
         // Até existir prova contratual, nenhuma forma vazia autoriza criação.
         return { ok: false, code: "no_match_contract_unverified", message: "Ausência de duplicado não comprovada." };
       }
      const contacto = contactoDaApi(corpo["contact"]);
      return contacto
        ? { ok: true, data: contacto }
        : { ok: false, code: "malformed_response", message: "Contacto sem campos exigidos." };
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
      if (!meta || typeof meta !== "object" || Array.isArray(meta) || typeof meta["total"] !== "number") {
        return { ok: false, code: "malformed_response", message: "Paginação não comprovada." };
      }
      const total = meta["total"];
      if (
        total !== lista.length ||
        lista.length >= 100 ||
        texto(meta["nextPageUrl"]) ||
        texto(meta["nextPage"])
      ) {
        // Paginação incompleta: não é possível concluir que não existe oportunidade.
        return { ok: false, code: "malformed_response", message: "Listagem truncada." };
      }
      const mapeadas = lista.map(oportunidadeDaApi);
      if (mapeadas.some((o) => o === null)) {
        return { ok: false, code: "malformed_response", message: "Oportunidade sem campos." };
      }
      return { ok: true, data: mapeadas as OportunidadeRemota[] };
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

  const cfg: GhlConfig = {
    baseUrl: GHL_ORIGIN,
    version: GHL_VERSION,
    token,
    locationId: acesso.acesso.locationId,
  };
  const criar = deps?.criarDeps ?? criarDepsGhl;
  const depsGhl = criar(cfg, async (p) => {
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

  const desfechos: DesfechoRemoto[] = [];
  let ignorados = 0;
  for (const linha of (pendentes as { id: string }[] | null) ?? []) {
    const reserva = await admin.rpc("claim_site_lead_remote_v2", {
      _submission: linha.id,
      _source: FALCAO_SOURCE_INTEGRACAO,
    });
    if (reserva.error || !reserva.data || typeof reserva.data !== "object") {
      ignorados += 1;
      continue;
    }
    const pedido = reserva.data as PedidoRemoto & { blocked?: boolean };
    if (
      pedido.blocked === true || pedido.submission_id !== linha.id ||
      pedido.organization_id !== acesso.acesso.orgId ||
      pedido.integration_id !== linhaIntegracao.id ||
      pedido.location_id !== acesso.acesso.locationId
    ) {
      ignorados += 1;
      continue;
    }
    desfechos.push(await processarSubmissaoRemota(pedido, depsGhl));
  }

  const confirmados = desfechos.filter((d) => d.estado === "confirmado").length;
  const porReconciliar = desfechos.filter((d) => d.estado === "pendente_reconciliacao").length;
  return {
    ok: true,
    message: `Processados ${String(desfechos.length)} recibos: ${String(confirmados)} confirmados, ${String(desfechos.length - confirmados - porReconciliar)} bloqueados para revisão, ${String(porReconciliar)} por reconciliar, ${String(ignorados)} não reservados.`,
    desfechos,
  };
}
