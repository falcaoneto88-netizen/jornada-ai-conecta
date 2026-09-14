import { queryOptions, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSessao } from "@/lib/session";
import { validarFuso } from "@/lib/clinic-time";

export function opcoesOrganizacao(userId: string | undefined) {
  return queryOptions({
    queryKey: ["organizacao", userId ?? "anonimo"],
    enabled: Boolean(userId),
    queryFn: async () => {
      if (!userId) throw new Error("Sessão não iniciada.");
      const { data: perfil, error: erroPerfil } = await supabase
        .from("profiles")
        .select("id,organization_id,full_name,email")
        .eq("id", userId)
        .single();
      if (erroPerfil || !perfil) throw new Error("Não foi possível ler o perfil da conta.");
      const { data: organizacao, error } = await supabase
        .from("organizations")
        .select("id,name,timezone,is_demo")
        .eq("id", perfil.organization_id)
        .single();
      if (error || !organizacao) throw new Error("Não foi possível ler os dados da clínica.");
      return {
        perfil,
        organizacao: { ...organizacao, timezone: validarFuso(organizacao.timezone) },
      };
    },
    staleTime: 60_000,
  });
}

export function useOrganizacao() {
  const { user } = useSessao();
  return useQuery(opcoesOrganizacao(user?.id));
}

export function useEquipaOrganizacao() {
  const contexto = useOrganizacao();
  const orgId = contexto.data?.organizacao.id;
  const { user } = useSessao();
  return useQuery({
    queryKey: ["equipa", user?.id ?? "anonimo", orgId],
    enabled: Boolean(user && orgId),
    queryFn: async () => {
      if (!orgId) throw new Error("Organização indisponível.");
      const { data, error } = await supabase
        .from("profiles")
        .select("id,full_name,email")
        .eq("organization_id", orgId)
        .order("full_name");
      if (error) throw new Error("Não foi possível consultar os utilizadores da organização.");
      return data ?? [];
    },
  });
}
