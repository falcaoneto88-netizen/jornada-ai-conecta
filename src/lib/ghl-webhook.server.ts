/**
 * Adaptadores server-only do recetor de webhooks: Supabase (service role) e
 * API oficial do GoHighLevel. Nenhum valor de credencial sai daqui.
 */
import { ghlFetch } from "./ghl.server";
import type {
  Claim,
  ContactoGhl,
  ResultadoApply,
  ResultadoFetchContacto,
  WebhookStore,
} from "./ghl-webhook.core";

export const GHL_API_BASE_URL = "https://services.leadconnectorhq.com";
export const GHL_API_VERSION = "2021-07-28";
/** Location verificada e ligada à organização f07ab3be-7419-4779-a901-ef71c5fc27f0. */
export const GHL_LOCATION_ESPERADA = "ok2UHC2QMZsd8UHsAgEa";

const LOCK_TIMEOUT_SEGUNDOS = 120;

type RpcResultado = { data: unknown; error: { message: string } | null };

/** Interface mínima do cliente service-role (permite testar contra Postgres real). */
export type ClienteRpc = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<RpcResultado>;
  from: (tabela: string) => {
    select: (colunas: string) => {
      eq: (
        coluna: string,
        valor: string,
      ) => { maybeSingle: () => PromiseLike<{ data: Record<string, unknown> | null; error: { message: string } | null }> };
    };
  };
};

function objeto(data: unknown): Record<string, unknown> {
  return data && typeof data === "object" ? (data as Record<string, unknown>) : {};
}

export function criarStore(admin: ClienteRpc): WebhookStore {
  return {
    async findOrganization(locationId) {
      const { data, error } = await admin
        .from("ghl_location_bindings")
        .select("organization_id")
        .eq("location_id", locationId)
        .maybeSingle();
      if (error) throw new Error(`binding: ${error.message}`);
      const org = data?.["organization_id"];
      return typeof org === "string" ? org : null;
    },

    async claim(input): Promise<Claim> {
      const { data, error } = await admin.rpc("ghl_claim_delivery", {
        _org: input.organizationId,
        _location: input.locationId,
        _key: input.idempotencyKey,
        _event_type: input.eventType,
        _event_id: input.eventId,
        _source_version: input.sourceVersion,
        _payload: input.payload,
        _ghl_contact_id: input.ghlContactId,
        _content_fallback: input.contentFallback,
        _lock_timeout_seconds: LOCK_TIMEOUT_SEGUNDOS,
      });
      if (error) throw new Error(`claim: ${error.message}`);
      const r = objeto(data);
      const outcome = r["outcome"];
      if (outcome === "claimed") {
        return {
          outcome: "claimed",
          inboxId: String(r["inbox_id"]),
          fence: Number(r["fence"]),
        };
      }
      if (outcome === "duplicate" || outcome === "in_flight" || outcome === "mismatch") {
        return { outcome };
      }
      throw new Error("claim: resposta inesperada");
    },

    async applyContact(input): Promise<ResultadoApply> {
      const { data, error } = await admin.rpc("ghl_apply_contact_event_v2", {
        _inbox_id: input.inboxId,
        _fence: input.fence,
        _org: input.organizationId,
        _ghl_contact_id: input.contacto.ghlContactId,
        _full_name: input.contacto.fullName,
        _phone: input.contacto.phone,
        _phone_normalized: input.contacto.phoneNormalized,
        _email: input.contacto.email,
        _tags: input.contacto.tags,
        _source: input.contacto.source,
        _last_interaction: input.contacto.lastInteractionAt,
        _event_type: input.eventType,
        _source_version: input.sourceVersion,
      });
      if (error) throw new Error(error.message);
      const r = objeto(data);
      const estado = String(r["estado"] ?? "");
      const contactId = typeof r["contact_id"] === "string" ? r["contact_id"] : null;
      if (estado === "processado" || estado === "ja_processado" || estado === "versao_antiga_ignorada") {
        return { estado, contactId, created: Boolean(r["created"]) };
      }
      if (estado === "reserva_expirada" || estado === "organizacao_divergente" || estado === "entrega_inexistente") {
        return { estado };
      }
      throw new Error("sincronização de contacto sem resultado");
    },

    async markFailed(input) {
      const { data, error } = await admin.rpc("ghl_mark_delivery_failed", {
        _inbox_id: input.inboxId,
        _fence: input.fence,
        _org: input.organizationId,
        _message: input.message,
      });
      if (error) throw new Error(`falha ao registar erro: ${error.message}`);
      return Boolean(data);
    },

    async recordFailedReceive(input) {
      const { error } = await admin.rpc("ghl_record_failed_receive", {
        _org: input.organizationId,
        _location: input.locationId,
        _key: input.idempotencyKey,
        _event_type: input.eventType,
        _event_id: input.eventId,
        _payload: input.payload,
        _message: input.message,
      });
      if (error) throw new Error(`falha ao registar erro: ${error.message}`);
    },
  };
}

/** Lê o contacto real na API oficial do GoHighLevel. */
export async function buscarContactoGhl(
  contactId: string,
  token: string,
): Promise<ResultadoFetchContacto> {
  const res = await ghlFetch<{ contact?: ContactoGhl }>(
    { baseUrl: GHL_API_BASE_URL, version: GHL_API_VERSION, token, locationId: GHL_LOCATION_ESPERADA },
    `contacts/${encodeURIComponent(contactId)}`,
  );
  if (!res.ok) return { ok: false, status: res.status, message: res.message };
  const contact = res.data?.contact;
  if (!contact?.id) return { ok: false, status: 404, message: "Contacto não encontrado no GoHighLevel." };
  return { ok: true, contact };
}
