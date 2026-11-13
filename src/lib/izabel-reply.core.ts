import { z } from "zod";
import type { AttendanceContext } from "./attendance-context.core";
import type { Message } from "./commercial-agent/core";

export const izabelLanguages = ["PT-PT", "PT-BR", "FR", "ES", "EN"] as const;
export type IzabelLanguage = (typeof izabelLanguages)[number];
export const izabelReplyInputSchema = z
  .object({
    organizationId: z.string().uuid(),
    contactId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
    conversationId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
    language: z.enum(["auto", ...izabelLanguages]).default("auto"),
  })
  .strict();
export type IzabelReplyInput = z.infer<typeof izabelReplyInputSchema>;
export type IzabelReply = {
  text: string;
  language: IzabelLanguage;
  summary: string;
  checkedAt: string;
  warnings: string[];
  sources: { label: string; updatedAt?: string }[];
  handover: boolean;
};
export type IzabelReplyError =
  | "forbidden"
  | "invalid_input"
  | "context_unavailable"
  | "no_patient_message"
  | "ia_nao_configurada"
  | "rate_limited"
  | "sem_creditos"
  | "invalid_response"
  | "erro_ia";
export type IzabelReplyResult =
  { ok: true; data: IzabelReply } | { ok: false; code: IzabelReplyError; message: string };
export function izabelFailure(code: IzabelReplyError): IzabelReplyResult {
  const messages: Record<IzabelReplyError, string> = {
    forbidden: "Sem permissão para preparar a resposta neste atendimento.",
    invalid_input: "Selecione uma conversa e um idioma válidos.",
    context_unavailable:
      "Não foi possível conferir esta conversa. Atualize as mensagens e tente novamente.",
    no_patient_message: "A Izabel precisa de uma mensagem do paciente para preparar a resposta.",
    ia_nao_configurada:
      "A IA ainda não está configurada no servidor. O seu rascunho foi preservado.",
    rate_limited: "Limite de pedidos atingido. Aguarde um momento e tente novamente.",
    sem_creditos: "Sem créditos de IA disponíveis. O seu rascunho foi preservado.",
    invalid_response:
      "A sugestão não passou na revisão automática de dados e segurança. O seu rascunho foi preservado; tente novamente ou prepare a resposta manualmente.",
    erro_ia: "A Izabel não conseguiu preparar a resposta agora. O seu rascunho foi preservado.",
  };
  return { ok: false, code, message: messages[code] };
}

const plain = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
/** Conservative language hint. Short acknowledgements inherit the preceding substantive patient text. */
export function replyLanguage(
  messages: Pick<Message, "direction" | "text">[],
  requested: IzabelReplyInput["language"],
): { language: IzabelLanguage; uncertain: boolean } {
  if (requested !== "auto") return { language: requested, uncertain: false };
  const inbound = messages
    .filter((m) => m.direction === "inbound")
    .slice(-10)
    .reverse();
  for (const message of inbound) {
    const text = plain(message.text).trim();
    if (
      !text ||
      /^(sim|nao|oui|non|yes|no|si|ok|merci|thanks|obrigad[oa]|gracias)[.!\s]*$/.test(text)
    )
      continue;
    const scores = [
      [
        "FR",
        (
          text.match(
            /\b(bonjour|bonsoir|voudrais|souhaite|rendez.vous|quelle|quelles|comment|pouvez|avez|vous|prix|demain|aujourd.hui|je|mon|ma|des|pour)\b/g,
          ) ?? []
        ).length,
      ],
      [
        "ES",
        (
          text.match(
            /\b(hola|buenos|buenas|quisiera|quiero|cita|precio|gracias|manana|puedo|puede|tengo|cuando|cuanto|horario|consulta)\b/g,
          ) ?? []
        ).length,
      ],
      [
        "EN",
        (
          text.match(
            /\b(hello|hi|would|like|appointment|price|please|could|when|what|tomorrow|have|my|the|is|can|thanks)\b/g,
          ) ?? []
        ).length,
      ],
      [
        "PT-PT",
        (
          text.match(
            /\b(ola|gostaria|quero|consulta|preco|obrigad[oa]|amanha|pode|tenho|quando|quanto|horario|marcar|bom|boa|dia|tarde)\b/g,
          ) ?? []
        ).length,
      ],
    ] as [IzabelLanguage, number][];
    scores.sort((a, b) => b[1] - a[1]);
    if (scores[0]![1] > 0 && scores[0]![1] > scores[1]![1])
      return { language: scores[0]![0], uncertain: false };
  }
  return { language: "PT-PT", uncertain: true };
}

// A changed-at timestamp cannot prove provider freshness. Only a successful scoped GHL read can.
export function appointmentEvidence(
  context: AttendanceContext | null,
  now: number,
  language: IzabelLanguage,
  verifiedAt?: string,
): { sentence: string | null; warning: string | null; updatedAt?: string } {
  if (!context)
    return {
      sentence: null,
      warning:
        "O contexto sincronizado está indisponível. Confira os detalhes da consulta antes de responder sobre agenda.",
    };
  const appointment = context.nextAppointment;
  if (!appointment)
    return {
      sentence: null,
      warning:
        "Não há próxima consulta elegível no contexto sincronizado. A sugestão não confirma data nem horário.",
    };
  const status = plain(appointment.status).replace(/[\s_-]/g, "");
  const confirmed = ["confirmed", "confirmado", "confirmada"].includes(status);
  const scheduled = [
    "unconfirmed",
    "new",
    "booked",
    "scheduled",
    "agendado",
    "agendada",
    "pending",
    "pendente",
  ].includes(status);
  const start = Date.parse(appointment.startAt),
    verified = verifiedAt ? Date.parse(verifiedAt) : NaN;
  if ((!confirmed && !scheduled) || !Number.isFinite(start) || start <= now)
    return {
      sentence: null,
      warning:
        "A consulta encontrada já passou ou não tem um estado elegível. Nenhuma confirmação foi inferida.",
    };
  if (!Number.isFinite(verified) || verified > now + 60_000 || now - verified > 60_000)
    return {
      sentence: null,
      warning:
        "Não foi possível conferir esta consulta diretamente no GHL. Confira a agenda antes de informar data, horário ou confirmação.",
      updatedAt: appointment.updatedAt,
    };
  try {
    const locale = { "PT-PT": "pt-PT", "PT-BR": "pt-BR", FR: "fr-FR", ES: "es-ES", EN: "en-GB" }[
      language
    ];
    const date = new Intl.DateTimeFormat(locale, {
      timeZone: context.timezone,
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(start);
    const time = new Intl.DateTimeFormat(locale, {
      timeZone: context.timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(start);
    const zone =
      context.timezone === "Europe/Lisbon"
        ? { "PT-PT": "Lisboa", "PT-BR": "Lisboa", FR: "Lisbonne", ES: "Lisboa", EN: "Lisbon" }[
            language
          ]
        : context.timezone;
    const sentences: Record<IzabelLanguage, string> = {
      "PT-PT": `Na agenda consultada, a sua consulta consta como ${confirmed ? "confirmada" : "agendada"} para ${date}, às ${time} (horário de ${zone}).`,
      "PT-BR": `Na agenda consultada, sua consulta consta como ${confirmed ? "confirmada" : "agendada"} para ${date}, às ${time} (horário de ${zone}).`,
      FR: `Dans l’agenda consulté, votre rendez-vous est ${confirmed ? "confirmé" : "programmé"} le ${date} à ${time} (heure de ${zone}).`,
      ES: `En la agenda consultada, su cita figura como ${confirmed ? "confirmada" : "programada"} para el ${date} a las ${time} (hora de ${zone}).`,
      EN: `In the calendar consulted, your appointment is ${confirmed ? "confirmed" : "scheduled"} for ${date} at ${time} (${zone} time).`,
    };
    return {
      sentence: sentences[language],
      warning:
        "Consulta conferida no GHL: o estado da agenda não comprova pagamento nem uma resposta de confirmação do paciente.",
      updatedAt: verifiedAt!,
    };
  } catch {
    return {
      sentence: null,
      warning: "O fuso da organização não pôde ser validado. Confira o horário na agenda.",
    };
  }
}

export const izabelModelReplySchema = z
  .object({
    text: z.string().trim().min(1).max(1200),
    language: z.enum(izabelLanguages),
    summary: z.string().trim().min(1).max(500),
    includeAppointment: z.boolean(),
    handover: z.boolean(),
    flags: z
      .array(
        z.enum([
          "clinical",
          "urgent",
          "human_requested",
          "opt_out",
          "unsupported_attachment",
          "missing_policy",
          "commercial_conflict",
        ]),
      )
      .max(7),
  })
  .strict();

/** Scheduling facts are appended by the server. The model never authors a date/status fact. */
export function unsafeReply(text: string): boolean {
  const t = plain(text);
  return (
    /\[|\]|\{\{|\}\}|\bappointment\.|\bcontact\.|\blocation\.|\bpendente\s*:|<[^>]*>|https?:\/\/|\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]){11,30}\b/.test(
      text,
    ) ||
    /\b(?:base operacional|v02|prompt|instrucoes internas|system message|ghl|lovable_api_key)\b/.test(
      t,
    ) ||
    /\b\d{1,2}[:h]\d{2}\b|\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b|\b\d{1,2}\s+de\s+(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b|\b(amanha|tomorrow|demain|manana|segunda.feira|terca.feira|quarta.feira|quinta.feira|sexta.feira|sabado|domingo|monday|tuesday|wednesday|thursday|friday|saturday|sunday|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|lunes|martes|miercoles|jueves|viernes)\b/.test(
      t,
    ) ||
    /\b(enviei|encaminhei|avisei|registei|registrei|reservei|agendei|validei)\b|\b(?:pagamento|payment|paiement|pago).{0,30}(?:confirm|valid|recebid|received|recu)|\b(?:consulta|cita|appointment|rendez.vous).{0,45}(?:confirmad|confirmed|confirme|agendad|scheduled|programad|programme|marcad|reservad|booked)|\b(?:confirmei|confirmed|confirmamos|confirmo|agendamos|reservamos).{0,30}(?:consulta|cita|appointment|rendez.vous)|j.ai (?:transmis|envoye|reserve)|\b(?:i have|i.ve|we have|we.ve).{0,20}(?:sent|booked|scheduled|confirmed)|\b(?:he|hemos) (?:enviado|reservado|confirmado)/.test(
      t,
    ) ||
    /sem riscos|100\s*%\s*segur|garantid[oa]|risk.free|sans risque|sin riesgo|guaranteed/.test(t) ||
    /\b(?:tome|tomar|use|utilize|aplique|take|apply|prenez|appliquez|toma|aplica)\b.{0,35}\b\d+(?:[.,]\d+)?\s*(?:mg|ml|comprimido|tablet|gota|pill)\b|\b(?:diagnostico|diagnosis|diagnostic)\s*[:=]|\b(?:voce tem|you have|vous avez|usted tiene)\s+(?:uma infe|an infection|une infection|una infe)/.test(
      t,
    ) ||
    (text.match(/\?/g) ?? []).length > 1
  );
}
