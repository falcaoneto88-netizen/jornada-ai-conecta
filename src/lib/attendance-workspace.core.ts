import { z } from "zod";
import { idGhl } from "./ghl-observation.core";

export const attendanceWorkspaceScopeSchema = z
  .object({ organizationId: z.string().uuid() })
  .strict();
export const attendanceWorkspaceInputSchema = attendanceWorkspaceScopeSchema.extend({
  ownerFilter: z.enum(["mine", "all", "unassigned"]).default("mine"),
  view: z.enum(["all", "returns_today", "overdue", "appointments_today"]).default("all"),
  page: z.number().int().min(0).max(100000).default(0),
  pageSize: z.union([z.literal(25), z.literal(50)]).default(25),
});
export const attendanceConversationInputSchema = attendanceWorkspaceScopeSchema.extend({
  ghlContactId: idGhl,
});
export type AttendanceWorkspaceInput = z.infer<typeof attendanceWorkspaceInputSchema>;
export type AttendanceWorkspaceFailureCode =
  "forbidden" | "migration_required" | "invalid_input" | "unavailable" | "contact_not_verified";
export type AttendanceWorkspaceResult<T = AttendanceWorkspace> =
  | { ok: true; data: T }
  | {
      ok: false;
      code: AttendanceWorkspaceFailureCode;
      message: string;
    };
const timestamp = z.string().datetime({ offset: true });
export const attendanceWorkspaceSchema = z.object({
  organizationId: z.string().uuid(),
  timezone: z.string(),
  checkedAt: timestamp,
  day: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    startAt: timestamp,
    endAt: timestamp,
  }),
  source: z.object({
    kind: z.literal("local"),
    coverage: z.literal("linked_contacts"),
    lastContactSyncAt: timestamp.nullable(),
  }),
  counts: z.object({
    awaitingResponse: z.null(),
    returnsToday: z.number().int().nonnegative(),
    returnsOverdue: z.number().int().nonnegative(),
    appointmentsToday: z.number().int().nonnegative(),
  }),
  awaitingResponseUnavailableReason: z.literal("message_coverage_unavailable"),
  page: z.object({
    index: z.number().int().nonnegative(),
    size: z.union([z.literal(25), z.literal(50)]),
    totalItems: z.number().int().nonnegative(),
    hasMore: z.boolean(),
  }),
  rows: z
    .array(
      z.object({
        id: z.string(),
        kind: z.enum(["return", "appointment"]),
        reason: z.enum(["return_overdue", "return_today", "appointment_today"]),
        contact: z.object({ id: z.string().uuid(), ghlContactId: idGhl, name: z.string() }),
        owner: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
        dueAt: timestamp,
        nextAction: z.string().nullable(),
        appointment: z
          .object({ id: z.string().uuid(), title: z.string(), status: z.string() })
          .nullable(),
        evidence: z.object({ source: z.enum(["jornada", "ghl_cache"]), updatedAt: timestamp }),
      }),
    )
    .max(50),
});
export type AttendanceWorkspace = z.infer<typeof attendanceWorkspaceSchema>;
export type AttendanceConversationResolution = {
  organizationId: string;
  ghlContactId: string;
  locationId: string;
  checkedAt: string;
  complete: boolean;
  resolution: "none" | "single" | "multiple" | "incomplete";
  conversations: {
    id: string;
    contactId: string;
    locationId: string;
    name: string;
    channel: string;
    lastMessageAt: string | null;
  }[];
};
export function attendanceWorkspaceFailure(
  code: AttendanceWorkspaceFailureCode,
): AttendanceWorkspaceResult<never> {
  const messages: Record<AttendanceWorkspaceFailureCode, string> = {
    forbidden: "Sem permissão para consultar esta organização.",
    migration_required: "Meu dia aguarda atualização do banco de dados.",
    invalid_input: "Revise os filtros e a página solicitada.",
    unavailable:
      "Não foi possível consultar os dados agora. Isso não significa ausência de pendências.",
    contact_not_verified: "Não foi possível confirmar este contato na subconta conectada.",
  };
  return { ok: false, code, message: messages[code] };
}
