import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { pedidoMensagens, pedidoWorkflows, pesquisaConversas } from "./ghl-observation.core";
import type { resolverAcesso } from "./ghl.functions";
type Contexto = Parameters<typeof resolverAcesso>[0];

export const consultarConversasGhl = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(pesquisaConversas)
  .handler(async ({ data, context }) => {
    const { observarGhl } = await import("./ghl-observation.server");
    const result = await observarGhl(context as unknown as Contexto, "conversas", data);
    if (result.tipo !== "conversas") throw new Error("Resposta inesperada.");
    return result;
  });
export const consultarMensagensGhl = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(pedidoMensagens)
  .handler(async ({ data, context }) => {
    const { observarGhl } = await import("./ghl-observation.server");
    const result = await observarGhl(context as unknown as Contexto, "mensagens", data);
    if (result.tipo !== "mensagens") throw new Error("Resposta inesperada.");
    return result;
  });
export const consultarWorkflowsGhl = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(pedidoWorkflows)
  .handler(async ({ data, context }) => {
    const { observarGhl } = await import("./ghl-observation.server");
    const result = await observarGhl(context as unknown as Contexto, "workflows", data);
    if (result.tipo !== "workflows") throw new Error("Resposta inesperada.");
    return result;
  });
