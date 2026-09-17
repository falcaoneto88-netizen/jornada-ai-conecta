/**
 * Ligação real ao GoHighLevel para os leads do site, limitada às submissões
 * desta integração. Usa o token privado já existente e a versão 2021-07-28.
 */
import { resolverAcesso } from "./ghl.functions";
import { FALCAO_SLUG } from "./falcao-lead.server";
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

function contactoDaApi(bruto: unknown): ContactoRemoto | null {
  if (!bruto || typeof bruto !== "object") return null;
  const c = bruto as Record<string, unknown>;
  if (typeof c["id"] !== "string") return null;
  return {
    id: c["id"],
    phoneNormalized: typeof c["phone"] === "string" ? c["phone"] : null,
    email: typeof c["email"] === "string" ? c["email"] : null,
    dnd: c["dnd"] === true,
  };
}

function oportunidadeDaApi(bruto: unknown): OportunidadeRemota | null {
  if (!bruto || typeof bruto !== "object") return null;
  const o = bruto as Record<string, unknown>;
  if (typeof o["id"] !== "string") return null;
  const funil = o["pipelineId"] ?? o["pipeline_id"];
  return {
    id: o["id"],
    pipelineId: typeof funil === "string" ? funil : null,
    status: typeof o["status"] === "string" ? o["status"] : null,
  };
}

function falha<T>(res: { code: string; message: string }): ResultadoRemotoApi<T> {
  return { ok: false, code: res.code, message: res.message };
}

export function criarDepsGhl(cfg: GhlConfig, rpc: DepsRemoto["concluir"]): DepsRemoto {
  return {
    async procurar({ locationId, termo }) {
      // Procura exata só é confirmada em memória; a API 2021-07-28 devolve aproximações.
      const res = await ghlFetch<{ contacts?: unknown[] }>(cfg, "contacts/", {
        query: { locationId, query: termo, limit: "20" },
      });
      if (!res.ok) return falha(res);
      const lista = Array.isArray(res.data?.contacts) ? res.data.contacts : [];
      return { ok: true, data: lista.map(contactoDaApi).filter((c): c is ContactoRemoto => !!c) };
    },
    async criarContacto(pedido: PedidoRemoto) {
      const res = await ghlFetch<{ contact?: unknown }>(cfg, "contacts/", {
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
      const contacto = contactoDaApi(res.data?.contact);
      return contacto
        ? { ok: true, data: contacto }
        : { ok: false, code: "outcome_unknown", message: "Resposta sem contacto." };
    },
    async oportunidades({ locationId, ghlContactId }) {
      const res = await ghlFetch<{ opportunities?: unknown[] }>(cfg, "opportunities/search", {
        query: { location_id: locationId, contact_id: ghlContactId, limit: "20" },
      });
      if (!res.ok) return falha(res);
      const lista = Array.isArray(res.data?.opportunities) ? res.data.opportunities : [];
      return {
        ok: true,
        data: lista.map(oportunidadeDaApi).filter((o): o is OportunidadeRemota => !!o),
      };
    },
    async criarOportunidade({ locationId, pipelineId, stageId, ghlContactId, nome }) {
      const res = await ghlFetch<{ opportunity?: { id?: string } }>(cfg, "opportunities/", {
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
      const id = res.data?.opportunity?.id;
      return typeof id === "string"
        ? { ok: true, data: { id } }
        : { ok: false, code: "outcome_unknown", message: "Resposta sem oportunidade." };
    },
    concluir: rpc,
  };
}

type Admin = {
  from: (t: string) => {
    select: (c: string) => {
      eq: (
        k: string,
        v: unknown,
      ) => {
        eq: (
          k: string,
          v: unknown,
        ) => { limit: (n: number) => PromiseLike<{ data: unknown; error: unknown }> };
      };
    };
  };
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

/** Executa um lote pequeno. Recibos incertos ficam bloqueados para reconciliação. */
export async function processarLeadsRemoto(
  ctx: Ctx,
  deps?: { admin?: Admin; criarDeps?: typeof criarDepsGhl },
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
    ((await import("@/integrations/supabase/client.server")).supabaseAdmin as unknown as Admin);

  const { data: pendentes, error } = await admin
    .from("site_lead_submissions")
    .select("id")
    .eq("organization_id", acesso.acesso.orgId)
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
    await admin.rpc("finish_site_lead_remote", {
      _submission: p.submissionId,
      _state: p.estado,
      _reason: p.motivo,
      _ghl_contact: p.ghlContactId,
      _ghl_opportunity: p.ghlOpportunityId,
    });
  });

  const desfechos: DesfechoRemoto[] = [];
  for (const linha of (pendentes as { id: string }[] | null) ?? []) {
    const reserva = await admin.rpc("claim_site_lead_remote", { _submission: linha.id });
    if (reserva.error || !reserva.data || typeof reserva.data !== "object") continue;
    desfechos.push(await processarSubmissaoRemota(reserva.data as PedidoRemoto, depsGhl));
  }

  const confirmados = desfechos.filter((d) => d.estado === "confirmado").length;
  return {
    ok: true,
    message: `Processados ${String(desfechos.length)} recibos: ${String(confirmados)} confirmados, ${String(desfechos.length - confirmados)} bloqueados para revisão.`,
    desfechos,
  };
}
