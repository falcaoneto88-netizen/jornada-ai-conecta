/**
 * Envio do acolhimento pela ligação de mensagens já existente (tipo SMS da API
 * oficial, encaminhado pelo provedor predefinido da conta). Sem credencial nova.
 */
import {
  processarAcolhimento,
  type DepsAcolhimento,
  type DesfechoAcolhimento,
  type PedidoAcolhimento,
  type ResultadoApi,
} from "./falcao-welcome.core";
import { FALCAO_SOURCE_INTEGRACAO } from "./falcao-lead.server";
import { resolverAcesso } from "./ghl.functions";
import { GHL_ORIGIN, GHL_VERSION, ghlFetch, readGhlSecrets, type GhlConfig } from "./ghl.server";

type Ctx = Parameters<typeof resolverAcesso>[0];

const LIMITE_LOTE = 5;

type ContactoApi = {
  contact?: {
    id?: string;
    locationId?: string;
    phone?: string;
    email?: string;
    dnd?: boolean;
    dndSettings?: unknown;
  };
};

function falha<T>(res: { code: string; message: string }): ResultadoApi<T> {
  return { ok: false, code: res.code, message: res.message };
}

export function criarDepsAcolhimento(
  cfg: GhlConfig,
  concluir: DepsAcolhimento["concluir"],
): DepsAcolhimento {
  return {
    async estadoContacto(ghlContactId) {
      const res = await ghlFetch<ContactoApi>(cfg, `contacts/${encodeURIComponent(ghlContactId)}`);
      if (!res.ok) return falha(res);
      const c = res.data.contact;
      // Campo em falta nunca significa "permitido": a resposta é malformada.
      if (!c?.id || !c.locationId || typeof c.dnd !== "boolean") {
        return { ok: false, code: "malformed_response", message: "Contacto sem campos exigidos." };
      }
       if (!c.dndSettings || typeof c.dndSettings !== "object" || Array.isArray(c.dndSettings)) {
         return { ok: false, code: "malformed_response", message: "Estado de bloqueio desconhecido." };
       }
       const entradas = Object.entries(c.dndSettings as Record<string, unknown>);
       if (entradas.some(([, valor]) => {
         if (!valor || typeof valor !== "object" || Array.isArray(valor)) return true;
         const status = (valor as Record<string, unknown>)["status"];
         return status !== "active" && status !== "inactive";
       })) {
         return { ok: false, code: "malformed_response", message: "Estado de bloqueio desconhecido." };
       }
       const bloqueados = entradas
         .filter(([, valor]) => (valor as Record<string, unknown>)["status"] === "active")
        .map(([canal]) => canal);
      return {
        ok: true,
        data: {
          id: c.id,
          locationId: c.locationId,
          phone: typeof c.phone === "string" ? c.phone : null,
          email: typeof c.email === "string" ? c.email : null,
          dnd: c.dnd,
          canaisBloqueados: bloqueados,
        },
      };
    },
    async enviar({ ghlContactId, mensagem }) {
      const res = await ghlFetch<{ messageId?: string; msg?: string; status?: string }>(
        cfg,
        "conversations/messages",
        {
          method: "POST",
          // O provedor predefinido da conta (ZaptosWPP V2) substitui o SMS nativo.
          body: { type: "SMS", contactId: ghlContactId, message: mensagem },
        },
      );
      if (!res.ok) return falha(res);
      return {
        ok: true,
        data: {
          messageId: typeof res.data.messageId === "string" ? res.data.messageId : null,
          status: typeof res.data.status === "string" ? res.data.status : null,
        },
      };
    },
    concluir,
  };
}

type Consulta = {
  eq: (k: string, v: unknown) => Consulta;
  limit: (n: number) => PromiseLike<{ data: unknown; error: unknown }>;
};

export type AdminAcolhimento = {
  from: (t: string) => { select: (c: string) => Consulta };
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

/** Só é sucesso quando a base confirma o estado e o identificador da mensagem. */
export function reciboAcolhimentoValido(
  data: unknown,
  esperado: { submissionId: string; estado: "enviado" | "bloqueado"; messageId: string | null },
): boolean {
  if (!data || typeof data !== "object") return false;
  const r = data as Record<string, unknown>;
  if (r["submission_id"] !== esperado.submissionId) return false;
  if (r["welcome_state"] !== esperado.estado) return false;
  if (r["persisted"] !== true) return false;
  if (r["delivered"] !== false) return false;
  if (esperado.estado === "enviado" && r["welcome_message_id"] !== esperado.messageId) return false;
  return true;
}

/** Destino já validado (organização, integração e location do binding). */
export type AcessoAcolhimento = { orgId: string; locationId: string; integrationId: string };

export function depsAcolhimentoDe(
  admin: AdminAcolhimento,
  cfg: GhlConfig,
  criar: typeof criarDepsAcolhimento = criarDepsAcolhimento,
): DepsAcolhimento {
  return criar(cfg, async (p) => {
    const { data, error: erroRpc } = await admin.rpc("finish_site_lead_welcome_v2", {
      _submission: p.submissionId,
      _state: p.estado,
      _reason: p.motivo,
      _message_id: p.messageId,
    });
    if (erroRpc) return { ok: false };
    return { ok: reciboAcolhimentoValido(data, p) };
  });
}

/** Uma única tentativa para um recibo. `null` = não reservado. */
export async function executarReciboAcolhimento(
  admin: AdminAcolhimento,
  acesso: AcessoAcolhimento,
  submissionId: string,
  depsGhl: DepsAcolhimento,
): Promise<DesfechoAcolhimento | null> {
  const reserva = await admin.rpc("claim_site_lead_welcome_v2", {
    _submission: submissionId,
    _source: FALCAO_SOURCE_INTEGRACAO,
  });
  if (reserva.error || !reserva.data || typeof reserva.data !== "object") return null;
  const pedido = reserva.data as PedidoAcolhimento & { blocked?: boolean };
  if (
    pedido.blocked === true || pedido.submission_id !== submissionId ||
    pedido.organization_id !== acesso.orgId ||
    pedido.integration_id !== acesso.integrationId ||
    pedido.location_id !== acesso.locationId
  ) {
    return null;
  }
  return processarAcolhimento(pedido, depsGhl);
}

export function configAcolhimento(token: string, locationId: string): GhlConfig {
  return { baseUrl: GHL_ORIGIN, version: GHL_VERSION, token, locationId };
}

/** Lote pequeno; cada recibo tem no máximo uma tentativa, sem repetições. */
export async function enviarAcolhimentosFalcao(
  ctx: Ctx,
  deps?: { admin?: AdminAcolhimento; criarDeps?: typeof criarDepsAcolhimento },
): Promise<{ ok: boolean; message: string; desfechos: DesfechoAcolhimento[] }> {
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
      .supabaseAdmin as unknown as AdminAcolhimento);

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
    .eq("remote_state", "confirmado")
    .eq("welcome_state", "pendente")
    .limit(LIMITE_LOTE);
  if (error) {
    return { ok: false, message: "Não foi possível ler os recibos pendentes.", desfechos: [] };
  }

  const alvo: AcessoAcolhimento = {
    orgId: acesso.acesso.orgId,
    locationId: acesso.acesso.locationId,
    integrationId: linhaIntegracao.id,
  };
  const depsGhl = depsAcolhimentoDe(
    admin,
    configAcolhimento(token, acesso.acesso.locationId),
    deps?.criarDeps ?? criarDepsAcolhimento,
  );

  const desfechos: DesfechoAcolhimento[] = [];
  let ignorados = 0;
  for (const linha of (pendentes as { id: string }[] | null) ?? []) {
    const desfecho = await executarReciboAcolhimento(admin, alvo, linha.id, depsGhl);
    if (desfecho) desfechos.push(desfecho);
    else ignorados += 1;
  }


  const aceites = desfechos.filter((d) => d.estado === "enviado").length;
  const porReconciliar = desfechos.filter((d) => d.estado === "pendente_reconciliacao").length;
  return {
    ok: true,
    message: `Tentativas: ${String(desfechos.length)}. Aceites pela API: ${String(aceites)} (aceitação não é entrega). Bloqueadas: ${String(desfechos.length - aceites - porReconciliar)}. Por reconciliar: ${String(porReconciliar)}. Não reservadas: ${String(ignorados)}.`,
    desfechos,
  };
}
