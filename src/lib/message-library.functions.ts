import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  contextoModeloSchema,
  lerBibliotecaSchema,
  salvarModeloSchema,
} from "./message-library.core";
export const getMessageLibrary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(lerBibliotecaSchema)
  .handler(async ({ data, context }) => {
    const { lerBiblioteca } = await import("./message-library.server");
    return lerBiblioteca(context, data);
  });
export const getMessageTemplateContext = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(contextoModeloSchema)
  .handler(async ({ data, context }) => {
    const { lerContextoModelo } = await import("./message-library.server");
    return lerContextoModelo(context, data);
  });
export const saveMessageTemplateDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(salvarModeloSchema)
  .handler(async ({ data, context }) => {
    const { salvarBiblioteca } = await import("./message-library.server");
    return salvarBiblioteca(context, data);
  });
