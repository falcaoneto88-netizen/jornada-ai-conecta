import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

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

export const criarChaveN8n = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({ confirm: z.literal(true) })
      .strict()
      .parse(d),
  )
  .handler(async ({ context }) => {
    const { criarChaveBridge } = await import("./n8n-bridge.admin.server");
    return criarChaveBridge(
      { supabase: context.supabase as never, userId: context.userId },
      getRequest().headers,
    );
  });
