import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

import { erro, naoAutenticado, supabaseForUser, texto } from "../supabase";

export default defineTool({
  name: "recent_activity",
  title: "Atividade recente",
  description: "Lista a auditoria da organização. verified=true indica registo emitido pelo backend ou banco; false inclui registos históricos ou declarados pelo cliente e não atesta a identidade indicada.",
  inputSchema: {
    limit: z.number().int().optional().describe("Número máximo de registos (1 a 50, por omissão 20)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit }, ctx) => {
    if (!ctx.isAuthenticated()) return naoAutenticado();
    const supabase = supabaseForUser(ctx);
    const max = Math.min(Math.max(limit ?? 20, 1), 50);
    const { data, error } = await supabase
      .from("audit_logs")
      .select("action,entity,entity_id,actor_id,actor_name,metadata,created_at,verified")
      .order("created_at", { ascending: false })
      .limit(max);
    if (error) return erro(error.message);
    return texto(data ?? []);
  },
});
