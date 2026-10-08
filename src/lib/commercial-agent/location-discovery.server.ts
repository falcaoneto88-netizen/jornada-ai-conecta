import { z } from "zod";
import { GHL_ORIGIN, GHL_VERSION, ghlFetch, type GhlConfig, type GhlResult } from "../ghl.server";
import { AgentError, id, type Event } from "./core";
import type { DiscoveryGet } from "./discovery.server";

export type LocationDiscoveryInput = {
  locationId: string;
  contactId?: string;
  since: string;
  until: string;
};
export type LocationDiscoveryDependencies = {
  config: GhlConfig;
  call?: DiscoveryGet;
  now?: () => number;
};
export type DiscoveredLocationEvent = { event: Event; observedAt: string };

const PAGE_SIZE = 100;
const MAX_PAGES = 20;
const instant = z.iso.datetime({ offset: true });
// These schemas discard body, attachments, names, addresses and provider payloads.
const messageSchema = z.object({
  id,
  locationId: id,
  contactId: id.nullish(),
  conversationId: id.nullish(),
  dateAdded: z.union([z.string(), z.number()]),
  messageType: z.string().max(100).nullish(),
  type: z.union([z.string().max(100), z.number().int().nonnegative()]).optional(),
  direction: z.string().max(100).nullish(),
});
const pageSchema = z.object({
  messages: z.array(messageSchema).max(PAGE_SIZE),
  nextCursor: z
    .string()
    .max(16_384)
    .refine(
      (value) =>
        value === "" ||
        (value.trim() !== "" &&
          [...value].every((character) => {
            const code = character.charCodeAt(0);
            return code >= 32 && code !== 127;
          })),
    )
    .nullable(),
  total: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});

function timestamp(value: unknown): number | null {
  if (typeof value === "number")
    return Number.isSafeInteger(value) && value >= 0 && Number.isFinite(new Date(value).getTime())
      ? value
      : null;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !instant.safeParse(value).success
  )
    return null;
  const result = Date.parse(value);
  return Number.isFinite(result) && result >= 0 ? result : null;
}

function messageKind(message: z.infer<typeof messageSchema>): string {
  const raw = message.messageType ?? (typeof message.type === "string" ? message.type : null);
  // Numeric codes alone cannot safely distinguish an external message from a call.
  if (!raw || !/^[A-Za-z][A-Za-z0-9_]*$/.test(raw))
    throw new AgentError("discovery_history_invalid");
  const kind = raw.replace(/^TYPE_/i, "").toUpperCase();
  if (!kind) throw new AgentError("discovery_history_invalid");
  if (
    typeof message.type === "string" &&
    message.type.replace(/^TYPE_/i, "").toUpperCase() !== kind
  )
    throw new AgentError("discovery_history_invalid");
  return kind;
}

type SeenMessage = {
  at: number;
  metadata: string;
  result: DiscoveredLocationEvent | null;
};

/**
 * Canonical GET-only export, scoped by the server's location and an optional exact contact.
 * Omitted channel covers non-email messages; Email is a separate complete cursor stream.
 * No event escapes until both streams finish with consistent totals (20 x 100 each).
 * Only metadata is returned; the caller separately authorizes ingress/generation/sending.
 */
export async function discoverLocationEvents(
  input: LocationDiscoveryInput,
  dependencies: LocationDiscoveryDependencies,
): Promise<DiscoveredLocationEvent[]> {
  const now = (dependencies.now ?? Date.now)();
  const since = timestamp(input.since);
  const until = timestamp(input.until);
  if (
    typeof input.since !== "string" ||
    typeof input.until !== "string" ||
    since === null ||
    until === null ||
    !Number.isSafeInteger(now) ||
    now < 0 ||
    since > until ||
    until > now
  )
    throw new AgentError("discovery_window_invalid");
  if (
    !id.safeParse(input.locationId).success ||
    (input.contactId !== undefined && !id.safeParse(input.contactId).success) ||
    dependencies.config.locationId !== input.locationId
  )
    throw new AgentError("scope_mismatch");
  if (dependencies.config.baseUrl !== GHL_ORIGIN || dependencies.config.version !== GHL_VERSION)
    throw new AgentError("discovery_config_invalid");

  const call = dependencies.call ?? ghlFetch;
  const all = new Map<string, SeenMessage>();
  for (const channel of [undefined, "Email"] as const) {
    const streamIds = new Set<string>();
    const cursors = new Set<string>();
    let cursor: string | undefined;
    let expectedTotal: number | undefined;
    let complete = false;
    for (let page = 0; page < MAX_PAGES; page++) {
      let response: GhlResult<unknown>;
      try {
        response = await call(dependencies.config, "conversations/messages/export", {
          method: "GET",
          query: {
            locationId: input.locationId,
            startDate: new Date(since).toISOString(),
            endDate: new Date(until).toISOString(),
            sortBy: "createdAt",
            sortOrder: "asc",
            limit: String(PAGE_SIZE),
            ...(input.contactId !== undefined ? { contactId: input.contactId } : {}),
            ...(channel !== undefined ? { channel } : {}),
            ...(cursor !== undefined ? { cursor } : {}),
          },
        });
      } catch {
        throw new AgentError("ghl_read_failed");
      }
      if (!response || response.ok !== true)
        throw new AgentError(
          response?.code === "rate_limited" ? "ghl_rate_limited" : "ghl_read_failed",
        );
      const parsed = pageSchema.safeParse(response.data);
      if (!parsed.success) throw new AgentError("discovery_history_invalid");
      const data = parsed.data;
      expectedTotal ??= data.total;
      if (data.total !== expectedTotal || expectedTotal > MAX_PAGES * PAGE_SIZE)
        throw new AgentError("history_incomplete");
      const previousCount = streamIds.size;
      for (const message of data.messages) {
        if (message.locationId !== input.locationId) throw new AgentError("scope_mismatch");
        const at = timestamp(message.dateAdded);
        if (at === null || at > now) throw new AgentError("discovery_timestamp_invalid");
        const kind = messageKind(message);
        const ignored =
          /^ACTIVITY(?:_|$)|(?:^|_)(?:CALL|VOICEMAIL)(?:_|$)|^INTERNAL(?:_?COMMENT)?$/.test(kind);
        if (
          (input.contactId !== undefined &&
            message.contactId != null &&
            message.contactId !== input.contactId) ||
          (!ignored && input.contactId !== undefined && message.contactId !== input.contactId)
        )
          throw new AgentError("scope_mismatch");
        if (
          !ignored &&
          (!message.contactId ||
            !message.conversationId ||
            !["inbound", "outbound"].includes(message.direction ?? ""))
        )
          throw new AgentError("discovery_history_invalid");
        const metadata = JSON.stringify([
          message.locationId,
          message.contactId ?? null,
          message.conversationId ?? null,
          at,
          kind,
          typeof message.type === "number" ? message.type : null,
          message.direction ?? null,
        ]);
        const previous = all.get(message.id);
        if (previous && previous.metadata !== metadata)
          throw new AgentError("discovery_message_conflict");
        all.set(message.id, {
          at,
          metadata,
          result:
            ignored || at < since || at > until
              ? null
              : {
                  observedAt: new Date(at).toISOString(),
                  event: {
                    type: message.direction === "inbound" ? "InboundMessage" : "OutboundMessage",
                    locationId: message.locationId,
                    contactId: message.contactId!,
                    conversationId: message.conversationId!,
                    messageId: message.id,
                  },
                },
        });
        streamIds.add(message.id);
      }
      if (streamIds.size > expectedTotal) throw new AgentError("history_incomplete");
      if (data.nextCursor === null || data.nextCursor === "") {
        if (streamIds.size !== expectedTotal) throw new AgentError("history_incomplete");
        complete = true;
        break;
      }
      if (streamIds.size === previousCount || cursors.has(data.nextCursor))
        throw new AgentError("history_incomplete");
      cursors.add(data.nextCursor);
      cursor = data.nextCursor;
    }
    if (!complete) throw new AgentError("history_incomplete");
  }
  // Equal-time inbound/outbound remains deterministic; human pauses are sticky in ingress.
  return [...all.values()]
    .filter((message) => message.result !== null)
    .sort(
      (left, right) =>
        left.at - right.at ||
        left.result!.event.messageId.localeCompare(right.result!.event.messageId),
    )
    .map((message) => message.result!);
}
