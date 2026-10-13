import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { attendanceScopeSchema, attendanceSaveSchema } from "./attendance-context.core";

export const readAttendanceContext = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(attendanceScopeSchema)
  .handler(async ({ data, context }) => {
    const { authenticatedAttendanceContext } = await import("./attendance-context.server");
    const access = await authenticatedAttendanceContext(context, data);
    return "failure" in access ? access.failure : access.service.read(access.scope);
  });

export const saveAttendanceContext = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(attendanceSaveSchema)
  .handler(async ({ data, context }) => {
    const { authenticatedAttendanceContext } = await import("./attendance-context.server");
    const access = await authenticatedAttendanceContext(context, data);
    return "failure" in access ? access.failure : access.service.save(access.scope, data);
  });
