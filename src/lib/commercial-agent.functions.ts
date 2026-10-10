import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
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
/** Contexto sanitizado para a caixa de entrada: destinatário, rota verificada e referência de revisão. */
export const getInboxSendContext = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(manualScopeSchema.extend({ organizationId: listSchema.shape.organizationId }))
  .handler(async ({ data, context }) => {
    const { safe, authenticatedAgent, configuredSmsProvider } =
      await import("./commercial-agent/runtime.server");
    return safe(async () => {
      const { agent, actor, writeEnabled } = await authenticatedAgent(context, data.organizationId);
      const r = await agent.inboxContext(
        data.organizationId,
        actor,
        { contactId: data.contactId, conversationId: data.conversationId },
        writeEnabled,
        await configuredSmsProvider(data.organizationId),
      );
      const c = r.context;
      const inbound = c.snapshot.messages.find((m) => m.id === c.snapshot.event.messageId);
      return {
        name: c.snapshot.name,
        channel: inbound?.channel ?? null,
        transport: r.route?.name ?? null,
        // Canais nativos: a conexão/permissão só é validada pelo GHL no envio.
        connectionVerifiedAtSend: r.route ? r.route.channel !== "SMS" : false,
        inboundAt: inbound?.at ?? null,
        sendAllowed: r.blockedReason === null,
        blockedReason: r.blockedReason,
        revision: r.revision,
        lastDispatch: c.lastDispatch
          ? {
              id: c.lastDispatch.id,
              state: c.lastDispatch.state,
              messageId: c.lastDispatch.messageId,
            }
          : null,
      };
    });
  });
const revisionSchema = z
  .object({
    historyHash: z.string().regex(/^[a-f0-9]{64}$/),
    sessionVersion: z.number().int().nonnegative(),
    channel: z.enum(["SMS", "IG", "FB", "WhatsApp"]),
    providerId: id.nullable(),
    defaultId: id.nullable(),
  })
  .strict();
/** Texto exato visível: trim só para testar vazio; nada é normalizado sem Corrigir. */
const exactText = z
  .string()
  .max(1500)
  .refine((t) => t.trim().length > 0, "empty");
/** Envio pela caixa de entrada: um clique humano final, idempotente por requestId. */
export const sendInboxMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    manualPrepareSchema
      .pick({ contactId: true, conversationId: true, requestId: true })
      .extend({
        organizationId: listSchema.shape.organizationId,
        text: exactText,
        revision: revisionSchema,
      }),
  )
  .handler(async ({ data, context }) => {
    const { safe, authenticatedAgent, configuredSmsProvider } =
      await import("./commercial-agent/runtime.server");
    return safe(async () => {
      const { agent, actor, writeEnabled } = await authenticatedAgent(context, data.organizationId);
      const { organizationId, ...input } = data;
      return agent.inboxSend(
        organizationId,
        actor,
        input,
        writeEnabled,
        await configuredSmsProvider(organizationId),
      );
    });
  });
/** Só leitura: estado durável de um pedido pelo seu requestId. */
export const getInboxSendStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({ organizationId: listSchema.shape.organizationId, requestId: z.string().uuid() }),
  )
  .handler(async ({ data, context }) => {
    const { safe, authenticatedAgent } = await import("./commercial-agent/runtime.server");
    return safe(async () => {
      const { agent, actor } = await authenticatedAgent(context, data.organizationId);
      return agent.inboxStatus(data.organizationId, actor, data.requestId);
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
