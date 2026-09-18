import { createFileRoute } from "@tanstack/react-router";

import { ehTokenAdNav } from "@/lib/ad-navigator.core";

const cabecalhos = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } as const;

const recusa = (status: number, erro: string) =>
  Response.json({ ok: false, error: erro }, { status, headers: cabecalhos });

/**
 * Indicadores comerciais agregados da organização/funil vinculados à concessão.
 * Sem query nem corpo: a organização vem sempre do bearer, validado server-side.
 * Nenhum outro cabeçalho é lido — não há forma de contornar o limite ou a
 * autorização com cabeçalhos forjados.
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
        // Formato exato do token emitido: 32 bytes em base64url (43 caracteres).
        if (!ehTokenAdNav(bearer)) return recusa(401, "credencial_invalida");

        const { lerResumo, limitePermitido } = await import("@/lib/ad-navigator.server");
        if (!(await limitePermitido("summary", bearer))) {
          return recusa(429, "demasiados_pedidos");
        }
        const r = await lerResumo(bearer);
        if (!r.ok) return recusa(r.status, r.erro);
        return Response.json(r.body, { status: 200, headers: cabecalhos });
      },
    },
  },
});
