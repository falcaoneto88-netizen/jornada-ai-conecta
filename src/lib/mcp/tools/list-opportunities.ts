import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

import { erro, naoAutenticado, supabaseForUser, texto } from "../supabase";

const schema = z.object({
  stage_key: z.string().min(1).max(100).optional().describe("Chave da etapa da jornada."),
  status: z.string().min(1).max(50).optional().describe("Estado da oportunidade."),
  updated_after: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe("Data/hora ISO mínima de atualização."),
  cursor: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe("Cursor devolvido na consulta anterior (paginação decrescente por atualização)."),
  limit: z.number().int().min(1).max(50).default(20).describe("Número de registos (1 a 50)."),
});

const COLUNAS =
  "id,ghl_opportunity_id,contact_id,name,pipeline_id,stage_id,stage_key,monetary_value,status,is_demo,created_at,updated_at";

export default defineTool({
  name: "list_opportunities",
  title: "Listar oportunidades",
  description:
    "Lista oportunidades da organização com os identificadores do GoHighLevel (oportunidade, pipeline e etapa), para casamento externo. Somente leitura; não cria nem altera oportunidades.",
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
    if (!input.success) return erro("Confira os filtros, as datas ISO e o limite entre 1 e 50.");
    const { stage_key, status, updated_after, cursor, limit } = input.data;
    try {
      const client = supabaseForUser(ctx);
      let query = client
        .from("opportunities")
        .select(COLUNAS)
        .order("updated_at", { ascending: false })
        .limit(limit);
      if (stage_key) query = query.eq("stage_key", stage_key);
      if (status) query = query.eq("status", status);
      if (updated_after) query = query.gte("updated_at", updated_after);
      if (cursor) query = query.lt("updated_at", cursor);
      const { data, error } = await query;
      if (error) return erro("Não foi possível consultar as oportunidades.");
      const registos = data ?? [];
      const next =
        registos.length === limit ? (registos[registos.length - 1]?.updated_at ?? null) : null;
      return texto({ opportunities: registos, next_cursor: next });
    } catch {
      return erro("Não foi possível consultar as oportunidades.");
    }
  },
});
