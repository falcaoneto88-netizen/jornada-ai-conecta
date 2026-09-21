import { z } from "zod";

export const MCP_PUBLIC_URL = "https://jornada-ai-conecta.lovable.app/mcp";
const toolsSchema = z.object({
  result: z.object({
    tools: z.array(z.object({ name: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/) })).max(100),
  }),
});

/** Fixed destination, no redirects, no credentials/error bodies in the result. */
export async function lerCatalogoPublicado(authorization: string, transport: typeof fetch = fetch) {
  if (!authorization.startsWith("Bearer ") || authorization.length < 10) {
    return { ok: false as const, status: 401, tools: [] as string[] };
  }
  try {
    const response = await transport(MCP_PUBLIC_URL, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: authorization,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "catalog-audit",
        method: "tools/list",
        params: {},
      }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return { ok: false as const, status: response.status, tools: [] as string[] };
    }
    const text = await response.text();
    if (text.length > 256_000) return { ok: false as const, status: 502, tools: [] as string[] };
    const payloads = response.headers.get("content-type")?.includes("text/event-stream")
      ? text
          .split(/\r?\n\r?\n/)
          .map((event) =>
            event
              .split(/\r?\n/)
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trim())
              .join("\n"),
          )
          .filter(Boolean)
      : [text];
    for (const payload of payloads) {
      let decoded: unknown;
      try {
        decoded = JSON.parse(payload);
      } catch {
        continue;
      }
      const parsed = toolsSchema.safeParse(decoded);
      if (parsed.success)
        return {
          ok: true as const,
          status: 200,
          tools: [...new Set(parsed.data.result.tools.map((t) => t.name))].sort(),
        };
    }
    return { ok: false as const, status: 502, tools: [] as string[] };
  } catch {
    return { ok: false as const, status: 503, tools: [] as string[] };
  }
}
