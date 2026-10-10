import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { AgentError } from "./core";
import { inboxAttachmentsSchema, INBOX_MEDIA_MAX_BYTES, type InboxAttachment } from "./inbox-media";

export const INBOX_MEDIA_TTL_MS = 10 * 60_000;
// Canonical original app only. Never derive a provider fetch URL from a client Host header.
export const INBOX_MEDIA_ORIGIN = "https://jornada-ai-conecta.lovable.app";
export type StoredInboxAttachment = InboxAttachment & { sha256: string; size: number };
export type InboxMedia = {
  issuedAt: string;
  expiresAt: string;
  attachments: StoredInboxAttachment[];
};
export type MediaBinding = { id: string; organization_id: string; request_id: string };
const extensions: Record<InboxAttachment["mimeType"], string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
};
const starts = (b: Buffer, value: string) =>
  b.subarray(0, value.length).toString("ascii") === value;

function pngStructure(b: Buffer): boolean {
  if (b.length < 57 || !b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return false;
  let imageData = false;
  for (let offset = 8; offset + 12 <= b.length;) {
    const length = b.readUInt32BE(offset),
      type = b.toString("ascii", offset + 4, offset + 8);
    if (offset + length + 12 > b.length) return false;
    if (
      offset === 8 &&
      (type !== "IHDR" ||
        length !== 13 ||
        b.readUInt32BE(offset + 8) === 0 ||
        b.readUInt32BE(offset + 12) === 0)
    )
      return false;
    if (type === "IDAT" && length > 0) imageData = true;
    if (type === "IEND") return length === 0 && offset + 12 === b.length && imageData;
    offset += length + 12;
  }
  return false;
}
function wavStructure(b: Buffer): boolean {
  if (
    b.length < 46 ||
    !starts(b, "RIFF") ||
    b.toString("ascii", 8, 12) !== "WAVE" ||
    b.readUInt32LE(4) + 8 !== b.length
  )
    return false;
  let format = false,
    data = false;
  for (let offset = 12; offset + 8 <= b.length;) {
    const length = b.readUInt32LE(offset + 4),
      type = b.toString("ascii", offset, offset + 4);
    if (offset + 8 + length > b.length) return false;
    if (type === "fmt ") {
      if (length < 16) return false;
      const codec = b.readUInt16LE(offset + 8),
        channels = b.readUInt16LE(offset + 10),
        rate = b.readUInt32LE(offset + 12),
        bits = b.readUInt16LE(offset + 22);
      if (
        ![1, 3].includes(codec) ||
        channels < 1 ||
        channels > 8 ||
        rate < 8000 ||
        rate > 192000 ||
        ![8, 16, 24, 32, 64].includes(bits)
      )
        return false;
      format = true;
    }
    if (type === "data" && length > 0) data = true;
    offset += 8 + length + (length % 2);
  }
  return format && data;
}
function signature(b: Buffer, mime: InboxAttachment["mimeType"]): boolean {
  if (mime === "image/jpeg")
    return (
      b.length >= 32 &&
      b[0] === 0xff &&
      b[1] === 0xd8 &&
      b[2] === 0xff &&
      b.at(-2) === 0xff &&
      b.at(-1) === 0xd9
    );
  if (mime === "image/png") return pngStructure(b);
  if (mime === "image/gif")
    return (
      b.length >= 26 &&
      (starts(b, "GIF87a") || starts(b, "GIF89a")) &&
      b.readUInt16LE(6) > 0 &&
      b.readUInt16LE(8) > 0 &&
      b.at(-1) === 0x3b
    );
  if (mime === "audio/wav") return wavStructure(b);
  if (mime === "audio/ogg")
    return (
      b.length >= 64 &&
      starts(b, "OggS") &&
      b[4] === 0 &&
      (b.subarray(0, 256).includes(Buffer.from("OpusHead")) ||
        b.subarray(0, 256).includes(Buffer.from("vorbis")))
    );
  if (mime === "audio/mpeg") {
    let offset = 0;
    if (starts(b, "ID3")) {
      if (b.length < 10 || b.subarray(6, 10).some((value) => value > 127)) return false;
      offset = 10 + ((b[6]! << 21) | (b[7]! << 14) | (b[8]! << 7) | b[9]!);
      if (b[3] === 4 && b[5]! & 0x10) offset += 10;
    }
    return (
      b.length >= offset + 24 &&
      b[offset] === 0xff &&
      (b[offset + 1]! & 0xe0) === 0xe0 &&
      (b[offset + 1]! & 6) !== 0 &&
      (b[offset + 2]! & 0xf0) !== 0xf0 &&
      (b[offset + 2]! & 0xf0) !== 0 &&
      (b[offset + 2]! & 0x0c) !== 0x0c
    );
  }
  if (mime === "audio/aac") {
    const frameLength = b.length >= 7 ? ((b[3]! & 3) << 11) | (b[4]! << 3) | (b[5]! >> 5) : 0;
    return (
      b.length >= 9 &&
      b[0] === 0xff &&
      (b[1]! & 0xf6) === 0xf0 &&
      frameLength > 7 &&
      frameLength <= b.length
    );
  }
  // M4A audio containers only; generic MP4/QuickTime can carry video and are not accepted.
  return (
    b.length >= 40 &&
    b.toString("ascii", 4, 8) === "ftyp" &&
    b.toString("ascii", 8, 12) === "M4A " &&
    b.includes(Buffer.from("mdat")) &&
    b.includes(Buffer.from("moov"))
  );
}
export function validateInboxAttachments(raw: unknown): StoredInboxAttachment[] {
  const parsed = inboxAttachmentsSchema.safeParse(raw ?? []);
  if (!parsed.success) throw new AgentError("media_invalid");
  return parsed.data.map((a) => {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(a.base64) || a.base64.length % 4 !== 0)
      throw new AgentError("media_invalid");
    const bytes = Buffer.from(a.base64, "base64");
    if (bytes.length > INBOX_MEDIA_MAX_BYTES) throw new AgentError("media_too_large");
    if (bytes.toString("base64") !== a.base64 || !signature(bytes, a.mimeType))
      throw new AgentError("media_unsupported");
    return { ...a, sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length };
  });
}
export const mediaManifest = (attachments: StoredInboxAttachment[] = []) =>
  attachments.map(({ name, mimeType, sha256, size }) => ({ name, mimeType, sha256, size }));
export function mediaToken(
  binding: MediaBinding,
  media: InboxMedia,
  index: number,
  key: string,
): string {
  const attachment = media.attachments[index];
  const secret = Buffer.from(key, "base64");
  if (!attachment || secret.length !== 32) throw new AgentError("media_invalid");
  return createHmac("sha256", secret)
    .update(
      JSON.stringify([
        "inbox-media-v1",
        binding.organization_id,
        binding.request_id,
        binding.id,
        index,
        attachment.sha256,
        media.expiresAt,
      ]),
    )
    .digest("base64url");
}
export function mediaUrls(binding: MediaBinding, media: InboxMedia, key: string): string[] {
  return media.attachments.map(
    (a, index) =>
      `${INBOX_MEDIA_ORIGIN}/api/public/commercial-agent-media/${binding.id}.${extensions[a.mimeType]}?index=${index}&token=${mediaToken(binding, media, index, key)}`,
  );
}
export function validMediaToken(received: string, expected: string): boolean {
  return (
    /^[A-Za-z0-9_-]{43}$/.test(received) &&
    timingSafeEqual(Buffer.from(received), Buffer.from(expected))
  );
}

/** Receipt URLs must equal the server-generated, content-bound manifest; no text-only reconciliation. */
export function sameMediaReceipt(raw: unknown, expected: readonly string[]): boolean {
  if (raw == null) return expected.length === 0;
  if (!Array.isArray(raw) || raw.length !== expected.length) return false;
  const urls = raw.map((v: unknown) =>
    typeof v === "string"
      ? v
      : v && typeof v === "object" && "url" in v && typeof v.url === "string"
        ? v.url
        : null,
  );
  return urls.every((value, index) => value === expected[index]);
}
