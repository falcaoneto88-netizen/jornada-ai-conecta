import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock("../supabase", () => ({
  supabaseForUser: mocks.client,
  naoAutenticado: () => ({ isError: true, content: [{ type: "text", text: "Não autenticado" }] }),
  erro: (text: string) => ({ isError: true, content: [{ type: "text", text }] }),
  texto: (data: unknown) => ({ content: [{ type: "text", text: JSON.stringify(data) }] }),
}));

import tool from "./list-opportunities";

const context = (authenticated = true) =>
  ({
    isAuthenticated: () => authenticated,
    getToken: () => (authenticated ? "synthetic-test-token" : null),
  }) as never;

function builder(rows: Array<Record<string, unknown>>) {
  const calls: Record<string, unknown[]> = {};
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "order", "limit", "eq", "gte", "lt"]) {
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

it("devolve identificadores do GoHighLevel e cursor quando a página enche", async () => {
  const rows = [
    {
      id: "a",
      ghl_opportunity_id: "opp-1",
      contact_id: "c1",
      updated_at: "2026-09-15T10:00:00.000Z",
    },
    {
      id: "b",
      ghl_opportunity_id: "opp-2",
      contact_id: "c2",
      updated_at: "2026-09-14T10:00:00.000Z",
    },
  ];
  const { chain, calls } = builder(rows);
  mocks.client.mockReturnValue({ from: vi.fn(() => chain) });
  const res = (await tool.handler(
    { limit: 2, stage_key: "novo", cursor: "2026-09-16T00:00:00.000Z" } as never,
    context(),
  )) as { content: Array<{ text: string }> };
  const payload = JSON.parse(res.content[0]!.text) as {
    opportunities: unknown[];
    next_cursor: string | null;
  };
  expect(payload.opportunities).toHaveLength(2);
  expect(payload.next_cursor).toBe("2026-09-14T10:00:00.000Z");
  expect(calls["eq"]).toEqual([["stage_key", "novo"]]);
  expect(calls["lt"]).toEqual([["updated_at", "2026-09-16T00:00:00.000Z"]]);
});
