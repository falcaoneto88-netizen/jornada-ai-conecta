import { createFileRoute } from "@tanstack/react-router";

const cabecalhos = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } as const;

const recusa = (status: number, erro: string) =>
  Response.json({ ok: false, error: erro }, { status, headers: cabecalhos });

/**
 * Indicadores comerciais agregados da organização/funil vinculados à concessão.
 * Sem query nem corpo: a organização vem sempre do bearer, validado server-side.
 */
export const Route = createFileRoute("/api/ad-navigator/v1/summary")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        if ([...url.searchParams.keys()].length > 0) return recusa(400, "pedido_invalido");

        const autorizacao = request.headers.get("authorization") ?? "";
        if (!autorizacao.startsWith("Bearer ")) return recusa(401, "credencial_invalida");
        const bearer = autorizacao.slice(7).trim();
        if (bearer.length < 20 || bearer.length > 256) return recusa(401, "credencial_invalida");

        const { lerResumo, limitePermitido, sha256hex } = await import("@/lib/ad-navigator.server");
        if (!(await limitePermitido(`summary:${sha256hex(bearer)}`))) {
          return recusa(429, "demasiados_pedidos");
        }
        const r = await lerResumo(bearer);
        if (!r.ok) return recusa(r.status, r.erro);
        return Response.json(r.body, { status: 200, headers: cabecalhos });
      },
    },
  },
});
