/**
 * Núcleo (sem dependências de infraestrutura) do recetor de Custom Webhooks do
 * GoHighLevel. Toda a I/O é injetada, o que torna o comportamento testável.
 *
 * Autenticação: cabeçalho `x-webhook-secret` com o valor de GHL_WEBHOOK_SECRET.
 * Este é o caminho "Workflow › Custom Webhook" do GoHighLevel — não há
 * assinatura HMAC nativa neste caminho.
 */

export const EVENTOS_SUPORTADOS = ["contact.created", "contact.updated"] as const;
export type EventoSuportado = (typeof EVENTOS_SUPORTADOS)[number];

export type ContactoGhl = {
  id: string;
  locationId?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  contactName?: string | null;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  tags?: string[] | null;
  source?: string | null;
  dateUpdated?: string | null;
  dateAdded?: string | null;
};

export type ResultadoFetchContacto =
  | { ok: true; contact: ContactoGhl }
  | { ok: false; status: number; message: string };

export type Claim =
  | { outcome: "claimed"; inboxId: string }
  | { outcome: "duplicate" }
  | { outcome: "in_flight" };

export type DadosContacto = {
  ghlContactId: string;
  fullName: string;
  phone: string | null;
  phoneNormalized: string | null;
  email: string | null;
  tags: string[];
  source: string | null;
  lastInteractionAt: string | null;
};

export interface WebhookStore {
  /** Ligação de confiança location -> organização (apenas server-side). */
  findOrganization(locationId: string): Promise<string | null>;
  /** Reserva a entrega de forma atómica; devolve duplicate quando já processada. */
  claim(input: {
    idempotencyKey: string;
    organizationId: string;
    eventType: EventoSuportado;
    eventId: string | null;
    locationId: string;
    sourceVersion: string;
    payload: Record<string, unknown>;
  }): Promise<Claim>;
  /** Grava contacto + auditoria + estado processado numa única transação. */
  applyContact(input: {
    inboxId: string;
    organizationId: string;
    eventType: EventoSuportado;
    sourceVersion: string;
    contacto: DadosContacto;
  }): Promise<{ contactId: string; created: boolean }>;
  markFailed(inboxId: string, message: string): Promise<void>;
}

export type WebhookDeps = {
  secret: string | null;
  tokenPresente: boolean;
  locationEsperada: string;
  store: WebhookStore;
  fetchContact: (contactId: string) => Promise<ResultadoFetchContacto>;
};

export type RespostaWebhook = {
  status: number;
  body: Record<string, unknown>;
};

function resposta(status: number, body: Record<string, unknown>): RespostaWebhook {
  return { status, body };
}

function limpar(valor?: string | null): string {
  return (valor ?? "").replace(/\bundefined\b|\bnull\b/gi, "").replace(/\s+/g, " ").trim();
}

export function nomeDoContacto(c: ContactoGhl): string {
  return (
    limpar([c.firstName, c.lastName].filter(Boolean).join(" ")) ||
    limpar(c.contactName) ||
    limpar(c.name) ||
    limpar(c.email) ||
    "Sem nome"
  );
}

export function normalizarTelefone(phone?: string | null): string | null {
  const digitos = (phone ?? "").replace(/\D/g, "");
  return digitos.length > 0 ? digitos : null;
}

/** Versão estável do registo de origem, usada na chave de idempotência. */
export function versaoDoContacto(c: ContactoGhl): string {
  if (typeof c.dateUpdated === "string" && c.dateUpdated.trim() !== "") return c.dateUpdated.trim();
  const conteudo = JSON.stringify({
    n: nomeDoContacto(c),
    p: c.phone ?? null,
    e: c.email ?? null,
    t: [...(c.tags ?? [])].sort(),
    s: c.source ?? null,
  });
  let h = 5381;
  for (let i = 0; i < conteudo.length; i++) h = ((h * 33) ^ conteudo.charCodeAt(i)) >>> 0;
  return `c${h.toString(16)}`;
}

export function isEventoSuportado(valor: unknown): valor is EventoSuportado {
  return typeof valor === "string" && (EVENTOS_SUPORTADOS as readonly string[]).includes(valor);
}

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() !== "" ? valor.trim() : null;
}

/** Processa uma entrega. Nunca devolve valores de credenciais. */
export async function processarWebhook(
  entrada: { corpo: string; segredoRecebido: string | null },
  deps: WebhookDeps,
): Promise<RespostaWebhook> {
  if (!deps.secret) {
    return resposta(503, { ok: false, erro: "webhook_nao_configurado" });
  }
  const recebido = entrada.segredoRecebido ?? "";
  if (recebido.length !== deps.secret.length || recebido !== deps.secret) {
    return resposta(401, { ok: false, erro: "segredo_invalido" });
  }
  if (entrada.corpo.length > 512_000) {
    return resposta(413, { ok: false, erro: "payload_demasiado_grande" });
  }

  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(entrada.corpo);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return resposta(400, { ok: false, erro: "json_invalido" });
    }
    payload = parsed as Record<string, unknown>;
  } catch {
    return resposta(400, { ok: false, erro: "json_invalido" });
  }

  const tipo = payload["type"];
  if (!isEventoSuportado(tipo)) {
    return resposta(422, {
      ok: false,
      erro: "evento_nao_suportado",
      suportados: EVENTOS_SUPORTADOS,
    });
  }

  const contactId = texto(payload["contactId"]);
  const locationId = texto(payload["locationId"]);
  if (!contactId) return resposta(400, { ok: false, erro: "contact_id_em_falta" });
  if (!locationId) return resposta(400, { ok: false, erro: "location_id_em_falta" });
  if (locationId !== deps.locationEsperada) {
    return resposta(403, { ok: false, erro: "location_nao_autorizada" });
  }

  const organizationId = await deps.store.findOrganization(locationId);
  if (!organizationId) return resposta(403, { ok: false, erro: "location_sem_ligacao" });

  if (!deps.tokenPresente) return resposta(503, { ok: false, erro: "token_nao_configurado" });

  const buscado = await deps.fetchContact(contactId);
  if (!buscado.ok) {
    // Falha a obter a fonte de verdade: não gravamos nada e pedimos nova tentativa.
    return resposta(buscado.status === 404 ? 404 : 502, {
      ok: false,
      erro: "falha_ao_obter_contacto",
      detalhe: buscado.message,
      retentavel: buscado.status !== 404,
    });
  }

  const contacto = buscado.contact;
  if (texto(contacto.locationId) !== deps.locationEsperada) {
    return resposta(403, { ok: false, erro: "contacto_de_outra_location" });
  }
  if (texto(contacto.id) !== contactId) {
    return resposta(409, { ok: false, erro: "contacto_divergente" });
  }

  const sourceVersion = versaoDoContacto(contacto);
  const eventId = texto(payload["eventId"]);
  const idempotencyKey = eventId
    ? `ghl:evt:${eventId}`
    : `ghl:${tipo}:${contactId}:${sourceVersion}`;

  const claim = await deps.store.claim({
    idempotencyKey,
    organizationId,
    eventType: tipo,
    eventId,
    locationId,
    sourceVersion,
    payload,
  });

  if (claim.outcome === "duplicate") {
    return resposta(200, { ok: true, estado: "duplicado", idempotencyKey });
  }
  if (claim.outcome === "in_flight") {
    return resposta(409, { ok: false, erro: "entrega_em_processamento", retentavel: true });
  }

  const dados: DadosContacto = {
    ghlContactId: contactId,
    fullName: nomeDoContacto(contacto),
    phone: texto(contacto.phone),
    phoneNormalized: normalizarTelefone(contacto.phone),
    email: texto(contacto.email),
    tags: Array.isArray(contacto.tags) ? contacto.tags.filter((t) => typeof t === "string") : [],
    source: texto(contacto.source) ?? "GoHighLevel",
    lastInteractionAt: texto(contacto.dateUpdated) ?? texto(contacto.dateAdded),
  };

  try {
    const r = await deps.store.applyContact({
      inboxId: claim.inboxId,
      organizationId,
      eventType: tipo,
      sourceVersion,
      contacto: dados,
    });
    return resposta(200, {
      ok: true,
      estado: "processado",
      criado: r.created,
      idempotencyKey,
    });
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : "erro desconhecido";
    const sanitizada = mensagem.slice(0, 300).replace(/(?:pit-|sb_|eyJ)[A-Za-z0-9._-]{6,}/g, "[oculto]");
    await deps.store.markFailed(claim.inboxId, sanitizada);
    return resposta(500, { ok: false, erro: "falha_ao_processar", retentavel: true });
  }
}
