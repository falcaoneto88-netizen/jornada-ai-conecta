/**
 * Núcleo do ingresso de leads do site "Experiência Falcão".
 *
 * Servidor-para-servidor: o corpo é assinado com HMAC-SHA256 sobre os bytes
 * exatos recebidos. A origem, a organização e o destino no GoHighLevel nunca
 * vêm do pedido — são resolvidos pela configuração ativa no servidor.
 */
import { z } from "zod";

export const FALCAO_SOURCE = "experiencia-falcao" as const;
export const FALCAO_CONSENT_VERSION = "2026-09-17.contact.v1" as const;
export const FALCAO_JANELA_MS = 5 * 60 * 1000;
export const FALCAO_LIMITE_BYTES = 4096;

export const leadSchema = z
  .object({
    source: z.literal(FALCAO_SOURCE),
    requestId: z.uuid(),
    timestamp: z.iso.datetime({ offset: true }),
    adult: z.literal(true),
    name: z.string().trim().min(2).max(80),
    phone: z.string().regex(/^\+[1-9]\d{7,14}$/),
    email: z.string().trim().email().max(160).optional(),
    consent: z
      .object({ contact: z.literal(true), version: z.literal(FALCAO_CONSENT_VERSION) })
      .strict(),
  })
  .strict();

export type LeadFalcao = z.infer<typeof leadSchema>;

export type ReciboLead = {
  receipt_id: string;
  request_id: string;
  status: string;
  local_state: string;
  remote_state: string;
  welcome_state: string;
  duplicate: boolean;
};

export type ResultadoIngresso =
  | { outcome: "ok"; recibo: ReciboLead }
  | { outcome: "conflito" }
  | { outcome: "indisponivel" }
  | { outcome: "invalido" }
  | { outcome: "erro" };

export interface LeadStore {
  ingest(input: {
    source: string;
    requestId: string;
    payloadHash: string;
    fullName: string;
    phone: string;
    phoneNormalized: string;
    email: string | null;
    consentVersion: string;
    consentAt: string;
  }): Promise<ResultadoIngresso>;
}

export type LeadDeps = {
  /** Valor de FALCAO_SITE_SIGNING_SECRET; ausente = falha fechada. */
  segredo: string | null;
  store: LeadStore;
  /** HMAC-SHA256 hexadecimal sobre os bytes exatos do corpo. */
  hmac: (segredo: string, corpo: Uint8Array) => Promise<string>;
  compararAssinatura?: (recebida: string, esperada: string) => boolean;
  agoraMs?: number;
};

export type RespostaLead = { status: number; body: Record<string, unknown> };

const responder = (status: number, body: Record<string, unknown>): RespostaLead => ({
  status,
  body,
});

/** Comparação em tempo constante para valores hexadecimais. */
export function comparacaoConstante(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function normalizarTelefone(phone: string): string {
  return phone.replace(/\D/g, "");
}

/**
 * Identidade dos dados: o instante do envio não faz parte, para que um reenvio
 * do mesmo formulário continue a ser reconhecido como o mesmo pedido.
 */
export function conteudoCanonico(lead: LeadFalcao): string {
  return JSON.stringify([
    lead.source,
    lead.requestId,
    lead.adult,
    lead.name.trim(),
    lead.phone,
    lead.email?.trim().toLowerCase() ?? null,
    lead.consent.version,
  ]);
}

export async function hashConteudo(texto: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Processa um envio assinado. Mensagens de erro nunca citam dados nem credenciais. */
export async function processarLeadFalcao(
  entrada: { corpo: Uint8Array; assinatura: string | null },
  deps: LeadDeps,
): Promise<RespostaLead> {
  if (!deps.segredo || !/^[a-f0-9]{64}$/.test(deps.segredo)) {
    return responder(503, { ok: false, erro: "integracao_nao_configurada" });
  }
  const assinatura = (entrada.assinatura ?? "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(assinatura)) {
    return responder(401, { ok: false, erro: "assinatura_invalida" });
  }
  if (entrada.corpo.byteLength > FALCAO_LIMITE_BYTES) {
    return responder(413, { ok: false, erro: "pedido_demasiado_grande" });
  }
  const esperada = await deps.hmac(deps.segredo, entrada.corpo);
  const comparar = deps.compararAssinatura ?? comparacaoConstante;
  if (!comparar(assinatura, esperada)) {
    return responder(401, { ok: false, erro: "assinatura_invalida" });
  }

  let bruto: unknown;
  try {
    bruto = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(entrada.corpo));
  } catch {
    return responder(400, { ok: false, erro: "pedido_invalido" });
  }
  const analisado = leadSchema.safeParse(bruto);
  if (!analisado.success) return responder(400, { ok: false, erro: "pedido_invalido" });
  const lead = analisado.data;

  const agora = deps.agoraMs ?? Date.now();
  const enviado = Date.parse(lead.timestamp);
  if (!Number.isFinite(enviado) || Math.abs(agora - enviado) > FALCAO_JANELA_MS) {
    return responder(400, { ok: false, erro: "fora_da_janela" });
  }

  const payloadHash = await hashConteudo(conteudoCanonico(lead));
  let resultado: ResultadoIngresso;
  try {
    resultado = await deps.store.ingest({
      source: lead.source,
      requestId: lead.requestId,
      payloadHash,
      fullName: lead.name.trim(),
      phone: lead.phone,
      phoneNormalized: normalizarTelefone(lead.phone),
      email: lead.email?.trim() ?? null,
      consentVersion: lead.consent.version,
      consentAt: new Date(enviado).toISOString(),
    });
  } catch {
    return responder(503, { ok: false, erro: "indisponivel", retentavel: true });
  }

  switch (resultado.outcome) {
    case "ok": {
      const r = resultado.recibo;
      return responder(r.duplicate ? 200 : 201, {
        ok: true,
        receiptId: r.receipt_id,
        requestId: r.request_id,
        status: r.status,
        duplicate: r.duplicate,
        // Estados distintos: nada aqui declara sucesso no GoHighLevel ou no acolhimento.
        localState: r.local_state,
        ghlState: r.remote_state,
        welcomeState: r.welcome_state,
      });
    }
    case "conflito":
      return responder(409, { ok: false, erro: "pedido_ja_registado_com_outros_dados" });
    case "indisponivel":
      return responder(503, { ok: false, erro: "integracao_nao_configurada" });
    case "invalido":
      return responder(400, { ok: false, erro: "pedido_invalido" });
    default:
      return responder(503, { ok: false, erro: "indisponivel", retentavel: true });
  }
}

/** Lê o corpo com limite real de bytes, mesmo sem Content-Length fiável. */
export async function lerCorpoLimitado(
  request: Request,
  limite = FALCAO_LIMITE_BYTES,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; status: number }> {
  const reader = request.body?.getReader();
  if (!reader) return { ok: false, status: 400 };
  const partes: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limite) {
        await reader.cancel();
        return { ok: false, status: 413 };
      }
      partes.push(value);
    }
  } catch {
    return { ok: false, status: 400 };
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const parte of partes) {
    bytes.set(parte, offset);
    offset += parte.byteLength;
  }
  return { ok: true, bytes };
}
