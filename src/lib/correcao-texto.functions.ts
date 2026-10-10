import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { corrigirTexto, MAX_CORRECAO } from "./correcao-texto.core";

/** Correção linguística do rascunho; não usa a base comercial nem gera respostas. */
export const corrigirRascunho = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { texto: string }) => {
    if (typeof input?.texto !== "string" || input.texto.length > MAX_CORRECAO)
      throw new Error("Texto inválido.");
    return { texto: input.texto };
  })
  .handler(async ({ data }) =>
    corrigirTexto(data.texto, { apiKey: process.env["LOVABLE_API_KEY"], fetch }),
  );
