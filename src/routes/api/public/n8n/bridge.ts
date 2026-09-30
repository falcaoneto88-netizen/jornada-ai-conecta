import { createFileRoute } from "@tanstack/react-router";

// Sem CORS: chamada de máquina (n8n) apenas. Só POST.
export const Route = createFileRoute("/api/public/n8n/bridge")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { receberBridgeN8n } = await import("@/lib/n8n-bridge.server");
        return receberBridgeN8n(request);
      },
    },
  },
});
