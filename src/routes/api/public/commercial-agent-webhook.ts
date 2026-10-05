import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/public/commercial-agent-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { agentWebhook } = await import("@/lib/commercial-agent/http.server");
        return agentWebhook(request);
      },
      GET: () =>
        Response.json({
          service: "commercial-agent-v02",
          mode: "supervised_only",
        }),
    },
  },
});
