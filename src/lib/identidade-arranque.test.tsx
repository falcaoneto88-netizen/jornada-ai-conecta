// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

type Sessao = { user: { id: string } } | null;
type Ouvinte = (evento: string, session: Sessao) => void;

const ouvintes: Ouvinte[] = [];
let arranque: { promessa: Promise<{ data: { session: Sessao } }>; resolver: (s: Sessao) => void; rejeitar: (e: unknown) => void };

function novoArranque() {
  let resolver!: (s: Sessao) => void;
  let rejeitar!: (e: unknown) => void;
  const promessa = new Promise<{ data: { session: Sessao } }>((res, rej) => {
    resolver = (s) => res({ data: { session: s } });
    rejeitar = rej;
  });
  return { promessa, resolver, rejeitar };
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: () => arranque.promessa,
      onAuthStateChange: (cb: Ouvinte) => {
        ouvintes.push(cb);
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
    },
  },
}));

const { FronteiraIdentidade } = await import("./identidade");
const { useSessao } = await import("./session");

function Rascunho() {
  const [texto] = useState(() => `rascunho-${Math.random()}`);
  return <div data-testid="rascunho">{texto}</div>;
}

/** Fica fora da fronteira: observa a sessão real ao longo de toda a sequência. */
function Sessao() {
  const s = useSessao();
  return (
    <div>
      <div data-testid="user">{s.user?.id ?? "sem-user"}</div>
      <div data-testid="carregando">{s.carregando ? "sim" : "nao"}</div>
    </div>
  );
}

async function emitir(evento: string, sessao: Sessao) {
  await act(async () => {
    ouvintes.forEach((o) => o(evento, sessao));
    await Promise.resolve();
  });
}

function montar() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <Sessao />
      <FronteiraIdentidade>
        <Rascunho />
      </FronteiraIdentidade>
    </QueryClientProvider>,
  );
  return queryClient;
}

describe("arranque de sessão atrasado", () => {
  beforeEach(() => {
    ouvintes.length = 0;
    arranque = novoArranque();
  });
  afterEach(() => cleanup());

  it("evento mais recente prevalece sobre getSession antigo (A -> B -> A antigo -> A)", async () => {
    const queryClient = montar();

    await emitir("INITIAL_SESSION", { user: { id: "A" } });
    await emitir("SIGNED_IN", { user: { id: "B" } });

    const rascunhoB = screen.getByTestId("rascunho").textContent;
    queryClient.setQueryData(["conversas"], "dados-de-B");
    expect(screen.getByTestId("user").textContent).toBe("B");

    // getSession inicial (conta A) resolve tarde.
    await act(async () => {
      arranque.resolver({ user: { id: "A" } });
      await Promise.resolve();
      await Promise.resolve();
    });

    // B continua ativa.
    expect(screen.getByTestId("user").textContent).toBe("B");
    expect(screen.getByTestId("rascunho").textContent).toBe(rascunhoB);
    expect(queryClient.getQueryData(["conversas"])).toBe("dados-de-B");

    // Voltar a A desmonta a árvore de B e limpa o cache.
    await emitir("SIGNED_IN", { user: { id: "A" } });
    await waitFor(() => expect(screen.getByTestId("user").textContent).toBe("A"));
    expect(screen.getByTestId("rascunho").textContent).not.toBe(rascunhoB);
    expect(queryClient.getQueryData(["conversas"])).toBeUndefined();
  });

  it("erro atrasado do getSession não repõe identidade antiga", async () => {
    montar();
    await emitir("SIGNED_IN", { user: { id: "B" } });

    await act(async () => {
      arranque.rejeitar(new Error("rede"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("user").textContent).toBe("B");
    expect(screen.getByTestId("carregando").textContent).toBe("nao");
  });

  it("falha de arranque sem evento novo encerra o carregamento como anónimo", async () => {
    montar();
    expect(screen.getByTestId("carregando").textContent).toBe("sim");

    await act(async () => {
      arranque.rejeitar(new Error("rede"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("carregando").textContent).toBe("nao");
    expect(screen.getByTestId("user").textContent).toBe("sem-user");
  });
});
