import { createClient } from "@supabase/supabase-js";

type Rpc = (
  body: string,
  signature: string,
) => Promise<{ data: unknown; error: { code?: string } | null }>;
const reply = (body: unknown, status: number) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Ingresso limitado; a assinatura também é verificada pelo próprio PostgreSQL. */
export async function receiveBioreportRequest(request: Request, rpc: Rpc): Promise<Response> {
  const signature = request.headers.get("x-bioreport-signature") ?? "";
  if (!/^[a-f0-9]{64}$/.test(signature)) return reply({ error: "unauthorized" }, 401);
  if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json")
    return reply({ error: "invalid_content_type" }, 415);
  const reader = request.body?.getReader();
  if (!reader) return reply({ error: "invalid_event" }, 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) {
        await reader.cancel();
        return reply({ error: "event_too_large" }, 413);
      }
      chunks.push(value);
    }
    const body = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
    const { data, error } = await rpc(body, signature);
    if (error) {
      const status =
        error.code === "28000"
          ? 401
          : ["23503", "23505"].includes(error.code ?? "")
            ? 409
            : ["22023", "22P02", "22007", "22008"].includes(error.code ?? "")
              ? 400
              : 503;
      return reply(
        {
          error:
            status === 401
              ? "unauthorized"
              : status === 409
                ? "contact_or_event_conflict"
                : status === 400
                  ? "invalid_event"
                  : "integration_unavailable",
        },
        status,
      );
    }
    return reply(data, 200);
  } catch {
    return reply({ error: "integration_unavailable" }, 503);
  } finally {
    reader.releaseLock();
  }
}

/** Cliente público: só a RPC assinada é executável; nenhuma chave service role. */
export async function receiveBioreport(request: Request) {
  return receiveBioreportRequest(request, async (body, signature) => {
    const url = process.env["SUPABASE_URL"] || import.meta.env["VITE_SUPABASE_URL"];
    const key =
      process.env["SUPABASE_PUBLISHABLE_KEY"] ||
      import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ||
      process.env["SUPABASE_ANON_KEY"];
    if (!url || !key) throw new Error("configuration");
    const publishable = key.startsWith("sb_publishable_");
    if (!publishable) {
      // Chaves legadas só podem ser anon, nunca service_role.
      const claims = JSON.parse(Buffer.from(key.split(".")[1] ?? "", "base64url").toString("utf8"));
      if (claims.role !== "anon") throw new Error("configuration");
    }
    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) => {
          const headers = new Headers(init?.headers);
          if (publishable && headers.get("Authorization") === `Bearer ${key}`)
            headers.delete("Authorization");
          headers.set("apikey", key);
          return fetch(input, { ...init, headers });
        },
      },
    });
    return await client.rpc("receive_bioreport_event", { _body: body, _signature: signature });
  });
}
