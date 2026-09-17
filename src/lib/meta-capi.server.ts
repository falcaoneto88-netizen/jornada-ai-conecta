/**
 * Teste controlado da API de Conversões da Meta (server-only).
 *
 * Princípios: autorização explícita no servidor ANTES de tocar na credencial;
 * o token nunca sai do servidor (nem prefixo, nem em logs, nem em URL); o
 * evento é sintético; a reserva no registo durável acontece antes do pedido e
 * nunca é libertada; não há repetição automática; aceitação da API não é prova
 * de visualização no Gestor de Eventos.
 */
import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { FALCAO_LOCATION, FALCAO_SLUG } from "./falcao-lead.server";
import { FALCAO_SOURCE } from "./falcao-lead.core";
import {
  DIAGNOSTICO_REDE,
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
  urlEventosMeta,
  type EstadoTentativaMeta,
} from "./meta-capi.core";

export const TEMPO_LIMITE_MS = 10_000;

export const RECUSA_ACESSO =
  "Acesso restrito ao administrador da organização com a integração Experiência Falcão ligada a esta conta do GoHighLevel.";

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
export type CtxMeta = { supabase: Cliente; userId: string };

export type DepsAutorizacao = {
  /** Vínculo de confiança, lido server-only (o cliente nunca o altera). */
  lerBinding?: (orgId: string) => Promise<string | null>;
};

export type AutorizacaoMeta =
  | { ok: true; orgId: string; integrationId: string }
  | { ok: false; message: string };

async function bindingServerOnly(orgId: string): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("ghl_location_bindings")
    .select("location_id")
    .eq("organization_id", orgId)
    .maybeSingle();
  const valor = (data as { location_id?: string } | null)?.location_id;
  return typeof valor === "string" ? valor : null;
}

/**
 * Guard partilhado: sessão real, papel de administrador, organização da sessão,
 * integração Experiência Falcão existente e vínculo à location autorizada.
 * Falha fechado: nada é revelado sobre a credencial a quem não passa aqui.
 */
export async function autorizarMetaCapi(
  ctx: CtxMeta,
  deps: DepsAutorizacao = {},
): Promise<AutorizacaoMeta> {
  const recusa = { ok: false as const, message: RECUSA_ACESSO };
  try {
    const { data: sessao, error: erroSessao } = await ctx.supabase.auth.getUser();
    const uid = sessao?.user?.id;
    if (erroSessao || typeof uid !== "string" || uid !== ctx.userId) return recusa;

    const papel = await ctx.supabase.rpc("tem_papel", { _papeis: ["administrador"] });
    if (papel.error || papel.data !== true) return recusa;

    const perfil = await ctx.supabase
      .from("profiles")
      .select("organization_id")
      .eq("id", uid)
      .maybeSingle();
    const orgId = (perfil.data as { organization_id?: string } | null)?.organization_id;
    if (perfil.error || typeof orgId !== "string") return recusa;

    const integracao = await ctx.supabase
      .from("site_integrations")
      .select("id,ghl_location_id")
      .eq("organization_id", orgId)
      .eq("slug", FALCAO_SLUG)
      .eq("source", FALCAO_SOURCE)
      .maybeSingle();
    const linha = integracao.data as { id?: string; ghl_location_id?: string } | null;
    if (integracao.error || typeof linha?.id !== "string" || linha.ghl_location_id !== FALCAO_LOCATION)
      return recusa;

    const binding = await (deps.lerBinding ?? bindingServerOnly)(orgId);
    if (binding !== FALCAO_LOCATION) return recusa;

    return { ok: true, orgId, integrationId: linha.id };
  } catch {
    return recusa;
  }
}

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
  autorizado: boolean;
  credencial: EstadoCredencialMeta | null;
  datasetId: string;
  businessId: string;
  adAccountId: string;
  graphVersion: string;
  eventSourceUrl: string;
  ultimaTentativa: TentativaMeta | null;
  codigosUsados: string[];
  leituraOk: boolean;
};

const ESTADO_NEGADO: EstadoMetaCapi = {
  autorizado: false,
  credencial: null,
  datasetId: META_DATASET_ID,
  businessId: META_BUSINESS_ID,
  adAccountId: META_AD_ACCOUNT_ID,
  graphVersion: META_GRAPH_VERSION,
  eventSourceUrl: META_EVENT_SOURCE_URL,
  ultimaTentativa: null,
  codigosUsados: [],
  leituraOk: false,
};

export async function lerEstadoMetaCapi(
  ctx: CtxMeta,
  deps: DepsAutorizacao & { lerToken?: () => string | null } = {},
): Promise<EstadoMetaCapi> {
  const autorizacao = await autorizarMetaCapi(ctx, deps);
  if (!autorizacao.ok) return ESTADO_NEGADO;

  const { data, error } = await ctx.supabase
    .from("meta_capi_test_attempts")
    .select("created_at,updated_at,status,test_event_code,event_id,events_received,fbtrace_id,diagnostic")
    .eq("dataset_id", META_DATASET_ID)
    .order("created_at", { ascending: false })
    .limit(50);

  const linhas = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  const linha = linhas[0];
  return {
    autorizado: true,
    credencial: estadoCredencialMeta(deps.lerToken ?? tokenMeta),
    datasetId: META_DATASET_ID,
    businessId: META_BUSINESS_ID,
    adAccountId: META_AD_ACCOUNT_ID,
    graphVersion: META_GRAPH_VERSION,
    eventSourceUrl: META_EVENT_SOURCE_URL,
    leituraOk: !error,
    codigosUsados: error ? [] : linhas.map((l) => String(l["test_event_code"])),
    ultimaTentativa:
      !error && linha
        ? {
            criadoEm: String(linha["created_at"]),
            atualizadoEm: String(linha["updated_at"]),
            status: linha["status"] as EstadoTentativaMeta,
            testEventCode: String(linha["test_event_code"]),
            eventId: String(linha["event_id"]),
            eventsReceived:
              typeof linha["events_received"] === "number"
                ? (linha["events_received"] as number)
                : null,
            fbtraceId: typeof linha["fbtrace_id"] === "string" ? (linha["fbtrace_id"] as string) : null,
            diagnostic:
              typeof linha["diagnostic"] === "string" ? (linha["diagnostic"] as string) : null,
          }
        : null,
  };
}

export type ResultadoTesteMeta = {
  ok: boolean;
  estado: EstadoTentativaMeta | "nao_iniciado";
  message: string;
  fbtraceId: string | null;
  eventId: string | null;
};

export type ReciboFinalizacao = {
  persisted?: boolean;
  attempt_id?: string;
  status?: string;
  events_received?: number | null;
} | null;

export type DepsTesteMeta = DepsAutorizacao & {
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
  }) => Promise<ReciboFinalizacao>;
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
}): Promise<ReciboFinalizacao> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // Os tipos gerados não exprimem parâmetros anuláveis; o SQL aceita NULL.
  const argumentos = {
    _attempt: entrada.attemptId,
    _status: entrada.status,
    _events_received: entrada.eventsReceived,
    _fbtrace: entrada.fbtraceId,
    _diagnostic: entrada.diagnostic,
  } as unknown as {
    _attempt: string;
    _status: string;
    _events_received: number;
    _fbtrace: string;
    _diagnostic: string;
  };
  const { data, error } = await supabaseAdmin.rpc("meta_capi_test_finish", argumentos);
  if (error) return null;
  return (data ?? null) as ReciboFinalizacao;
}

/** O recibo tem de bater certo com o que o servidor mandou gravar. */
function reciboConfere(
  recibo: ReciboFinalizacao,
  esperado: { attemptId: string; status: EstadoTentativaMeta; eventsReceived: number | null },
): boolean {
  if (!recibo || recibo.persisted !== true) return false;
  if (recibo.attempt_id !== esperado.attemptId) return false;
  if (recibo.status !== esperado.status) return false;
  const recebidos = recibo.events_received ?? null;
  return recebidos === esperado.eventsReceived;
}

/**
 * Envia UM evento sintético de teste. Só um administrador da organização da
 * integração existente pode chamar; a reserva é atómica e não reutilizável.
 */
export async function testarMetaCapi(
  ctx: CtxMeta,
  entrada: { confirm: boolean; testEventCode: string; requestId?: string },
  deps: DepsTesteMeta = {},
): Promise<ResultadoTesteMeta> {
  const recusa = (message: string): ResultadoTesteMeta => ({
    ok: false,
    estado: "nao_iniciado",
    message,
    fbtraceId: null,
    eventId: null,
  });

  // 1) Autorização explícita, antes de qualquer leitura da credencial.
  const autorizacao = await autorizarMetaCapi(ctx, deps);
  if (!autorizacao.ok) return recusa(autorizacao.message);

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

  const reserva = await ctx.supabase.rpc("meta_capi_test_reserve", {
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
  } catch {
    // Sem repetição e sem texto bruto: diagnóstico estático, desfecho incerto.
    leitura = {
      status: "uncertain",
      eventsReceived: null,
      fbtraceId: null,
      diagnostico: DIAGNOSTICO_REDE,
    };
  }

  let recibo: ReciboFinalizacao = null;
  try {
    recibo = await (deps.finalizar ?? finalizarReal)({
      attemptId,
      status: leitura.status,
      eventsReceived: leitura.eventsReceived,
      fbtraceId: leitura.fbtraceId,
      diagnostic: leitura.diagnostico,
    });
  } catch {
    recibo = null;
  }

  if (
    !reciboConfere(recibo, {
      attemptId,
      status: leitura.status,
      eventsReceived: leitura.eventsReceived,
    })
  )
    return {
      ok: false,
      estado: "uncertain",
      message:
        "O pedido saiu, mas o resultado não ficou gravado de forma verificável. Não repita: consulte o estado desta tentativa e confirme no Gestor de Eventos da Meta.",
      fbtraceId: leitura.fbtraceId,
      eventId,
    };

  const mensagens: Record<EstadoTentativaMeta, string> = {
    in_progress: "Tentativa em curso.",
    api_accepted:
      "A API aceitou 1 evento de teste sintético. Aceitação não confirma visualização no Gestor de Eventos.",
    rejected: `A Meta recusou o evento de teste (${leitura.diagnostico}).`,
    uncertain: `Resultado por confirmar (${leitura.diagnostico}). Não repita: verifique no Gestor de Eventos.`,
  };
  return {
    ok: leitura.status === "api_accepted",
    estado: leitura.status,
    message: mensagens[leitura.status],
    fbtraceId: leitura.fbtraceId,
    eventId,
  };
}

/** SHA-256 hexadecimal, usado só no identificador fictício do teste. */
function hashSincrono(valor: string): string {
  return createHash("sha256").update(valor, "utf8").digest("hex");
}
