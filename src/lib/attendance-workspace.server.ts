import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AttendanceRpc } from "./attendance-context.server";
import { normalizarConversas, type ConversaGhl } from "./ghl-observation.core";
import {
  ghlFetch,
  GHL_ORIGIN,
  GHL_VERSION,
  readGhlSecrets,
  type GhlConfig,
  type GhlResult,
} from "./ghl.server";
import {
  attendanceWorkspaceFailure,
  attendanceWorkspaceInputSchema,
  attendanceWorkspaceSchema,
  attendanceConversationInputSchema,
  type AttendanceWorkspaceInput,
  type AttendanceWorkspaceResult,
  type AttendanceConversationResolution,
} from "./attendance-workspace.core";

export class AttendanceWorkspaceService {
  constructor(private readonly rpc: AttendanceRpc) {}
  async read(
    scope: { organizationId: string; actorId: string },
    input: AttendanceWorkspaceInput,
  ): Promise<AttendanceWorkspaceResult> {
    const parsed = attendanceWorkspaceInputSchema.safeParse(input);
    if (!parsed.success || !z.string().uuid().safeParse(scope.actorId).success)
      return attendanceWorkspaceFailure("invalid_input");
    if (parsed.data.organizationId !== scope.organizationId)
      return attendanceWorkspaceFailure("forbidden");
    try {
      const result = await this.rpc.rpc("attendance_workspace_read", {
        _org: scope.organizationId,
        _actor: scope.actorId,
        _owner: parsed.data.ownerFilter,
        _view: parsed.data.view,
        _page: parsed.data.page,
        _size: parsed.data.pageSize,
      });
      if (result.error) {
        const code = (result.error as { code?: unknown }).code;
        return attendanceWorkspaceFailure(
          ["PGRST202", "42883", "42703"].includes(String(code))
            ? "migration_required"
            : "unavailable",
        );
      }
      const error = (result.data as { error?: unknown } | null)?.error;
      if (error === "forbidden" || error === "invalid_input")
        return attendanceWorkspaceFailure(error);
      const data = attendanceWorkspaceSchema.safeParse(result.data);
      if (
        !data.success ||
        data.data.organizationId !== scope.organizationId ||
        data.data.page.index !== parsed.data.page ||
        data.data.page.size !== parsed.data.pageSize
      )
        return attendanceWorkspaceFailure("unavailable");
      return { ok: true, data: data.data };
    } catch {
      return attendanceWorkspaceFailure("unavailable");
    }
  }
}
export async function authenticatedAttendanceWorkspace(
  context: { supabase: SupabaseClient; userId: string },
  organizationId: string,
) {
  try {
    const { data, error } = await context.supabase
      .from("profiles")
      .select("organization_id")
      .eq("id", context.userId)
      .maybeSingle();
    if (error || !data?.organization_id || data.organization_id !== organizationId)
      return { failure: attendanceWorkspaceFailure("forbidden") };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return {
      service: new AttendanceWorkspaceService(supabaseAdmin as unknown as AttendanceRpc),
      scope: { organizationId: data.organization_id as string, actorId: context.userId },
    };
  } catch {
    return { failure: attendanceWorkspaceFailure("unavailable") };
  }
}

type ReadGhl = (
  cfg: GhlConfig,
  path: string,
  init?: { query?: Record<string, string | undefined> },
) => Promise<GhlResult<unknown>>;
/** Only contact + conversation metadata; never creates conversations or loads message histories. */
export async function resolveAttendanceConversationsVerified(
  scope: { organizationId: string; ghlContactId: string; locationId: string },
  config: GhlConfig,
  get: ReadGhl = ghlFetch,
): Promise<AttendanceWorkspaceResult<AttendanceConversationResolution>> {
  if (
    !attendanceConversationInputSchema.safeParse({
      organizationId: scope.organizationId,
      ghlContactId: scope.ghlContactId,
    }).success ||
    config.locationId !== scope.locationId
  )
    return attendanceWorkspaceFailure("forbidden");
  try {
    const response = await get(config, `contacts/${scope.ghlContactId}`);
    if (!response.ok) return attendanceWorkspaceFailure("contact_not_verified");
    const contact = z
      .object({ contact: z.object({ id: z.string(), locationId: z.string() }) })
      .safeParse(response.data);
    if (
      !contact.success ||
      contact.data.contact.id !== scope.ghlContactId ||
      contact.data.contact.locationId !== scope.locationId
    )
      return attendanceWorkspaceFailure("contact_not_verified");
    const results = new Map<string, ConversaGhl>();
    let cursor: string | undefined,
      complete = false;
    // Bounded read by one exact contact. A pagination boundary never means unique conversation.
    for (let page = 0; page < 4; page++) {
      const res = await get(config, "conversations/search", {
        query: {
          locationId: scope.locationId,
          contactId: scope.ghlContactId,
          limit: "25",
          sort: "desc",
          sortBy: "last_message_date",
          status: "all",
          ...(cursor ? { startAfterDate: cursor } : {}),
        },
      });
      if (!res.ok) return attendanceWorkspaceFailure("unavailable");
      const batch = normalizarConversas(res.data, scope.locationId, cursor);
      if (batch.conversas.some((c) => c.contactId !== scope.ghlContactId))
        return attendanceWorkspaceFailure("contact_not_verified");
      for (const c of batch.conversas) results.set(c.id, c);
      if (!batch.proximoCursor) {
        // Search's official contract includes total. Missing coverage cannot establish uniqueness.
        complete = !batch.limitePaginacao && batch.total !== null && batch.total === results.size;
        break;
      }
      cursor = batch.proximoCursor;
    }
    const conversations = [...results.values()].map((c) => ({
      id: c.id,
      contactId: c.contactId,
      locationId: c.locationId,
      name: c.nome,
      channel: c.tipo,
      lastMessageAt: c.ultimaData,
    }));
    return {
      ok: true,
      data: {
        ...scope,
        checkedAt: new Date().toISOString(),
        complete,
        resolution: !complete
          ? "incomplete"
          : conversations.length === 0
            ? "none"
            : conversations.length === 1
              ? "single"
              : "multiple",
        conversations,
      },
    };
  } catch {
    return attendanceWorkspaceFailure("unavailable");
  }
}
export async function authenticatedAttendanceConversations(
  context: { supabase: SupabaseClient; userId: string },
  input: { organizationId: string; ghlContactId: string },
): Promise<AttendanceWorkspaceResult<AttendanceConversationResolution>> {
  try {
    const { resolverAcesso } = await import("./ghl.functions");
    const access = await resolverAcesso(context, [
      "administrador",
      "gestor",
      "comercial",
      "visualizador",
    ]);
    if (!access.ok || access.acesso.orgId !== input.organizationId)
      return attendanceWorkspaceFailure("forbidden");
    const token = readGhlSecrets().token;
    if (!token) return attendanceWorkspaceFailure("unavailable");
    const scope = {
      organizationId: access.acesso.orgId,
      ghlContactId: input.ghlContactId,
      locationId: access.acesso.locationId,
    };
    return resolveAttendanceConversationsVerified(scope, {
      baseUrl: GHL_ORIGIN,
      version: GHL_VERSION,
      token,
      locationId: scope.locationId,
    });
  } catch {
    return attendanceWorkspaceFailure("unavailable");
  }
}
