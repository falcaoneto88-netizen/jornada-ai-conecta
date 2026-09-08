import { useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";

import { supabase } from "@/integrations/supabase/client";

export const IDENTIDADE_ANONIMA = "anonimo";

/**
 * Fronteira de identidade.
 *
 * Toda a árvore por baixo é remontada quando a sessão muda (entrar, sair ou
 * trocar de conta). Assim, o estado local das páginas (rascunhos, análises de
 * IA, filtros) desaparece com a conta anterior e qualquer promessa iniciada na
 * conta A que resolva depois da troca escreve num componente já desmontado —
 * nunca na conta B. O cache de consultas é cancelado e limpo na mesma troca.
 */
export function FronteiraIdentidade({
  children,
  aoTrocar,
}: {
  children: ReactNode;
  aoTrocar?: (identidade: string) => void;
}) {
  const queryClient = useQueryClient();
  const [chave, setChave] = useState<string>(IDENTIDADE_ANONIMA);
  const anterior = useRef<string | null>(null);

  useEffect(() => {
    let vivo = true;

    const aplicar = (idUtilizador: string | null) => {
      if (!vivo) return;
      const identidade = idUtilizador ?? IDENTIDADE_ANONIMA;
      if (anterior.current === identidade) return;
      const primeira = anterior.current === null;
      anterior.current = identidade;
      if (!primeira) {
        void queryClient.cancelQueries();
        queryClient.clear();
      }
      setChave(identidade);
      aoTrocar?.(identidade);
    };

    // Inclui a inicialização: getSession + INITIAL_SESSION são ambos tratados.
    void supabase.auth.getSession().then(({ data }) => aplicar(data.session?.user?.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_evento, session) => {
      aplicar(session?.user?.id ?? null);
    });

    return () => {
      vivo = false;
      sub.subscription.unsubscribe();
    };
    // aoTrocar é estável no uso real; evitamos re-subscrições desnecessárias.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient]);

  return <Fragment key={chave}>{children}</Fragment>;
}
