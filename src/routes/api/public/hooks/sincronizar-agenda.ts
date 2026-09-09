/**
 * Atualização automática da agenda (chamada horária agendada no backend).
 * Só aceita chamadas com o segredo interno; nunca escreve no GoHighLevel.
 */
import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";

export const Route = createFileRoute("/api/public/hooks/sincronizar-agenda")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const esperado = process.env["CRON_SECRET"] ?? "";
        const recebido = request.headers.get("x-cron-secret") ?? "";
        const a = Buffer.from(recebido, "utf8");
        const b = Buffer.from(esperado, "utf8");
        if (!esperado || a.length !== b.length || !timingSafeEqual(a, b)) {
          return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { sincronizarAgendaSistema } = await import("@/lib/ghl-agenda.server");

        try {
          const res = await sincronizarAgendaSistema(supabaseAdmin);
          return Response.json(res, { status: res.ok ? 200 : 200 });
        } catch (erro) {
          return Response.json(
            { ok: false, code: "server_error", message: erro instanceof Error ? erro.message : "falha" },
            { status: 500 },
          );
        }
      },
    },
  },
});
