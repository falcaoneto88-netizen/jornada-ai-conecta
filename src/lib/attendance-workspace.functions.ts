import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  attendanceWorkspaceInputSchema,
  attendanceConversationInputSchema,
} from "./attendance-workspace.core";

export const readAttendanceWorkspace = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(attendanceWorkspaceInputSchema)
  .handler(async ({ data, context }) => {
    const { authenticatedAttendanceWorkspace } = await import("./attendance-workspace.server");
    const auth = await authenticatedAttendanceWorkspace(context, data.organizationId);
    return "failure" in auth ? auth.failure : auth.service.read(auth.scope, data);
  });
export const resolveAttendanceConversations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(attendanceConversationInputSchema)
  .handler(async ({ data, context }) => {
    const { authenticatedAttendanceConversations } = await import("./attendance-workspace.server");
    return authenticatedAttendanceConversations(context, data);
  });
