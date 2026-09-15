import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock("../supabase", () => ({
  supabaseForUser: mocks.client,
  naoAutenticado: () => ({ isError: true, content: [{ type: "text", text: "Não autenticado" }] }),
  erro: (text: string) => ({ isError: true, content: [{ type: "text", text }] }),
  texto: (data: unknown) => ({ content: [{ type: "text", text: JSON.stringify(data) }] }),
}));

import tool from "./list-contacts";

const context = (authenticated = true) =>
  ({
    isAuthenticated: () => authenticated,
    getToken: () => (authenticated ? "synthetic-test-token" : null),
  }) as never;

function builder(rows: Array<Record<string, unknown>>) {
  const calls: Record<string, unknown[]> = {};
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "order", "limit", "eq", "ilike", "gte", "lt"]) {
    chain[m] = vi.fn((...args: unknown[]) => {
      calls[m] = [...(calls[m] ?? []), args];
      return chain;
    });
  }
  (chain as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
    resolve({ data: rows, error: null });
  return { chain, calls };
}

beforeEach(() => vi.clearAllMocks());

it("bloqueia sessão ausente sem criar cliente", async () => {
  expect(await tool.handler({ limit: 5 } as never, context(false))).toHaveProperty("isError", true);
  expect(mocks.client).not.toHaveBeenCalled();
});

it("recusa limite excessivo antes de consultar", async () => {
  expect(await tool.handler({ limit: 500 } as never, context())).toHaveProperty("isError", true);
  expect(mocks.client).not.toHaveBeenCalled();
});

it("inclui o identificador do GoHighLevel e não devolve cursor em página incompleta", async () => {
  const rows = [
    { id: "a", ghl_contact_id: "ghl-1", updated_at: "2026-09-15T10:00:00.000Z" },
  ];
  const { chain, calls } = builder(rows);
  mocks.client.mockReturnValue({ from: vi.fn(() => chain) });
  const res = (await tool.handler(
    { limit: 20, search: "ana", updated_after: "2026-09-01T00:00:00.000Z" } as never,
    context(),
  )) as { content: Array<{ text: string }> };
  const payload = JSON.parse(res.content[0]!.text) as {
    contacts: Array<{ ghl_contact_id: string }>;
    next_cursor: string | null;
  };
  expect(payload.contacts[0]!.ghl_contact_id).toBe("ghl-1");
  expect(payload.next_cursor).toBeNull();
  expect(calls["ilike"]).toEqual([["full_name", "%ana%"]]);
  expect(calls["gte"]).toEqual([["updated_at", "2026-09-01T00:00:00.000Z"]]);
});
