import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const estadoIntegracaoFalcao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { lerEstadoIntegracaoSite } = await import("./falcao-site.server");
    return lerEstadoIntegracaoSite(context.supabase);
  });

export const configurarIntegracaoFalcao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ confirm: z.literal(true), enabled: z.boolean() }).strict())
  .handler(async ({ context, data }) => {
    const { configurarIntegracaoSite } = await import("./falcao-site.server");
    return configurarIntegracaoSite(context.supabase, data);
  });
