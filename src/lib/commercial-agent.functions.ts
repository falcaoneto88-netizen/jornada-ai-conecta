import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { commandSchema, listSchema, pauseSchema, reconcileSchema } from "./commercial-agent/core";

export const listAgentDrafts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(listSchema)
  .handler(async ({ data, context }) => {
    const { safe, authenticatedAgent } = await import("./commercial-agent/runtime.server");
    return safe(async () => {
      const { agent, actor } = await authenticatedAgent(context, data.organizationId);
      return agent.list(data.organizationId, actor);
    });
  });
export const approveAgentDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(commandSchema)
  .handler(async ({ data, context }) => {
    const { safe, authenticatedAgent } = await import("./commercial-agent/runtime.server");
    return safe(async () => {
      const { agent, actor, writeEnabled } = await authenticatedAgent(context, data.organizationId);
      return agent.approve(data.organizationId, actor, data, writeEnabled);
    });
  });
export const rejectAgentDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(commandSchema)
  .handler(async ({ data, context }) => {
    const { safe, authenticatedAgent } = await import("./commercial-agent/runtime.server");
    return safe(async () => {
      const { agent, actor } = await authenticatedAgent(context, data.organizationId);
      return agent.reject(data.organizationId, actor, data);
    });
  });
export const pauseAgentContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(pauseSchema)
  .handler(async ({ data, context }) => {
    const { safe, authenticatedAgent } = await import("./commercial-agent/runtime.server");
    return safe(async () => {
      const { agent, actor } = await authenticatedAgent(context, data.organizationId);
      return agent.pause(
        data.organizationId,
        actor,
        data.contactId,
        data.expectedVersion,
        data.paused,
      );
    });
  });
export const reconcileAgentDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(reconcileSchema)
  .handler(async ({ data, context }) => {
    const { safe, authenticatedAgent } = await import("./commercial-agent/runtime.server");
    return safe(async () => {
      const { agent, actor } = await authenticatedAgent(context, data.organizationId);
      return agent.reconcile(data.organizationId, actor, data);
    });
  });
