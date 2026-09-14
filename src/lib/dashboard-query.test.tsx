// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const estado = vi.hoisted(() => ({
  user: "user-a" as string | undefined,
  falhar: false,
  chamadas: [] as { tabela: string; filtros: unknown[][] }[],
}));
vi.mock("@/lib/session", () => ({
  useSessao: () => ({
    user: estado.user ? { id: estado.user } : null,
    modo: estado.user ? "conta" : "anonimo",
    carregando: false,
  }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (tabela: string) => {
      const chamada = { tabela, filtros: [] as unknown[][] };
      estado.chamadas.push(chamada);
      const resultado =
        tabela === "contacts"
          ? [{ id: "a", stage_key: "novo_lead" }]
          : tabela === "journey_stages"
            ? [{ key: "novo_lead", name: "Novo Lead" }]
            : [];
      const query: Record<string, unknown> = {};
      for (const metodo of ["select", "eq", "gte", "lt", "order", "range", "not", "limit"]) {
        query[metodo] = (...args: unknown[]) => {
          chamada.filtros.push([metodo, ...args]);
          return query;
        };
      }
      query["then"] = (resolve: (r: unknown) => unknown) =>
        Promise.resolve({
          data: resultado,
          error: estado.falhar && tabela === "appointments" ? { message: "Indisponível" } : null,
          count: 0,
        }).then(resolve);
      return query;
    },
  },
}));
import { usePainel } from "./dashboard";

const clientes: QueryClient[] = [];
function preparar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clientes.push(qc);
  for (const id of ["user-a", "user-b"])
    qc.setQueryData(["organizacao", id], {
      perfil: { id },
      organizacao: { id: `org-${id}`, timezone: "Europe/Lisbon" },
    });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}
beforeEach(() => {
  estado.user = "user-a";
  estado.falhar = false;
  estado.chamadas.length = 0;
});
afterEach(() => {
  cleanup();
  clientes.splice(0).forEach((c) => c.clear());
});

it("restringe todas as consultas à organização e exclui registos demo dos indicadores", async () => {
  const { result } = renderHook(() => usePainel(7), { wrapper: preparar() });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  for (const c of estado.chamadas) {
    expect(c.filtros).toContainEqual(["eq", "organization_id", "org-user-a"]);
    if (c.tabela !== "journey_stages") expect(c.filtros).toContainEqual(["eq", "is_demo", false]);
  }
  expect(estado.chamadas.find((c) => c.tabela === "contacts")?.filtros).toContainEqual([
    "gte",
    "created_at",
    result.current.data?.periodo.inicio,
  ]);
  expect(estado.chamadas.find((c) => c.tabela === "contacts")?.filtros).toContainEqual([
    "lt",
    "created_at",
    result.current.data?.periodo.fim,
  ]);
});
it("alterar o período e a identidade refaz a consulta com escopo correto", async () => {
  const { result, rerender } = renderHook(({ dias }) => usePainel(dias), {
    initialProps: { dias: 7 },
    wrapper: preparar(),
  });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  const inicio7 = result.current.data?.periodo.inicio;
  estado.chamadas.length = 0;
  estado.user = "user-b";
  rerender({ dias: 30 });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data?.periodo.inicio).not.toBe(inicio7);
  for (const c of estado.chamadas)
    expect(c.filtros).toContainEqual(["eq", "organization_id", "org-user-b"]);
});
it("recusa apresentar indicadores quando uma fonte falha", async () => {
  estado.falhar = true;
  const { result } = renderHook(() => usePainel(7), { wrapper: preparar() });
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(result.current.data).toBeUndefined();
});
it("sessão ausente não consulta o banco", () => {
  estado.user = undefined;
  renderHook(() => usePainel(7), { wrapper: preparar() });
  expect(estado.chamadas).toHaveLength(0);
});
