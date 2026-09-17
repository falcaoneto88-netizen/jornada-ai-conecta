import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const estadoMetaCapiFalcao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { lerEstadoMetaCapi } = await import("./meta-capi.server");
    return lerEstadoMetaCapi(context.supabase);
  });

export const testarMetaCapiFalcao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z
      .object({
        confirm: z.literal(true),
        testEventCode: z.string().regex(/^TEST[0-9A-Z]{1,16}$/),
      })
      .strict(),
  )
  .handler(async ({ context, data }) => {
    const { testarMetaCapi } = await import("./meta-capi.server");
    return testarMetaCapi(context.supabase, { confirm: true, testEventCode: data.testEventCode });
  });
