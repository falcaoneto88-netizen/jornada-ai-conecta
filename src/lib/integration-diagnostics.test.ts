import { describe, expect, it, vi } from "vitest";
import { lerCatalogoPublicado, MCP_PUBLIC_URL } from "./integration-diagnostics.server";
const auth = "Bearer synthetic-token";
describe("catálogo publicado autenticado", () => {
  it("não faz pedido sem autenticação", async () => {
    const fetcher = vi.fn();
    expect((await lerCatalogoPublicado("", fetcher)).status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("usa destino fixo e preserva autenticação sem a devolver", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({
        result: { tools: [{ name: "list_bioreport_events" }, { name: "list_opportunities" }] },
      }),
    );
    const result = await lerCatalogoPublicado(auth, fetcher);
    expect(result.tools).toEqual(["list_bioreport_events", "list_opportunities"]);
    expect(fetcher.mock.calls[0]![0]).toBe(MCP_PUBLIC_URL);
    expect(fetcher.mock.calls[0]![1].redirect).toBe("manual");
    expect(fetcher.mock.calls[0]![1].headers.Authorization).toBe(auth);
    expect(JSON.stringify(result)).not.toContain(auth);
  });
  it("aceita transporte SSE", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response('event: message\ndata: {"result":{"tools":[{"name":"list_contacts"}]}}\n\n', {
        headers: { "Content-Type": "text/event-stream" },
      }),
    );
    expect((await lerCatalogoPublicado(auth, fetcher)).tools).toEqual(["list_contacts"]);
  });
  it.each([301, 401, 403, 500])(
    "não segue redirecionamento nem expõe erro HTTP %s",
    async (status) => {
      const result = await lerCatalogoPublicado(
        auth,
        vi.fn().mockResolvedValue(new Response(auth, { status })),
      );
      expect(result).toEqual({ ok: false, status, tools: [] });
    },
  );
  it("não trata JSON-RPC error como catálogo vazio", async () => {
    const result = await lerCatalogoPublicado(
      auth,
      vi.fn().mockResolvedValue(Response.json({ error: { message: auth } })),
    );
    expect(result).toEqual({ ok: false, status: 502, tools: [] });
  });
  it("sanitiza falhas de transporte", async () =>
    expect(await lerCatalogoPublicado(auth, vi.fn().mockRejectedValue(new Error(auth)))).toEqual({
      ok: false,
      status: 503,
      tools: [],
    }));
});
