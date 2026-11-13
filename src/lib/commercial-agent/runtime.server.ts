import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { resolverAcesso } from "../ghl.functions";
import { AgentError } from "./core";
import { configuredGenerator, HighLevel } from "./providers.server";
import { CommercialAgent, type Store } from "./service.server";
import { bindAttendanceDraftDispatch } from "../attendance-draft.server";
import { readInboxReviewRows } from "./inbox-review.server";
import { readAgentQueuePage, readManualQueuePage, type QueueReadClient } from "./queue-read.server";
import type { ManualQueueRequest, QueuePageRequest } from "./queue-read";

type Rpc = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};
export function createStore(client: Rpc): Store {
  return {
    async command<T>(op: string, org: string, data: Record<string, unknown> = {}, actor?: string) {
      const r = await client.rpc(
        op.startsWith("manual_") ? "commercial_agent_manual_command" : "commercial_agent_command",
        {
          _op: op,
          _org: org,
          _data: data,
          _actor: actor ?? null,
        },
      );
      if (r.error) throw new AgentError("storage_unavailable");
      const err = (r.data as { error?: unknown } | null)?.error;
      if (typeof err === "string")
        throw new AgentError(/^[a-z_]{1,60}$/.test(err) ? err : "storage_unavailable");
      return r.data as T;
    },
  };
}
export async function resolveAgentLocation(locationId: string) {
  if (locationId !== process.env["GHL_LOCATION_ID"]) throw new AgentError("scope_mismatch");
  const { data, error } = await supabaseAdmin
    .from("ghl_location_bindings")
    .select("organization_id")
    .eq("location_id", locationId)
    .maybeSingle();
  if (error || !data) throw new AgentError("scope_mismatch");
  return data.organization_id;
}
export function runtime(locationId: string) {
  if (locationId !== process.env["GHL_LOCATION_ID"]) throw new AgentError("scope_mismatch");
  const key = process.env["COMMERCIAL_AGENT_ENCRYPTION_KEY"] ?? "";
  if (Buffer.from(key, "base64").length !== 32) throw new AgentError("encryption_not_configured");
  return new CommercialAgent({
    store: createStore(supabaseAdmin as unknown as Rpc),
    provider: new HighLevel(process.env["GHL_PRIVATE_TOKEN"] ?? "", locationId),
    generate: configuredGenerator(process.env),
    encryptionKey: key,
    enabled: process.env["COMMERCIAL_AGENT_ENABLED"] === "true",
    sendEnabled: process.env["COMMERCIAL_AGENT_SEND_ENABLED"] === "true",
    bindAttendanceDraft: (input) =>
      bindAttendanceDraftDispatch(supabaseAdmin as unknown as Rpc, key, input),
    readInboxReview: (scope) => {
      if (scope.locationId !== locationId) throw new AgentError("scope_mismatch");
      return readInboxReviewRows(supabaseAdmin, scope);
    },
  });
}
async function authenticatedScope(ctx: { supabase: SupabaseClient; userId: string }, org: string) {
  const r = await resolverAcesso(ctx, ["administrador", "gestor", "comercial"]);
  if (!r.ok || r.acesso.orgId !== org) throw new AgentError("forbidden");
  return r.acesso;
}
export async function authenticatedAgent(
  ctx: { supabase: SupabaseClient; userId: string },
  org: string,
) {
  const scope = await authenticatedScope(ctx, org);
  return {
    agent: runtime(scope.locationId),
    actor: ctx.userId,
    writeEnabled: scope.conn?.["write_enabled"] === true,
  };
}
/** Shares authorization with action routes, without constructing providers or executing mutating RPCs. */
export async function authenticatedQueueReader(
  ctx: { supabase: SupabaseClient; userId: string },
  org: string,
) {
  const access = await authenticatedScope(ctx, org);
  const scope = {
    organizationId: access.orgId,
    locationId: access.locationId,
    actorId: ctx.userId,
  };
  const client = supabaseAdmin as unknown as QueueReadClient;
  return {
    drafts(input: QueuePageRequest) {
      const encryptionKey = process.env["COMMERCIAL_AGENT_ENCRYPTION_KEY"] ?? "";
      if (Buffer.from(encryptionKey, "base64").length !== 32)
        throw new AgentError("encryption_not_configured");
      return readAgentQueuePage(client, scope, input, {
        encryptionKey,
        enabled: process.env["COMMERCIAL_AGENT_ENABLED"] === "true",
        sendEnabled: process.env["COMMERCIAL_AGENT_SEND_ENABLED"] === "true",
      });
    },
    manual(input: ManualQueueRequest) {
      return readManualQueuePage(client, scope, input);
    },
  };
}
export async function safe<T>(fn: () => Promise<T>) {
  try {
    return { ok: true as const, data: await fn() };
  } catch (e) {
    return { ok: false as const, code: e instanceof AgentError ? e.code : "internal_error" };
  }
}

/** Fornecedor SMS configurado da clínica (só leitura); evidência adicional, nunca autorização. */
export async function configuredSmsProvider(org: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("n8n_bridge_settings")
    .select("zaptos_provider_id")
    .eq("organization_id", org)
    .maybeSingle();
  if (error || !data) return null;
  const v = data.zaptos_provider_id;
  return typeof v === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(v) ? v : null;
}
