import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useOrganizacao } from "./organization";
import { useSessao } from "./session";
import {
  consultarConversasGhl,
  consultarMensagensGhl,
  consultarWorkflowsGhl,
} from "./ghl-observation.functions";

export function useConversasGhl(query: string) {
  const { user, modo } = useSessao();
  const { data } = useOrganizacao();
  const org = data?.organizacao.id;
  const ler = useServerFn(consultarConversasGhl);
  return useInfiniteQuery({
    queryKey: ["ghl-conversas", user?.id, org, query],
    enabled: Boolean(user && org && modo !== "demo"),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => ler({ data: { organizationId: org!, query, cursor: pageParam } }),
    getNextPageParam: (pagina) => pagina.proximoCursor ?? undefined,
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: false,
  });
}
export function useMensagensGhl(conversationId: string) {
  const { user, modo } = useSessao();
  const { data } = useOrganizacao();
  const org = data?.organizacao.id;
  const ler = useServerFn(consultarMensagensGhl);
  return useInfiniteQuery({
    queryKey: ["ghl-mensagens", user?.id, org, conversationId],
    enabled: Boolean(user && org && conversationId && modo !== "demo"),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      ler({ data: { organizationId: org!, conversationId, cursor: pageParam } }),
    getNextPageParam: (pagina) => pagina.proximoCursor ?? undefined,
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: false,
  });
}
export function useWorkflowsGhl() {
  const { user, modo } = useSessao();
  const { data } = useOrganizacao();
  const org = data?.organizacao.id;
  const ler = useServerFn(consultarWorkflowsGhl);
  return useQuery({
    queryKey: ["ghl-workflows", user?.id, org],
    enabled: Boolean(user && org && modo !== "demo"),
    queryFn: () => ler({ data: { organizationId: org! } }),
    staleTime: 60_000,
    retry: false,
  });
}
