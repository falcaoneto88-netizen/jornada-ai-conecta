import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/commercial-agent-notification")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { agentNotification } = await import("@/lib/commercial-agent/http.server");
        return agentNotification(request);
      },
    },
  },
});
