import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/bioreport-event")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { receiveBioreport } = await import("@/lib/bioreport-events.server");
        return receiveBioreport(request);
      },
    },
  },
});
