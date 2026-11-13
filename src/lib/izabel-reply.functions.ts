import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { izabelReplyInputSchema } from "./izabel-reply.core";

export const prepareIzabelReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(izabelReplyInputSchema)
  .handler(async ({ data, context }) => {
    const { prepareIzabelReplyForSession } = await import("./izabel-reply.server");
    return prepareIzabelReplyForSession(context, data);
  });
