/**
 * Teste controlado da API de Conversões da Meta (server-only).
 *
 * Princípios: o token nunca sai do servidor (nem prefixo, nem em logs, nem em
 * URL); o evento é sintético; a reserva no registo durável acontece ANTES do
 * pedido e nunca é libertada; não há repetição automática; aceitação da API não
 * é prova de visualização no Gestor de Eventos.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  META_AD_ACCOUNT_ID,
  META_BUSINESS_ID,
  META_DATASET_ID,
  META_EVENT_SOURCE_URL,
  META_GRAPH_VERSION,
  codigoTesteValido,
  construirEventoTeste,
  idEventoTeste,
  interpretarRespostaMeta,
  requestIdValido,
  sanitizarDiagnostico,
  urlEventosMeta,
  type EstadoTentativaMeta,
} from "./meta-capi.core";

export const TEMPO_LIMITE_MS = 10_000;

export type EstadoCredencialMeta = "ausente" | "malformada" | "presente";

/** Só o próprio servidor lê o valor; para fora sai apenas o estado. */
function tokenMeta(): string | null {
  const bruto = process.env["FALCAO_SITE_META_CAPI_ACCESS_TOKEN"];
  return typeof bruto === "string" && bruto.trim() !== "" ? bruto.trim() : null;
}

export function estadoCredencialMeta(ler: () => string | null = tokenMeta): EstadoCredencialMeta {
  const valor = ler();
  if (valor === null) return "ausente";
  return /^[A-Za-z0-9._-]{30,512}$/.test(valor) ? "presente" : "malformada";
}

type Cliente = Pick<SupabaseClient, "rpc" | "from" | "auth">;

export type TentativaMeta = {
  criadoEm: string;
  atualizadoEm: string;
  status: EstadoTentativaMeta;
  testEventCode: string;
  eventId: string;
  eventsReceived: number | null;
  fbtraceId: string | null;
  diagnostic: string | null;
};

export type EstadoMetaCapi = {
  credencial: EstadoCredencialMeta;
  datasetId: string;
  businessId: string;
  adAccountId: string;
  graphVersion: string;
  eventSourceUrl: string;
  ultimaTentativa: TentativaMeta | null;
  leituraOk: boolean;
};

export async function lerEstadoMetaCapi(
  client: Cliente,
  ler: () => string | null = tokenMeta,
): Promise<EstadoMetaCapi> {
  const { data, error } = await client
    .from("meta_capi_test_attempts")
    .select("created_at,updated_at,status,test_event_code,event_id,events_received,fbtrace_id,diagnostic")
    .eq("dataset_id", META_DATASET_ID)
    .order("created_at", { ascending: false })
    .limit(1);

  const linha = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  return {
    credencial: estadoCredencialMeta(ler),
    datasetId: META_DATASET_ID,
    businessId: META_BUSINESS_ID,
    adAccountId: META_AD_ACCOUNT_ID,
    graphVersion: META_GRAPH_VERSION,
    eventSourceUrl: META_EVENT_SOURCE_URL,
    leituraOk: !error,
    ultimaTentativa: linha
      ? {
          criadoEm: String(linha["created_at"]),
          atualizadoEm: String(linha["updated_at"]),
          status: linha["status"] as EstadoTentativaMeta,
          testEventCode: String(linha["test_event_code"]),
          eventId: String(linha["event_id"]),
          eventsReceived:
            typeof linha["events_received"] === "number" ? (linha["events_received"] as number) : null,
          fbtraceId: typeof linha["fbtrace_id"] === "string" ? (linha["fbtrace_id"] as string) : null,
          diagnostic: typeof linha["diagnostic"] === "string" ? (linha["diagnostic"] as string) : null,
        }
      : null,
  };
}

export type ResultadoTesteMeta = {
  ok: boolean;
  estado: EstadoTentativaMeta | "nao_iniciado";
  message: string;
  fbtraceId: string | null;
};

export type DepsTesteMeta = {
  lerToken?: () => string | null;
  /** Um único pedido, sem repetição automática. */
  enviar?: (url: string, corpo: URLSearchParams) => Promise<{
    httpStatus: number;
    corpo: unknown;
    redirecionado: boolean;
  }>;
  /** Finalização em canal de confiança (service role). */
  finalizar?: (entrada: {
    attemptId: string;
    status: EstadoTentativaMeta;
    eventsReceived: number | null;
    fbtraceId: string | null;
    diagnostic: string;
  }) => Promise<boolean>;
  agora?: () => Date;
  novoRequestId?: () => string;
  hash?: (valor: string) => string;
};

async function enviarReal(url: string, corpo: URLSearchParams) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TEMPO_LIMITE_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: corpo,
      redirect: "manual",
      signal: ctrl.signal,
    });
    const texto = await res.text();
    let json: unknown = null;
    try {
      json = texto === "" ? null : JSON.parse(texto);
    } catch {
      json = null;
    }
    return {
      httpStatus: res.status,
      corpo: json,
      redirecionado: res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function finalizarReal(entrada: {
  attemptId: string;
  status: EstadoTentativaMeta;
  eventsReceived: number | null;
  fbtraceId: string | null;
  diagnostic: string;
}): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("meta_capi_test_finish", {
    _attempt: entrada.attemptId,
    _status: entrada.status,
    _events_received: entrada.eventsReceived,
    _fbtrace: entrada.fbtraceId,
    _diagnostic: entrada.diagnostic,
  });
  return !error && (data as { persisted?: boolean } | null)?.persisted === true;
}

/**
 * Envia UM evento sintético de teste. Só um administrador da organização da
 * integração existente pode chamar; a reserva é atómica e não reutilizável.
 */
export async function testarMetaCapi(
  client: Cliente,
  entrada: { confirm: boolean; testEventCode: string; requestId?: string },
  deps: DepsTesteMeta = {},
): Promise<ResultadoTesteMeta> {
  const recusa = (message: string): ResultadoTesteMeta => ({
    ok: false,
    estado: "nao_iniciado",
    message,
    fbtraceId: null,
  });

  if (entrada.confirm !== true) return recusa("Confirme o envio do evento de teste.");
  if (!codigoTesteValido(entrada.testEventCode))
    return recusa("Código de teste inválido. Copie-o do Gestor de Eventos (ex.: TEST00000).");
  if (entrada.requestId !== undefined && !requestIdValido(entrada.requestId))
    return recusa("Identificador de pedido inválido.");

  const credencial = estadoCredencialMeta(deps.lerToken ?? tokenMeta);
  if (credencial !== "presente")
    return recusa(
      credencial === "ausente"
        ? "A credencial da Meta não está registada no servidor."
        : "A credencial da Meta registada no servidor não tem um formato utilizável.",
    );
  const token = (deps.lerToken ?? tokenMeta)();
  if (token === null) return recusa("A credencial da Meta não está registada no servidor.");

  const requestId = entrada.requestId ?? (deps.novoRequestId ?? (() => crypto.randomUUID()))();
  if (!requestIdValido(requestId)) return recusa("Identificador de pedido inválido.");
  const eventId = idEventoTeste(requestId);

  const reserva = await client.rpc("meta_capi_test_reserve", {
    _dataset: META_DATASET_ID,
    _test_code: entrada.testEventCode,
    _request: requestId,
    _event_id: eventId,
    _confirm: true,
  });
  const attemptId = (reserva.data as { attempt_id?: string } | null)?.attempt_id;
  if (reserva.error || typeof attemptId !== "string")
    return recusa(
      "Não foi possível reservar a tentativa. Confirme que é administrador desta organização e que ainda não existe um teste com este código.",
    );

  const agora = (deps.agora ?? (() => new Date()))();
  const sha = deps.hash ?? hashSincrono;
  const evento = construirEventoTeste({
    eventId,
    eventTimeSegundos: Math.floor(agora.getTime() / 1000),
    // Identificador fictício exclusivo do teste: não deriva de ninguém real.
    externalIdHash: sha(`jornada-capi-teste:${requestId}`),
    testEventCode: entrada.testEventCode,
  });

  const corpo = new URLSearchParams();
  corpo.set("data", JSON.stringify(evento.data));
  corpo.set("test_event_code", evento.test_event_code);
  corpo.set("access_token", token);

  let leitura: ReturnType<typeof interpretarRespostaMeta>;
  try {
    const resposta = await (deps.enviar ?? enviarReal)(urlEventosMeta(), corpo);
    leitura = interpretarRespostaMeta(resposta);
  } catch (erro) {
    // Sem repetição: o desfecho fica incerto e a reserva não é libertada.
    leitura = {
      status: "uncertain",
      eventsReceived: null,
      fbtraceId: null,
      diagnostico: sanitizarDiagnostico(
        `Falha de rede ou tempo limite: ${erro instanceof Error ? erro.message : "desconhecida"}`,
      ),
    };
  }

  const persistido = await (deps.finalizar ?? finalizarReal)({
    attemptId,
    status: leitura.status,
    eventsReceived: leitura.eventsReceived,
    fbtraceId: leitura.fbtraceId,
    diagnostic: leitura.diagnostico,
  });

  if (!persistido)
    return {
      ok: false,
      estado: "uncertain",
      message:
        "O pedido saiu, mas não foi possível gravar o resultado. Trate como por confirmar e reveja no Gestor de Eventos antes de repetir.",
      fbtraceId: leitura.fbtraceId,
    };

  const mensagens: Record<EstadoTentativaMeta, string> = {
    in_progress: "Tentativa em curso.",
    api_accepted:
      "A API aceitou 1 evento de teste sintético. Aceitação não confirma visualização no Gestor de Eventos.",
    rejected: `A Meta recusou o evento de teste. ${leitura.diagnostico}`,
    uncertain: `Resultado por confirmar. ${leitura.diagnostico}`,
  };
  return {
    ok: leitura.status === "api_accepted",
    estado: leitura.status,
    message: mensagens[leitura.status],
    fbtraceId: leitura.fbtraceId,
  };
}

/** SHA-256 hexadecimal (Node/Workers), usado só no identificador fictício. */
function hashSincrono(valor: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  return createHash("sha256").update(valor, "utf8").digest("hex");
}
