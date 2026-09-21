import { createFileRoute } from "@tanstack/react-router";

/**
 * Identificador de release, seguro por construção: só metadados públicos de
 * versão, nunca segredos, ambiente, credenciais ou caminhos internos.
 *
 * `build` é estático desta revisão e nunca é nulo: serve para provar, do lado
 * de fora, qual a versão publicada. `release` é o identificador do ambiente,
 * quando existe.
 */
const BUILD = "jornada-integrations-20260921.3";

export const Route = createFileRoute("/api/version")({
  server: {
    handlers: {
      GET: async () => {
        const release = process.env["RELEASE_SHA"] ?? process.env["CF_VERSION_ID"] ?? null;
        return Response.json(
          {
            ok: true,
            service: "jornada-ai",
            build: BUILD,
            api: { "ad-navigator": 1 },
            release:
              typeof release === "string" && /^[0-9a-zA-Z._-]{4,64}$/.test(release)
                ? release
                : null,
            checked_at: new Date().toISOString(),
          },
          { status: 200, headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});
