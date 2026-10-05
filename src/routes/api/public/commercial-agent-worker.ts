import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/public/commercial-agent-worker")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { agentWorker } = await import("@/lib/commercial-agent/http.server");
        return agentWorker(request);
      },
    },
  },
});
