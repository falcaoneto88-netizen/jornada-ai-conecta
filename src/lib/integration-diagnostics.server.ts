import { z } from "zod";

export const MCP_PUBLIC_URL = "https://jornada-ai-conecta.lovable.app/mcp";
const toolsSchema = z.object({
  result: z.object({
    tools: z.array(z.object({ name: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/) })).max(100),
  }),
});

/**
 * Categorias fechadas de falha. Nunca se devolve cabeçalho, corpo ou exceção
 * em bruto, e nunca se atribui um 401 à exigência de client claim sem um
 * desafio `WWW-Authenticate` correspondente.
 */
export type MotivoCatalogo =
  | "ok"
  | "sem_sessao"
  | "sem_permissao"
  | "oauth_client_required"
  | "unauthorized"
  | "http_error"
  | "resposta_invalida"
  | "indisponivel";

export type ResultadoCatalogo = {
  ok: boolean;
  status: number;
  reason: MotivoCatalogo;
  tools: string[];
};

const DESAFIO_CLIENT_CLAIM = 'error_description="OAuth client claim is required"';

/** Só classifica como claim de cliente quando o desafio o declara literalmente. */
export function classificar401(wwwAuthenticate: string | null): MotivoCatalogo {
  return wwwAuthenticate?.includes(DESAFIO_CLIENT_CLAIM) ? "oauth_client_required" : "unauthorized";
}

/** Fixed destination, no redirects, no credentials/error bodies in the result. */
export async function lerCatalogoPublicado(
  authorization: string,
  transport: typeof fetch = fetch,
): Promise<ResultadoCatalogo> {
  if (!authorization.startsWith("Bearer ") || authorization.length < 10) {
    return { ok: false, status: 401, reason: "sem_sessao", tools: [] };
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
      const reason: MotivoCatalogo =
        response.status === 401
          ? classificar401(response.headers.get("www-authenticate"))
          : "http_error";
      await response.body?.cancel();
      return { ok: false, status: response.status, reason, tools: [] };
    }
    const text = await response.text();
    if (text.length > 256_000)
      return { ok: false, status: 502, reason: "resposta_invalida", tools: [] };
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
          ok: true,
          status: 200,
          reason: "ok",
          tools: [...new Set(parsed.data.result.tools.map((t) => t.name))].sort(),
        };
    }
    return { ok: false, status: 502, reason: "resposta_invalida", tools: [] };
  } catch {
    return { ok: false, status: 503, reason: "indisponivel", tools: [] };
  }
}
