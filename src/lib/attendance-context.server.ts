import type { SupabaseClient } from "@supabase/supabase-js";
import {
  attendanceCivilToUtc,
  attendanceContextSchema,
  attendanceFailure,
  attendanceSaveSchema,
  attendanceScopeSchema,
  type AttendanceResult,
  type AttendanceScope,
  type AttendanceSaveInput,
} from "./attendance-context.core";

export type AttendanceRpc = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};
export type VerifiedAttendanceScope = AttendanceScope & { actorId: string };

/** Local-only context. No provider API, clinical notes, calendar changes or message dispatch. */
export class AttendanceContextService {
  constructor(private readonly rpc: AttendanceRpc) {}

  async read(scope: VerifiedAttendanceScope): Promise<AttendanceResult> {
    return this.command(scope, "read", {});
  }

  async save(
    scope: VerifiedAttendanceScope,
    input: AttendanceSaveInput,
  ): Promise<AttendanceResult> {
    const parsed = attendanceSaveSchema.safeParse(input);
    if (!parsed.success) return attendanceFailure("invalid_input");
    if (input.organizationId !== scope.organizationId || input.ghlContactId !== scope.ghlContactId)
      return attendanceFailure("forbidden");
    const context = await this.read(scope);
    if (!context.ok) return context;
    if (!context.data.canEdit) return attendanceFailure("forbidden");
    if (parsed.data.expectedTimezone !== context.data.timezone)
      return attendanceFailure("conflict");
    let dueAt: string | null = null;
    if (parsed.data.returnAction === "set") {
      const converted = attendanceCivilToUtc(parsed.data.dueLocal!, context.data.timezone);
      if (!converted.ok) return converted;
      dueAt = converted.data;
    }
    return this.command(scope, "save", {
      expectedVersion: parsed.data.expectedVersion,
      ownerId: parsed.data.ownerId,
      returnAction: parsed.data.returnAction,
      returnText: parsed.data.returnText ?? null,
      dueAt,
      timezone: context.data.timezone,
    });
  }

  private async command(
    scope: VerifiedAttendanceScope,
    op: "read" | "save",
    data: Record<string, unknown>,
  ): Promise<AttendanceResult> {
    if (
      !attendanceScopeSchema.safeParse({
        organizationId: scope.organizationId,
        ghlContactId: scope.ghlContactId,
      }).success ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(scope.actorId)
    )
      return attendanceFailure("invalid_input");
    try {
      const result = await this.rpc.rpc("attendance_context_command", {
        _op: op,
        _org: scope.organizationId,
        _actor: scope.actorId,
        _contact: scope.ghlContactId,
        _data: data,
      });
      if (result.error) {
        const code = (result.error as { code?: unknown }).code;
        return attendanceFailure(
          code === "PGRST202" || code === "42883" || code === "42703"
            ? "migration_required"
            : "unavailable",
        );
      }
      const error = (result.data as { error?: unknown } | null)?.error;
      if (
        error === "forbidden" ||
        error === "conflict" ||
        error === "invalid_input" ||
        error === "contact_not_synced"
      )
        return attendanceFailure(error);
      const parsed = attendanceContextSchema.safeParse(result.data);
      if (
        !parsed.success ||
        parsed.data.organizationId !== scope.organizationId ||
        parsed.data.contact.ghlContactId !== scope.ghlContactId
      )
        return attendanceFailure("unavailable");
      return { ok: true, data: parsed.data };
    } catch {
      return attendanceFailure("unavailable");
    }
  }
}

export async function authenticatedAttendanceContext(
  context: { supabase: SupabaseClient; userId: string },
  input: AttendanceScope,
): Promise<
  | { service: AttendanceContextService; scope: VerifiedAttendanceScope }
  | { failure: AttendanceResult }
> {
  try {
    const { data, error } = await context.supabase
      .from("profiles")
      .select("organization_id")
      .eq("id", context.userId)
      .maybeSingle();
    if (error || !data?.organization_id || data.organization_id !== input.organizationId)
      return { failure: attendanceFailure("forbidden") };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return {
      scope: {
        organizationId: data.organization_id,
        ghlContactId: input.ghlContactId,
        actorId: context.userId,
      },
      service: new AttendanceContextService(supabaseAdmin as unknown as AttendanceRpc),
    };
  } catch {
    return { failure: attendanceFailure("unavailable") };
  }
}
