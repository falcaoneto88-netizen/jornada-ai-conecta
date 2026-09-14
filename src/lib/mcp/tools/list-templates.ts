import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

import { erro, naoAutenticado, supabaseForUser, texto } from "../supabase";

export default defineTool({
  name: "list_message_templates",
  title: "Listar modelos de mensagem",
  description:
    "Lista rascunhos da biblioteca da organização. Não indica publicação ou uso no GHL. Pode incluir modelos arquivados.",
  inputSchema: {
    stage_key: z.string().optional().describe("Chave da etapa da jornada para filtrar."),
    include_archived: z.boolean().optional().describe("Incluir arquivados (padrão: false)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ stage_key, include_archived }, ctx) => {
    if (!ctx.isAuthenticated()) return naoAutenticado();
    const supabase = supabaseForUser(ctx);
    let query = supabase
      .from("message_templates")
      .select(
        "id,name,channel,language,stage_key,body,is_demo,lifecycle,usage_note,revision,updated_at",
      )
      .eq("is_demo", false)
      .order("created_at");
    if (!include_archived) query = query.eq("lifecycle", "draft");
    if (stage_key) query = query.eq("stage_key", stage_key);
    const { data, error } = await query;
    if (error) return erro(error.message);
    return texto(data ?? []);
  },
});
