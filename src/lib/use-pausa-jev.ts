import { useEffect, useState } from "react";

/** Pausa local (por componente) após 429; devolve segundos restantes e função para iniciar. */
export function usePausaJev(): [number, (segundos: number | null | undefined) => void] {
  const [ate, setAte] = useState<number | null>(null);
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    if (ate === null) return;
    const id = setInterval(() => {
      const n = Date.now();
      setAgora(n);
      if (n >= ate) setAte(null);
    }, 1000);
    return () => clearInterval(id);
  }, [ate]);
  const restante = ate === null ? 0 : Math.max(0, Math.ceil((ate - agora) / 1000));
  const iniciar = (s: number | null | undefined) => {
    if (!s) return;
    const n = Date.now();
    setAgora(n);
    setAte(n + s * 1000);
  };
  return [restante, iniciar];
}
