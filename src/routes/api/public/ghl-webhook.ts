import { createFileRoute } from "@tanstack/react-router";
import { createHash, createHmac, timingSafeEqual } from "crypto";

function comparaSeguro(a: string, b: string) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export const Route = createFileRoute("/api/public/ghl-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const segredo = process.env["GHL_WEBHOOK_SECRET"];
        if (!segredo) {
          return Response.json({ ok: false, error: "webhook_nao_configurado" }, { status: 503 });
        }

        const corpo = await request.text();
        if (corpo.length > 512_000) {
          return Response.json({ ok: false, error: "payload_demasiado_grande" }, { status: 413 });
        }

        const headerSecret = request.headers.get("x-webhook-secret") ?? "";
        const assinatura = request.headers.get("x-wh-signature") ?? request.headers.get("x-hub-signature-256") ?? "";
        const esperado = createHmac("sha256", segredo).update(corpo).digest("hex");
        const valido =
          (headerSecret !== "" && comparaSeguro(headerSecret, segredo)) ||
          (assinatura !== "" && comparaSeguro(assinatura.replace(/^sha256=/, ""), esperado));

        if (!valido) {
          return Response.json({ ok: false, error: "assinatura_invalida" }, { status: 401 });
        }

        let payload: Record<string, unknown> = {};
        try {
          payload = JSON.parse(corpo) as Record<string, unknown>;
        } catch {
          return Response.json({ ok: false, error: "json_invalido" }, { status: 400 });
        }

        const idempotencyKey =
          request.headers.get("x-idempotency-key") ??
          (typeof payload["webhookId"] === "string" ? (payload["webhookId"] as string) : null) ??
          createHash("sha256").update(corpo).digest("hex");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const locationId =
          (typeof payload["locationId"] === "string" ? (payload["locationId"] as string) : null) ??
          process.env["GHL_LOCATION_ID"] ??
          null;

        let organizationId: string | null = null;
        if (locationId) {
          const { data } = await supabaseAdmin
            .from("ghl_connections")
            .select("organization_id")
            .eq("location_id", locationId)
            .maybeSingle();
          organizationId = data?.organization_id ?? null;
        }

        const { error } = await supabaseAdmin.from("webhooks_inbox").insert({
          organization_id: organizationId,
          idempotency_key: idempotencyKey,
          event_type: (payload["type"] as string) ?? (payload["event"] as string) ?? "desconhecido",
          payload,
          signature_valid: true,
          processed_at: new Date().toISOString(),
        });

        if (error) {
          // 23505 = chave duplicada → evento já recebido, resposta idempotente.
          if (error.code === "23505") {
            return Response.json({ ok: true, duplicado: true }, { status: 200 });
          }
          return Response.json({ ok: false, error: "falha_ao_registar" }, { status: 500 });
        }

        return Response.json({ ok: true }, { status: 200 });
      },
      GET: async () =>
        Response.json({ ok: true, servico: "ghl-webhook", metodo: "POST" }, { status: 200 }),
    },
  },
});
