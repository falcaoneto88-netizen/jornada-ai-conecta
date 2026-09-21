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
