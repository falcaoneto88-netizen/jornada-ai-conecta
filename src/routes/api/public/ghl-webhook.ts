import { createFileRoute } from "@tanstack/react-router";

import { processarWebhook } from "@/lib/ghl-webhook.core";
import {
  GHL_LOCATION_ESPERADA,
  buscarContactoGhl,
  criarStore,
} from "@/lib/ghl-webhook.server";

export const Route = createFileRoute("/api/public/ghl-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["GHL_WEBHOOK_SECRET"] ?? null;
        const token = process.env["GHL_PRIVATE_TOKEN"] ?? null;
        const corpo = await request.text();

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { status, body } = await processarWebhook(
          { corpo, segredoRecebido: request.headers.get("x-webhook-secret") },
          {
            secret,
            tokenPresente: Boolean(token),
            locationEsperada: GHL_LOCATION_ESPERADA,
            store: criarStore(supabaseAdmin as never),
            fetchContact: (contactId) => buscarContactoGhl(contactId, token ?? ""),
          },
        );

        return Response.json(body, { status });
      },
      GET: async () =>
        Response.json(
          {
            ok: true,
            servico: "ghl-webhook",
            metodo: "POST",
            autenticacao: "cabeçalho x-webhook-secret (Custom Webhook do GoHighLevel)",
            eventos: ["contact.created", "contact.updated"],
          },
          { status: 200 },
        ),
    },
  },
});
