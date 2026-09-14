import { z } from "zod";
export const analiseSchema = z
  .object({
    resumo: z.string().max(6000),
    intencao: z.enum([
      "informacao",
      "preco",
      "agendamento",
      "objecao",
      "pos_procedimento",
      "urgencia",
    ]),
    sentimento: z.enum(["positivo", "neutro", "negativo"]),
    prioridade: z.enum(["baixa", "media", "alta"]),
    revisao_humana: z.boolean(),
    sugestoes: z
      .array(
        z.object({
          tom: z.enum(["objetiva", "acolhedora", "premium"]),
          texto: z.string().min(1).max(6000),
        }),
      )
      .length(3),
  })
  .refine((a) => new Set(a.sugestoes.map((s) => s.tom)).size === 3);
export type AnaliseIA = z.infer<typeof analiseSchema>;
