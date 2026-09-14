import { z } from "zod";

export const idGhl = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const texto = z.string().max(100_000);
const dataGhl = z.union([z.string(), z.number()]).nullish();
export const pesquisaConversas = z
  .object({
    organizationId: z.string().uuid(),
    query: z.string().trim().max(100).default(""),
    cursor: z
      .string()
      .max(40)
      .regex(/^\d+(?:\.\d+)?$/)
      .optional(),
  })
  .strict();
export const pedidoMensagens = z
  .object({
    organizationId: z.string().uuid(),
    conversationId: idGhl,
    cursor: idGhl.optional(),
  })
  .strict();
export const pedidoWorkflows = z.object({ organizationId: z.string().uuid() }).strict();

export function dataIso(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const input = typeof value === "string" && /^\d{10,}$/.test(value) ? Number(value) : value;
  const date = new Date(input);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

const conversaSchema = z.object({
  id: idGhl,
  contactId: idGhl,
  locationId: idGhl,
  fullName: texto.nullish(),
  contactName: texto.nullish(),
  lastMessageBody: texto.nullish(),
  lastMessageType: z.string().nullish(),
  lastMessageDate: dataGhl,
  unreadCount: z.number().int().nonnegative().nullish(),
});
export type ConversaGhl = {
  id: string;
  contactId: string;
  locationId: string;
  nome: string;
  ultimaMensagem: string;
  tipo: string;
  ultimaData: string | null;
  naoLidas: number | null;
};
export function normalizarConversas(raw: unknown, locationId: string, cursor?: string) {
  const parsed = z
    .object({
      conversations: z.array(conversaSchema).max(100),
      total: z.number().nonnegative().optional(),
    })
    .parse(raw);
  if (parsed.conversations.some((c) => c.locationId !== locationId))
    throw new Error("Resposta GHL fora da subconta autorizada.");
  const conversas: ConversaGhl[] = parsed.conversations.map((c) => ({
    id: c.id,
    contactId: c.contactId,
    locationId: c.locationId,
    nome: c.fullName?.trim() || c.contactName?.trim() || "Contacto sem nome",
    ultimaMensagem: c.lastMessageBody ?? "",
    tipo: c.lastMessageType ?? "Desconhecido",
    ultimaData: dataIso(c.lastMessageDate),
    naoLidas: c.unreadCount ?? null,
  }));
  const last = conversas.at(-1)?.ultimaData;
  const next = last ? String(new Date(last).getTime()) : null;
  const more = conversas.length >= 25;
  // O cursor da API é uma data; não prometer completude se ela estiver ausente ou não avançar.
  const avanca = next !== null && (!cursor || Number(next) < Number(cursor));
  return {
    conversas,
    total: parsed.total ?? null,
    proximoCursor: more && avanca ? next : null,
    limitePaginacao: more && !avanca,
  };
}

const mensagemSchema = z.object({
  id: idGhl,
  conversationId: idGhl,
  contactId: idGhl.optional(),
  locationId: idGhl.optional(),
  dateAdded: dataGhl,
  body: texto.nullish(),
  messageType: z.string().nullish(),
  type: z.union([z.string(), z.number()]).optional(),
  direction: z.string().optional(),
  status: z.string().nullish(),
  source: z.string().nullish(),
  error: texto.nullish(),
  contentType: z.string().nullish(),
  attachments: z.array(z.unknown()).optional(),
  conversationProviderId: z.string().nullish(),
});
export type MensagemGhl = {
  id: string;
  data: string | null;
  texto: string;
  tipo: string;
  direcao: string;
  estado: string | null;
  origem: string | null;
  erro: string | null;
  anexos: number;
  html: boolean;
  provedor: string | null;
};
export function normalizarMensagens(
  raw: unknown,
  scope: { locationId: string; contactId: string; conversationId: string },
  cursor?: string,
) {
  const parsed = z
    .object({
      messages: z.object({
        messages: z.array(mensagemSchema).max(100),
        nextPage: z.boolean(),
        lastMessageId: idGhl.nullish(),
      }),
    })
    .parse(raw).messages;
  if (
    parsed.messages.some(
      (m) =>
        m.conversationId !== scope.conversationId ||
        (m.contactId !== undefined && m.contactId !== scope.contactId) ||
        (m.locationId !== undefined && m.locationId !== scope.locationId),
    )
  ) {
    throw new Error("Mensagem fora da conversa autorizada.");
  }
  const mensagens: MensagemGhl[] = Array.from(
    new Map(
      parsed.messages.map((m) => [
        m.id,
        {
          id: m.id,
          data: dataIso(m.dateAdded),
          texto: m.body ?? "",
          tipo: m.messageType ?? String(m.type ?? "Desconhecido"),
          direcao: m.direction ?? "unknown",
          estado: m.status ?? null,
          origem: m.source ?? null,
          erro: m.error ?? null,
          anexos: m.attachments?.length ?? 0,
          html: m.contentType?.includes("html") ?? false,
          provedor: m.conversationProviderId ?? null,
        },
      ]),
    ).values(),
  ).sort((a, b) => (a.data ?? "").localeCompare(b.data ?? ""));
  const next = parsed.lastMessageId;
  const avanca = Boolean(next && next !== cursor);
  return {
    mensagens,
    proximoCursor: parsed.nextPage && avanca ? next! : null,
    limitePaginacao: parsed.nextPage && !avanca,
  };
}

export function normalizarWorkflows(raw: unknown, locationId: string) {
  const parsed = z
    .object({
      workflows: z
        .array(
          z.object({
            id: idGhl,
            name: z.string().max(1000),
            locationId: idGhl,
            status: z.string().max(100),
            version: z.number().nullish(),
            updatedAt: dataGhl,
          }),
        )
        .max(5000),
    })
    .parse(raw);
  if (parsed.workflows.some((w) => w.locationId !== locationId))
    throw new Error("Workflow fora da subconta autorizada.");
  return parsed.workflows.map((w) => ({
    id: w.id,
    nome: w.name,
    estado: w.status,
    versao: w.version ?? null,
    atualizadoEm: dataIso(w.updatedAt),
    url: `https://app.gohighlevel.com/v2/location/${locationId}/automation/workflow/${w.id}/logs`,
  }));
}

export function confirmarConversa(raw: unknown, locationId: string, conversationId: string) {
  const parsed = z
    .object({ id: idGhl, contactId: idGhl, locationId: idGhl, deleted: z.boolean().optional() })
    .parse(raw);
  if (parsed.id !== conversationId || parsed.locationId !== locationId || parsed.deleted)
    throw new Error("Conversa indisponível nesta subconta.");
  return parsed;
}

export function canalMensagem(tipo: string) {
  const chave = tipo.replace(/^TYPE_/, "").toUpperCase();
  const nomes: Record<string, string> = {
    SMS: "SMS",
    WHATSAPP: "WhatsApp",
    EMAIL: "E-mail",
    FACEBOOK: "Facebook",
    INSTAGRAM: "Instagram",
    CALL: "Chamada",
    WEBCHAT: "Chat",
    LIVE_CHAT: "Chat",
  };
  return nomes[chave] ?? tipo;
}

/** Uma palavra na conversa não comprova a qual consulta ou pergunta ela responde. */
export function respostaLiteral(m: Pick<MensagemGhl, "direcao" | "texto">): "SIM" | "NÃO" | null {
  if (m.direcao !== "inbound") return null;
  const t = m.texto
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.!?]+$/, "");
  return t === "sim" ? "SIM" : t === "nao" ? "NÃO" : null;
}
