import { z } from "zod";
import { confirmarConversa, normalizarMensagens } from "../ghl-observation.core";
import { GHL_ORIGIN, GHL_VERSION, ghlFetch, type GhlConfig, type GhlResult } from "../ghl.server";
import { AgentError, id, type Event } from "./core";

export type DiscoveryGet = (
  config: GhlConfig,
  path: string,
  init: { method: "GET"; query?: Record<string, string | undefined> },
) => Promise<GhlResult<unknown>>;

export type DiscoveryInput = { locationId: string; contactId: string; since: string };
export type DiscoveryDependencies = {
  config: GhlConfig;
  call?: DiscoveryGet;
  now?: () => number;
};

const scopeSchema = z.object({ id, locationId: id, contactId: id });
const searchSchema = z.object({
  conversations: z.array(scopeSchema).max(2),
  total: z.number().int().nonnegative(),
});
// Strip message bodies and all other payload fields before normalization or retention.
const messageSchema = scopeSchema.extend({
  conversationId: id,
  dateAdded: z.union([z.string(), z.number()]),
  messageType: z.string().nullish(),
  type: z.union([z.string(), z.number()]).optional(),
  direction: z.string().optional(),
});
const pageSchema = z.object({
  messages: z.object({
    messages: z.array(messageSchema).max(50),
    nextPage: z.boolean(),
    lastMessageId: id.nullish(),
  }),
});
const isoDate = z.iso.datetime({ offset: true });
const externalTypes = new Set([
  "SMS",
  "CUSTOM_SMS",
  "EMAIL",
  "SMS_REVIEW_REQUEST",
  "SMS_NO_SHOW_REQUEST",
  "CAMPAIGN_SMS",
  "CAMPAIGN_EMAIL",
  "FACEBOOK",
  "CAMPAIGN_FACEBOOK",
  "INSTAGRAM",
  "WHATSAPP",
  "WEBCHAT",
  "LIVE_CHAT",
  "GMB",
  "CUSTOM",
  "FB",
  "IG",
]);

function timestamp(value: unknown): number | null {
  // ISO with an explicit time zone, or an API Unix timestamp in milliseconds.
  if (typeof value === "number")
    return Number.isSafeInteger(value) && value >= 0 && Number.isFinite(new Date(value).getTime())
      ? value
      : null;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !isoDate.safeParse(value).success
  )
    return null;
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : null;
}

/**
 * Read-only discovery. The caller authorizes this exact contact and supplies the pilot
 * start; webhook text and purported message/conversation IDs never enter this API.
 * A complete history (at most 20 pages of 50) is required before returning any event.
 * Repeated discovery deliberately returns the same IDs for store.ingress to deduplicate.
 */
export async function discoverContactEvents(
  input: DiscoveryInput,
  dependencies: DiscoveryDependencies,
): Promise<Event[]> {
  const now = (dependencies.now ?? Date.now)();
  const since = timestamp(input.since);
  if (typeof input.since !== "string" || since === null || !Number.isFinite(now) || since > now)
    throw new AgentError("discovery_since_invalid");
  if (
    !id.safeParse(input.locationId).success ||
    !id.safeParse(input.contactId).success ||
    dependencies.config.locationId !== input.locationId
  )
    throw new AgentError("scope_mismatch");
  if (dependencies.config.baseUrl !== GHL_ORIGIN || dependencies.config.version !== GHL_VERSION)
    throw new AgentError("discovery_config_invalid");

  const call = dependencies.call ?? ghlFetch;
  const get = async (path: string, query?: Record<string, string | undefined>) => {
    let result: GhlResult<unknown>;
    try {
      result = await call(dependencies.config, path, {
        method: "GET",
        ...(query ? { query } : {}),
      });
    } catch {
      throw new AgentError("ghl_read_failed");
    }
    if (!result.ok)
      throw new AgentError(result.code === "rate_limited" ? "ghl_rate_limited" : "ghl_read_failed");
    return result.data;
  };

  const contact = z
    .object({ contact: z.object({ id, locationId: id }) })
    .safeParse(await get(`contacts/${input.contactId}`));
  if (!contact.success) throw new AgentError("discovery_contact_invalid");
  if (
    contact.data.contact.id !== input.contactId ||
    contact.data.contact.locationId !== input.locationId
  )
    throw new AgentError("scope_mismatch");

  const search = searchSchema.safeParse(
    await get("conversations/search", {
      locationId: input.locationId,
      contactId: input.contactId,
      limit: "2",
    }),
  );
  if (!search.success) throw new AgentError("discovery_conversations_ambiguous");
  if (
    search.data.conversations.some(
      (c) => c.locationId !== input.locationId || c.contactId !== input.contactId,
    )
  )
    throw new AgentError("scope_mismatch");
  if (search.data.total !== search.data.conversations.length || search.data.total > 1)
    throw new AgentError("discovery_conversations_ambiguous");
  const found = search.data.conversations[0];
  if (!found) return [];

  const rawConversation = await get(`conversations/${found.id}`);
  try {
    if (
      confirmarConversa(rawConversation, input.locationId, found.id).contactId !== input.contactId
    )
      throw new Error();
  } catch {
    throw new AgentError("scope_mismatch");
  }

  const scope = {
    locationId: input.locationId,
    contactId: input.contactId,
    conversationId: found.id,
  };
  const all = new Map<
    string,
    { at: number; direction: string; kind: string; event: Event | null }
  >();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const parsed = pageSchema.safeParse(
      await get(`conversations/${found.id}/messages`, {
        limit: "50",
        lastMessageId: cursor,
      }),
    );
    if (!parsed.success) throw new AgentError("discovery_history_invalid");
    const raw = parsed.data.messages;
    if (
      raw.messages.some(
        (m) =>
          m.locationId !== scope.locationId ||
          m.contactId !== scope.contactId ||
          m.conversationId !== scope.conversationId,
      )
    )
      throw new AgentError("scope_mismatch");
    const normalized = normalizarMensagens(parsed.data, scope, cursor);
    if (
      normalized.limitePaginacao ||
      (raw.nextPage &&
        (!raw.messages.length || !raw.messages.some((m) => m.id === raw.lastMessageId)))
    )
      throw new AgentError("history_incomplete");

    // Validate each original metadata row before the shared normalizer's ID deduplication.
    for (const message of raw.messages) {
      const at = timestamp(message.dateAdded);
      if (at === null || at > now) throw new AgentError("discovery_timestamp_invalid");
      const kind = (message.messageType ?? String(message.type ?? ""))
        .replace(/^TYPE_/i, "")
        .toUpperCase();
      const ignored = /ACTIVITY|CALL|VOICEMAIL|INTERNAL/.test(kind);
      const direction = message.direction ?? "";
      if (!ignored && (!externalTypes.has(kind) || !["inbound", "outbound"].includes(direction)))
        throw new AgentError("discovery_history_invalid");
      const previous = all.get(message.id);
      if (
        previous &&
        (previous.at !== at || previous.direction !== direction || previous.kind !== kind)
      )
        throw new AgentError("discovery_message_conflict");
      all.set(message.id, {
        at,
        direction,
        kind,
        event:
          ignored || at < since
            ? null
            : {
                ...scope,
                messageId: message.id,
                type: direction === "inbound" ? "InboundMessage" : "OutboundMessage",
              },
      });
    }
    if (!normalized.proximoCursor) {
      const events = [...all.values()]
        .filter((m) => m.event)
        .sort((a, b) => a.at - b.at || a.event!.messageId.localeCompare(b.event!.messageId));
      // An ID tie-breaker cannot establish whether a human reply preceded a patient reply.
      for (let i = 1; i < events.length; i++)
        if (
          events[i]!.at === events[i - 1]!.at &&
          events[i]!.direction !== events[i - 1]!.direction
        )
          throw new AgentError("discovery_order_ambiguous");
      return events.map((m) => m.event!);
    }
    if (cursors.has(normalized.proximoCursor)) throw new AgentError("history_incomplete");
    cursors.add(normalized.proximoCursor);
    cursor = normalized.proximoCursor;
  }
  throw new AgentError("history_incomplete");
}
