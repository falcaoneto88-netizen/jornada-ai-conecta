import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolverAcesso } from "./ghl.functions";

/** Read-only; scope is resolved from the authenticated session, never input. */
export const verificarCatalogoMcp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const acesso = await resolverAcesso(context as never, ["administrador"]);
    if (!acesso.ok)
      return {
        ok: false as const,
        status: 403,
        reason: "sem_permissao" as const,
        tools: [] as string[],
        checked_at: new Date().toISOString(),
      };
    const { lerCatalogoPublicado } = await import("./integration-diagnostics.server");
    const result = await lerCatalogoPublicado(getRequest().headers.get("authorization") ?? "");
    return { ...result, checked_at: new Date().toISOString() };
  });
