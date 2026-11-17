import "@tanstack/react-start/server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { resolverAcesso } from "../ghl.functions";
import { loadIzabelV03AutomaticReference } from "../izabel/knowledge-v03.server";
import { AgentError } from "./core";
import { createStore } from "./runtime.server";
import { AUTOMATION_POLICY_HASH } from "./providers.server";
import type { AutomationControlDeps } from "./automation-control.server";

export async function automationControl(
  ctx: { supabase: SupabaseClient; userId: string },
  requestedOrganization: string,
): Promise<AutomationControlDeps> {
  const result = await resolverAcesso(ctx, ["administrador", "gestor", "comercial"]);
  if (!result.ok || result.acesso.orgId !== requestedOrganization)
    throw new AgentError("forbidden");
  const { orgId, locationId, conn } = result.acesso;
  const provider = process.env["COMMERCIAL_AGENT_AI_PROVIDER"] ?? "openai";
  return {
    store: createStore(supabaseAdmin as unknown as Parameters<typeof createStore>[0]),
    organizationId: orgId,
    locationId,
    actorId: ctx.userId,
    writeEnabled: conn?.["write_enabled"] === true,
    policyHash: AUTOMATION_POLICY_HASH,
    runtimeReady:
      process.env["COMMERCIAL_AGENT_ENABLED"] === "true" &&
      process.env["COMMERCIAL_AGENT_SEND_ENABLED"] === "true" &&
      process.env["COMMERCIAL_AGENT_DISCOVERY_ENABLED"] === "true" &&
      Boolean(process.env["GHL_PRIVATE_TOKEN"]) &&
      Boolean(process.env["COMMERCIAL_AGENT_WORKER_SECRET"]) &&
      Buffer.from(process.env["COMMERCIAL_AGENT_ENCRYPTION_KEY"] ?? "", "base64").length === 32 &&
      Boolean(process.env["IZABEL_KNOWLEDGE_BUCKET"]) &&
      ((provider === "lovable" && Boolean(process.env["LOVABLE_API_KEY"])) ||
        (provider === "openai" && Boolean(process.env["OPENAI_API_KEY"]))),
    verifyKnowledge: async () => {
      try {
        await loadIzabelV03AutomaticReference({ organizationId: orgId, locationId });
      } catch {
        throw new AgentError("knowledge_unavailable");
      }
    },
  };
}
