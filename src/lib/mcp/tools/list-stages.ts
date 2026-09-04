import { defineTool } from "@lovable.dev/mcp-js";

import { erro, naoAutenticado, supabaseForUser, texto } from "../supabase";

export default defineTool({
  name: "list_journey_stages",
  title: "Listar etapas da jornada",
  description: "Lista as etapas da jornada do cliente (nome, chave e ordem) da organização do utilizador.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) return naoAutenticado();
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("journey_stages")
      .select("key,name,position")
      .order("position");
    if (error) return erro(error.message);
    return texto(data ?? []);
  },
});
