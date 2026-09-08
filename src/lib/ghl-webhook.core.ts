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
  | { outcome: "claimed"; inboxId: string; fence: number }
  | { outcome: "duplicate" }
  | { outcome: "in_flight" }
  | { outcome: "mismatch" };

export type ResultadoApply =
  | { estado: "processado" | "ja_processado" | "versao_antiga_ignorada"; contactId: string | null; created: boolean }
  | { estado: "reserva_expirada" | "organizacao_divergente" | "entrega_inexistente" };

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
  /** Reserva a entrega de forma atómica e com fencing token. */
  claim(input: {
    idempotencyKey: string;
    organizationId: string;
    locationId: string;
    eventType: EventoSuportado;
    eventId: string | null;
    sourceVersion: string;
    ghlContactId: string;
    /** true quando a versão é uma impressão digital do conteúdo (sem dateUpdated/eventId). */
    contentFallback: boolean;
    payload: Record<string, unknown>;
  }): Promise<Claim>;
  /** Grava contacto + auditoria + estado processado numa única transação. */
  applyContact(input: {
    inboxId: string;
    fence: number;
    organizationId: string;
    eventType: EventoSuportado;
    sourceVersion: string;
    contacto: DadosContacto;
  }): Promise<ResultadoApply>;
  /** Só marca falhado se a reserva ainda for a ativa (protege contra workers atrasados). */
  markFailed(input: {
    inboxId: string;
    fence: number;
    organizationId: string;
    message: string;
  }): Promise<boolean>;
  /** Regista uma falha ocorrida antes de existir reserva (ex.: falha ao ler o GHL). */
  recordFailedReceive(input: {
    organizationId: string;
    locationId: string;
    idempotencyKey: string;
    eventType: EventoSuportado;
    eventId: string | null;
    payload: Record<string, unknown>;
    message: string;
  }): Promise<void>;
}

export type WebhookDeps = {
  secret: string | null;
  tokenPresente: boolean;
  locationEsperada: string;
  store: WebhookStore;
  fetchContact: (contactId: string) => Promise<ResultadoFetchContacto>;
  /** Comparação em tempo constante (a rota injeta timingSafeEqual). */
  compararSegredo?: (recebido: string, esperado: string) => boolean;
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

/** Comparação em tempo constante, usada como alternativa quando não há timingSafeEqual. */
export function comparacaoConstante(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const max = Math.max(x.length, y.length);
  for (let i = 0; i < max; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

function conteudoCanonico(c: ContactoGhl): string {
  return JSON.stringify([
    nomeDoContacto(c),
    c.phone ?? null,
    c.email ?? null,
    [...(c.tags ?? [])].filter((t) => typeof t === "string").sort(),
    c.source ?? null,
    c.dateAdded ?? null,
  ]);
}

async function sha256Hex(texto: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Versão do registo de origem usada na idempotência.
 * Preferimos `dateUpdated` (versão verificada). Sem ela, usamos uma impressão
 * digital SHA-256 do conteúdo canónico e sinalizamos `contentFallback`, para
 * que A→B→A seja tratado comparando com o estado realmente aplicado.
 */
export async function versaoDoContacto(
  c: ContactoGhl,
): Promise<{ version: string; contentFallback: boolean }> {
  if (typeof c.dateUpdated === "string" && c.dateUpdated.trim() !== "") {
    return { version: `v:${c.dateUpdated.trim()}`, contentFallback: false };
  }
  return { version: `h:${await sha256Hex(conteudoCanonico(c))}`, contentFallback: true };
}

export function isEventoSuportado(valor: unknown): valor is EventoSuportado {
  return typeof valor === "string" && (EVENTOS_SUPORTADOS as readonly string[]).includes(valor);
}

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() !== "" ? valor.trim() : null;
}

export function sanitizarErro(erro: unknown): string {
  const mensagem = erro instanceof Error ? erro.message : "erro desconhecido";
  return mensagem
    .slice(0, 300)
    .replace(/(?:pit-|sb_|eyJ)[A-Za-z0-9._-]{6,}/g, "[oculto]");
}

/** Processa uma entrega. Nunca devolve valores de credenciais. */
export async function processarWebhook(
  entrada: { corpo: string; segredoRecebido: string | null },
  deps: WebhookDeps,
): Promise<RespostaWebhook> {
  if (!deps.secret) {
    return resposta(503, { ok: false, erro: "webhook_nao_configurado" });
  }
  const comparar = deps.compararSegredo ?? comparacaoConstante;
  if (!comparar(entrada.segredoRecebido ?? "", deps.secret)) {
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

  const eventId = texto(payload["eventId"]);
  const prefixo = `ghl:${organizationId}:${locationId}`;

  if (!deps.tokenPresente) return resposta(503, { ok: false, erro: "token_nao_configurado" });

  const buscado = await deps.fetchContact(contactId);
  if (!buscado.ok) {
    // Sem fonte de verdade não gravamos o contacto, mas registamos a falha
    // para ficar visível no histórico de webhooks da aplicação.
    await deps.store.recordFailedReceive({
      organizationId,
      locationId,
      idempotencyKey: eventId
        ? `${prefixo}:evt:${eventId}:origem`
        : `${prefixo}:${tipo}:${contactId}:origem`,
      eventType: tipo,
      eventId,
      payload,
      message: `falha ao obter contacto no GoHighLevel (${buscado.status}): ${sanitizarErro(new Error(buscado.message))}`,
    });
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

  const { version: sourceVersion, contentFallback } = await versaoDoContacto(contacto);
  const idempotencyKey = eventId
    ? `${prefixo}:evt:${eventId}`
    : `${prefixo}:${tipo}:${contactId}:${sourceVersion}`;

  const claim = await deps.store.claim({
    idempotencyKey,
    organizationId,
    locationId,
    eventType: tipo,
    eventId,
    sourceVersion,
    ghlContactId: contactId,
    contentFallback: eventId ? false : contentFallback,
    payload,
  });

  if (claim.outcome === "duplicate") {
    return resposta(200, { ok: true, estado: "duplicado", idempotencyKey });
  }
  if (claim.outcome === "in_flight") {
    return resposta(409, { ok: false, erro: "entrega_em_processamento", retentavel: true });
  }
  if (claim.outcome === "mismatch") {
    return resposta(409, { ok: false, erro: "entrega_de_outra_organizacao" });
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

  let r: ResultadoApply;
  try {
    r = await deps.store.applyContact({
      inboxId: claim.inboxId,
      fence: claim.fence,
      organizationId,
      eventType: tipo,
      sourceVersion,
      contacto: dados,
    });
  } catch (erro) {
    await deps.store.markFailed({
      inboxId: claim.inboxId,
      fence: claim.fence,
      organizationId,
      message: sanitizarErro(erro),
    });
    return resposta(500, { ok: false, erro: "falha_ao_processar", retentavel: true });
  }

  switch (r.estado) {
    case "processado":
      return resposta(200, { ok: true, estado: "processado", criado: r.created, idempotencyKey });
    case "ja_processado":
      return resposta(200, { ok: true, estado: "duplicado", idempotencyKey });
    case "versao_antiga_ignorada":
      return resposta(200, { ok: true, estado: "versao_antiga_ignorada", idempotencyKey });
    case "reserva_expirada":
      return resposta(409, { ok: false, erro: "reserva_expirada", retentavel: true });
    default:
      await deps.store.markFailed({
        inboxId: claim.inboxId,
        fence: claim.fence,
        organizationId,
        message: `estado inesperado: ${r.estado}`,
      });
      return resposta(500, { ok: false, erro: "falha_ao_processar", retentavel: true });
  }
}
