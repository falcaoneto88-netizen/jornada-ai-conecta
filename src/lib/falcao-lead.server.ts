/**
 * Adaptadores server-only do ingresso "Experiência Falcão".
 * Nenhum valor de credencial sai daqui e o cliente nunca recebe service role.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import { validarRecibo, type LeadStore, type ResultadoIngresso } from "./falcao-lead.core";

/** Destino autorizado, fixo no servidor e reconferido contra o binding real. */
export const FALCAO_LOCATION = "ok2UHC2QMZsd8UHsAgEa";
export const FALCAO_PIPELINE = "2QGyurvcmwhNhRgq0jCq";
export const FALCAO_STAGE_GHL = "c23ea507-33f5-41b6-933b-fd532ccbb773";
export const FALCAO_SLUG = "experiencia-falcao";
export const FALCAO_STAGE_LOCAL = "novo_lead";
export const FALCAO_SITE_URL = "https://experiencia-falcao-teste.falcaoneto88.chatgpt.site";

/** Rascunho neutro; {{nome}} só é preenchido quando houver canal verificado. */
export const FALCAO_ACOLHIMENTO_RASCUNHO =
  "Olá, {{nome}}! Sou da equipa do Dr. João Falcão. Recebemos o seu pedido de contacto pela Experiência Falcão. Como podemos ajudar? Se preferir não receber mensagens, diga-nos por aqui.";

export function segredoFalcao(): string | null {
  const valor = (process.env["FALCAO_SITE_SIGNING_SECRET"] ?? "").trim();
  return /^[a-f0-9]{64}$/.test(valor) ? valor : null;
}

export async function hmacHex(segredo: string, corpo: Uint8Array): Promise<string> {
  return createHmac("sha256", Buffer.from(segredo, "utf8")).update(Buffer.from(corpo)).digest("hex");
}

export function compararHex(recebida: string, esperada: string): boolean {
  const a = Buffer.from(recebida, "utf8");
  const b = Buffer.from(esperada, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

type ClienteRpc = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
};

export function criarLeadStore(admin: ClienteRpc): LeadStore {
  return {
    async ingest(input): Promise<ResultadoIngresso> {
      const { data, error } = await admin.rpc("ingest_site_lead", {
        _source: input.source,
        _request_id: input.requestId,
        _payload_hash: input.payloadHash,
        _full_name: input.fullName,
        _phone: input.phone,
        _phone_normalized: input.phoneNormalized,
        _email: input.email,
        _consent_version: input.consentVersion,
        _consent_at: input.consentAt,
      });
      if (error) {
        if (error.code === "23505") return { outcome: "conflito" };
        if (error.code === "53400") return { outcome: "limite" };
        if (error.code === "42501") return { outcome: "indisponivel" };
        if (error.code === "22023" || error.code === "22P02") return { outcome: "invalido" };
        return { outcome: "erro" };
      }
      // Recibo inválido nunca vira sucesso: falha fechada para reconciliação.
      const recibo = validarRecibo(data);
      return recibo ? { outcome: "ok", recibo } : { outcome: "erro" };
    },
  };
}
