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
import { resolverAcesso } from "./ghl.functions";
import { GHL_ORIGIN, GHL_VERSION, ghlFetch, readGhlSecrets, type GhlConfig } from "./ghl.server";

type Ctx = Parameters<typeof resolverAcesso>[0];

const LIMITE_LOTE = 5;

type ContactoApi = {
  contact?: {
    id?: string;
    dnd?: boolean;
    dndSettings?: Record<string, { status?: string }>;
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
      if (!c?.id) return { ok: false, code: "not_found", message: "Contacto não encontrado." };
      const bloqueados = Object.entries(c.dndSettings ?? {})
        .filter(([, v]) => (v?.status ?? "").toLowerCase() === "active")
        .map(([canal]) => canal);
      return { ok: true, data: { id: c.id, dnd: c.dnd === true, canaisBloqueados: bloqueados } };
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
        ) => {
          eq: (
            k: string,
            v: unknown,
          ) => { limit: (n: number) => PromiseLike<{ data: unknown; error: unknown }> };
        };
      };
    };
  };
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

/** Lote pequeno; cada recibo tem no máximo uma tentativa, sem repetições. */
export async function enviarAcolhimentosFalcao(
  ctx: Ctx,
  deps?: { admin?: Admin; criarDeps?: typeof criarDepsAcolhimento },
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
    ((await import("@/integrations/supabase/client.server")).supabaseAdmin as unknown as Admin);

  const { data: pendentes, error } = await admin
    .from("site_lead_submissions")
    .select("id")
    .eq("organization_id", acesso.acesso.orgId)
    .eq("remote_state", "confirmado")
    .eq("welcome_state", "pendente")
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
  const depsGhl = (deps?.criarDeps ?? criarDepsAcolhimento)(cfg, async (p) => {
    await admin.rpc("finish_site_lead_welcome", {
      _submission: p.submissionId,
      _state: p.estado,
      _reason: p.motivo,
      _message_id: p.messageId,
    });
  });

  const desfechos: DesfechoAcolhimento[] = [];
  for (const linha of (pendentes as { id: string }[] | null) ?? []) {
    const reserva = await admin.rpc("claim_site_lead_welcome", { _submission: linha.id });
    if (reserva.error || !reserva.data || typeof reserva.data !== "object") continue;
    desfechos.push(await processarAcolhimento(reserva.data as PedidoAcolhimento, depsGhl));
  }

  const aceites = desfechos.filter((d) => d.estado === "enviado").length;
  return {
    ok: true,
    message: `Tentativas: ${String(desfechos.length)}. Aceites pela API: ${String(aceites)} (aceitação não é entrega). Bloqueadas: ${String(desfechos.length - aceites)}.`,
    desfechos,
  };
}
