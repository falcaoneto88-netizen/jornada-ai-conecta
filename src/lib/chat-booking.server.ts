import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { resolverAcesso } from "./ghl.functions";
import { ghlFetch, GHL_ORIGIN, GHL_VERSION, readGhlSecrets, urlOficial } from "./ghl.server";
import { chaveDia, validarFuso } from "./clinic-time";
import {
  bookingDay,
  bookingId,
  chatBookingCreateSchema,
  chatBookingFailure,
  chatBookingOptionsSchema,
  chatBookingReadSchema,
  parseBookingCalendar,
  parseBookingSlots,
  verifyBookingEvent,
  type ChatBookingCreateInput,
  type ChatBookingAbandonResult,
  type ChatBookingError,
  type ChatBookingOptions,
  type ChatBookingOptionsInput,
  type ChatBookingReadInput,
  type ChatBookingReceipt,
  type ChatBookingResult,
} from "./chat-booking.core";

export type ChatBookingScope = {
  organizationId: string;
  actorId: string;
  locationId: string;
  calendarId: string | null;
  contactId: string;
  ghlContactId: string;
  contactName: string;
  timezone: string;
  canBook: boolean;
};
export const bookingStoredSchema = z.object({
  requestId: z.string().uuid(),
  ghlContactId: bookingId,
  contactId: z.string().uuid(),
  locationId: bookingId,
  calendarId: bookingId,
  calendarName: z.string(),
  timezone: z.string(),
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }),
  notify: z.boolean(),
  dispatchId: z.string().uuid(),
  state: z.enum(["pending", "unknown", "rejected", "confirmed"]),
  appointmentId: bookingId.nullable(),
  cacheSynced: z.boolean(),
  errorCode: z.string().nullable(),
});
export type StoredBooking = z.infer<typeof bookingStoredSchema>;
export type BookingCommand = {
  request: StoredBooking | null;
  claimed?: boolean;
  abandoned?: boolean;
};
export interface ChatBookingStore {
  command(
    scope: ChatBookingScope,
    operation: "read" | "claim" | "ack" | "finish" | "abandon",
    data: Record<string, unknown>,
  ): Promise<BookingCommand>;
}
export type BookingHttpResult =
  { ok: true; data: unknown } | { ok: false; definitive: boolean; status: number; code: string };
export interface BookingProvider {
  contact(id: string): Promise<unknown>;
  calendar(id: string): Promise<unknown>;
  slots(
    id: string,
    query: { startDate: string; endDate: string; timezone: string; duration: string },
  ): Promise<unknown>;
  create(body: {
    calendarId: string;
    locationId: string;
    contactId: string;
    startTime: string;
    endTime: string;
    appointmentStatus: "new";
    toNotify: boolean;
    ignoreFreeSlotValidation: false;
    ignoreDateRange: false;
  }): Promise<BookingHttpResult>;
  event(id: string): Promise<unknown>;
}
export class ChatBookingException extends Error {
  constructor(readonly code: ChatBookingError) {
    super(code);
  }
}
const codes = new Set<ChatBookingError>([
  "forbidden",
  "invalid_input",
  "not_configured",
  "contact_not_found",
  "calendar_unsupported",
  "provider_unavailable",
  "slot_unavailable",
  "configuration_changed",
  "write_disabled",
  "request_mismatch",
  "request_abandoned",
  "duplicate_slot",
  "not_found",
  "migration_required",
  "unavailable",
]);
function failure(error: unknown): ChatBookingResult<never> {
  return chatBookingFailure(error instanceof ChatBookingException ? error.code : "unavailable");
}
const normalize = (value: string) => new Date(value).toISOString();
function matchesInput(request: StoredBooking, input: ChatBookingCreateInput) {
  return (
    request.ghlContactId === input.ghlContactId &&
    request.calendarId === input.calendarId &&
    request.timezone === input.timezone &&
    normalize(request.startAt) === normalize(input.startAt) &&
    normalize(request.endAt) === normalize(input.endAt) &&
    request.notify === input.notify
  );
}
function receipt(request: StoredBooking): ChatBookingReceipt {
  const messages: Record<StoredBooking["state"], string> = {
    pending:
      "O pedido foi registrado, mas o resultado ainda não foi concluído. Consulte o resultado; não faça um novo agendamento.",
    unknown: request.appointmentId
      ? "O GHL recebeu o pedido, mas a verificação ainda está pendente. Confira o resultado sem repetir o agendamento."
      : "O resultado do pedido não pôde ser determinado. Confira a Agenda no GHL; não repita este agendamento.",
    rejected:
      "O GHL recusou este pedido sem criar o agendamento. Atualize os horários antes de tentar novamente.",
    confirmed: request.cacheSynced
      ? "Agendamento criado e verificado no GHL. Isso não confirma presença nem pagamento do paciente."
      : "Agendamento criado e verificado no GHL. A atualização da Agenda no Jornada AI ainda está pendente; não agende novamente.",
  };
  return {
    state: request.state,
    requestId: request.requestId,
    ...(request.appointmentId ? { appointmentId: request.appointmentId } : {}),
    startAt: normalize(request.startAt),
    endAt: normalize(request.endAt),
    calendarName: request.calendarName,
    timezone: request.timezone,
    message: messages[request.state],
    cacheSynced: request.cacheSynced,
  };
}

/** Only this adapter uses Calendar v3. Existing contact and other GHL clients retain 2021-07-28. */
export class ChatBookingGhl implements BookingProvider {
  constructor(
    private readonly token: string,
    private readonly locationId: string,
    private readonly transport: typeof fetch = fetch,
  ) {}
  private async calendarRequest(
    path: string,
    method: "GET" | "POST",
    query: Record<string, string> = {},
    body?: unknown,
  ): Promise<BookingHttpResult> {
    try {
      const response = await this.transport(urlOficial(path, query).toString(), {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Version: "v3",
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok)
        return {
          ok: false,
          definitive: [400, 401, 403, 404, 409, 422, 429].includes(response.status),
          status: response.status,
          code: `http_${response.status}`,
        };
      const text = await response.text();
      if (text.length > 1_000_000)
        return { ok: false, definitive: false, status: response.status, code: "invalid_response" };
      try {
        return { ok: true, data: JSON.parse(text) };
      } catch {
        return { ok: false, definitive: false, status: response.status, code: "invalid_response" };
      }
    } catch {
      return { ok: false, definitive: false, status: 0, code: "transport_unknown" };
    }
  }
  private async get(path: string, query?: Record<string, string>): Promise<unknown> {
    const result = await this.calendarRequest(path, "GET", query);
    if (!result.ok) throw new ChatBookingException("provider_unavailable");
    return result.data;
  }
  async contact(id: string) {
    const result = await ghlFetch(
      { token: this.token, locationId: this.locationId, baseUrl: GHL_ORIGIN, version: GHL_VERSION },
      `contacts/${bookingId.parse(id)}`,
    );
    if (!result.ok) throw new ChatBookingException("provider_unavailable");
    return result.data;
  }
  calendar(id: string) {
    return this.get(`calendars/${bookingId.parse(id)}`);
  }
  slots(
    id: string,
    query: { startDate: string; endDate: string; timezone: string; duration: string },
  ) {
    return this.get(`calendars/${bookingId.parse(id)}/free-slots`, query);
  }
  create(body: Parameters<BookingProvider["create"]>[0]) {
    return this.calendarRequest("calendars/events/appointments", "POST", {}, body);
  }
  event(id: string) {
    return this.get(`calendars/events/appointments/${bookingId.parse(id)}`);
  }
}

export class ChatBookingRpcStore implements ChatBookingStore {
  constructor(
    private readonly rpc: {
      rpc(
        name: string,
        args: Record<string, unknown>,
      ): PromiseLike<{ data: unknown; error: unknown }>;
    },
  ) {}
  async command(
    scope: ChatBookingScope,
    operation: "read" | "claim" | "ack" | "finish" | "abandon",
    data: Record<string, unknown>,
  ): Promise<BookingCommand> {
    const result = await this.rpc.rpc("chat_booking_command", {
      _op: operation,
      _org: scope.organizationId,
      _actor: scope.actorId,
      _data: data,
    });
    if (result.error) {
      const code = (result.error as { code?: unknown }).code;
      throw new ChatBookingException(
        ["PGRST202", "42P01", "42883", "42703"].includes(String(code))
          ? "migration_required"
          : "unavailable",
      );
    }
    const error = (result.data as { error?: unknown } | null)?.error;
    if (typeof error === "string")
      throw new ChatBookingException(
        codes.has(error as ChatBookingError) ? (error as ChatBookingError) : "unavailable",
      );
    const parsed = z
      .object({
        request: bookingStoredSchema.nullable(),
        claimed: z.boolean().optional(),
        abandoned: z.boolean().optional(),
      })
      .safeParse(result.data);
    if (!parsed.success) throw new ChatBookingException("unavailable");
    const request = parsed.data.request;
    if (
      request &&
      (request.ghlContactId !== scope.ghlContactId ||
        request.contactId !== scope.contactId ||
        request.locationId !== scope.locationId ||
        request.requestId !== data["requestId"])
    )
      throw new ChatBookingException("forbidden");
    return {
      request,
      ...(parsed.data.claimed === undefined ? {} : { claimed: parsed.data.claimed }),
      ...(parsed.data.abandoned === undefined ? {} : { abandoned: parsed.data.abandoned }),
    };
  }
}

export class ChatBookingService {
  constructor(
    private readonly provider: BookingProvider,
    private readonly store: ChatBookingStore,
    private readonly now: () => number = Date.now,
    private readonly uuid: () => string = randomUUID,
  ) {}
  async options(
    scope: ChatBookingScope,
    raw: ChatBookingOptionsInput,
  ): Promise<ChatBookingResult<ChatBookingOptions>> {
    const parsed = chatBookingOptionsSchema.safeParse(raw);
    if (!parsed.success) return chatBookingFailure("invalid_input");
    if (
      parsed.data.organizationId !== scope.organizationId ||
      parsed.data.ghlContactId !== scope.ghlContactId
    )
      return chatBookingFailure("forbidden");
    if (!scope.calendarId) return chatBookingFailure("not_configured");
    try {
      let day;
      try {
        day = bookingDay(parsed.data.date, scope.timezone);
      } catch {
        return chatBookingFailure("invalid_input");
      }
      if (
        Date.parse(day.endAt) <= this.now() ||
        Date.parse(day.startAt) > this.now() + 366 * 86_400_000
      )
        return chatBookingFailure("invalid_input");
      const contact = z
        .object({
          contact: z.object({
            id: bookingId,
            locationId: bookingId,
            name: z.string().optional(),
            firstName: z.string().optional(),
            lastName: z.string().optional(),
          }),
        })
        .parse(await this.provider.contact(scope.ghlContactId)).contact;
      if (contact.id !== scope.ghlContactId || contact.locationId !== scope.locationId)
        return chatBookingFailure("forbidden");
      let calendar;
      try {
        calendar = parseBookingCalendar(
          await this.provider.calendar(scope.calendarId),
          scope.calendarId,
          scope.locationId,
        );
      } catch (error) {
        if (error instanceof ChatBookingException) throw error;
        return chatBookingFailure("calendar_unsupported");
      }
      const slots = parseBookingSlots(
        await this.provider.slots(scope.calendarId, {
          startDate: String(Date.parse(day.startAt)),
          endDate: String(Date.parse(day.endAt)),
          timezone: scope.timezone,
          duration: String(calendar.durationMinutes),
        }),
        parsed.data.date,
        scope.timezone,
        calendar.durationMinutes,
        this.now(),
      );
      return {
        ok: true,
        data: {
          contactName:
            contact.name?.trim() ||
            [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim() ||
            scope.contactName,
          calendarId: calendar.id,
          calendarName: calendar.name,
          timezone: scope.timezone,
          durationMinutes: calendar.durationMinutes,
          meetingLabel: calendar.meetingLabel,
          slots,
          canBook: scope.canBook,
          ...(scope.canBook
            ? {}
            : { blockReason: "A escrita no GHL está desativada para esta organização." }),
          checkedAt: new Date(this.now()).toISOString(),
        },
      };
    } catch (error) {
      return error instanceof ChatBookingException
        ? failure(error)
        : chatBookingFailure("provider_unavailable");
    }
  }
  private async stored(scope: ChatBookingScope, requestId: string) {
    return (
      await this.store.command(scope, "read", { requestId, ghlContactId: scope.ghlContactId })
    ).request;
  }
  private async reconcile(
    scope: ChatBookingScope,
    request: StoredBooking,
  ): Promise<ChatBookingReceipt> {
    if (
      !request.appointmentId ||
      request.state === "rejected" ||
      (request.state === "confirmed" && request.cacheSynced)
    )
      return receipt(request);
    try {
      const raw = z
        .object({ event: z.unknown() })
        .parse(await this.provider.event(request.appointmentId));
      const event = verifyBookingEvent(raw.event, request, request.appointmentId);
      const result = await this.store.command(scope, "finish", {
        requestId: request.requestId,
        ghlContactId: scope.ghlContactId,
        dispatchId: request.dispatchId,
        state: "confirmed",
        appointmentId: event.id,
        rawStatus: event.appointmentStatus,
      });
      return result.request ? receipt(result.request) : receipt({ ...request, state: "unknown" });
    } catch {
      return receipt(request.state === "confirmed" ? request : { ...request, state: "unknown" });
    }
  }
  async read(
    scope: ChatBookingScope,
    raw: ChatBookingReadInput,
  ): Promise<ChatBookingResult<ChatBookingReceipt>> {
    const parsed = chatBookingReadSchema.safeParse(raw);
    if (!parsed.success) return chatBookingFailure("invalid_input");
    if (
      parsed.data.organizationId !== scope.organizationId ||
      parsed.data.ghlContactId !== scope.ghlContactId
    )
      return chatBookingFailure("forbidden");
    try {
      const request = await this.stored(scope, parsed.data.requestId);
      if (!request) return chatBookingFailure("not_found");
      return { ok: true, data: await this.reconcile(scope, request) };
    } catch (error) {
      return failure(error);
    }
  }
  async abandon(
    scope: ChatBookingScope,
    raw: ChatBookingReadInput,
  ): Promise<ChatBookingResult<ChatBookingAbandonResult>> {
    const parsed = chatBookingReadSchema.safeParse(raw);
    if (!parsed.success) return chatBookingFailure("invalid_input");
    if (
      parsed.data.organizationId !== scope.organizationId ||
      parsed.data.ghlContactId !== scope.ghlContactId
    )
      return chatBookingFailure("forbidden");
    try {
      const outcome = await this.store.command(scope, "abandon", {
        requestId: parsed.data.requestId,
        ghlContactId: scope.ghlContactId,
      });
      if (outcome.request)
        return {
          ok: true,
          data: { abandoned: false, receipt: await this.reconcile(scope, outcome.request) },
        };
      return outcome.abandoned === true
        ? { ok: true, data: { abandoned: true } }
        : chatBookingFailure("unavailable");
    } catch (error) {
      return failure(error);
    }
  }
  async create(
    scope: ChatBookingScope,
    raw: ChatBookingCreateInput,
  ): Promise<ChatBookingResult<ChatBookingReceipt>> {
    const parsed = chatBookingCreateSchema.safeParse(raw);
    if (!parsed.success) return chatBookingFailure("invalid_input");
    const input = {
      ...parsed.data,
      startAt: normalize(parsed.data.startAt),
      endAt: normalize(parsed.data.endAt),
    };
    if (input.organizationId !== scope.organizationId || input.ghlContactId !== scope.ghlContactId)
      return chatBookingFailure("forbidden");
    let request: StoredBooking;
    try {
      const previous = await this.stored(scope, input.requestId);
      if (previous)
        return matchesInput(previous, input)
          ? { ok: true, data: await this.reconcile(scope, previous) }
          : chatBookingFailure("request_mismatch");
      if (!scope.canBook) return chatBookingFailure("write_disabled");
      if (input.calendarId !== scope.calendarId || input.timezone !== scope.timezone)
        return chatBookingFailure("configuration_changed");
      const options = await this.options(scope, {
        organizationId: scope.organizationId,
        ghlContactId: scope.ghlContactId,
        date: chaveDia(input.startAt, scope.timezone),
      });
      if (!options.ok) return options;
      if (
        !options.data.slots.some(
          (slot) => slot.startAt === input.startAt && slot.endAt === input.endAt,
        )
      )
        return chatBookingFailure("slot_unavailable");
      const claimed = await this.store.command(scope, "claim", {
        requestId: input.requestId,
        ghlContactId: scope.ghlContactId,
        contactId: scope.contactId,
        locationId: scope.locationId,
        calendarId: scope.calendarId,
        calendarName: options.data.calendarName,
        timezone: scope.timezone,
        startAt: input.startAt,
        endAt: input.endAt,
        notify: input.notify,
        dispatchId: this.uuid(),
      });
      if (!claimed.request) throw new ChatBookingException("unavailable");
      request = claimed.request;
      if (
        !matchesInput(request, input) ||
        request.contactId !== scope.contactId ||
        request.locationId !== scope.locationId ||
        request.requestId !== input.requestId
      )
        throw new ChatBookingException("request_mismatch");
      if (!claimed.claimed) return { ok: true, data: await this.reconcile(scope, request) };
    } catch (error) {
      return failure(error);
    }
    // From this point a durable, single-use dispatch claim exists. Any ambiguous result is
    // a receipt to reconcile, never an error that invites a fresh POST.
    try {
      const result = await this.provider.create({
        calendarId: request.calendarId,
        locationId: request.locationId,
        contactId: request.ghlContactId,
        startTime: normalize(request.startAt),
        endTime: normalize(request.endAt),
        appointmentStatus: "new",
        toNotify: request.notify,
        ignoreFreeSlotValidation: false,
        ignoreDateRange: false,
      });
      if (!result.ok) {
        const state = result.definitive ? "rejected" : "unknown";
        const saved = await this.store.command(scope, "finish", {
          requestId: request.requestId,
          ghlContactId: scope.ghlContactId,
          dispatchId: request.dispatchId,
          state,
          errorCode: result.code,
        });
        return { ok: true, data: receipt(saved.request ?? { ...request, state }) };
      }
      // A flat, valid provider ID is enough to read the exact event. Do not lose that
      // identity merely because the POST response omitted other documented fields.
      const eventId = z.object({ id: bookingId }).safeParse(result.data);
      if (!eventId.success) {
        const saved = await this.store.command(scope, "finish", {
          requestId: request.requestId,
          ghlContactId: scope.ghlContactId,
          dispatchId: request.dispatchId,
          state: "unknown",
          errorCode: "invalid_response",
        });
        return { ok: true, data: receipt(saved.request ?? { ...request, state: "unknown" }) };
      }
      request = { ...request, state: "unknown", appointmentId: eventId.data.id };
      const ackData = {
        requestId: request.requestId,
        ghlContactId: scope.ghlContactId,
        dispatchId: request.dispatchId,
        appointmentId: eventId.data.id,
      };
      let acknowledged: BookingCommand;
      try {
        acknowledged = await this.store.command(scope, "ack", ackData);
      } catch {
        acknowledged = await this.store.command(scope, "ack", ackData);
      } // Idempotent ledger write, never provider POST.
      if (!acknowledged.request?.appointmentId) return { ok: true, data: receipt(request) };
      return { ok: true, data: await this.reconcile(scope, acknowledged.request) };
    } catch {
      // Do not retry the POST or infer an event by contact/time when its returned ID is missing.
      try {
        const saved = await this.store.command(scope, "finish", {
          requestId: request.requestId,
          ghlContactId: scope.ghlContactId,
          dispatchId: request.dispatchId,
          state: "unknown",
          errorCode: "dispatch_unknown",
          ...(request.appointmentId ? { appointmentId: request.appointmentId } : {}),
        });
        return {
          ok: true,
          data: receipt(
            saved.request?.appointmentId || !request.appointmentId
              ? (saved.request ?? { ...request, state: "unknown" })
              : { ...request, state: "unknown" },
          ),
        };
      } catch {
        return { ok: true, data: receipt({ ...request, state: "unknown" }) };
      }
    }
  }
}

export async function authenticatedChatBooking(
  context: { supabase: SupabaseClient; userId: string },
  input: { organizationId: string; ghlContactId: string },
): Promise<
  { scope: ChatBookingScope; service: ChatBookingService } | { failure: ChatBookingResult<never> }
> {
  try {
    const access = await resolverAcesso(context, ["administrador", "gestor", "comercial"]);
    if (!access.ok || access.acesso.orgId !== input.organizationId)
      return { failure: chatBookingFailure("forbidden") };
    const { orgId, locationId, conn } = access.acesso;
    const [organization, contacts] = await Promise.all([
      context.supabase.from("organizations").select("timezone").eq("id", orgId).maybeSingle(),
      context.supabase
        .from("contacts")
        .select("id,full_name")
        .eq("organization_id", orgId)
        .eq("ghl_contact_id", input.ghlContactId)
        .eq("is_demo", false)
        .limit(2),
    ]);
    if (contacts.error || contacts.data?.length !== 1)
      return { failure: chatBookingFailure("contact_not_found") };
    if (organization.error || typeof organization.data?.timezone !== "string")
      return { failure: chatBookingFailure("not_configured") };
    const timezone = validarFuso(organization.data.timezone);
    const token = readGhlSecrets();
    if (!token.token || token.locationId !== locationId)
      return { failure: chatBookingFailure("not_configured") };
    const calendarId = bookingId.safeParse(conn?.["calendar_id"]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const scope: ChatBookingScope = {
      organizationId: orgId,
      actorId: context.userId,
      locationId,
      calendarId: calendarId.success ? calendarId.data : null,
      contactId: String(contacts.data[0]!.id),
      ghlContactId: input.ghlContactId,
      contactName: String(contacts.data[0]!.full_name),
      timezone,
      canBook: conn?.["write_enabled"] === true,
    };
    return {
      scope,
      service: new ChatBookingService(
        new ChatBookingGhl(token.token, locationId),
        new ChatBookingRpcStore(
          supabaseAdmin as unknown as ConstructorParameters<typeof ChatBookingRpcStore>[0],
        ),
      ),
    };
  } catch {
    return { failure: chatBookingFailure("unavailable") };
  }
}
