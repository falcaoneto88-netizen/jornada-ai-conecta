/**
 * Execução automática de UM recibo, derivada do próprio ingresso assinado e já
 * persistido. Não há sessão nem papel fabricados: o contexto é de serviço,
 * restrito ao servidor, e só encontra o destino pela configuração da própria
 * integração (organização, integração, binding e ligação ativa).
 *
 * Tudo continua fechado por omissão: se a integração estiver desligada, a
 * escrita remota não estiver habilitada, a ligação não estiver conectada com
 * write_enabled, o canal de acolhimento não estiver configurado ou faltarem
 * credenciais, nada é executado e o recibo fica como está.
 *
 * Não há retomas automáticas: as reservas na base (ledger durável) impedem
 * segunda execução da mesma pessoa, reenvios e retomas de resultado incerto.
 */
import {
  FALCAO_SOURCE_INTEGRACAO,
} from "./falcao-lead.server";
import {
  configGhl,
  criarDepsGhl,
  depsRemotoDe,
  executarReciboRemoto,
  type AdminRemoto,
} from "./falcao-remote.server";
import {
  configAcolhimento,
  criarDepsAcolhimento,
  depsAcolhimentoDe,
  executarReciboAcolhimento,
  type AdminAcolhimento,
} from "./falcao-welcome.server";
import type { DesfechoRemoto } from "./falcao-remote.core";
import type { DesfechoAcolhimento } from "./falcao-welcome.core";
import { readGhlSecrets } from "./ghl.server";

export type AdminAuto = AdminRemoto & AdminAcolhimento;

export type ResultadoAuto = {
  executado: boolean;
  motivo: string;
  remoto: DesfechoRemoto | null;
  acolhimento: DesfechoAcolhimento | null;
};

type LinhaIntegracao = {
  id: string;
  organization_id: string;
  enabled: boolean;
  remote_write_state: string;
  welcome_channel_state: string;
  ghl_location_id: string | null;
};

type LinhaLigacao = { write_enabled: boolean; status: string };
type LinhaRecibo = { id: string; organization_id: string; integration_id: string };

const parado = (motivo: string): ResultadoAuto => ({
  executado: false,
  motivo,
  remoto: null,
  acolhimento: null,
});

/**
 * Processa o recibo indicado. Nunca lança: qualquer falha devolve um motivo,
 * e a resposta pública ao site nunca depende deste resultado.
 */
export async function executarReciboFalcao(
  submissionId: string,
  deps?: {
    admin?: AdminAuto;
    criarRemoto?: typeof criarDepsGhl;
    criarAcolhimento?: typeof criarDepsAcolhimento;
    token?: string | null;
  },
): Promise<ResultadoAuto> {
  try {
    const token = deps?.token !== undefined ? deps.token : readGhlSecrets().token;
    if (!token) return parado("credenciais_indisponiveis");

    const admin =
      deps?.admin ??
      ((await import("@/integrations/supabase/client.server"))
        .supabaseAdmin as unknown as AdminAuto);

    const integracao = await admin
      .from("site_integrations")
      .select("id,organization_id,enabled,remote_write_state,welcome_channel_state,ghl_location_id")
      .eq("source", FALCAO_SOURCE_INTEGRACAO)
      .limit(1);
    const linha = (integracao.data as LinhaIntegracao[] | null)?.[0];
    if (integracao.error || !linha) return parado("integracao_nao_configurada");
    const locationId = linha.ghl_location_id;
    if (!linha.enabled || linha.remote_write_state !== "habilitado" || !locationId) {
      return parado("integracao_desligada");
    }

    const ligacao = await admin
      .from("ghl_connections")
      .select("write_enabled,status")
      .eq("organization_id", linha.organization_id)
      .eq("location_id", locationId)
      .limit(1);
    const conn = (ligacao.data as LinhaLigacao[] | null)?.[0];
    if (ligacao.error || !conn || conn.write_enabled !== true || conn.status !== "conectada") {
      return parado("escrita_desativada");
    }

    // O recibo tem de pertencer exatamente a esta organização e integração.
    const recibo = await admin
      .from("site_lead_submissions")
      .select("id,organization_id,integration_id")
      .eq("id", submissionId)
      .limit(1);
    const sub = (recibo.data as LinhaRecibo[] | null)?.[0];
    if (
      recibo.error || !sub || sub.id !== submissionId ||
      sub.organization_id !== linha.organization_id || sub.integration_id !== linha.id
    ) {
      return parado("recibo_fora_da_integracao");
    }

    const alvo = { orgId: linha.organization_id, locationId, integrationId: linha.id };
    const remoto = await executarReciboRemoto(
      admin,
      alvo,
      submissionId,
      depsRemotoDe(admin, configGhl(token, locationId), deps?.criarRemoto ?? criarDepsGhl),
    );
    if (!remoto || remoto.estado !== "confirmado") {
      return { executado: true, motivo: "remoto_nao_confirmado", remoto, acolhimento: null };
    }
    if (linha.welcome_channel_state !== "configurado") {
      return { executado: true, motivo: "canal_de_acolhimento_pendente", remoto, acolhimento: null };
    }

    const acolhimento = await executarReciboAcolhimento(
      admin,
      alvo,
      submissionId,
      depsAcolhimentoDe(
        admin,
        configAcolhimento(token, locationId),
        deps?.criarAcolhimento ?? criarDepsAcolhimento,
      ),
    );
    return { executado: true, motivo: "processado", remoto, acolhimento };
  } catch {
    // Falha de infraestrutura nunca altera a resposta ao site nem repete escrita.
    return parado("falha_inesperada");
  }
}
