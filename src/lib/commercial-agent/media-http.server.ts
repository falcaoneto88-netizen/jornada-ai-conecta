import { z } from "zod";
import { unseal } from "./providers.server";
import { manualHash, type ManualPayload } from "./service.server";
import {
  mediaManifest,
  mediaToken,
  validMediaToken,
  validateInboxAttachments,
  INBOX_MEDIA_TTL_MS,
} from "./inbox-media.server";

export type MediaRow = {
  id: string;
  organization_id: string;
  request_id: string;
  location_id: string;
  contact_id: string;
  conversation_id: string;
  state: string;
  dispatch_id: string | null;
  payload: string;
  reply_hash: string;
  created_at: string;
};
type MediaDeps = { read(id: string): Promise<MediaRow | null>; key: string; now?: () => number };
const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};
const hidden = () => new Response(null, { status: 404, headers });

/**
 * A short-lived bearer capability for provider retrieval, NOT a public permanent upload.
 * Never logs the request, URL, token, file name, bytes or provider response.
 * Possession of the URL grants read access for at most ten minutes; GHL/Zaptos can keep their copy.
 */
export async function inboxMediaResponse(
  request: Request,
  file: string,
  deps: MediaDeps,
): Promise<Response> {
  try {
    if (!["GET", "HEAD"].includes(request.method))
      return new Response(null, { status: 405, headers: { ...headers, Allow: "GET, HEAD" } });
    const match = /^([a-f0-9-]{36})\.(jpg|png|gif|mp3|wav|ogg|m4a|aac)$/.exec(file);
    if (!match || !z.string().uuid().safeParse(match[1]).success) return hidden();
    const query = new URL(request.url).searchParams;
    if (
      [...query.keys()].some((k) => k !== "index" && k !== "token") ||
      query.getAll("index").length !== 1 ||
      query.getAll("token").length !== 1 ||
      query.get("index") !== "0"
    )
      return hidden();
    const token = query.get("token") ?? "";
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return hidden();
    const row = await deps.read(match[1]!);
    if (
      !row ||
      row.id !== match[1] ||
      !row.dispatch_id ||
      !["sending", "sent", "unknown"].includes(row.state)
    )
      return hidden();
    const payload = unseal<ManualPayload>(
      row.payload,
      deps.key,
      `manual:${row.organization_id}:${row.request_id}`,
    );
    const media = payload.media;
    const now = (deps.now ?? Date.now)();
    const expiry = Date.parse(media?.expiresAt ?? "");
    const issued = Date.parse(media?.issuedAt ?? "");
    if (
      !media ||
      !Number.isFinite(expiry) ||
      !Number.isFinite(issued) ||
      expiry <= now ||
      issued > now + 5000 ||
      expiry <= issued ||
      expiry - issued > INBOX_MEDIA_TTL_MS ||
      manualHash(payload) !== row.reply_hash
    )
      return hidden();
    if (
      payload.snapshot.event.locationId !== row.location_id ||
      payload.snapshot.event.contactId !== row.contact_id ||
      payload.snapshot.event.conversationId !== row.conversation_id ||
      payload.snapshot.route?.channel !== "SMS" ||
      !payload.snapshot.route.providerId
    )
      return hidden();
    if (!validMediaToken(token, mediaToken(row, media, 0, deps.key))) return hidden();
    // Recheck the actual encrypted bytes, not only a claimed content hash.
    const verified = validateInboxAttachments(
      media.attachments.map(({ name, mimeType, base64 }) => ({ name, mimeType, base64 })),
    );
    if (
      JSON.stringify(mediaManifest(verified)) !== JSON.stringify(mediaManifest(media.attachments))
    )
      return hidden();
    const attachment = verified[0];
    if (!attachment) return hidden();
    const suffixes: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/gif": "gif",
      "audio/mpeg": "mp3",
      "audio/wav": "wav",
      "audio/ogg": "ogg",
      "audio/mp4": "m4a",
      "audio/aac": "aac",
    };
    if (match[2] !== suffixes[attachment.mimeType]) return hidden();
    const bytes = Buffer.from(attachment.base64, "base64");
    const resultHeaders = {
      ...headers,
      "Content-Type": attachment.mimeType,
      "Content-Disposition": `attachment; filename="attachment.${match[2]}"`,
      "Accept-Ranges": "bytes",
    };
    const range = request.method === "GET" ? request.headers.get("range") : null;
    if (range) {
      const bounds = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!bounds || (!bounds[1] && !bounds[2]))
        return new Response(null, {
          status: 416,
          headers: { ...resultHeaders, "Content-Range": `bytes */${bytes.length}` },
        });
      const start = bounds[1] ? Number(bounds[1]) : Math.max(0, bytes.length - Number(bounds[2]));
      const end =
        bounds[1] && bounds[2] ? Math.min(Number(bounds[2]), bytes.length - 1) : bytes.length - 1;
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start > end ||
        start < 0 ||
        end >= bytes.length ||
        (!bounds[1] && Number(bounds[2]) === 0)
      )
        return new Response(null, {
          status: 416,
          headers: { ...resultHeaders, "Content-Range": `bytes */${bytes.length}` },
        });
      return new Response(new Uint8Array(bytes.subarray(start, end + 1)), {
        status: 206,
        headers: {
          ...resultHeaders,
          "Content-Range": `bytes ${start}-${end}/${bytes.length}`,
          "Content-Length": String(end - start + 1),
        },
      });
    }
    return new Response(request.method === "HEAD" ? null : new Uint8Array(bytes), {
      headers: { ...resultHeaders, "Content-Length": String(bytes.length) },
    });
  } catch {
    // Includes decryption/database errors: never forward a URL-bearing exception to the router.
    return hidden();
  }
}

export async function serveInboxMedia(request: Request, file: string): Promise<Response> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return await inboxMediaResponse(request, file, {
      key: process.env["COMMERCIAL_AGENT_ENCRYPTION_KEY"] ?? "",
      async read(id) {
        const { data, error } = await supabaseAdmin
          .from("commercial_agent_manual_dispatches")
          .select(
            "id,organization_id,request_id,location_id,contact_id,conversation_id,state,dispatch_id,payload,reply_hash,created_at",
          )
          .eq("id", id)
          .maybeSingle();
        if (error || !data) return null;
        const row = data as MediaRow;
        const binding = await supabaseAdmin
          .from("ghl_location_bindings")
          .select("organization_id")
          .eq("organization_id", row.organization_id)
          .eq("location_id", row.location_id)
          .maybeSingle();
        return binding.error || !binding.data ? null : row;
      },
    });
  } catch {
    return hidden();
  }
}
