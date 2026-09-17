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

/** Acolhimento pelo canal existente; depende do interruptor do canal e de write_enabled. */
export const enviarAcolhimentoFalcao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { enviarAcolhimentosFalcao } = await import("./falcao-welcome.server");
    const r = await enviarAcolhimentosFalcao(context as never);
    return { ok: r.ok, message: r.message, total: r.desfechos.length };
  });
