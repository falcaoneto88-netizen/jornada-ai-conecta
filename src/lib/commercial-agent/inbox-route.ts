import { z } from "zod";
import type { Snapshot } from "./core";

/** Rota explícita de transporte usada pela caixa de entrada (nunca o default implícito). */
export type InboxRoute = { providerId: string; name: string; defaultId: string | null };

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

/**
 * Resolve o fornecedor real: o da mensagem recebida, ou — quando o GHL não o indica —
 * apenas com prova cruzada (configuração verificada da clínica = último envio real
 * desta conversa = default atual = fornecedor listado). Qualquer dúvida bloqueia.
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
  if (inbound.channel !== "SMS") return { ok: false, code: "unsupported_channel" };
  if (!channels) return { ok: false, code: "route_unverified" };
  const make = (id: string) => {
    const name = channels.providers.get(id);
    return name === undefined
      ? ({ ok: false, code: "route_unverified" } as const)
      : ({ ok: true, route: { providerId: id, name, defaultId: channels.defaultId } } as const);
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
  a.providerId === b.providerId && a.defaultId === b.defaultId;
