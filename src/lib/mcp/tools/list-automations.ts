import { defineTool } from "@lovable.dev/mcp-js";

import { erro, naoAutenticado, supabaseForUser, texto } from "../supabase";

export default defineTool({
  name: "list_automations",
  title: "Listar automações",
  description: "Lista as automações da jornada com estado, gatilho e contagem de execuções.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) return naoAutenticado();
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("automations")
      .select("id,name,description,status,trigger_type,runs_total,runs_success,runs_error,last_run_at,is_demo")
      .order("created_at");
    if (error) return erro(error.message);
    return texto(data ?? []);
  },
});
