import { z } from "zod";

const ghlId = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
export const attendanceDraftScopeSchema = z
  .object({
    organizationId: z.string().uuid(),
    contactId: ghlId,
    conversationId: ghlId,
  })
  .strict();
export const attendanceDraftSaveSchema = attendanceDraftScopeSchema.extend({
  text: z.string().max(1500),
  expectedRevision: z.string().uuid().nullable(),
});
export const attendanceDraftClearSchema = attendanceDraftScopeSchema.extend({
  expectedText: z.string().max(1500),
  expectedRevision: z.string().uuid().nullable(),
});
export type AttendanceDraftScope = z.infer<typeof attendanceDraftScopeSchema>;
export type AttendanceDraftSave = z.infer<typeof attendanceDraftSaveSchema>;
export type AttendanceDraftClear = z.infer<typeof attendanceDraftClearSchema>;
export type AttendanceDraftSnapshot = {
  revision: string | null;
  draft: { text: string; updatedAt: string; expiresAt: string } | null;
};
export type AttendanceDraftResult =
  | { ok: true; data: AttendanceDraftSnapshot }
  | { ok: false; code: "draft_conflict"; current: AttendanceDraftSnapshot }
  | { ok: false; code: "draft_unavailable" | "forbidden" | "scope_mismatch" | "invalid_input" };

/** Draft persistence never implies permission, preparation, acceptance or delivery of a message. */
export const ATTENDANCE_DRAFT_TTL_DAYS = 7;
