import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolverAcesso, type DepsAcesso } from "./ghl.functions";
import {
  translateText,
  translationInput,
  type TranslationInput,
  type TranslationResult,
} from "./translation.core";

type TranslationContext = Parameters<typeof resolverAcesso>[0];
export type TranslationDependencies = {
  acesso?: DepsAcesso;
  lerChave?: () => string | undefined;
  fetch?: typeof fetch;
};

/** Tenant and operational role resolve before reading credentials or contacting AI. No CRM mutation. */
export async function translationHandler(
  context: TranslationContext,
  input: TranslationInput,
  deps: TranslationDependencies = {},
): Promise<TranslationResult> {
  const access = await resolverAcesso(
    context,
    ["administrador", "gestor", "comercial"],
    deps.acesso,
  );
  if (!access.ok)
    return {
      ok: false,
      code: "sem_permissao",
      message: "Tradutor indisponível para este acesso à organização.",
    };
  return translateText(input, {
    apiKey: (deps.lerChave ?? (() => process.env["LOVABLE_API_KEY"]))(),
    fetch: deps.fetch ?? fetch,
  });
}

export const traduzirInbox = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(translationInput)
  .handler(({ context, data }) =>
    translationHandler(context as unknown as TranslationContext, data),
  );
