import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  appointmentFinanceEntrySchema,
  appointmentFinanceFailure,
  appointmentFinanceReadFailure,
  appointmentFinanceReadSchema,
  appointmentFinanceSaveSchema,
  type AppointmentFinanceErrorCode,
  type AppointmentFinanceReadResult,
  type AppointmentFinanceSaveResult,
} from "./appointment-finance.core";

export type AppointmentFinanceRpc = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};
export type AppointmentFinanceScope = { organizationId: string; actorId: string };
const scopeSchema = z
  .object({ organizationId: z.string().uuid(), actorId: z.string().uuid() })
  .strict();
const readResultSchema = z
  .object({
    available: z.literal(true),
    entries: z.array(appointmentFinanceEntrySchema).max(200),
    canEdit: z.literal(true),
  })
  .strict();
const errorCodes = new Set<AppointmentFinanceErrorCode>([
  "forbidden",
  "appointment_not_found",
  "invalid_input",
  "conflict",
  "request_mismatch",
]);

/** Local administrative overlay. It never changes appointments or calls a provider. */
export class AppointmentFinanceService {
  constructor(private readonly rpc: AppointmentFinanceRpc) {}

  async read(
    scope: AppointmentFinanceScope,
    input: unknown,
  ): Promise<AppointmentFinanceReadResult> {
    const parsed = appointmentFinanceReadSchema.safeParse(input);
    if (!parsed.success || !scopeSchema.safeParse(scope).success)
      return appointmentFinanceReadFailure("invalid_input");
    const result = await this.command(scope, "read", parsed.data);
    if (!result.ok) return appointmentFinanceReadFailure(result.code);
    const data = readResultSchema.safeParse(result.data);
    const requested = new Set(parsed.data.appointmentIds);
    if (
      !data.success ||
      data.data.entries.some((entry) => !requested.has(entry.appointmentId)) ||
      new Set(data.data.entries.map((entry) => entry.appointmentId)).size !==
        data.data.entries.length
    )
      return appointmentFinanceReadFailure("unavailable");
    return data.data;
  }

  async save(
    scope: AppointmentFinanceScope,
    input: unknown,
  ): Promise<AppointmentFinanceSaveResult> {
    const parsed = appointmentFinanceSaveSchema.safeParse(input);
    if (!parsed.success || !scopeSchema.safeParse(scope).success)
      return appointmentFinanceFailure("invalid_input");
    const result = await this.command(scope, "save", parsed.data);
    if (!result.ok) return appointmentFinanceFailure(result.code);
    const data = z.object({ entry: appointmentFinanceEntrySchema }).strict().safeParse(result.data);
    if (
      !data.success ||
      data.data.entry.appointmentId !== parsed.data.appointmentId ||
      data.data.entry.totalCents !== parsed.data.totalCents ||
      data.data.entry.depositCents !== parsed.data.depositCents ||
      data.data.entry.updatedBy !== scope.actorId ||
      data.data.entry.revision !== parsed.data.expectedRevision + 1
    )
      return appointmentFinanceFailure("unavailable");
    return { ok: true, entry: data.data.entry };
  }

  private async command(
    scope: AppointmentFinanceScope,
    op: "read" | "save",
    data: Record<string, unknown>,
  ) {
    try {
      const result = await this.rpc.rpc("appointment_finance_command", {
        _op: op,
        _org: scope.organizationId,
        _actor: scope.actorId,
        _data: data,
      });
      if (result.error) {
        const code = (result.error as { code?: unknown }).code;
        return {
          ok: false as const,
          code: (["PGRST202", "42P01", "42883", "42703"].includes(String(code))
            ? "migration_required"
            : "unavailable") as AppointmentFinanceErrorCode,
        };
      }
      const error = (result.data as { error?: unknown } | null)?.error;
      if (typeof error === "string")
        return {
          ok: false as const,
          code: errorCodes.has(error as AppointmentFinanceErrorCode)
            ? (error as AppointmentFinanceErrorCode)
            : ("unavailable" as const),
        };
      return { ok: true as const, data: result.data };
    } catch {
      return { ok: false as const, code: "unavailable" as const };
    }
  }
}

export async function authenticatedAppointmentFinance(context: {
  supabase: SupabaseClient;
  userId: string;
}): Promise<
  | { service: AppointmentFinanceService; scope: AppointmentFinanceScope }
  | { failure: AppointmentFinanceErrorCode }
> {
  try {
    const { resolverAcesso } = await import("./ghl.functions");
    const access = await resolverAcesso(context, ["administrador", "gestor", "comercial"]);
    if (!access.ok) return { failure: "forbidden" };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return {
      scope: { organizationId: access.acesso.orgId, actorId: context.userId },
      service: new AppointmentFinanceService(supabaseAdmin as unknown as AppointmentFinanceRpc),
    };
  } catch {
    return { failure: "unavailable" };
  }
}
