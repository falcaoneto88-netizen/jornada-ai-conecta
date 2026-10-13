import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  attendanceDraftScopeSchema,
  attendanceDraftSaveSchema,
  attendanceDraftClearSchema,
} from "./attendance-draft.core";

export const loadAttendanceDraft = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(attendanceDraftScopeSchema)
  .handler(async ({ data, context }) => {
    const { authenticatedAttendanceDraft } = await import("./attendance-draft.server");
    const auth = await authenticatedAttendanceDraft(context, data);
    return "failure" in auth ? auth.failure : auth.service.load(auth.scope);
  });

export const saveAttendanceDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(attendanceDraftSaveSchema)
  .handler(async ({ data, context }) => {
    const { authenticatedAttendanceDraft } = await import("./attendance-draft.server");
    const { text, expectedRevision, ...scope } = data;
    const auth = await authenticatedAttendanceDraft(context, scope);
    return "failure" in auth
      ? auth.failure
      : auth.service.save(auth.scope, { text, expectedRevision });
  });

export const clearAttendanceDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(attendanceDraftClearSchema)
  .handler(async ({ data, context }) => {
    const { authenticatedAttendanceDraft } = await import("./attendance-draft.server");
    const { expectedText, expectedRevision, ...scope } = data;
    const auth = await authenticatedAttendanceDraft(context, scope);
    return "failure" in auth
      ? auth.failure
      : auth.service.clear(auth.scope, { expectedText, expectedRevision });
  });
