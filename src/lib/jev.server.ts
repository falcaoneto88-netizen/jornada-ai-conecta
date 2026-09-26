import {
  JEV_URL,
  categoriaDoStatus,
  esperaRetry,
  pedidoTeste,
  validarResposta,
  type CategoriaJev,
  type ResultadoValidado,
} from "./jev.core";

export type ResultadoChamada = {
  categoria: CategoriaJev;
  latencia_ms: number;
  resultado: ResultadoValidado | null;
};

export type DepsJev = {
  fetch?: typeof fetch;
  esperar?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  maxTentativas?: number;
};

/** Chamada server-only ao Jev via OpenRouter. Nunca registra chave nem corpo. */
export async function testarJevServidor(chave: string, deps: DepsJev = {}): Promise<ResultadoChamada> {
  const f = deps.fetch ?? fetch;
  const esperar = deps.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const timeoutMs = deps.timeoutMs ?? 10_000;
  const max = deps.maxTentativas ?? 2;
  const inicio = Date.now();
  let categoria: CategoriaJev = "indisponivel";

  for (let tentativa = 0; tentativa < max; tentativa++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await f(JEV_URL, {
        method: "POST",
        redirect: "manual",
        signal: ctrl.signal,
        headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
        body: JSON.stringify(pedidoTeste()),
      });
      if (res.status >= 300 && res.status < 400) {
        return { categoria: "resposta_invalida", latencia_ms: Date.now() - inicio, resultado: null };
      }
      if (res.ok) {
        let corpo: unknown = null;
        try {
          corpo = await res.json();
        } catch {
          corpo = null;
        }
        const resultado = validarResposta(corpo);
        return {
          categoria: resultado ? "ok" : "resposta_invalida",
          latencia_ms: Date.now() - inicio,
          resultado,
        };
      }
      categoria = categoriaDoStatus(res.status);
      const retentavel = res.status === 429 || res.status >= 500;
      if (!retentavel || tentativa === max - 1) break;
      await esperar(esperaRetry(res.headers.get("retry-after"), tentativa));
    } catch (e) {
      categoria = e instanceof Error && e.name === "AbortError" ? "timeout" : "indisponivel";
      if (tentativa === max - 1) break;
      await esperar(esperaRetry(null, tentativa));
    } finally {
      clearTimeout(t);
    }
  }
  return { categoria, latencia_ms: Date.now() - inicio, resultado: null };
}
