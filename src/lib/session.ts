import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";

const CHAVE_DEMO = "jornada.modo-demonstracao";

/** "demo" = dados fictícios locais. "conta" = dados reais da organização. */
export type ModoAcesso = "demo" | "conta" | "anonimo";

export function ativarDemo() {
  if (typeof window !== "undefined") window.localStorage.setItem(CHAVE_DEMO, "1");
}

export function desativarDemo() {
  if (typeof window !== "undefined") window.localStorage.removeItem(CHAVE_DEMO);
}

export function isDemoAtivo() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(CHAVE_DEMO) === "1";
}

export type SessaoEstado = {
  carregando: boolean;
  user: User | null;
  modo: ModoAcesso;
};

export function useSessao(): SessaoEstado {
  const [estado, setEstado] = useState<SessaoEstado>({ carregando: true, user: null, modo: "anonimo" });

  useEffect(() => {
    let ativo = true;
    // Eventos de autenticação prevalecem sobre o getSession inicial atrasado.
    let houveEvento = false;

    const resolver = (user: User | null) => {
      if (!ativo) return;
      setEstado({
        carregando: false,
        user,
        modo: user ? "conta" : isDemoAtivo() ? "demo" : "anonimo",
      });
    };

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (houveEvento) return;
        resolver(data.session?.user ?? null);
      })
      .catch(() => {
        if (houveEvento) return;
        resolver(null);
      });
    const { data: sub } = supabase.auth.onAuthStateChange((_evento, session) => {
      houveEvento = true;
      resolver(session?.user ?? null);
    });


    return () => {
      ativo = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return estado;
}
