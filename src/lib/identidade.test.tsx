// @vitest-environment jsdom
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Ouvinte = (evento: string, session: { user: { id: string } } | null) => void;

const ouvintes: Ouvinte[] = [];
let sessaoAtual: { user: { id: string } } | null = null;

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: sessaoAtual } }),
      onAuthStateChange: (cb: Ouvinte) => {
        ouvintes.push(cb);
        cb("INITIAL_SESSION", sessaoAtual);
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
    },
  },
}));

const { FronteiraIdentidade } = await import("./identidade");

/** Promessa que só resolve quando o teste mandar (simula IA/consulta lenta). */
function adiada<T>() {
  let resolver!: (v: T) => void;
  const promessa = new Promise<T>((r) => {
    resolver = r;
  });
  return { promessa, resolver };
}

let analiseA = adiada<string>();
let consultaA = adiada<string>();

function Pagina() {
  const [rascunho, setRascunho] = useState<string | null>(null);
  const [analise, setAnalise] = useState<string | null>(null);

  useEffect(() => {
    // Promessa iniciada na conta que montou este componente.
    void analiseA.promessa.then((texto) => {
      setAnalise(texto);
      setRascunho(`rascunho:${texto}`);
    });
  }, []);

  const q = useQuery({
    queryKey: ["conversas"],
    queryFn: () => consultaA.promessa,
    retry: false,
  });

  return (
    <div>
      <div data-testid="analise">{analise ?? "sem-analise"}</div>
      <div data-testid="rascunho">{rascunho ?? "sem-rascunho"}</div>
      <div data-testid="consulta">{q.data ?? "sem-dados"}</div>
    </div>
  );
}

async function emitir(evento: string, sessao: { user: { id: string } } | null) {
  sessaoAtual = sessao;
  await act(async () => {
    ouvintes.forEach((o) => o(evento, sessao));
    await Promise.resolve();
  });
}

describe("fronteira de identidade", () => {
  beforeEach(() => {
    ouvintes.length = 0;
    sessaoAtual = null;
    analiseA = adiada<string>();
    consultaA = adiada<string>();
  });

  it("descarta estado local e cache quando a sessão muda, mesmo com promessas adiadas", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    sessaoAtual = { user: { id: "utilizador-A" } };

    render(
      <QueryClientProvider client={queryClient}>
        <FronteiraIdentidade>
          <Pagina />
        </FronteiraIdentidade>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("analise")).toBeDefined());

    // Troca para a conta B antes de qualquer resultado da conta A chegar.
    await emitir("SIGNED_IN", { user: { id: "utilizador-B" } });

    // Só agora a análise e a consulta da conta A resolvem.
    const analiseDaContaA = adiada<string>();
    await act(async () => {
      analiseA.resolver("segredo-da-conta-A");
      consultaA.resolver("conversas-da-conta-A");
      await Promise.resolve();
      await Promise.resolve();
      analiseDaContaA.resolver("fim");
      await analiseDaContaA.promessa;
    });

    // Nada da conta A aparece na conta B.
    expect(screen.getByTestId("analise").textContent).toBe("sem-analise");
    expect(screen.getByTestId("rascunho").textContent).toBe("sem-rascunho");
    expect(screen.getByTestId("consulta").textContent).toBe("sem-dados");
    expect(document.body.innerHTML).not.toContain("segredo-da-conta-A");
    expect(document.body.innerHTML).not.toContain("conversas-da-conta-A");
    expect(queryClient.getQueryData(["conversas"])).toBeUndefined();
  });

  it("trata a inicialização e a saída de sessão", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    sessaoAtual = { user: { id: "utilizador-A" } };

    render(
      <QueryClientProvider client={queryClient}>
        <FronteiraIdentidade>
          <Pagina />
        </FronteiraIdentidade>
      </QueryClientProvider>,
    );

    await act(async () => {
      analiseA.resolver("dado-da-conta-A");
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(screen.getByTestId("analise").textContent).toBe("dado-da-conta-A"),
    );

    await emitir("SIGNED_OUT", null);

    expect(screen.getByTestId("analise").textContent).toBe("sem-analise");
    expect(screen.getByTestId("rascunho").textContent).toBe("sem-rascunho");
  });
});
