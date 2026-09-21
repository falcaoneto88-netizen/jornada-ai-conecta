import type { EstadoAdNavigator } from "./ad-navigator.server";
import { estadoConcessao } from "./ad-navigator-status";

/** Resultado da sonda aos próprios endpoints publicados da ponte v1. */
export type SondaPonte = {
  exchange_ok: boolean;
  summary_ok: boolean;
  motivo: "ok" | "indisponivel" | "resposta_inesperada" | "nao_verificado";
};

export type VerificacaoPonte = {
  id: "vinculo" | "autenticacao" | "sem_pendente" | "sem_vigente";
  rotulo: string;
  ok: boolean;
  detalhe: string;
};

/**
 * Pré-condições avaliadas ANTES de emitir qualquer código. A sonda confirma
 * que o caminho autenticado da ponte está de pé (troca recusa código inválido,
 * resumo recusa credencial inválida) — nunca cria pareamento nem concessão.
 */
export function avaliarProntidao(
  e: EstadoAdNavigator,
  sonda: SondaPonte,
  agora: number,
): { verificacoes: VerificacaoPonte[]; podeGerar: boolean } {
  const vinculo =
    e.binding_ok && e.connection_ok && Boolean(e.location_id) && Boolean(e.pipeline_id);
  const pendente = Boolean(
    e.pending_pairing && Date.parse(e.pending_pairing.expires_at) > agora,
  );
  const vigente = e.grants.some((g) => estadoConcessao(g, agora) === "vigente");
  const autenticacao = sonda.exchange_ok && sonda.summary_ok;

  const verificacoes: VerificacaoPonte[] = [
    {
      id: "vinculo",
      rotulo: "Vínculo real ao GoHighLevel",
      ok: vinculo,
      detalhe: vinculo
        ? "Conta e funil desta clínica validados no servidor."
        : "Confirme a ligação ao GoHighLevel desta conta antes de continuar.",
    },
    {
      id: "autenticacao",
      rotulo: "Autenticação da ponte ativa",
      ok: autenticacao,
      detalhe: autenticacao
        ? "A troca recusa códigos inválidos e o resumo recusa credenciais inválidas."
        : sonda.motivo === "nao_verificado"
          ? "Ainda não verificado nesta sessão."
          : "O caminho autenticado não respondeu como esperado. Não é seguro emitir código.",
    },
    {
      id: "sem_pendente",
      rotulo: "Sem código pendente",
      ok: !pendente,
      detalhe: pendente
        ? "Existe um código ainda válido. Conclua ou revogue antes de emitir outro."
        : "Nenhum código por usar.",
    },
    {
      id: "sem_vigente",
      rotulo: "Sem acesso vigente",
      ok: !vigente,
      detalhe: vigente
        ? "Já existe acesso concedido. Revogue antes de emitir um novo código."
        : "Nenhum acesso concedido em vigor.",
    },
  ];

  return { verificacoes, podeGerar: verificacoes.every((v) => v.ok) };
}
