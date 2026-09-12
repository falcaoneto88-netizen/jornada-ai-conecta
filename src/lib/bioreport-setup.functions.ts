import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const configurarRecebimentoBioreport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ confirm: z.literal(true) }).strict())
  .handler(async ({ context, data }) => {
    const { configureBioreport } = await import("./bioreport-setup.server");
    return configureBioreport(context.supabase, data.confirm);
  });
