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
/** Contexto sanitizado para a caixa de entrada: destinatário, canal e motivo de bloqueio. */
export const getInboxSendContext = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(manualScopeSchema.extend({ organizationId: listSchema.shape.organizationId }))
  .handler(async ({ data, context }) => {
    const { safe, authenticatedAgent } = await import("./commercial-agent/runtime.server");
    return safe(async () => {
      const { agent, actor, writeEnabled } = await authenticatedAgent(context, data.organizationId);
      const c = await agent.manualContext(
        data.organizationId,
        actor,
        { contactId: data.contactId, conversationId: data.conversationId },
        writeEnabled,
      );
      const inbound = c.snapshot.messages.find((m) => m.id === c.snapshot.event.messageId);
      return {
        name: c.snapshot.name,
        channel: inbound?.channel ?? null,
        providerConfigured: Boolean(inbound?.provider),
        inboundAt: inbound?.at ?? null,
        sendAllowed: c.sendAllowed,
        blockedReason: c.blockedReason,
        lastDispatch: c.lastDispatch
          ? { id: c.lastDispatch.id, state: c.lastDispatch.state, messageId: c.lastDispatch.messageId }
          : null,
      };
    });
  });
/** Envio pela caixa de entrada: um clique humano final, idempotente por requestId. */
export const sendInboxMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    manualPrepareSchema
      .pick({ contactId: true, conversationId: true, text: true, requestId: true })
      .extend({ organizationId: listSchema.shape.organizationId }),
  )
  .handler(async ({ data, context }) => {
    const { safe, authenticatedAgent } = await import("./commercial-agent/runtime.server");
    return safe(async () => {
      const { agent, actor, writeEnabled } = await authenticatedAgent(context, data.organizationId);
      const { organizationId, ...input } = data;
      return agent.inboxSend(organizationId, actor, input, writeEnabled);
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
