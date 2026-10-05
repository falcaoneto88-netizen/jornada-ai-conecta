import { z } from "zod";

export const id = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
export const eventSchema = z.object({
  type: z.enum(["InboundMessage", "OutboundMessage"]),
  locationId: id,
  contactId: id,
  conversationId: id,
  messageId: id,
});
export type Event = z.infer<typeof eventSchema>;
export const flagSchema = z.enum([
  "commercial_conflict",
  "missing_policy",
  "clinical",
  "urgent",
  "human_requested",
  "unsupported_attachment",
  "unsupported_action",
]);
export const decisionSchema = z
  .object({
    reply: z.string().min(1).max(1500),
    flags: z.array(flagSchema).max(7),
    handoff: z.boolean(),
    optOut: z.boolean(),
  })
  .strict();
export type Decision = z.infer<typeof decisionSchema>;
export type Message = {
  id: string;
  at: string;
  direction: "inbound" | "outbound";
  text: string;
  channel: string;
  attachments: number;
  provider: string | null;
};
export type Snapshot = {
  event: Event;
  messages: Message[];
  dnd: boolean;
  name: string;
  historyHash: string;
};
export type DraftPayload = {
  snapshot: Snapshot;
  decision: Decision;
  policyHash: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
};
export type DraftRow = {
  id: string;
  organization_id: string;
  event_id: string;
  contact_id: string;
  conversation_id: string;
  location_id: string;
  message_id: string;
  state: string;
  version: number;
  contact_version: number;
  payload: string;
  reply_hash: string;
  expires_at: string;
  created_at: string;
  result_message_id: string | null;
  approved_at?: string | null;
  error_code: string | null;
  paused?: boolean;
  opt_out?: boolean;
  session_version?: number;
};
export type Settings = {
  organization_id: string;
  location_id: string;
  mode: "off" | "supervised";
  allowed_contacts: string[];
  allowed_channels: string[];
};
export type QueueError = {
  id: string;
  state: string;
  error_code: string;
  attempts: number;
  created_at: string;
};
export type SessionRow = { contact_id: string; version: number; paused: boolean; opt_out: boolean };
export type Job = { id: string; lease: string; contact_version: number; event: Event };
export class AgentError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
export function classifySafety(text: string) {
  const s = text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
  return {
    optOut:
      /\b(stop|unsubscribe)\b|parem? de me|nao (quero|desejo).*(mensage|contat)|nao me (envie|contat|procure)|ne me contactez plus|arretez.*message|do not contact|don't (contact|message)/i.test(
        s,
      ),
    handoff:
      /falar com.*(humano|pessoa|danilo|atendente)|atendimento humano|speak to.*(human|person)|parler.*(personne|humain)/i.test(
        s,
      ),
    urgent:
      /falta de ar|dificuldade.*respir|dor.*peito|shortness of breath|chest pain|difficulte.*respir/i.test(
        s,
      ),
  };
}
/** Conservative extra checks; clinical/commercial evaluation still requires a reviewer. */
export function checkReply(text: string): string[] {
  const errors: string[] = [];
  if ((text.match(/\?/g) ?? []).length > 1) errors.push("multiple_questions");
  if (
    /\b(enviei|encaminhei|avisei|registei|registrei|reservei|agendei)\b|vou (avisar|encaminhar|transferir)|posso (avisar|encaminhar|transferir)|pagamento.{0,20}(validado|confirmado)|consulta.{0,20}confirmada|cadastro.{0,20}(salvo|realizado)|appointment.{0,20}confirmed|payment.{0,20}(validated|confirmed)|j.ai (transmis|envoye)|rendez-vous.{0,20}confirme/i.test(
      text.normalize("NFD").replace(/\p{Diacritic}/gu, ""),
    )
  )
    errors.push("unverified_action");
  if (/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]){11,30}\b/.test(text) || /https?:\/\//i.test(text))
    errors.push("unapproved_payment_or_link");
  if (/sem riscos|100% seguro|garantid[oa]|risk.free/i.test(text)) errors.push("unsupported_claim");
  if (/\[(nome|data|horario)\]/i.test(text)) errors.push("placeholder");
  return errors;
}
export function checkSend(s: {
  enabled: boolean;
  sendEnabled: boolean;
  writeEnabled: boolean;
  allowed: boolean;
  paused: boolean;
  optOut: boolean;
  dnd: boolean;
  expired: boolean;
  historyChanged: boolean;
  channel: string;
  inboundAgeMs: number;
  flags: string[];
}): string | null {
  if (!s.enabled || !s.sendEnabled || !s.writeEnabled || !s.allowed) return "send_disabled";
  if (s.optOut || s.dnd) return "do_not_contact";
  if (s.paused) return "human_paused";
  if (s.expired || s.historyChanged) return "draft_stale";
  if (s.flags.length) return "review_required";
  if (!["WhatsApp", "SMS", "IG", "FB"].includes(s.channel)) return "unsupported_channel";
  if (s.inboundAgeMs < 0 || s.inboundAgeMs >= 23 * 3600000) return "channel_window";
  return null;
}
export const commandSchema = z
  .object({
    organizationId: z.string().uuid(),
    draftId: z.string().uuid(),
    version: z.number().int().positive(),
    replyHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const pauseSchema = z
  .object({
    organizationId: z.string().uuid(),
    contactId: id,
    expectedVersion: z.number().int().nonnegative(),
    paused: z.boolean(),
  })
  .strict();
export const listSchema = z.object({ organizationId: z.string().uuid() }).strict();
export const reconcileSchema = z
  .object({ organizationId: z.string().uuid(), draftId: z.string().uuid(), messageId: id })
  .strict();
export const labels: Record<string, string> = {
  pending: "Aguardando aprovação",
  sending: "Envio em andamento",
  sent: "Aceita pelo HighLevel",
  unknown: "Conferir envio no HighLevel",
  rejected: "Rejeitada",
  invalidated: "Desatualizada",
  commercial_conflict: "Conflito com regra comercial — decisão humana",
  missing_policy: "Regra não definida no V02",
  clinical: "Avaliação clínica necessária",
  urgent: "Possível urgência",
  human_requested: "Pessoa pediu atendimento humano",
  unsupported_attachment: "Anexo exige revisão humana",
  unsupported_action: "Ação ainda não disponível",
};
