import { z } from "zod";

export const attendanceScopeSchema = z
  .object({
    organizationId: z.string().uuid(),
    ghlContactId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
  })
  .strict();
export const attendanceSaveSchema = attendanceScopeSchema
  .extend({
    expectedTimezone: z.string().min(1).max(100),
    expectedVersion: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    ownerId: z.string().uuid().nullable(),
    returnAction: z.enum(["keep", "set", "complete", "clear"]),
    returnText: z.string().trim().min(1).max(500).optional(),
    dueLocal: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.returnAction === "set" && (!value.returnText || !value.dueLocal))
      ctx.addIssue({ code: "custom", message: "Indique ação e prazo.", path: ["returnText"] });
    if (
      value.returnAction !== "set" &&
      (value.returnText !== undefined || value.dueLocal !== undefined)
    )
      ctx.addIssue({ code: "custom", message: "Campos de prazo apenas para definir retorno." });
  });
export type AttendanceScope = z.infer<typeof attendanceScopeSchema>;
export type AttendanceSaveInput = z.infer<typeof attendanceSaveSchema>;
export type AttendanceErrorCode =
  | "forbidden"
  | "migration_required"
  | "conflict"
  | "invalid_input"
  | "invalid_datetime"
  | "ambiguous_datetime"
  | "unavailable"
  | "contact_not_synced";
export type AttendanceResult<T = AttendanceContext> =
  { ok: true; data: T } | { ok: false; code: AttendanceErrorCode; message: string };

const timestamp = z.string().datetime({ offset: true });
export const attendanceContextSchema = z.object({
  organizationId: z.string().uuid(),
  timezone: z.string(),
  canEdit: z.boolean(),
  checkedAt: timestamp,
  contact: z.object({
    id: z.string().uuid(),
    ghlContactId: z.string(),
    name: z.string(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    updatedAt: timestamp,
  }),
  stage: z.object({ key: z.string(), name: z.string() }).nullable(),
  nextAppointment: z
    .object({
      id: z.string().uuid(),
      title: z.string(),
      startAt: timestamp,
      endAt: timestamp.nullable(),
      status: z.string(),
      updatedAt: timestamp,
    })
    .nullable(),
  team: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
  attendance: z.object({
    version: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    ownerId: z.string().uuid().nullable(),
    nextAction: z.string().nullable(),
    nextActionAt: timestamp.nullable(),
  }),
});
export type AttendanceContext = z.infer<typeof attendanceContextSchema>;

export function attendanceFailure(code: AttendanceErrorCode): AttendanceResult<never> {
  const messages: Record<AttendanceErrorCode, string> = {
    forbidden: "Sem permissão para este atendimento.",
    migration_required: "O contexto interno aguarda atualização do banco de dados.",
    conflict: "Este atendimento foi atualizado por outra pessoa. Recarregue antes de guardar.",
    invalid_input: "Revise o responsável, a ação e o prazo informados.",
    invalid_datetime: "Data ou hora inválida no fuso da organização.",
    ambiguous_datetime: "Esta hora ocorre duas vezes na mudança de horário. Escolha outra hora.",
    unavailable: "Não foi possível consultar o contexto interno agora.",
    contact_not_synced: "Este contato ainda não foi sincronizado com o Jornada AI.",
  };
  return { ok: false, code, message: messages[code] };
}

/** Convert an explicit civil minute in the organization zone, never the browser/server zone.
 * Both sides of a DST transition are considered; repeated and nonexistent civil times fail closed. */
export function attendanceCivilToUtc(local: string, timezone: string): AttendanceResult<string> {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) return attendanceFailure("invalid_datetime");
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  if (year < 2000 || year > 2100 || hour > 23 || minute > 59)
    return attendanceFailure("invalid_datetime");
  const nominal = Date.UTC(year, month - 1, day, hour, minute);
  if (new Date(nominal).toISOString().slice(0, 16) !== local)
    return attendanceFailure("invalid_datetime");
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    const civilEpoch = (instant: number) => {
      const p = Object.fromEntries(
        formatter.formatToParts(instant).map((part) => [part.type, part.value]),
      );
      return Date.UTC(
        Number(p["year"]),
        Number(p["month"]) - 1,
        Number(p["day"]),
        Number(p["hour"]),
        Number(p["minute"]),
        Number(p["second"]),
      );
    };
    const offsets = new Set<number>();
    for (let h = -36; h <= 36; h += 6) {
      const instant = nominal + h * 3600000;
      offsets.add(civilEpoch(instant) - instant);
    }
    const candidates = [...offsets]
      .map((offset) => nominal - offset)
      .filter((instant) => civilEpoch(instant) === nominal);
    if (!candidates.length) return attendanceFailure("invalid_datetime");
    if (candidates.length !== 1) return attendanceFailure("ambiguous_datetime");
    return { ok: true, data: new Date(candidates[0]!).toISOString() };
  } catch {
    return attendanceFailure("invalid_datetime");
  }
}
