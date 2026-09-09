/**
 * Utilitários server-only para falar com a API do GoHighLevel / LeadConnector.
 * Nenhum token sai daqui: as credenciais vivem apenas em variáveis de ambiente
 * do backend e nunca são devolvidas ao frontend.
 */

export type GhlConfig = {
  baseUrl: string;
  version: string;
  token: string;
  locationId: string;
};

export type GhlResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; code: GhlErrorCode; message: string };

export type GhlErrorCode =
  | "missing_secrets"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "timeout"
  | "server_error"
  | "network_error"
  | "bad_request";

export function readGhlSecrets(): { token: string | null; locationId: string | null } {
  return {
    token: process.env["GHL_PRIVATE_TOKEN"] ?? null,
    locationId: process.env["GHL_LOCATION_ID"] ?? null,
  };
}

function codeForStatus(status: number): GhlErrorCode {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  return "bad_request";
}

export function mensagemErro(code: GhlErrorCode): string {
  switch (code) {
    case "missing_secrets":
      return "Credenciais do GoHighLevel não configuradas no backend.";
    case "unauthorized":
      return "Token inválido ou expirado. Gere um novo Private Integration Token no GoHighLevel.";
    case "forbidden":
      return "O token não tem os escopos necessários para esta operação.";
    case "not_found":
      return "Recurso não encontrado. Verifique o Location ID ou o identificador enviado.";
    case "rate_limited":
      return "Limite de pedidos do GoHighLevel atingido. Tente novamente dentro de alguns segundos.";
    case "timeout":
      return "O GoHighLevel demorou demasiado a responder (tempo limite excedido).";
    case "server_error":
      return "O GoHighLevel devolveu um erro interno. Tente novamente mais tarde.";
    case "network_error":
      return "Não foi possível contactar o GoHighLevel.";
    default:
      return "Pedido recusado pelo GoHighLevel. Verifique os dados enviados.";
  }
}

const TIMEOUT_MS = 12_000;
const MAX_TENTATIVAS = 3;

/** Origem e versão fixas da API oficial. Nada as pode alterar em runtime. */
export const GHL_ORIGIN = "https://services.leadconnectorhq.com";
export const GHL_VERSION = "2021-07-28";

/** Constrói o URL final garantindo que nunca sai da origem oficial. */
export function urlOficial(path: string, query: Record<string, string | undefined> = {}): URL {
  const original = String(path);
  if (/^[a-z][a-z0-9+.-]*:/i.test(original) || /^\/{2,}/.test(original) || original.includes("..")) {
    throw new Error("caminho não permitido");
  }
  const limpo = original.replace(/^\/+/, "");
  if (limpo.startsWith("//")) throw new Error("caminho não permitido");
  const url = new URL(limpo, `${GHL_ORIGIN}/`);
  if (url.origin !== GHL_ORIGIN) throw new Error("origem não permitida");
  for (const [k, v] of Object.entries(query)) {
    if (v != null && v !== "") url.searchParams.set(k, v);
  }
  return url;
}

/** Pedido com timeout, retry com backoff exponencial e erros legíveis. */
export async function ghlFetch<T = unknown>(
  cfg: GhlConfig,
  path: string,
  init: { method?: string; body?: unknown; query?: Record<string, string | undefined> } = {},
): Promise<GhlResult<T>> {
  let url: URL;
  try {
    url = urlOficial(path, init.query ?? {});
  } catch {
    return { ok: false, status: 0, code: "bad_request", message: mensagemErro("bad_request") };
  }

  let ultimo: { status: number; code: GhlErrorCode } = { status: 0, code: "network_error" };

  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    try {
      const res = await fetch(url.toString(), {
        method: init.method ?? "GET",
        headers: {
          Authorization: `Bearer ${cfg.token}`,
          Version: GHL_VERSION,
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
        },
        ...(init.body ? { body: JSON.stringify(init.body) } : {}),
        // Nunca seguir redirects: evitaria enviar o token para outro destino.
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (res.status >= 300 && res.status < 400) {
        return {
          ok: false,
          status: res.status,
          code: "bad_request",
          message: "O GoHighLevel respondeu com um redirecionamento; pedido bloqueado por segurança.",
        };
      }

      if (res.ok) {
        const texto = await res.text();
        const data = texto ? (JSON.parse(texto) as T) : ({} as T);
        return { ok: true, status: res.status, data };
      }

      const code = codeForStatus(res.status);
      ultimo = { status: res.status, code };
      // Só vale a pena repetir em rate-limit ou erro do servidor.
      if (code !== "rate_limited" && code !== "server_error") break;
    } catch (erro) {
      const isTimeout = erro instanceof Error && (erro.name === "TimeoutError" || erro.name === "AbortError");
      ultimo = { status: 0, code: isTimeout ? "timeout" : "network_error" };
    }

    if (tentativa < MAX_TENTATIVAS) {
      await new Promise((r) => setTimeout(r, 400 * 2 ** (tentativa - 1)));
    }
  }

  return { ok: false, status: ultimo.status, code: ultimo.code, message: mensagemErro(ultimo.code) };
}

export type PapelApp = "administrador" | "gestor" | "comercial" | "visualizador";

export type DefinicaoOperacao = {
  method: "GET" | "POST";
  /** Caminho relativo; recebe a location autorizada e o contacto GHL verificado. */
  path: (ctx: { locationId: string; ghlContactId: string | null }) => string;
  escrita: boolean;
  /** Papéis autorizados a executar a operação. */
  papeis: readonly PapelApp[];
  /** Parâmetros de query aceites do cliente (locationId é sempre imposto pelo servidor). */
  query: readonly string[];
  /** Chaves de body aceites do cliente. */
  body: readonly string[];
  /** Exige um contacto local cuja propriedade é verificada na location autorizada. */
  exigeContacto: boolean;
  /** Nome do parâmetro de location exigido por esta rota da API oficial. */
  chaveLocation?: "locationId" | "location_id";
  /** Envia o contacto verificado na query (rotas que filtram por contacto). */
  contactoNaQuery?: "contactId" | "contact_id";
};

const LEITURA: readonly PapelApp[] = ["administrador", "gestor", "comercial", "visualizador"];
const OPERACAO: readonly PapelApp[] = ["administrador", "gestor", "comercial"];

/** Operações permitidas no proxy. Nada fora desta lista é executado. */
export const OPERACOES: Record<string, DefinicaoOperacao> = {
  "locations.get": {
    method: "GET",
    path: (c) => `locations/${encodeURIComponent(c.locationId)}`,
    escrita: false,
    papeis: LEITURA,
    query: [],
    body: [],
    exigeContacto: false,
  },
  "contacts.list": {
    method: "GET",
    path: () => "contacts/",
    escrita: false,
    papeis: LEITURA,
    query: ["limit", "query", "startAfterId", "startAfter"],
    body: [],
    exigeContacto: false,
  },
  "pipelines.list": {
    method: "GET",
    path: () => "opportunities/pipelines",
    escrita: false,
    papeis: LEITURA,
    query: [],
    body: [],
    exigeContacto: false,
  },
  "opportunities.search": {
    method: "GET",
    path: () => "opportunities/search",
    escrita: false,
    papeis: LEITURA,
    query: ["limit", "q", "status"],
    body: [],
    exigeContacto: false,
    // A rota /opportunities/search da versão 2021-07-28 exige "location_id".
    chaveLocation: "location_id",
  },
  "calendars.list": {
    method: "GET",
    path: () => "calendars/",
    escrita: false,
    papeis: LEITURA,
    query: [],
    body: [],
    exigeContacto: false,
  },
  "calendars.events": {
    method: "GET",
    path: () => "calendars/events",
    escrita: false,
    papeis: LEITURA,
    query: ["calendarId", "startTime", "endTime"],
    body: [],
    exigeContacto: false,
  },
  "users.list": {
    method: "GET",
    path: () => "users/",
    escrita: false,
    papeis: ["administrador", "gestor"],
    query: [],
    body: [],
    exigeContacto: false,
  },
  "conversations.search": {
    method: "GET",
    path: () => "conversations/search",
    escrita: false,
    papeis: LEITURA,
    query: ["limit", "query"],
    body: [],
    exigeContacto: true,
    contactoNaQuery: "contactId",
  },
  "conversations.sendMessage": {
    method: "POST",
    path: () => "conversations/messages",
    escrita: true,
    papeis: OPERACAO,
    query: [],
    body: ["type", "message"],
    exigeContacto: true,
  },
  "contacts.addTag": {
    method: "POST",
    path: (c) => `contacts/${encodeURIComponent(c.ghlContactId ?? "")}/tags`,
    escrita: true,
    papeis: OPERACAO,
    query: [],
    body: ["tags"],
    exigeContacto: true,
  },
};

export type OperacaoGhl = keyof typeof OPERACOES;

export function isOperacaoValida(op: string): op is OperacaoGhl {
  return Object.prototype.hasOwnProperty.call(OPERACOES, op);
}

/**
 * Parâmetros impostos pelo servidor: location com o nome que a rota exige e,
 * quando aplicável, o contacto já verificado.
 */
export function parametrosDoServidor(
  op: DefinicaoOperacao,
  ctx: { locationId: string; ghlContactId: string | null },
): Record<string, string> {
  const saida: Record<string, string> = { [op.chaveLocation ?? "locationId"]: ctx.locationId };
  if (op.contactoNaQuery && ctx.ghlContactId) saida[op.contactoNaQuery] = ctx.ghlContactId;
  return saida;
}

/** Filtra a query do cliente pela allowlist; locationId nunca vem do cliente. */
export function filtrarQuery(
  op: DefinicaoOperacao,
  query: Record<string, unknown> | undefined,
): { ok: true; valor: Record<string, string> } | { ok: false; motivo: string } {
  const saida: Record<string, string> = {};
  for (const [k, v] of Object.entries(query ?? {})) {
    if (
      k === "locationId" ||
      k === "location_id" ||
      k === "altId" ||
      k === "altType" ||
      k === "contactId" ||
      k === "contact_id"
    ) {
      return { ok: false, motivo: `O parâmetro "${k}" é definido pelo servidor e não pode ser enviado.` };
    }
    if (!op.query.includes(k)) return { ok: false, motivo: `Parâmetro não permitido: "${k}".` };
    if (typeof v !== "string" && typeof v !== "number") return { ok: false, motivo: `Valor inválido em "${k}".` };
    saida[k] = String(v).slice(0, 200);
  }
  return { ok: true, valor: saida };
}

/** Valida o body pela allowlist da operação. */
export function filtrarBody(
  op: DefinicaoOperacao,
  body: unknown,
): { ok: true; valor: Record<string, unknown> } | { ok: false; motivo: string } {
  if (body == null) return { ok: true, valor: {} };
  if (typeof body !== "object" || Array.isArray(body)) return { ok: false, motivo: "Body inválido." };
  const saida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (k === "locationId" || k === "location_id" || k === "contactId") {
      return { ok: false, motivo: `O campo "${k}" é definido pelo servidor e não pode ser enviado.` };
    }
    if (!op.body.includes(k)) return { ok: false, motivo: `Campo não permitido: "${k}".` };
    if (typeof v === "string") saida[k] = v.slice(0, 4000);
    else if (Array.isArray(v) && v.every((i) => typeof i === "string")) saida[k] = v.slice(0, 20);
    else return { ok: false, motivo: `Valor inválido em "${k}".` };
  }
  return { ok: true, valor: saida };
}

/** Confirma que o contacto do GoHighLevel pertence à location autorizada. */
export async function contactoPertenceALocation(
  token: string,
  locationId: string,
  ghlContactId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const res = await ghlFetch<{ contact?: { id?: string; locationId?: string } }>(
    { baseUrl: GHL_ORIGIN, version: GHL_VERSION, token, locationId },
    `contacts/${encodeURIComponent(ghlContactId)}`,
  );
  if (!res.ok) return { ok: false, message: res.message };
  const contacto = res.data?.contact;
  if (!contacto?.id) return { ok: false, message: "Contacto não encontrado no GoHighLevel." };
  if (contacto.id !== ghlContactId) {
    return { ok: false, message: "O contacto devolvido não corresponde ao pedido." };
  }
  if (contacto.locationId !== locationId) {
    return { ok: false, message: "O contacto não pertence à localização autorizada desta conta." };
  }
  return { ok: true };
}

