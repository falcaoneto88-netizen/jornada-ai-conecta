import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Só administradores; a escrita continua dependente de write_enabled e da integração. */
export const processarLeadsFalcao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { processarLeadsRemoto } = await import("./falcao-remote.server");
    const r = await processarLeadsRemoto(context as never);
    return { ok: r.ok, message: r.message, total: r.desfechos.length };
  });
