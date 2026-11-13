import { z } from "zod";
import { AgentError, decisionSchema, eventSchema, type DraftPayload, type Settings } from "./core";
import { POLICY_HASH, replyHash, unseal } from "./providers.server";
import {
  queueCategorySchema,
  type AgentQueuePage,
  type ManualQueuePage,
  type ManualQueueRequest,
  type QueuePageRequest,
} from "./queue-read";

export interface QueueReadClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}
export type QueueReadScope = { organizationId: string; locationId: string; actorId: string };
const count = z.number().int().nonnegative();
const settingsSchema = z.object({
  organization_id: z.string(),
  location_id: z.string(),
  mode: z.enum(["off", "supervised"]),
  allowed_contacts: z.array(z.string()),
  allowed_channels: z.array(z.string()),
  receive_all_contacts: z.boolean().optional(),
  receive_since: z.string().nullable().optional(),
  receive_cursor_until: z.string().nullable().optional(),
  manual_send_all_contacts: z.boolean().optional(),
});
const rawDraftSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string(),
  location_id: z.string(),
  event_id: z.string(),
  contact_id: z.string(),
  conversation_id: z.string(),
  message_id: z.string(),
  state: z.string(),
  version: count,
  contact_version: count,
  payload: z.string(),
  reply_hash: z.string(),
  expires_at: z.string(),
  created_at: z.string(),
  result_message_id: z.string().nullable(),
  approved_at: z.string().nullable(),
  error_code: z.string().nullable(),
  paused: z.boolean(),
  opt_out: z.boolean(),
  session_version: count,
  policy_hash: z.string(),
  contact_name: z.string().nullable(),
  category: queueCategorySchema,
});
const baseSchema = z.object({ settings: settingsSchema, asOf: z.string() });
const queueResultSchema = baseSchema.extend({
  items: z.array(rawDraftSchema).max(50),
  counts: z.object({ review: count, team: count, uncertain: count, history: count }),
  errors: z
    .array(
      z.object({
        id: z.string(),
        state: z.literal("failed"),
        error_code: z.string(),
        attempts: count,
        created_at: z.string(),
      }),
    )
    .max(20),
  failedEventCount: count,
  ignoredEventCount: count,
});
const manualResultSchema = baseSchema.extend({
  total: count,
  items: z
    .array(
      z.object({
        locationId: z.string(),
        contactId: z.string(),
        conversationId: z.string(),
        sessionVersion: count,
        paused: z.boolean(),
        optOut: z.boolean(),
        lastMessageAt: z.string().nullable(),
        contactName: z.string().nullable(),
        channel: z.string().nullable(),
      }),
    )
    .max(50),
});

async function readProjection(
  client: QueueReadClient,
  scope: QueueReadScope,
  input: ManualQueueRequest,
  kind: "drafts" | "manual",
  category = "review",
) {
  const response = await client.rpc("commercial_agent_queue_read", {
    _org: scope.organizationId,
    _location: scope.locationId,
    _actor: scope.actorId,
    _kind: kind,
    _category: category,
    _query: input.query,
    _page: input.page,
    _page_size: input.pageSize,
    _as_of: input.asOf ?? null,
    _policy_hash: POLICY_HASH,
  });
  if (response.error) {
    const code = (response.error as { code?: string }).code;
    throw new AgentError(
      code === "PGRST202" || code === "42883" ? "queue_read_unavailable" : "storage_unavailable",
    );
  }
  const error = (response.data as { error?: unknown } | null)?.error;
  if (typeof error === "string")
    throw new AgentError(/^[a-z_]{1,60}$/.test(error) ? error : "storage_unavailable");
  return response.data;
}
function checkScope(settings: z.infer<typeof settingsSchema>, scope: QueueReadScope) {
  if (
    settings.organization_id !== scope.organizationId ||
    settings.location_id !== scope.locationId
  )
    throw new AgentError("scope_mismatch");
}
function pagination(total: number, page: number, pageSize: number) {
  return {
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    hasMore: page * pageSize < total,
  };
}

/** A bounded read. Filters/counts/pagination run in SQL before any ciphertext reaches Node. */
export async function readAgentQueuePage(
  client: QueueReadClient,
  scope: QueueReadScope,
  input: QueuePageRequest,
  config: { encryptionKey: string; enabled: boolean; sendEnabled: boolean },
): Promise<AgentQueuePage> {
  let pageInput = input;
  let parsed = queueResultSchema.safeParse(
    await readProjection(client, scope, input, "drafts", input.category),
  );
  if (!parsed.success) throw new AgentError("storage_unavailable");
  checkScope(parsed.data.settings, scope);
  // Categories remain live (expiry, human actions, receipts). If a later page
  // disappears, restart once at page 1 instead of trapping the user on an empty page.
  if (input.page > Math.max(1, Math.ceil(parsed.data.counts[input.category] / input.pageSize))) {
    pageInput = { ...input, page: 1, asOf: parsed.data.asOf };
    parsed = queueResultSchema.safeParse(
      await readProjection(client, scope, pageInput, "drafts", input.category),
    );
    if (!parsed.success) throw new AgentError("storage_unavailable");
  }
  const result = parsed.data;
  checkScope(result.settings, scope);
  const items = result.items.map((row) => {
    if (
      row.organization_id !== scope.organizationId ||
      row.location_id !== scope.locationId ||
      row.category !== input.category
    )
      throw new AgentError("scope_mismatch");
    const { payload, policy_hash, contact_name, ...safeRow } = row;
    const content = payload
      ? unseal<DraftPayload>(
          payload,
          config.encryptionKey,
          `${scope.organizationId}:${row.event_id}`,
        )
      : null;
    if (content) {
      const event = eventSchema.safeParse(content.snapshot?.event);
      if (
        !event.success ||
        !decisionSchema.safeParse(content.decision).success ||
        !Array.isArray(content.snapshot.messages) ||
        event.data.type !== "InboundMessage" ||
        event.data.locationId !== row.location_id ||
        event.data.contactId !== row.contact_id ||
        event.data.conversationId !== row.conversation_id ||
        event.data.messageId !== row.message_id ||
        content.policyHash !== policy_hash ||
        replyHash(content) !== row.reply_hash
      )
        throw new AgentError("scope_mismatch");
    }
    const inbound = content?.snapshot.messages.find(
      (message) => message.id === row.message_id && message.direction === "inbound",
    );
    return {
      ...safeRow,
      content,
      contactName: contact_name,
      channel: typeof inbound?.channel === "string" ? inbound.channel : null,
      policyCurrent: content?.policyHash === POLICY_HASH,
    };
  });
  return {
    settings: result.settings as Settings,
    enabled: config.enabled,
    sendEnabled: config.sendEnabled,
    items,
    errors: result.errors,
    counts: result.counts,
    failedEventCount: result.failedEventCount,
    ignoredEventCount: result.ignoredEventCount,
    pagination: {
      ...pageInput,
      asOf: result.asOf,
      ...pagination(result.counts[input.category], pageInput.page, input.pageSize),
    },
  };
}

/** Canonical contact names come from scoped contacts, never retained encrypted draft payloads. */
export async function readManualQueuePage(
  client: QueueReadClient,
  scope: QueueReadScope,
  input: ManualQueueRequest,
): Promise<ManualQueuePage> {
  let pageInput = input;
  let parsed = manualResultSchema.safeParse(await readProjection(client, scope, input, "manual"));
  if (!parsed.success) throw new AgentError("storage_unavailable");
  checkScope(parsed.data.settings, scope);
  if (input.page > Math.max(1, Math.ceil(parsed.data.total / input.pageSize))) {
    pageInput = { ...input, page: 1, asOf: parsed.data.asOf };
    parsed = manualResultSchema.safeParse(await readProjection(client, scope, pageInput, "manual"));
    if (!parsed.success) throw new AgentError("storage_unavailable");
  }
  const result = parsed.data;
  checkScope(result.settings, scope);
  if (result.items.some((item) => item.locationId !== scope.locationId))
    throw new AgentError("scope_mismatch");
  return {
    ...pageInput,
    asOf: result.asOf,
    items: result.items,
    ...pagination(result.total, pageInput.page, input.pageSize),
  };
}
