import { z } from "zod";
import { chaveDia, deslocarDia, inicioDiaUtc, validarFuso } from "./clinic-time";

export const bookingId = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const instant = z.string().datetime({ offset: true });
const scope = z.object({ organizationId: z.string().uuid(), ghlContactId: bookingId }).strict();
export const chatBookingOptionsSchema = scope
  .extend({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
  .strict();
export const chatBookingReadSchema = scope.extend({ requestId: z.string().uuid() }).strict();
export const chatBookingCreateSchema = chatBookingReadSchema
  .extend({
    calendarId: bookingId,
    timezone: z.string().min(1).max(100),
    startAt: instant,
    endAt: instant,
    notify: z.boolean().default(false),
  })
  .strict();
export type ChatBookingOptionsInput = z.infer<typeof chatBookingOptionsSchema>;
export type ChatBookingReadInput = z.infer<typeof chatBookingReadSchema>;
export type ChatBookingCreateInput = z.infer<typeof chatBookingCreateSchema>;
export type ChatBookingOptions = {
  contactName: string;
  calendarId: string;
  calendarName: string;
  timezone: string;
  durationMinutes: number;
  meetingLabel: string | null;
  slots: { startAt: string; endAt: string; label: string }[];
  canBook: boolean;
  blockReason?: string;
  checkedAt: string;
};
export type ChatBookingReceipt = {
  state: "confirmed" | "unknown" | "rejected" | "pending";
  requestId: string;
  appointmentId?: string;
  startAt?: string;
  endAt?: string;
  calendarName?: string;
  timezone?: string;
  message: string;
  cacheSynced?: boolean;
};
export type ChatBookingAbandonResult =
  { abandoned: true } | { abandoned: false; receipt: ChatBookingReceipt };
export type ChatBookingError =
  | "forbidden"
  | "invalid_input"
  | "not_configured"
  | "contact_not_found"
  | "calendar_unsupported"
  | "provider_unavailable"
  | "slot_unavailable"
  | "configuration_changed"
  | "write_disabled"
  | "request_mismatch"
  | "request_abandoned"
  | "duplicate_slot"
  | "not_found"
  | "migration_required"
  | "unavailable";
export type ChatBookingResult<T> =
  { ok: true; data: T } | { ok: false; code: ChatBookingError; message: string };
export function chatBookingFailure(code: ChatBookingError): ChatBookingResult<never> {
  const messages: Record<ChatBookingError, string> = {
    forbidden: "Sem permissão para agendar neste atendimento.",
    invalid_input: "Confira a data e o horário selecionados.",
    not_configured: "A agenda da organização ainda não está configurada.",
    contact_not_found:
      "O contato precisa estar vinculado ao GHL e ao Jornada AI antes do agendamento.",
    calendar_unsupported:
      "Esta agenda precisa de configuração adicional para agendar pelo Meu Chat. Abra a Agenda para conferir.",
    provider_unavailable: "Não foi possível consultar o GHL agora. Tente atualizar os horários.",
    slot_unavailable: "Este horário já não está disponível. Atualize os horários e escolha outro.",
    configuration_changed: "A agenda ou o fuso mudou. Atualize os horários antes de agendar.",
    write_disabled:
      "A escrita no GHL está desativada para esta organização. Os horários podem ser consultados.",
    request_abandoned:
      "Este pedido foi encerrado antes de criar um agendamento. Atualize os horários para iniciar outro pedido.",
    request_mismatch:
      "Este pedido já foi usado com outros dados. Confira o resultado antes de iniciar outro agendamento.",
    duplicate_slot:
      "Já existe um pedido para este contato e horário. Confira o resultado na Agenda antes de repetir.",
    not_found: "Este pedido não foi encontrado neste atendimento.",
    migration_required: "O agendamento pelo Meu Chat aguarda a atualização do banco de dados.",
    unavailable:
      "Não foi possível guardar ou consultar o pedido com segurança. Nenhum novo envio deve ser repetido sem conferir o resultado.",
  };
  return { ok: false, code, message: messages[code] };
}

export function bookingDay(date: string, timezone: string): { startAt: string; endAt: string } {
  validarFuso(timezone);
  const value = new Date(`${date}T12:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(value.getTime()) ||
    value.toISOString().slice(0, 10) !== date ||
    Number(date.slice(0, 4)) < 2020 ||
    Number(date.slice(0, 4)) > 2100
  )
    throw new Error("invalid_input");
  return {
    startAt: inicioDiaUtc(date, timezone),
    endAt: inicioDiaUtc(deslocarDia(date, 1), timezone),
  };
}
export type BookingCalendar = {
  id: string;
  name: string;
  durationMinutes: number;
  meetingLabel: string | null;
};
export function parseBookingCalendar(
  raw: unknown,
  calendarId: string,
  locationId: string,
): BookingCalendar {
  const calendar = z
    .object({
      calendar: z.object({
        id: bookingId,
        locationId: bookingId,
        name: z.string().trim().min(1).max(200),
        isActive: z.boolean(),
        calendarType: z.string(),
        slotDuration: z.number().positive().optional(),
        slotDurationUnit: z.enum(["mins", "hours"]).optional(),
        durationOptions: z
          .array(
            z.object({
              duration: z.number().positive(),
              durationUnit: z.enum(["mins", "hours"]),
              isDefault: z.boolean(),
            }),
          )
          .max(3)
          .optional(),
        locationConfigurations: z
          .array(z.object({ kind: z.string(), location: z.string().max(500).optional() }))
          .max(20)
          .optional(),
      }),
    })
    .parse(raw).calendar;
  if (
    calendar.id !== calendarId ||
    calendar.locationId !== locationId ||
    !calendar.isActive ||
    !["event", "round_robin", "personal", "collective"].includes(calendar.calendarType)
  )
    throw new Error("calendar_unsupported");
  let duration: number;
  if (calendar.durationOptions?.length) {
    const defaults = calendar.durationOptions.filter((entry) => entry.isDefault);
    if (defaults.length !== 1 || defaults[0]!.durationUnit !== "mins")
      throw new Error("calendar_unsupported");
    // v3 describes durationOptions.duration as minutes even though durationUnit also exists.
    // Hours options are intentionally blocked until their wire contract is verified.
    duration = defaults[0]!.duration;
  } else {
    if (!calendar.slotDuration || !calendar.slotDurationUnit)
      throw new Error("calendar_unsupported");
    duration = calendar.slotDuration * (calendar.slotDurationUnit === "hours" ? 60 : 1);
  }
  if (!Number.isInteger(duration) || duration < 1 || duration > 480)
    throw new Error("calendar_unsupported");
  const locations = calendar.locationConfigurations ?? [];
  const location = locations.length === 1 ? locations[0] : null;
  const labels: Record<string, string> = {
    physical: "Presencial",
    custom: "Local definido pela agenda",
    zoom_conference: "Online — Zoom",
    google_conference: "Online — Google Meet",
    ms_teams_conference: "Online — Teams",
    inbound_call: "Por telefone",
    outbound_call: "Por telefone",
  };
  return {
    id: calendar.id,
    name: calendar.name,
    durationMinutes: duration,
    meetingLabel: location ? (labels[location.kind] ?? null) : null,
  };
}
export function parseBookingSlots(
  raw: unknown,
  date: string,
  timezone: string,
  durationMinutes: number,
  now: number,
): ChatBookingOptions["slots"] {
  const day = bookingDay(date, timezone);
  const parsed = z.record(z.string(), z.unknown()).parse(raw);
  const slots =
    parsed[date] === undefined
      ? []
      : z.object({ slots: z.array(instant).max(1500) }).parse(parsed[date]).slots;
  const duration = durationMinutes * 60_000;
  return [...new Set(slots.map((slot) => new Date(slot).toISOString()))]
    .filter(
      (slot) =>
        Date.parse(slot) > now &&
        Date.parse(slot) >= Date.parse(day.startAt) &&
        Date.parse(slot) < Date.parse(day.endAt) &&
        chaveDia(slot, timezone) === date,
    )
    .sort()
    .map((startAt) => ({
      startAt,
      endAt: new Date(Date.parse(startAt) + duration).toISOString(),
      label: new Intl.DateTimeFormat("pt-PT", {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "shortOffset",
        hourCycle: "h23",
      }).format(new Date(startAt)),
    }));
}
export const bookingEventSchema = z.object({
  id: bookingId,
  calendarId: bookingId,
  locationId: bookingId,
  contactId: bookingId,
  startTime: instant,
  endTime: instant,
  appointmentStatus: z.string(),
  deleted: z.boolean().optional(),
});
export type BookingEvent = z.infer<typeof bookingEventSchema>;
export type BookingTarget = {
  locationId: string;
  calendarId: string;
  ghlContactId: string;
  startAt: string;
  endAt: string;
};
export function verifyBookingEvent(
  raw: unknown,
  expected: BookingTarget,
  eventId?: string,
): BookingEvent {
  const event = bookingEventSchema.parse(raw);
  if (
    (eventId && event.id !== eventId) ||
    event.locationId !== expected.locationId ||
    event.calendarId !== expected.calendarId ||
    event.contactId !== expected.ghlContactId ||
    Date.parse(event.startTime) !== Date.parse(expected.startAt) ||
    Date.parse(event.endTime) !== Date.parse(expected.endAt) ||
    event.deleted ||
    !["new", "confirmed", "active"].includes(event.appointmentStatus)
  )
    throw new Error("event_mismatch");
  return event;
}
