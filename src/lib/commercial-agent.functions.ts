import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  commandSchema,
  listSchema,
  pauseSchema,
  reconcileSchema,
  manualScopeSchema,
  manualPrepareSchema,
  manualSendSchema,
  id,
} from "./commercial-agent/core";

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

export const getManualAgentContext = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(manualScopeSchema.extend({ organizationId: listSchema.shape.organizationId }))
  .handler(async ({ data, context }) => {
    const { safe, authenticatedAgent } = await import("./commercial-agent/runtime.server");
    return safe(async () => {
      const { agent, actor, writeEnabled } = await authenticatedAgent(context, data.organizationId);
      return agent.manualContext(
        data.organizationId,
        actor,
        { contactId: data.contactId, conversationId: data.conversationId },
        writeEnabled,
      );
    });
  });
export const prepareManualAgentMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(manualPrepareSchema.extend({ organizationId: listSchema.shape.organizationId }))
  .handler(async ({ data, context }) => {
    const { safe, authenticatedAgent } = await import("./commercial-agent/runtime.server");
    return safe(async () => {
      const { agent, actor, writeEnabled } = await authenticatedAgent(context, data.organizationId);
      const { organizationId, ...input } = data;
      return agent.manualPrepare(organizationId, actor, input, writeEnabled);
    });
  });
export const sendManualAgentMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(manualSendSchema.extend({ organizationId: listSchema.shape.organizationId }))
  .handler(async ({ data, context }) => {
    const { safe, authenticatedAgent } = await import("./commercial-agent/runtime.server");
    return safe(async () => {
      const { agent, actor, writeEnabled } = await authenticatedAgent(context, data.organizationId);
      return agent.manualSend(
        data.organizationId,
        actor,
        { manualId: data.manualId, replyHash: data.replyHash },
        writeEnabled,
      );
    });
  });
export const reconcileManualAgentMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    manualSendSchema
      .omit({ replyHash: true })
      .extend({ organizationId: listSchema.shape.organizationId, messageId: id }),
  )
  .handler(async ({ data, context }) => {
    const { safe, authenticatedAgent } = await import("./commercial-agent/runtime.server");
    return safe(async () => {
      const { agent, actor } = await authenticatedAgent(context, data.organizationId);
      return agent.manualReconcile(data.organizationId, actor, {
        manualId: data.manualId,
        messageId: data.messageId,
      });
    });
  });
