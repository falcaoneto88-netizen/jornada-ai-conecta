/**
 * Contrato puro da API de Conversões da Meta (Conversions API) para o teste
 * controlado da "Experiência Falcão".
 *
 * Documentação oficial consultada (17/07/2026):
 * https://developers.facebook.com/documentation/ads-commerce/conversions-api/using-the-api
 *
 * Regras deste módulo:
 * - nunca recebe nem devolve o token de acesso (ele vive só no servidor);
 * - o evento é sintético e não representa lead, venda nem pessoa real;
 * - nada aqui faz rede: só constrói e interpreta.
 */

/** Conjunto de dados (pixel) "Experiência Falcão — Site". */
export const META_DATASET_ID = "1810411136960763";
/** Portfólio empresarial proprietário do conjunto de dados. */
export const META_BUSINESS_ID = "584772001227472";
/** Conta de anúncios associada (apenas informativa no painel). */
export const META_AD_ACCOUNT_ID = "1701191574152308";
/** Versão fixa da Graph API usada no pedido. */
export const META_GRAPH_VERSION = "v26.0";
export const META_GRAPH_ORIGIN = "https://graph.facebook.com";

/** Domínio raiz autorizado, sem caminho nem query. */
export const META_EVENT_SOURCE_URL = "https://experiencia-falcao-teste.falcaoneto88.chatgpt.site";

/** Agente de utilizador fixo do teste: não é o de nenhuma pessoa. */
export const META_TEST_USER_AGENT = "JornadaAI-CAPI-Test/1.0 (synthetic; no real visitor)";
/** IP reservado para documentação (RFC 5737): nunca um IP real. */
export const META_TEST_IP = "192.0.2.1";

/** Nome do único evento permitido nesta preparação. */
export const META_TEST_EVENT_NAME = "PageView";

export type EstadoTentativaMeta = "in_progress" | "api_accepted" | "rejected" | "uncertain";

export type EventoTesteMeta = {
  data: {
    event_name: string;
    event_time: number;
    event_id: string;
    action_source: "website";
    event_source_url: string;
    user_data: {
      external_id: string;
      client_ip_address: string;
      client_user_agent: string;
    };
  }[];
  test_event_code: string;
};

/** Código de teste tal como a Meta o apresenta no Gestor de Eventos (ex.: TEST53467). */
export function codigoTesteValido(valor: unknown): valor is string {
  return typeof valor === "string" && /^TEST[0-9A-Z]{1,16}$/.test(valor);
}

export function requestIdValido(valor: unknown): valor is string {
  return (
    typeof valor === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(valor)
  );
}

/** Identificador do evento, marcado como teste e persistido antes do envio. */
export function idEventoTeste(requestId: string): string {
  return `jornada-capi-teste-${requestId}`;
}

/** URL do endpoint oficial. O token nunca entra no URL. */
export function urlEventosMeta(dataset = META_DATASET_ID): string {
  return `${META_GRAPH_ORIGIN}/${META_GRAPH_VERSION}/${dataset}/events`;
}

/**
 * Um único evento sintético PageView. Sem contacto, e-mail, telefone, cookie,
 * IP real, foto, questionário nem qualquer intenção clínica.
 */
export function construirEventoTeste(entrada: {
  eventId: string;
  eventTimeSegundos: number;
  externalIdHash: string;
  testEventCode: string;
}): EventoTesteMeta {
  return {
    data: [
      {
        event_name: META_TEST_EVENT_NAME,
        event_time: entrada.eventTimeSegundos,
        event_id: entrada.eventId,
        action_source: "website",
        event_source_url: META_EVENT_SOURCE_URL,
        user_data: {
          external_id: entrada.externalIdHash,
          client_ip_address: META_TEST_IP,
          client_user_agent: META_TEST_USER_AGENT,
        },
      },
    ],
    test_event_code: entrada.testEventCode,
  };
}

/**
 * Diagnóstico estruturado: nunca guardamos texto bruto da rede nem da Meta,
 * só campos técnicos conhecidos. Assim nenhum valor sensível pode escapar por
 * uma mensagem de erro.
 */
export const DIAGNOSTICO_REDE = "falha_de_rede_ou_tempo_limite";
export const DIAGNOSTICO_REDIRECIONAMENTO = "redirecionamento_recusado";
export const DIAGNOSTICO_SEM_CONTAGEM = "resposta_sem_events_received";
export const DIAGNOSTICO_ERRO_EM_2XX = "erro_no_corpo_de_resposta_2xx";

function campo(nome: string, valor: unknown): string | null {
  if (typeof valor === "number" && Number.isFinite(valor)) return `${nome}=${valor}`;
  if (typeof valor === "boolean") return `${nome}=${valor ? "sim" : "nao"}`;
  return null;
}

/** Só HTTP, error.code, error_subcode e is_transient. Sem mensagem, sem corpo. */
export function diagnosticoEstruturado(entrada: {
  httpStatus: number;
  erro: Record<string, unknown> | null;
  motivo?: string;
}): string {
  const partes = [`http=${entrada.httpStatus}`];
  if (entrada.motivo) partes.push(`motivo=${entrada.motivo}`);
  if (entrada.erro) {
    for (const [nome, chave] of [
      ["code", "code"],
      ["subcode", "error_subcode"],
      ["transient", "is_transient"],
    ] as const) {
      const p = campo(nome, entrada.erro[chave]);
      if (p) partes.push(p);
    }
  }
  return partes.join(" ").slice(0, 200);
}

/** Redacção exata do token, para o caso de algum texto ter de ser guardado. */
export function redigirToken(texto: string, token: string | null): string {
  if (!token || token === "") return texto;
  return texto.split(token).join("[oculto]");
}

export type LeituraRespostaMeta = {
  status: EstadoTentativaMeta;
  eventsReceived: number | null;
  fbtraceId: string | null;
  diagnostico: string;
};

/**
 * Sucesso só com HTTP 2xx e events_received exatamente 1.
 * Corpo vazio, sem campos ou incoerente nunca é sucesso: fica para revisão.
 */
export function interpretarRespostaMeta(entrada: {
  httpStatus: number;
  corpo: unknown;
  redirecionado?: boolean;
}): LeituraRespostaMeta {
  const corpo =
    entrada.corpo && typeof entrada.corpo === "object" && !Array.isArray(entrada.corpo)
      ? (entrada.corpo as Record<string, unknown>)
      : null;
  const fbtraceBruto = corpo?.["fbtrace_id"];
  const fbtraceId =
    typeof fbtraceBruto === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(fbtraceBruto)
      ? fbtraceBruto
      : null;

  if (entrada.redirecionado === true) {
    return {
      status: "uncertain",
      eventsReceived: null,
      fbtraceId,
      diagnostico: "Resposta redirecionada: envio recusado e resultado por confirmar.",
    };
  }

  const ok = entrada.httpStatus >= 200 && entrada.httpStatus < 300;
  if (!ok) {
    const erro = corpo?.["error"];
    const mensagem =
      erro && typeof erro === "object" && !Array.isArray(erro)
        ? ((erro as Record<string, unknown>)["message"] ?? erro)
        : corpo ?? "";
    return {
      status: "rejected",
      eventsReceived: null,
      fbtraceId,
      diagnostico: sanitizarDiagnostico(`HTTP ${entrada.httpStatus}: ${sanitizarDiagnostico(mensagem)}`),
    };
  }

  const recebidos = corpo?.["events_received"];
  if (typeof recebidos !== "number" || !Number.isInteger(recebidos)) {
    return {
      status: "uncertain",
      eventsReceived: null,
      fbtraceId,
      diagnostico: "Resposta sem events_received: resultado por confirmar na Meta.",
    };
  }
  if (recebidos !== 1) {
    return {
      status: "uncertain",
      eventsReceived: recebidos,
      fbtraceId,
      diagnostico: `A Meta indicou ${recebidos} eventos recebidos em vez de 1.`,
    };
  }
  return {
    status: "api_accepted",
    eventsReceived: 1,
    fbtraceId,
    diagnostico: "Pedido aceite pela API. Aceitação não é prova de visualização no Gestor de Eventos.",
  };
}
