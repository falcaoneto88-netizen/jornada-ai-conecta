import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock("../supabase", () => ({
  supabaseForUser: mocks.client,
  naoAutenticado: () => ({ isError: true, content: [{ type: "text", text: "Não autenticado" }] }),
  erro: (text: string) => ({ isError: true, content: [{ type: "text", text }] }),
  texto: (data: unknown) => ({ content: [{ type: "text", text: JSON.stringify(data) }] }),
}));
import tool from "./list-bioreport-events";
const context = (authenticated = true) =>
  ({
    isAuthenticated: () => authenticated,
    getToken: () => (authenticated ? "synthetic-test-token" : null),
  }) as never;
beforeEach(() => vi.clearAllMocks());
it("bloqueia sessão ausente sem criar cliente", async () => {
  expect(
    await tool.handler(
      { limit: 1, contact_id: undefined, consultation_id: undefined },
      context(false),
    ),
  ).toHaveProperty("isError", true);
  expect(mocks.client).not.toHaveBeenCalled();
});
it("verifica papel antes de ler eventos", async () => {
  const from = vi.fn();
  mocks.client.mockReturnValue({
    auth: { getUser: async () => ({ data: { user: {} }, error: null }) },
    rpc: async () => ({ data: false, error: null }),
    from,
  });
  expect(
    await tool.handler({ limit: 1, contact_id: undefined, consultation_id: undefined }, context()),
  ).toHaveProperty("isError", true);
  expect(from).not.toHaveBeenCalled();
});
it("recusa limite excessivo antes de consultar", async () => {
  expect(
    await tool.handler(
      { limit: 100, contact_id: undefined, consultation_id: undefined },
      context(),
    ),
  ).toHaveProperty("isError", true);
  expect(mocks.client).not.toHaveBeenCalled();
});
