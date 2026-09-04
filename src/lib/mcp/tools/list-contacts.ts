import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

import { erro, naoAutenticado, supabaseForUser, texto } from "../supabase";

export default defineTool({
  name: "list_contacts",
  title: "Listar clientes",
  description:
    "Lista clientes da organização, com pesquisa por nome e filtro por etapa da jornada. Devolve no máximo 50 registos.",
  inputSchema: {
    search: z.string().optional().describe("Texto a procurar no nome do cliente."),
    stage_key: z.string().optional().describe("Chave da etapa da jornada para filtrar."),
    limit: z.number().int().optional().describe("Número máximo de registos (1 a 50, por omissão 20)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ search, stage_key, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return naoAutenticado();
    const supabase = supabaseForUser(ctx);
    const max = Math.min(Math.max(limit ?? 20, 1), 50);
    let query = supabase
      .from("contacts")
      .select("id,full_name,email,phone,stage_key,tags,owner_name,next_action,next_action_at,is_demo")
      .order("last_interaction_at", { ascending: false, nullsFirst: false })
      .limit(max);
    if (stage_key) query = query.eq("stage_key", stage_key);
    if (search) query = query.ilike("full_name", `%${search}%`);
    const { data, error } = await query;
    if (error) return erro(error.message);
    return texto(data ?? []);
  },
});
