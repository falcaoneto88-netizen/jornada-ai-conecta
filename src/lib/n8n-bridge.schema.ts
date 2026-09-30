import { z } from "zod";

const idGhl = z.string().regex(/^[A-Za-z0-9_-]{6,64}$/);

/** Campos NÃO secretos editáveis no cartão. Flags de ativação não fazem parte. */
export const configEntradaSchema = z
  .object({
    calendarId: idGhl.nullable(),
    channel: z.enum(["sms", "whatsapp_zaptos"]).nullable(),
    clinicAddress: z.string().trim().max(240),
    fallbackUserId: idGhl.nullable(),
  })
  .strict();
export type ConfigEntrada = z.infer<typeof configEntradaSchema>;
