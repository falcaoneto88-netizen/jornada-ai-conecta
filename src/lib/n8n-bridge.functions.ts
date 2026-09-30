import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { configEntradaSchema } from "./n8n-bridge.schema";

export const estadoPonteN8n = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { lerEstadoPonte } = await import("./n8n-bridge.admin.server");
    return lerEstadoPonte({ supabase: context.supabase as never, userId: context.userId });
  });

export const guardarPonteN8n = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => configEntradaSchema.parse(d))
  .handler(async ({ context, data }) => {
    const { guardarConfigPonte } = await import("./n8n-bridge.admin.server");
    return guardarConfigPonte(
      { supabase: context.supabase as never, userId: context.userId },
      data,
    );
  });
