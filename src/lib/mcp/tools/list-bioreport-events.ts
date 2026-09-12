import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { erro, naoAutenticado, supabaseForUser, texto } from "../supabase";

const schema = z.object({
  contact_id: z.uuid("Contato inválido.").optional(),
  consultation_id: z.uuid("Consulta inválida.").optional(),
  limit: z.number().int().min(1).max(50).default(20),
});
export default defineTool({
  name: "list_bioreport_events",
  title: "Consultar eventos do BioReport",
  description:
    "Lista eventos assinados recebidos do BioReport e seus vínculos de consulta/contato. Apenas administradores. Recebimento não significa mensagem enviada, etapa alterada ou workflow executado.",
  inputSchema: schema.shape,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: async (raw, ctx) => {
    if (!ctx.isAuthenticated() || !ctx.getToken()) return naoAutenticado();
    const input = schema.safeParse(raw);
    if (!input.success) return erro("Confira os identificadores e o limite entre 1 e 50.");
    try {
      const client = supabaseForUser(ctx);
      const { data: user, error: authError } = await client.auth.getUser();
      if (authError || !user.user) return naoAutenticado();
      const roles = await client.rpc("tem_papel", { _papeis: ["administrador"] });
      if (roles.error || roles.data !== true) return erro("Acesso restrito a administradores.");
      // Tipo localizado até regenerar os tipos Supabase após aplicar a migração.
      const db = client as unknown as import("@supabase/supabase-js").SupabaseClient;
      let query = db
        .from("bioreport_events")
        .select(
          "event_id,event_type,consultation_id,patient_id,record_id,contact_id,ghl_contact_id,occurred_at,received_at",
        )
        .order("received_at", { ascending: false })
        .limit(input.data.limit);
      if (input.data.contact_id) query = query.eq("contact_id", input.data.contact_id);
      if (input.data.consultation_id)
        query = query.eq("consultation_id", input.data.consultation_id);
      const { data, error } = await query;
      if (error)
        return erro("Não foi possível consultar os eventos. Confira a instalação da integração.");
      return texto({ events: data ?? [], messages_sent_by_integration: 0 });
    } catch {
      return erro("Não foi possível validar o acesso aos eventos.");
    }
  },
});
