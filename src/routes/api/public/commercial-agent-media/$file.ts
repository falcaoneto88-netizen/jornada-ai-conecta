import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/commercial-agent-media/$file")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { serveInboxMedia } = await import("@/lib/commercial-agent/media-http.server");
        return serveInboxMedia(request, params.file);
      },
      HEAD: async ({ request, params }) => {
        const { serveInboxMedia } = await import("@/lib/commercial-agent/media-http.server");
        return serveInboxMedia(request, params.file);
      },
    },
  },
});
