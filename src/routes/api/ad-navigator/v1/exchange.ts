import { createFileRoute } from "@tanstack/react-router";

import { AD_NAV_LIMITE_BYTES, validarPedidoTroca } from "@/lib/ad-navigator.core";
import { lerCorpoLimitado } from "@/lib/falcao-lead.core";

const cabecalhos = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } as const;

const recusa = (status: number, erro: string) =>
  Response.json({ ok: false, error: erro }, { status, headers: cabecalhos });

/**
 * Troca do código de pareamento por uma concessão de leitura agregada.
 * Nenhum bearer sai do Jornada: o recetor envia apenas o SHA256 do seu token.
 */
export const Route = createFileRoute("/api/ad-navigator/v1/exchange")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") {
          return recusa(415, "tipo_de_conteudo_invalido");
        }
        const corpo = await lerCorpoLimitado(request, AD_NAV_LIMITE_BYTES);
        if (!corpo.ok) {
          return recusa(corpo.status, corpo.status === 413 ? "pedido_demasiado_grande" : "pedido_invalido");
        }
        let bruto: unknown;
        try {
          bruto = JSON.parse(new TextDecoder().decode(corpo.bytes)) as unknown;
        } catch {
          return recusa(400, "pedido_invalido");
        }
        const validado = validarPedidoTroca(bruto);
        if (!validado.ok) return recusa(400, "pedido_invalido");

        const { limitePermitido, sha256hex, trocarCodigo } = await import("@/lib/ad-navigator.server");
        if (!(await limitePermitido(`exchange:${sha256hex(validado.pedido.code)}`))) {
          return recusa(429, "demasiados_pedidos");
        }
        const r = await trocarCodigo(validado.pedido);
        if (!r.ok) return recusa(r.status, r.erro);
        return Response.json(r.body, { status: 200, headers: cabecalhos });
      },
    },
  },
});
