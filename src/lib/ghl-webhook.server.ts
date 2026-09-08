/**
 * Adaptadores server-only do recetor de webhooks: Supabase (service role) e
 * API oficial do GoHighLevel. Nenhum valor de credencial sai daqui.
 */
import { ghlFetch } from "./ghl.server";
import type {
  Claim,
  ContactoGhl,
  ResultadoFetchContacto,
  WebhookStore,
} from "./ghl-webhook.core";

export const GHL_API_BASE_URL = "https://services.leadconnectorhq.com";
export const GHL_API_VERSION = "2021-07-28";
/** Location verificada e ligada à organização f07ab3be-7419-4779-a901-ef71c5fc27f0. */
export const GHL_LOCATION_ESPERADA = "ok2UHC2QMZsd8UHsAgEa";

const LOCK_TIMEOUT_MS = 2 * 60 * 1000;

type Admin = {
  from: (t: string) => any;
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
};

export function criarStore(admin: Admin): WebhookStore {
  return {
    async findOrganization(locationId) {
      const { data, error } = await admin
        .from("ghl_location_bindings")
        .select("organization_id")
        .eq("location_id", locationId)
        .maybeSingle();
      if (error) throw new Error(`binding: ${error.message}`);
      return (data?.organization_id as string | undefined) ?? null;
    },

    async claim(input): Promise<Claim> {
      const agora = new Date().toISOString();
      const { data, error } = await admin
        .from("webhooks_inbox")
        .insert({
          organization_id: input.organizationId,
          idempotency_key: input.idempotencyKey,
          event_type: input.eventType,
          event_id: input.eventId,
          location_id: input.locationId,
          source_version: input.sourceVersion,
          payload: input.payload,
          signature_valid: true,
          status: "a_processar",
          attempts: 1,
          locked_at: agora,
        })
        .select("id")
        .maybeSingle();

      if (!error && data?.id) return { outcome: "claimed", inboxId: data.id as string };
      if (error && error.code !== "23505") throw new Error(`inbox: ${error.message}`);

      const { data: existente, error: erroLeitura } = await admin
        .from("webhooks_inbox")
        .select("id, status, processed_at, attempts, locked_at")
        .eq("idempotency_key", input.idempotencyKey)
        .maybeSingle();
      if (erroLeitura) throw new Error(`inbox: ${erroLeitura.message}`);
      if (!existente) throw new Error("inbox: entrega não encontrada após conflito");
      if (existente.status === "processado" || existente.processed_at) return { outcome: "duplicate" };

      const expirado =
        !existente.locked_at || Date.now() - new Date(existente.locked_at as string).getTime() > LOCK_TIMEOUT_MS;
      if (existente.status === "a_processar" && !expirado) return { outcome: "in_flight" };

      const { data: reservada, error: erroClaim } = await admin
        .from("webhooks_inbox")
        .update({
          status: "a_processar",
          attempts: ((existente.attempts as number) ?? 0) + 1,
          locked_at: agora,
        })
        .eq("id", existente.id)
        .eq("status", existente.status)
        .is("processed_at", null)
        .select("id")
        .maybeSingle();
      if (erroClaim) throw new Error(`inbox: ${erroClaim.message}`);
      if (!reservada?.id) return { outcome: "in_flight" };
      return { outcome: "claimed", inboxId: reservada.id as string };
    },

    async applyContact(input) {
      const { data, error } = await admin.rpc("ghl_apply_contact_event", {
        _inbox_id: input.inboxId,
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
      const r = (data ?? {}) as { contact_id?: string; created?: boolean };
      if (!r.contact_id) throw new Error("sincronização de contacto sem resultado");
      return { contactId: r.contact_id, created: Boolean(r.created) };
    },

    async markFailed(inboxId, message) {
      await admin
        .from("webhooks_inbox")
        .update({ status: "falhado", error_message: message, locked_at: null, processed_at: null })
        .eq("id", inboxId);
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
