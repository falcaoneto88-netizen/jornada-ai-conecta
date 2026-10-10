import { getNormalizedURL } from "@tanstack/router-core/ssr/server";

/** Bounds JSON/FormData before TanStack parses it. One 5 MiB attachment fits as base64. */
export const SERVER_FUNCTION_BODY_LIMIT = 8 * 1024 * 1024;

export async function boundServerFunctionBody(
  request: Request,
  base = "/_serverFn/",
  limit = SERVER_FUNCTION_BODY_LIMIT,
): Promise<Request | Response> {
  const prefix = `${base.replace(/\/+$/, "")}/`;
  if (request.method !== "POST" || !getNormalizedURL(request.url).url.pathname.startsWith(prefix))
    return request;
  const rejected = () =>
    Response.json(
      { error: "request_too_large" },
      { status: 413, headers: { "Cache-Control": "no-store" } },
    );
  const declared = request.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > limit) return rejected();
  if (!request.body) return request;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        void reader.cancel().catch(() => {});
        return rejected();
      }
      chunks.push(value);
    }
  } catch {
    return Response.json(
      { error: "request_body_unavailable" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Request(request, { body });
}
