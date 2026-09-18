import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolverAcesso, SEM_PERMISSAO } from "./ghl.functions";

/** Guard partilhado: sessão real + administrador + vínculo GHL server-side. */
async function autorizar(context: { supabase: never; userId: string }) {
  const acesso = await resolverAcesso(context as never, ["administrador"]);
  return acesso.ok ? acesso : null;
}

export const estadoAdNavigator = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const acesso = await autorizar(context as never);
    if (!acesso) return { autorizado: false as const, message: SEM_PERMISSAO };
    const { lerEstadoAdNavigator } = await import("./ad-navigator.server");
    const r = await lerEstadoAdNavigator(context.supabase);
    if (!r.ok) return { autorizado: true as const, leituraOk: false as const, message: r.message };
    return { autorizado: true as const, leituraOk: true as const, estado: r.estado };
  });

export const gerarCodigoAdNavigator = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ confirm: z.literal(true) }).strict())
  .handler(async ({ context }) => {
    const acesso = await autorizar(context as never);
    if (!acesso) return { ok: false as const, message: SEM_PERMISSAO };
    const { criarPareamentoAdNavigator } = await import("./ad-navigator.server");
    const r = await criarPareamentoAdNavigator(context.supabase);
    if (!r.ok) return { ok: false as const, message: r.message };
    // O código só é devolvido aqui, uma única vez, para colar no Ad Navigator.
    return { ok: true as const, code: r.code, detalhe: r.detalhe };
  });

export const revogarAcessoAdNavigator = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ confirm: z.literal(true) }).strict())
  .handler(async ({ context }) => {
    const acesso = await autorizar(context as never);
    if (!acesso) return { ok: false as const, message: SEM_PERMISSAO };
    const { revogarAdNavigator } = await import("./ad-navigator.server");
    const r = await revogarAdNavigator(context.supabase);
    if (!r.ok) return { ok: false as const, message: r.message };
    return { ok: true as const, detalhe: r.detalhe };
  });
