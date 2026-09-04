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

/** Pedido com timeout, retry com backoff exponencial e erros legíveis. */
export async function ghlFetch<T = unknown>(
  cfg: GhlConfig,
  path: string,
  init: { method?: string; body?: unknown; query?: Record<string, string | undefined> } = {},
): Promise<GhlResult<T>> {
  const url = new URL(path.replace(/^\//, ""), cfg.baseUrl.replace(/\/?$/, "/"));
  for (const [k, v] of Object.entries(init.query ?? {})) {
    if (v != null && v !== "") url.searchParams.set(k, v);
  }

  let ultimo: { status: number; code: GhlErrorCode } = { status: 0, code: "network_error" };

  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    try {
      const res = await fetch(url.toString(), {
        method: init.method ?? "GET",
        headers: {
          Authorization: `Bearer ${cfg.token}`,
          Version: cfg.version,
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
        },
        ...(init.body ? { body: JSON.stringify(init.body) } : {}),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

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

/** Operações permitidas no proxy. Nada fora desta lista é executado. */
export const OPERACOES = {
  "locations.get": { method: "GET", path: (c: GhlConfig) => `locations/${c.locationId}`, escrita: false },
  "contacts.list": { method: "GET", path: () => "contacts/", escrita: false },
  "pipelines.list": { method: "GET", path: () => "opportunities/pipelines", escrita: false },
  "opportunities.search": { method: "GET", path: () => "opportunities/search", escrita: false },
  "calendars.list": { method: "GET", path: () => "calendars/", escrita: false },
  "users.list": { method: "GET", path: () => "users/", escrita: false },
  "conversations.search": { method: "GET", path: () => "conversations/search", escrita: false },
  "conversations.sendMessage": { method: "POST", path: () => "conversations/messages", escrita: true },
  "contacts.addTag": { method: "POST", path: () => "contacts/tags", escrita: true },
} as const;

export type OperacaoGhl = keyof typeof OPERACOES;

export function isOperacaoValida(op: string): op is OperacaoGhl {
  return Object.prototype.hasOwnProperty.call(OPERACOES, op);
}
