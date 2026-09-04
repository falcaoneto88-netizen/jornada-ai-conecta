import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

import { erro, naoAutenticado, supabaseForUser, texto } from "../supabase";

export default defineTool({
  name: "move_contact_stage",
  title: "Mover cliente de etapa",
  description:
    "Move um cliente para outra etapa da jornada e regista a alteração na auditoria. Confirme com o utilizador antes de usar.",
  inputSchema: {
    contact_id: z.string().describe("Identificador do cliente."),
    stage_key: z.string().describe("Chave da etapa de destino."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async ({ contact_id, stage_key }, ctx) => {
    if (!ctx.isAuthenticated()) return naoAutenticado();
    const supabase = supabaseForUser(ctx);

    const { data: etapa, error: erroEtapa } = await supabase
      .from("journey_stages")
      .select("key,name")
      .eq("key", stage_key)
      .maybeSingle();
    if (erroEtapa) return erro(erroEtapa.message);
    if (!etapa) return erro(`Etapa "${stage_key}" não existe.`);

    const { data: anterior, error: erroContacto } = await supabase
      .from("contacts")
      .select("id,full_name,stage_key,organization_id")
      .eq("id", contact_id)
      .maybeSingle();
    if (erroContacto) return erro(erroContacto.message);
    if (!anterior) return erro("Cliente não encontrado.");

    const { data, error } = await supabase
      .from("contacts")
      .update({ stage_key })
      .eq("id", contact_id)
      .select("id,full_name,stage_key")
      .maybeSingle();
    if (error) return erro(error.message);

    await supabase.from("audit_logs").insert({
      organization_id: anterior.organization_id,
      action: "contacto.mover_etapa",
      entity: "contacts",
      entity_id: contact_id,
      actor_name: ctx.getUserEmail() ?? "MCP",
      metadata: { de: anterior.stage_key, para: stage_key, origem: "mcp" },
    });

    return texto({ movido: data, etapa: etapa.name });
  },
});
