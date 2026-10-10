import { z } from "zod";
import type { Snapshot } from "./core";

export type InboxChannel = "SMS" | "IG" | "FB" | "WhatsApp";
/**
 * Rota explícita de transporte usada pela caixa de entrada (nunca o default implícito).
 * SMS: fornecedor (conversationProviderId) provado. IG/FB: integração nativa do canal da
 * mensagem recebida, sem conversationProviderId. WhatsApp: par número comercial ↔ contato
 * lido da mensagem recebida (a janela de 24h é por esse par).
 */
export type InboxRoute = {
  channel: InboxChannel;
  providerId: string | null;
  name: string;
  defaultId: string | null;
  fromNumber?: string;
  toNumber?: string;
};

const providerId = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
export const smsChannelsSchema = z.object({
  conversationChannel: z.object({
    defaults: z.object({ SMS: providerId.nullish() }).passthrough().nullish(),
    SMS: z
      .array(
        z
          .object({
            conversationProvider: z
              .object({ _id: providerId, name: z.string().max(200), type: z.string() })
              .passthrough(),
          })
          .passthrough(),
      )
      .default([]),
  }),
});
export type SmsChannels = { defaultId: string | null; providers: Map<string, string> };

export function parseSmsChannels(raw: unknown): SmsChannels | null {
  const p = smsChannelsSchema.safeParse(raw);
  if (!p.success) return null;
  const providers = new Map<string, string>();
  for (const s of p.data.conversationChannel.SMS) {
    if (s.conversationProvider.type !== "SMS") continue;
    if (providers.has(s.conversationProvider._id)) return null;
    providers.set(s.conversationProvider._id, s.conversationProvider.name);
  }
  return { defaultId: p.data.conversationChannel.defaults?.SMS ?? null, providers };
}

const PHONE = /^\+[1-9]\d{6,14}$/;
export const isInboxChannel = (c: string): c is InboxChannel =>
  c === "SMS" || c === "IG" || c === "FB" || c === "WhatsApp";

/**
 * Resolve a rota real a partir da mensagem recebida canónica. SMS exige fornecedor provado
 * (o da entrada, ou prova cruzada configuração = último envio = default). Qualquer dúvida bloqueia.
 * Nunca escolhe outro canal.
 */
export function resolveInboxRoute(
  snapshot: Snapshot,
  channels: SmsChannels | null,
  configuredProviderId: string | null,
): { ok: true; route: InboxRoute } | { ok: false; code: string } {
  const inbound = snapshot.messages.find(
    (m) => m.id === snapshot.event.messageId && m.direction === "inbound",
  );
  if (!inbound) return { ok: false, code: "inbound_not_verified" };
  if (inbound.channel === "IG" || inbound.channel === "FB")
    return {
      ok: true,
      route: {
        channel: inbound.channel,
        providerId: null,
        defaultId: null,
        name: inbound.channel === "IG" ? "Instagram (integração nativa)" : "Facebook Messenger (integração nativa)",
      },
    };
  if (inbound.channel === "WhatsApp") {
    // Entrada: from = contato, to = número comercial que recebeu (e que tem a janela aberta).
    const business = inbound.to ?? null;
    const contact = inbound.from ?? null;
    if (!business || !contact || !PHONE.test(business) || !PHONE.test(contact) || business === contact)
      return { ok: false, code: "whatsapp_sender_unverified" };
    return {
      ok: true,
      route: {
        channel: "WhatsApp",
        providerId: null,
        defaultId: null,
        fromNumber: business,
        toNumber: contact,
        name: `WhatsApp (número comercial final ${business.slice(-4)})`,
      },
    };
  }
  if (inbound.channel !== "SMS") return { ok: false, code: "unsupported_channel" };
  if (!channels) return { ok: false, code: "route_unverified" };
  const make = (id: string) => {
    const name = channels.providers.get(id);
    return name === undefined
      ? ({ ok: false, code: "route_unverified" } as const)
      : ({
          ok: true,
          route: { channel: "SMS", providerId: id, name, defaultId: channels.defaultId },
        } as const);
  };
  if (inbound.provider) return make(inbound.provider);
  if (!configuredProviderId) return { ok: false, code: "route_unverified" };
  const lastOutbound = [...snapshot.messages]
    .reverse()
    .find((m) => m.direction === "outbound" && m.provider);
  if (!lastOutbound || lastOutbound.provider !== configuredProviderId)
    return { ok: false, code: "route_unverified" };
  // Sem fornecedor na entrada, a resposta pode ter chegado pelo default: tem de coincidir.
  if (channels.defaultId !== configuredProviderId) return { ok: false, code: "route_ambiguous" };
  return make(configuredProviderId);
}

export const sameRoute = (a: InboxRoute, b: InboxRoute) =>
  a.channel === b.channel &&
  a.providerId === b.providerId &&
  a.defaultId === b.defaultId &&
  (a.fromNumber ?? null) === (b.fromNumber ?? null) &&
  (a.toNumber ?? null) === (b.toNumber ?? null);
