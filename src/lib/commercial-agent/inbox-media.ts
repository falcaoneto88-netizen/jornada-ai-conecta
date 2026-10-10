import { z } from "zod";

export const INBOX_MEDIA_MAX_BYTES = 5 * 1024 * 1024;
export const inboxAttachmentSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(180)
      .refine(
        (s) =>
          !s.includes("/") &&
          !s.includes("\\") &&
          [...s].every((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127),
      ),
    mimeType: z.enum([
      "image/jpeg",
      "image/png",
      "image/gif",
      "audio/mpeg",
      "audio/wav",
      "audio/ogg",
      "audio/mp4",
      "audio/aac",
    ]),
    base64: z
      .string()
      .min(4)
      .max(Math.ceil(INBOX_MEDIA_MAX_BYTES / 3) * 4),
  })
  .strict();
export type InboxAttachment = z.infer<typeof inboxAttachmentSchema>;
export const inboxAttachmentsSchema = z.array(inboxAttachmentSchema).max(1);
