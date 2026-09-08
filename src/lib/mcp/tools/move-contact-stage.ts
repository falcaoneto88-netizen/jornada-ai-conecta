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

    // Papel do próprio utilizador: as políticas de escrita exigem operação.
    const { data: papeis, error: erroPapeis } = await supabase.from("user_roles").select("role");
    if (erroPapeis) return erro(erroPapeis.message);
    const podeOperar = (papeis ?? []).some((p) =>
      ["administrador", "gestor", "comercial"].includes(String(p.role)),
    );
    if (!podeOperar) return erro("Não tem permissão para mover clientes de etapa.");

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
      .select("id,full_name,stage_key");
    if (error) return erro(error.message);
    // Sem linhas afetadas significa que as políticas recusaram a escrita.
    if (!data || data.length !== 1) {
      return erro("A alteração não foi aplicada: sem permissão ou cliente fora da sua organização.");
    }

    const { error: erroAuditoria } = await supabase.from("audit_logs").insert({
      organization_id: anterior.organization_id,
      actor_id: ctx.getUserId?.() ?? null,
      action: "contacto.mover_etapa",
      entity: "contacts",
      entity_id: contact_id,
      actor_name: ctx.getUserEmail() ?? "MCP",
      metadata: { de: anterior.stage_key, para: stage_key, origem: "mcp" },
    });
    if (erroAuditoria) return erro(`Alteração aplicada, mas a auditoria falhou: ${erroAuditoria.message}`);

    return texto({ movido: data[0], etapa: etapa.name });
  },
});
