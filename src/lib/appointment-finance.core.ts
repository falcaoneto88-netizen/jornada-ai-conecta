import { z } from "zod";

/** Administrative figures entered by the team, never proof of a payment. */
export const MAX_APPOINTMENT_FINANCE_CENTS = 100_000_000;
const cents = z.number().int().min(0).max(MAX_APPOINTMENT_FINANCE_CENTS);
export const appointmentFinanceReadSchema = z
  .object({ appointmentIds: z.array(z.string().uuid()).max(200) })
  .strict();
export const appointmentFinanceSaveSchema = z
  .object({
    appointmentId: z.string().uuid(),
    totalCents: cents,
    depositCents: cents,
    expectedRevision: z.number().int().min(0).max(2_147_483_646),
    requestId: z.string().uuid(),
  })
  .strict()
  .refine((value) => value.depositCents <= value.totalCents, {
    message: "O sinal informado não pode exceder o valor total.",
    path: ["depositCents"],
  });
export const appointmentFinanceEntrySchema = z
  .object({
    appointmentId: z.string().uuid(),
    totalCents: cents,
    depositCents: cents,
    currency: z.literal("EUR"),
    revision: z.number().int().positive(),
    updatedAt: z.string().datetime({ offset: true }),
    updatedBy: z.string().uuid(),
  })
  .strict()
  .refine((value) => value.depositCents <= value.totalCents);

export type AppointmentFinanceReadInput = z.infer<typeof appointmentFinanceReadSchema>;
export type AppointmentFinanceSaveInput = z.infer<typeof appointmentFinanceSaveSchema>;
export type AppointmentFinanceEntry = z.infer<typeof appointmentFinanceEntrySchema>;
export type AppointmentFinanceErrorCode =
  | "forbidden"
  | "migration_required"
  | "appointment_not_found"
  | "invalid_input"
  | "conflict"
  | "request_mismatch"
  | "unavailable";
export type AppointmentFinanceReadResult = {
  available: boolean;
  entries: AppointmentFinanceEntry[];
  canEdit: boolean;
  code?: AppointmentFinanceErrorCode;
  message?: string;
};
export type AppointmentFinanceSaveResult =
  | { ok: true; entry: AppointmentFinanceEntry }
  | { ok: false; code: AppointmentFinanceErrorCode; message: string };

const messages: Record<AppointmentFinanceErrorCode, string> = {
  forbidden: "Sem permissão para consultar ou editar os valores administrativos.",
  migration_required: "Os valores administrativos aguardam atualização do banco de dados.",
  appointment_not_found: "Consulta indisponível ou ainda não vinculada ao GoHighLevel nesta conta.",
  invalid_input: "Revise os valores informados. O sinal não pode ultrapassar o total.",
  conflict: "Os valores foram atualizados por outra pessoa. Recarregue antes de guardar.",
  request_mismatch: "Esta tentativa já foi usada com outros dados. Recarregue antes de guardar.",
  unavailable: "Não foi possível consultar ou guardar os valores agora. Tente novamente.",
};
export function appointmentFinanceFailure(
  code: AppointmentFinanceErrorCode,
): Extract<AppointmentFinanceSaveResult, { ok: false }> {
  return { ok: false, code, message: messages[code] };
}
export function appointmentFinanceReadFailure(
  code: AppointmentFinanceErrorCode,
): AppointmentFinanceReadResult {
  return { available: false, entries: [], canEdit: false, code, message: messages[code] };
}
