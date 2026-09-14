import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSessao } from "@/lib/session";
import { opcoesOrganizacao } from "@/lib/organization";
import { chaveDia, deslocarDia, inicioDiaUtc, intervaloDias } from "@/lib/clinic-time";

export type ContactoPainel = { id: string; stage_key: string };
export type MarcacaoPainel = { id: string; status: string };
export type EtapaPainel = { key: string; name: string };

export function resumirPainel(
  contactos: ContactoPainel[],
  marcacoes: MarcacaoPainel[],
  oportunidades: number,
  etapas: EtapaPainel[],
) {
  const elegiveis = marcacoes.filter((m) => !["cancelada", "invalid"].includes(m.status));
  const confirmadas = elegiveis.filter((m) => m.status === "confirmada").length;
  const contagem = new Map<string, number>();
  for (const c of contactos) contagem.set(c.stage_key, (contagem.get(c.stage_key) ?? 0) + 1);
  const distribuicao = etapas.map((e) => ({
    nome: e.name,
    key: e.key,
    quantidade: contagem.get(e.key) ?? 0,
  }));
  const conhecidas = new Set(etapas.map((e) => e.key));
  for (const [key, quantidade] of contagem) {
    if (!conhecidas.has(key)) distribuicao.push({ key, nome: key || "Sem etapa", quantidade });
  }
  return {
    contactos: contactos.length,
    marcacoes: marcacoes.length,
    oportunidades,
    confirmadas,
    elegiveis: elegiveis.length,
    taxaConfirmacao: elegiveis.length ? Math.round((confirmadas / elegiveis.length) * 100) : null,
    distribuicao,
  };
}

/** Page until the complete filtered result is read; fail instead of displaying partial KPIs. */
export async function lerPaginas<T>(
  pagina: (
    inicio: number,
    fim: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const linhas: T[] = [];
  for (let inicio = 0; ; inicio += 500) {
    const { data, error } = await pagina(inicio, inicio + 499);
    if (error) throw new Error(error.message);
    if (!data) throw new Error("A consulta não devolveu dados.");
    linhas.push(...data);
    if (data.length < 500) return linhas;
  }
}

export function usePainel(dias: number) {
  const { user, carregando, modo } = useSessao();
  const qc = useQueryClient();
  return useQuery({
    queryKey: ["painel", user?.id ?? modo, dias],
    enabled: !carregando && Boolean(user),
    refetchInterval: 60_000,
    queryFn: async () => {
      const { organizacao } = await qc.fetchQuery(opcoesOrganizacao(user?.id));
      const fuso = organizacao.timezone;
      const agora = new Date();
      const periodo = intervaloDias(dias, agora, fuso);
      const amanha = deslocarDia(chaveDia(agora, fuso), 1);
      const [contactos, marcacoes, oportunidades, etapas, proximas] = await Promise.all([
        lerPaginas((a, b) =>
          supabase
            .from("contacts")
            .select("id,stage_key")
            .eq("organization_id", organizacao.id)
            .eq("is_demo", false)
            .gte("created_at", periodo.inicio)
            .lt("created_at", periodo.fim)
            .order("id")
            .range(a, b),
        ),
        lerPaginas((a, b) =>
          supabase
            .from("appointments")
            .select("id,status")
            .eq("organization_id", organizacao.id)
            .eq("is_demo", false)
            .gte("start_at", periodo.inicio)
            .lt("start_at", periodo.fim)
            .order("id")
            .range(a, b),
        ),
        supabase
          .from("opportunities")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizacao.id)
          .eq("is_demo", false)
          .gte("updated_at", periodo.inicio)
          .lt("updated_at", periodo.fim),
        supabase
          .from("journey_stages")
          .select("key,name")
          .eq("organization_id", organizacao.id)
          .order("position"),
        supabase
          .from("appointments")
          .select("id,title,start_at,status,contacts(full_name)")
          .eq("organization_id", organizacao.id)
          .eq("is_demo", false)
          .not("status", "in", '("cancelada","invalid","realizada","faltou")')
          .gte("start_at", inicioDiaUtc(amanha, fuso))
          .lt("start_at", inicioDiaUtc(deslocarDia(amanha, 1), fuso))
          .order("start_at")
          .order("id")
          .limit(5),
      ]);
      if (oportunidades.error || oportunidades.count === null || etapas.error || proximas.error) {
        throw new Error("Não foi possível obter todos os indicadores. Tente novamente.");
      }
      return {
        ...resumirPainel(contactos, marcacoes, oportunidades.count, etapas.data ?? []),
        proximas: proximas.data ?? [],
        periodo,
        fuso,
        consultadoEm: agora.toISOString(),
      };
    },
  });
}
