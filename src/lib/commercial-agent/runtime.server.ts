import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { resolverAcesso } from "../ghl.functions";
import { AgentError } from "./core";
import { configuredGenerator, HighLevel } from "./providers.server";
import { CommercialAgent, type Store } from "./service.server";

type Rpc = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};
export function createStore(client: Rpc): Store {
  return {
    async command<T>(op: string, org: string, data: Record<string, unknown> = {}, actor?: string) {
      const r = await client.rpc("commercial_agent_command", {
        _op: op,
        _org: org,
        _data: data,
        _actor: actor ?? null,
      });
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
  });
}
export async function authenticatedAgent(
  ctx: { supabase: SupabaseClient; userId: string },
  org: string,
) {
  const r = await resolverAcesso(ctx, ["administrador", "gestor", "comercial"]);
  if (!r.ok || r.acesso.orgId !== org) throw new AgentError("forbidden");
  return {
    agent: runtime(r.acesso.locationId),
    actor: ctx.userId,
    writeEnabled: r.acesso.conn?.["write_enabled"] === true,
  };
}
export async function safe<T>(fn: () => Promise<T>) {
  try {
    return { ok: true as const, data: await fn() };
  } catch (e) {
    return { ok: false as const, code: e instanceof AgentError ? e.code : "internal_error" };
  }
}
