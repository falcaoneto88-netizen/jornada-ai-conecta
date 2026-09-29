import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/n8n/confirmacao-consulta")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { receberConfirmacaoN8n } = await import("@/lib/n8n-confirmacao.server");
        return receberConfirmacaoN8n(request);
      },
    },
  },
});
