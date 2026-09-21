import type { EstadoAdNavigator } from "./ad-navigator.server";

type Concessao = EstadoAdNavigator["grants"][number];
export function estadoConcessao(g: Concessao, agora: number): string {
  if (g.revoked_at) return "revogado";
  const validade = Date.parse(g.expires_at);
  if (!Number.isFinite(validade) || validade <= agora) return "expirado";
  return "vigente";
}

/** Uma leitura no emissor não comprova persistência no receptor. */
export function resumoPareamento(e: EstadoAdNavigator, agora: number) {
  const ativos = e.grants.filter((g) => estadoConcessao(g, agora) === "vigente");
  if (!e.binding_ok || !e.connection_ok)
    return {
      rotulo: "Vínculo indisponível",
      detalhe: "Confirme o vínculo desta clínica antes de usar a integração.",
    };
  if (
    ativos.some(
      (g) => g.use_count > 0 && g.last_used_at && Number.isFinite(Date.parse(g.last_used_at)),
    )
  )
    return {
      rotulo: "Leitura registrada",
      detalhe:
        "O Jornada recebeu uma leitura autenticada. A persistência no Ad Navigator ainda precisa ser comprovada no receptor.",
    };
  if (ativos.length)
    return {
      rotulo: "Troca concluída — aguardando leitura",
      detalhe:
        "A concessão existe. Falta a leitura autenticada do resumo e a persistência no Ad Navigator.",
    };
  return {
    rotulo: "Aguardando receptor/ativação",
    detalhe:
      e.pending_pairing && Date.parse(e.pending_pairing.expires_at) > agora
        ? "Existe um código pendente. A troca ainda não foi concluída."
        : "Gere o código apenas quando o Ad Navigator estiver autenticado e pronto para a troca.",
  };
}

export type PassoPonte = {
  id: "vinculo" | "codigo" | "troca" | "leitura" | "persistencia";
  rotulo: string;
  concluido: boolean;
  detalhe: string;
};

/**
 * Registo persistente do painel: cada passo vem do estado guardado no
 * servidor (pareamento, concessões, leituras), nunca de memória do browser.
 */
export function linhaDoTempo(e: EstadoAdNavigator, agora: number): PassoPonte[] {
  const vinculo =
    e.binding_ok && e.connection_ok && Boolean(e.location_id) && Boolean(e.pipeline_id);
  const pendente = e.pending_pairing && Date.parse(e.pending_pairing.expires_at) > agora;
  const emitido = Boolean(pendente) || e.grants.length > 0;
  const troca = e.grants.length > 0;
  const leituras = e.grants.reduce((total, g) => total + (g.use_count > 0 ? g.use_count : 0), 0);
  const ultima = e.grants
    .map((g) => g.last_used_at)
    .filter((v): v is string => Boolean(v) && Number.isFinite(Date.parse(v as string)))
    .sort()
    .at(-1);
  return [
    {
      id: "vinculo",
      rotulo: "Vínculo validado",
      concluido: vinculo,
      detalhe: vinculo ? "Conta e funil desta clínica confirmados." : "Por confirmar.",
    },
    {
      id: "codigo",
      rotulo: "Código emitido",
      concluido: emitido,
      detalhe: pendente
        ? "Código válido à espera de troca."
        : emitido
          ? "Já emitido."
          : "Ainda não.",
    },
    {
      id: "troca",
      rotulo: "Troca concluída",
      concluido: troca,
      detalhe: troca ? `${e.grants.length} concessão(ões) registada(s).` : "Ainda não.",
    },
    {
      id: "leitura",
      rotulo: "Leitura autenticada",
      concluido: leituras > 0,
      detalhe: leituras > 0 ? `${leituras} leitura(s); última em ${ultima ?? "—"}.` : "Ainda não.",
    },
    {
      id: "persistencia",
      rotulo: "Persistência no Ad Navigator",
      concluido: false,
      detalhe: "Só o próprio Ad Navigator pode comprovar; não é observável daqui.",
    },
  ];
}
