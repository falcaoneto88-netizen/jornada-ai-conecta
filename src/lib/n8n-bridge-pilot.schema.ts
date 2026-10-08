import { z } from "zod";
import { PILOT_KINDS } from "./n8n-bridge-pilot";
const id = z.string().regex(/^[A-Za-z0-9_-]{6,64}$/);
export const pilotInputSchema = z.discriminatedUnion("enabled", [
  z.object({ enabled: z.literal(false) }).strict(),
  z
    .object({
      enabled: z.literal(true),
      contactId: id,
      appointmentId: id,
      expectedStartTime: z.string().datetime({ offset: true }),
      expiresAt: z.string().datetime({ offset: true }),
      allowedKinds: z
        .array(z.enum(PILOT_KINDS))
        .min(1)
        .max(PILOT_KINDS.length)
        .refine((v) => new Set(v).size === v.length),
    })
    .strict(),
]);
export type PilotInput = z.infer<typeof pilotInputSchema>;
