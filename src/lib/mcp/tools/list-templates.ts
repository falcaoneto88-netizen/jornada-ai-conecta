import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

import { erro, naoAutenticado, supabaseForUser, texto } from "../supabase";

export default defineTool({
  name: "list_message_templates",
  title: "Listar modelos de mensagem",
  description: "Lista os modelos de mensagem da organização, com filtro opcional por etapa da jornada.",
  inputSchema: {
    stage_key: z.string().optional().describe("Chave da etapa da jornada para filtrar."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ stage_key }, ctx) => {
    if (!ctx.isAuthenticated()) return naoAutenticado();
    const supabase = supabaseForUser(ctx);
    let query = supabase
      .from("message_templates")
      .select("id,name,channel,language,stage_key,body,is_demo")
      .order("created_at");
    if (stage_key) query = query.eq("stage_key", stage_key);
    const { data, error } = await query;
    if (error) return erro(error.message);
    return texto(data ?? []);
  },
});
