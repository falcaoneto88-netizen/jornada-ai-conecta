import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { manualQueueSchema, queuePageSchema } from "./commercial-agent/queue-read";

export const listAgentQueuePage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(queuePageSchema)
  .handler(async ({ data, context }) => {
    const { safe, authenticatedQueueReader } = await import("./commercial-agent/runtime.server");
    return safe(async () => {
      const { organizationId, ...input } = data;
      const reader = await authenticatedQueueReader(context, organizationId);
      return reader.drafts(input);
    });
  });

export const searchManualAgentConversations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(manualQueueSchema)
  .handler(async ({ data, context }) => {
    const { safe, authenticatedQueueReader } = await import("./commercial-agent/runtime.server");
    return safe(async () => {
      const { organizationId, ...input } = data;
      const reader = await authenticatedQueueReader(context, organizationId);
      return reader.manual(input);
    });
  });
