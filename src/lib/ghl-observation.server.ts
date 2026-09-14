import { resolverAcesso, type Acesso, type Recusa } from "./ghl.functions";
import {
  ghlFetch,
  readGhlSecrets,
  GHL_ORIGIN,
  GHL_VERSION,
  type GhlConfig,
  type GhlResult,
} from "./ghl.server";
import {
  confirmarConversa,
  normalizarConversas,
  normalizarMensagens,
  normalizarWorkflows,
  pedidoMensagens,
  pedidoWorkflows,
  pesquisaConversas,
} from "./ghl-observation.core";

type Contexto = Parameters<typeof resolverAcesso>[0];
type Dependencias = {
  acesso: (ctx: Contexto) => Promise<{ ok: true; acesso: Acesso } | Recusa>;
  token: () => string | null;
  get: (
    cfg: GhlConfig,
    path: string,
    init?: { query?: Record<string, string | undefined> },
  ) => Promise<GhlResult<unknown>>;
};
const padrao: Dependencias = {
  acesso: (ctx) => resolverAcesso(ctx, ["administrador", "gestor", "comercial", "visualizador"]),
  token: () => readGhlSecrets().token,
  get: ghlFetch,
};

/** Só GETs oficiais, depois de resolver organização, papel e binding confiável. */
export async function observarGhl(
  ctx: Contexto,
  tipo: "conversas" | "mensagens" | "workflows",
  input: unknown,
  deps = padrao,
) {
  const data = (
    tipo === "conversas"
      ? pesquisaConversas
      : tipo === "mensagens"
        ? pedidoMensagens
        : pedidoWorkflows
  ).parse(input);
  const result = await deps.acesso(ctx);
  if (!result.ok) throw new Error(result.message);
  const { orgId, locationId } = result.acesso;
  if (orgId !== data.organizationId)
    throw new Error("A organização da sessão mudou. Atualize a página.");
  const token = deps.token();
  if (!token) throw new Error("Credenciais GHL indisponíveis.");
  const cfg = { baseUrl: GHL_ORIGIN, version: GHL_VERSION, token, locationId };
  async function get(path: string, query?: Record<string, string | undefined>) {
    const res = await deps.get(cfg, path, query ? { query } : {});
    if (!res.ok) throw new Error(res.message);
    return res.data;
  }
  const comum = { organizationId: orgId, locationId, consultadoEm: new Date().toISOString() };
  try {
    if (tipo === "conversas") {
      const p = pesquisaConversas.parse(data);
      const raw = await get("conversations/search", {
        locationId,
        limit: "25",
        sort: "desc",
        sortBy: "last_message_date",
        query: p.query,
        startAfterDate: p.cursor,
      });
      return {
        tipo: "conversas" as const,
        ...comum,
        ...normalizarConversas(raw, locationId, p.cursor),
      };
    }
    if (tipo === "mensagens") {
      const p = pedidoMensagens.parse(data);
      const conversa = confirmarConversa(
        await get(`conversations/${p.conversationId}`),
        locationId,
        p.conversationId,
      );
      const raw = await get(`conversations/${conversa.id}/messages`, {
        limit: "50",
        lastMessageId: p.cursor,
      });
      return {
        tipo: "mensagens" as const,
        ...comum,
        contactId: conversa.contactId,
        ...normalizarMensagens(
          raw,
          { locationId, contactId: conversa.contactId, conversationId: conversa.id },
          p.cursor,
        ),
      };
    }
    return {
      tipo: "workflows" as const,
      ...comum,
      workflows: normalizarWorkflows(await get("workflows/", { locationId }), locationId),
    };
  } catch (e) {
    // Zod pode conter trechos do payload; nunca os devolver como erro ao navegador.
    if (e instanceof Error && e.name === "ZodError")
      throw new Error(
        "O GHL devolveu dados num formato inesperado. Consulte novamente ou abra o GHL.",
      );
    throw e;
  }
}
