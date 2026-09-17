import { createFileRoute } from "@tanstack/react-router";

import {
  FALCAO_CONSENT_VERSION,
  FALCAO_LIMITE_BYTES,
  FALCAO_SOURCE,
  lerCorpoLimitado,
  processarLeadFalcao,
} from "@/lib/falcao-lead.core";
import {
  compararHex,
  criarLeadStore,
  hmacHex,
  segredoFalcao,
} from "@/lib/falcao-lead.server";

const semCache = { "Cache-Control": "no-store" } as const;

export const Route = createFileRoute("/api/public/falcao-lead")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") {
          return Response.json(
            { ok: false, erro: "tipo_de_conteudo_invalido" },
            { status: 415, headers: semCache },
          );
        }
        const corpo = await lerCorpoLimitado(request, FALCAO_LIMITE_BYTES);
        if (!corpo.ok) {
          return Response.json(
            { ok: false, erro: corpo.status === 413 ? "pedido_demasiado_grande" : "pedido_invalido" },
            { status: corpo.status, headers: semCache },
          );
        }

        const segredo = segredoFalcao();
        if (!segredo) {
          return Response.json(
            { ok: false, erro: "integracao_nao_configurada" },
            { status: 503, headers: semCache },
          );
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { status, body } = await processarLeadFalcao(
          { corpo: corpo.bytes, assinatura: request.headers.get("x-falcao-signature") },
          {
            segredo,
            store: criarLeadStore(supabaseAdmin as never, segredo),
            hmac: hmacHex,
            compararAssinatura: compararHex,
          },
        );
        return Response.json(body, { status, headers: semCache });
      },
      GET: async () =>
        Response.json(
          {
            ok: true,
            servico: "falcao-lead",
            metodo: "POST",
            autenticacao: "cabeçalho x-falcao-signature (HMAC-SHA256 do corpo exato)",
            campos: ["source", "requestId", "timestamp", "adult", "name", "phone", "email?", "consent"],
            source: FALCAO_SOURCE,
            consentVersion: FALCAO_CONSENT_VERSION,
            limiteBytes: FALCAO_LIMITE_BYTES,
          },
          { status: 200, headers: semCache },
        ),
    },
  },
});
