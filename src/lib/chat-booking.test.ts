import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as accessModule from "./ghl.functions";
import {
  bookingDay,
  chatBookingCreateSchema,
  parseBookingCalendar,
  parseBookingSlots,
  verifyBookingEvent,
  type ChatBookingCreateInput,
} from "./chat-booking.core";
import {
  authenticatedChatBooking,
  ChatBookingException,
  ChatBookingGhl,
  ChatBookingRpcStore,
  ChatBookingService,
  type BookingProvider,
  type ChatBookingScope,
  type ChatBookingStore,
  type StoredBooking,
} from "./chat-booking.server";

const org = "11111111-1111-4111-8111-111111111111";
const contact = "22222222-2222-4222-8222-222222222222";
const actor = "33333333-3333-4333-8333-333333333333";
const requestId = "44444444-4444-4444-8444-444444444444";
const dispatchId = "55555555-5555-4555-8555-555555555555";
const secondId = "66666666-6666-4666-8666-666666666666";
const now = Date.parse("2026-11-13T10:00:00Z");
const scope: ChatBookingScope = {
  organizationId: org,
  actorId: actor,
  locationId: "location",
  calendarId: "calendar",
  contactId: contact,
  ghlContactId: "patient",
  contactName: "Teste",
  timezone: "Europe/Lisbon",
  canBook: true,
};
const input: ChatBookingCreateInput = {
  organizationId: org,
  ghlContactId: "patient",
  requestId,
  calendarId: "calendar",
  timezone: "Europe/Lisbon",
  startAt: "2026-11-16T11:00:00.000Z",
  endAt: "2026-11-16T11:30:00.000Z",
  notify: false,
};
const calendar = {
  calendar: {
    id: "calendar",
    locationId: "location",
    name: "Consulta inicial",
    isActive: true,
    calendarType: "personal",
    slotDuration: 30,
    slotDurationUnit: "mins",
  },
};
const event = {
  id: "event",
  calendarId: "calendar",
  locationId: "location",
  contactId: "patient",
  startTime: input.startAt,
  endTime: input.endAt,
  appointmentStatus: "new",
};
const optionsInput = { organizationId: org, ghlContactId: "patient", date: "2026-11-16" };
const readInput = { organizationId: org, ghlContactId: "patient", requestId };

/** Synthetic ledger mirrors immutable requests; real SQL/concurrency coverage lives in .db.test.ts. */
class MemoryStore implements ChatBookingStore {
  rows = new Map<string, StoredBooking>();
  abandoned = new Set<string>();
  calls: { operation: string; data: Record<string, unknown> }[] = [];
  async command(
    _scope: ChatBookingScope,
    operation: "read" | "claim" | "ack" | "finish" | "abandon",
    data: Record<string, unknown>,
  ) {
    this.calls.push({ operation, data });
    const id = String(data["requestId"]);
    const previous = this.rows.get(id);
    if (operation === "read") return { request: previous ? structuredClone(previous) : null };
    if (operation === "abandon") {
      if (previous) return { request: structuredClone(previous) };
      this.abandoned.add(id);
      return { request: null, abandoned: true };
    }
    if (operation === "claim") {
      if (this.abandoned.has(id)) throw new ChatBookingException("request_abandoned");
      if (previous) return { request: structuredClone(previous), claimed: false };
      if (
        [...this.rows.values()].some(
          (r) =>
            r.startAt === data["startAt"] &&
            r.calendarId === data["calendarId"] &&
            r.ghlContactId === data["ghlContactId"] &&
            r.state !== "rejected",
        )
      )
        throw new ChatBookingException("duplicate_slot");
      const row: StoredBooking = {
        ...data,
        state: "pending",
        appointmentId: null,
        cacheSynced: false,
        errorCode: null,
      } as StoredBooking;
      this.rows.set(id, row);
      return { request: structuredClone(row), claimed: true };
    }
    if (!previous) throw new ChatBookingException("not_found");
    const row = { ...previous };
    if (operation === "ack") {
      row.appointmentId = String(data["appointmentId"]);
      row.state = "unknown";
    } else {
      row.state = data["state"] as StoredBooking["state"];
      if (data["appointmentId"]) row.appointmentId = String(data["appointmentId"]);
      row.cacheSynced = row.state === "confirmed";
      row.errorCode = data["errorCode"] ? String(data["errorCode"]) : null;
    }
    this.rows.set(id, row);
    return { request: structuredClone(row) };
  }
}
function setup() {
  const provider = {
    contact: vi.fn(async () => ({
      contact: { id: "patient", locationId: "location", name: "Teste Pessoa" },
    })),
    calendar: vi.fn(async () => structuredClone(calendar)),
    slots: vi.fn(async () => ({ "2026-11-16": { slots: [input.startAt] } })),
    create: vi.fn<BookingProvider["create"]>(async () => ({
      ok: true,
      data: structuredClone(event),
    })),
    event: vi.fn(async () => ({ event: structuredClone(event) })),
  };
  const store = new MemoryStore();
  const service = new ChatBookingService(
    provider,
    store,
    () => now,
    () => dispatchId,
  );
  return { provider, store, service };
}
function seeded(
  state: StoredBooking["state"] = "pending",
  appointmentId: string | null = null,
): StoredBooking {
  return {
    requestId,
    ghlContactId: "patient",
    contactId: contact,
    locationId: "location",
    calendarId: "calendar",
    calendarName: "Consulta inicial",
    timezone: "Europe/Lisbon",
    startAt: input.startAt,
    endAt: input.endAt,
    notify: false,
    dispatchId,
    state,
    appointmentId,
    cacheSynced: false,
    errorCode: null,
  };
}

describe("booking calendar contracts", () => {
  it("defaults notify to false and rejects hidden CRM/clinical fields", () => {
    const { notify: _, ...plain } = input;
    expect(chatBookingCreateSchema.parse(plain).notify).toBe(false);
    for (const extra of [
      { locationId: "elsewhere" },
      { notes: "clinical" },
      { appointmentStatus: "confirmed" },
      { title: "arbitrary" },
    ])
      expect(chatBookingCreateSchema.safeParse({ ...input, ...extra }).success).toBe(false);
  });
  it.each(["2026-02-30", "2026-13-01", "invalid"])("rejects invalid civil date %s", (date) => {
    expect(() => bookingDay(date, scope.timezone)).toThrow();
  });
  it("uses the actual 23/25-hour Lisbon civil-day boundaries", () => {
    const march = bookingDay("2026-03-29", scope.timezone);
    const october = bookingDay("2026-10-25", scope.timezone);
    expect(Date.parse(march.endAt) - Date.parse(march.startAt)).toBe(23 * 3600000);
    expect(Date.parse(october.endAt) - Date.parse(october.startAt)).toBe(25 * 3600000);
    expect(march.endAt).toBe("2026-03-29T23:00:00.000Z");
  });
  it("keeps repeated DST hours distinct with offset labels and removes exact duplicates", () => {
    const slots = parseBookingSlots(
      {
        "2026-10-25": {
          slots: [
            "2026-10-25T01:00:00+01:00",
            "2026-10-25T01:00:00Z",
            "2026-10-25T01:00:00+01:00",
            "2026-10-26T00:00:00Z",
          ],
        },
      },
      "2026-10-25",
      scope.timezone,
      30,
      Date.parse("2026-10-24T00:00:00Z"),
    );
    expect(slots).toHaveLength(2);
    expect(slots[0]!.label).not.toBe(slots[1]!.label);
    expect(slots[0]!.endAt).toBe("2026-10-25T00:30:00.000Z");
  });
  it("accepts no date entry as no slots and rejects malformed free slots", () => {
    expect(
      parseBookingSlots({ traceId: "opaque" }, optionsInput.date, scope.timezone, 30, now),
    ).toEqual([]);
    expect(() =>
      parseBookingSlots(
        { "2026-11-16": { slots: ["11:00"] } },
        optionsInput.date,
        scope.timezone,
        30,
        now,
      ),
    ).toThrow();
  });
  it("reads default duration in minutes or canonical slot hours", () => {
    expect(parseBookingCalendar(calendar, "calendar", "location").durationMinutes).toBe(30);
    expect(
      parseBookingCalendar(
        { calendar: { ...calendar.calendar, slotDuration: 1, slotDurationUnit: "hours" } },
        "calendar",
        "location",
      ).durationMinutes,
    ).toBe(60);
    expect(
      parseBookingCalendar(
        {
          calendar: {
            ...calendar.calendar,
            durationOptions: [{ duration: 45, durationUnit: "mins", isDefault: true }],
          },
        },
        "calendar",
        "location",
      ).durationMinutes,
    ).toBe(45);
  });
  it.each([
    { locationId: "other" },
    { id: "other" },
    { isActive: false },
    { calendarType: "service_booking" },
    { calendarType: "class_booking" },
    { name: "a".repeat(201) },
    { durationOptions: [{ duration: 1, durationUnit: "hours", isDefault: true }] },
    { durationOptions: [{ duration: 30, durationUnit: "mins", isDefault: false }] },
    {
      durationOptions: [
        { duration: 30, durationUnit: "mins", isDefault: true },
        { duration: 60, durationUnit: "mins", isDefault: true },
      ],
    },
  ])("blocks incompatible or mismatched calendar %j", (change) =>
    expect(() =>
      parseBookingCalendar(
        { calendar: { ...calendar.calendar, ...change } },
        "calendar",
        "location",
      ),
    ).toThrow(),
  );
  it.each([
    { contactId: "other" },
    { locationId: "other" },
    { calendarId: "other" },
    { id: "other" },
    { startTime: "2026-11-16T12:00:00Z" },
    { appointmentStatus: "cancelled" },
    { deleted: true },
  ])("never verifies a mismatched event %j", (change) =>
    expect(() => verifyBookingEvent({ ...event, ...change }, seeded(), "event")).toThrow(),
  );
});

describe("booking service supervision and idempotency", () => {
  it("authenticates scope before any provider read, ledger claim or write", async () => {
    const { service, provider, store } = setup();
    expect(await service.create(scope, { ...input, organizationId: secondId })).toMatchObject({
      ok: false,
      code: "forbidden",
    });
    expect(await service.create(scope, { ...input, ghlContactId: "other" })).toMatchObject({
      ok: false,
      code: "forbidden",
    });
    expect(provider.contact).not.toHaveBeenCalled();
    expect(store.calls).toHaveLength(0);
    expect(provider.create).not.toHaveBeenCalled();
  });
  it("checks contact location, configured calendar, current slots and write gate", async () => {
    const a = setup();
    a.provider.contact.mockResolvedValue({
      contact: { id: "patient", locationId: "other", name: "foreign" },
    });
    expect(await a.service.create(scope, input)).toMatchObject({ ok: false, code: "forbidden" });
    expect(a.provider.create).not.toHaveBeenCalled();
    const b = setup();
    expect(await b.service.create({ ...scope, canBook: false }, input)).toMatchObject({
      ok: false,
      code: "write_disabled",
    });
    expect(b.provider.contact).not.toHaveBeenCalled();
    expect(await b.service.options({ ...scope, canBook: false }, optionsInput)).toMatchObject({
      ok: true,
      data: { canBook: false },
    });
    expect(await b.service.create(scope, { ...input, calendarId: "other" })).toMatchObject({
      ok: false,
      code: "configuration_changed",
    });
    expect(await b.service.create(scope, { ...input, timezone: "UTC" })).toMatchObject({
      ok: false,
      code: "configuration_changed",
    });
    b.provider.slots.mockResolvedValue({ "2026-11-16": { slots: [] } });
    expect(await b.service.create(scope, input)).toMatchObject({
      ok: false,
      code: "slot_unavailable",
    });
    expect(b.provider.create).not.toHaveBeenCalled();
  });
  it("validates civil dates before provider reads", async () => {
    const { service, provider } = setup();
    expect(await service.options(scope, { ...optionsInput, date: "2026-02-30" })).toMatchObject({
      ok: false,
      code: "invalid_input",
    });
    expect(provider.contact).not.toHaveBeenCalled();
  });
  it("uses exclusive free-slot day bounds in the configured timezone", async () => {
    const { service, provider } = setup();
    await service.options(scope, optionsInput);
    expect(provider.slots).toHaveBeenCalledWith("calendar", {
      startDate: String(Date.parse("2026-11-16T00:00:00Z")),
      endDate: String(Date.parse("2026-11-17T00:00:00Z")),
      timezone: "Europe/Lisbon",
      duration: "30",
    });
  });
  it("claims, posts only the minimal new/not-notified appointment, acknowledges, GET verifies and persists once", async () => {
    const { service, provider, store } = setup();
    const result = await service.create(scope, input);
    expect(result).toMatchObject({
      ok: true,
      data: { state: "confirmed", appointmentId: "event", cacheSynced: true },
    });
    expect(provider.create).toHaveBeenCalledExactlyOnceWith({
      calendarId: "calendar",
      locationId: "location",
      contactId: "patient",
      startTime: input.startAt,
      endTime: input.endAt,
      appointmentStatus: "new",
      toNotify: false,
      ignoreFreeSlotValidation: false as const,
      ignoreDateRange: false as const,
    });
    expect(store.calls.map((c) => c.operation)).toEqual(["read", "claim", "ack", "finish"]);
    expect(provider.event).toHaveBeenCalledExactlyOnceWith("event");
    expect(await service.create(scope, input)).toMatchObject({
      ok: true,
      data: { state: "confirmed" },
    });
    await service.read(scope, readInput);
    expect(provider.create).toHaveBeenCalledTimes(1);
    expect(provider.event).toHaveBeenCalledTimes(1);
  });
  it("only enables toNotify for an explicit true; replay cannot mutate that decision", async () => {
    const { service, provider } = setup();
    await service.create(scope, { ...input, notify: true });
    expect(provider.create.mock.calls[0]![0].toNotify).toBe(true);
    expect(await service.create(scope, input)).toMatchObject({
      ok: false,
      code: "request_mismatch",
    });
    expect(provider.create).toHaveBeenCalledTimes(1);
  });
  it("concurrent same-request calls get only one durable dispatch", async () => {
    const { service, provider } = setup();
    await Promise.all([service.create(scope, input), service.create(scope, input)]);
    expect(provider.create).toHaveBeenCalledTimes(1);
  });
  it("different request IDs cannot duplicate the same contact slot", async () => {
    const { service, provider } = setup();
    const results = await Promise.all([
      service.create(scope, input),
      service.create(scope, { ...input, requestId: secondId }),
    ]);
    expect(provider.create).toHaveBeenCalledTimes(1);
    expect(results.some((r) => !r.ok && r.code === "duplicate_slot")).toBe(true);
  });
  it("denied final claim stops before POST after live options were read", async () => {
    const { provider, store } = setup();
    const command = store.command.bind(store);
    store.command = vi.fn(async (s, op, d) => {
      if (op === "claim") throw new ChatBookingException("write_disabled");
      return command(s, op, d);
    });
    const service = new ChatBookingService(
      provider,
      store,
      () => now,
      () => dispatchId,
    );
    expect(await service.create(scope, input)).toMatchObject({ ok: false, code: "write_disabled" });
    expect(provider.slots).toHaveBeenCalledOnce();
    expect(provider.create).not.toHaveBeenCalled();
  });
  it("refuses a malformed claim snapshot before POST", async () => {
    const { provider, store } = setup();
    const command = store.command.bind(store);
    store.command = vi.fn(async (s, op, d) =>
      op === "claim"
        ? { request: { ...seeded(), locationId: "other" }, claimed: true }
        : command(s, op, d),
    );
    const service = new ChatBookingService(
      provider,
      store,
      () => now,
      () => dispatchId,
    );
    expect(await service.create(scope, input)).toMatchObject({
      ok: false,
      code: "request_mismatch",
    });
    expect(provider.create).not.toHaveBeenCalled();
  });
  it.each(["timeout", "500", "malformed"])(
    "does not repost an ambiguous %s outcome, including a new request ID",
    async (kind) => {
      const { service, provider } = setup();
      if (kind === "timeout") provider.create.mockRejectedValue(new Error("timeout"));
      if (kind === "500")
        provider.create.mockResolvedValue({
          ok: false,
          definitive: false,
          status: 500,
          code: "http_500",
        });
      if (kind === "malformed")
        provider.create.mockResolvedValue({ ok: true, data: { status: "ok" } });
      expect(await service.create(scope, input)).toMatchObject({
        ok: true,
        data: { state: "unknown" },
      });
      expect(await service.create(scope, input)).toMatchObject({
        ok: true,
        data: { state: "unknown" },
      });
      expect(await service.read(scope, readInput)).toMatchObject({
        ok: true,
        data: { state: "unknown" },
      });
      expect(await service.create(scope, { ...input, requestId: secondId })).toMatchObject({
        ok: false,
        code: "duplicate_slot",
      });
      expect(provider.create).toHaveBeenCalledTimes(1);
      expect(provider.event).not.toHaveBeenCalled();
    },
  );
  it("retains a valid ID from a partial flat POST response, then verifies GET's distinct envelope", async () => {
    const { service, provider } = setup();
    provider.create.mockResolvedValue({ ok: true, data: { id: "event" } });
    expect(await service.create(scope, input)).toMatchObject({
      ok: true,
      data: { state: "confirmed", appointmentId: "event" },
    });
    expect(provider.event).toHaveBeenCalledWith("event");
  });
  it("does not assume a nested POST envelope is a known event", async () => {
    const { service, provider } = setup();
    provider.create.mockResolvedValue({ ok: true, data: { event } });
    expect(await service.create(scope, input)).toMatchObject({
      ok: true,
      data: { state: "unknown" },
    });
    expect(provider.event).not.toHaveBeenCalled();
  });
  it("reconciles a known event after GET failure without another POST", async () => {
    const { service, provider } = setup();
    provider.event.mockRejectedValueOnce(new Error("unavailable"));
    expect(await service.create(scope, input)).toMatchObject({
      ok: true,
      data: { state: "unknown", appointmentId: "event" },
    });
    expect(await service.read({ ...scope, canBook: false }, readInput)).toMatchObject({
      ok: true,
      data: { state: "confirmed" },
    });
    expect(provider.create).toHaveBeenCalledTimes(1);
  });
  it("a wrong contact/time in the exact event never confirms or overwrites cache", async () => {
    const { service, provider, store } = setup();
    provider.event.mockResolvedValue({ event: { ...event, contactId: "other" } });
    expect(await service.create(scope, input)).toMatchObject({
      ok: true,
      data: { state: "unknown" },
    });
    expect(
      store.calls.some((c) => c.operation === "finish" && c.data["state"] === "confirmed"),
    ).toBe(false);
  });
  it("a definitive refusal stays rejected and requires a new request plus refreshed availability", async () => {
    const { service, provider } = setup();
    provider.create.mockResolvedValueOnce({
      ok: false,
      definitive: true,
      status: 400,
      code: "http_400",
    });
    expect(await service.create(scope, input)).toMatchObject({
      ok: true,
      data: { state: "rejected" },
    });
    expect(await service.create(scope, input)).toMatchObject({
      ok: true,
      data: { state: "rejected" },
    });
    expect(provider.create).toHaveBeenCalledTimes(1);
    expect(await service.create(scope, { ...input, requestId: secondId })).toMatchObject({
      ok: true,
      data: { state: "confirmed" },
    });
    expect(provider.slots).toHaveBeenCalledTimes(2);
  });
  it("an existing unacked dispatch is never reclaimed, even after write is disabled", async () => {
    const { service, provider, store } = setup();
    store.rows.set(requestId, seeded());
    expect(await service.create({ ...scope, canBook: false }, input)).toMatchObject({
      ok: true,
      data: { state: "pending" },
    });
    expect(provider.create).not.toHaveBeenCalled();
    expect(provider.contact).not.toHaveBeenCalled();
  });
  it("retries only an idempotent ledger acknowledgement; never the provider POST", async () => {
    const { provider, store } = setup();
    const command = store.command.bind(store);
    let first = true;
    store.command = vi.fn(async (s, op, d) => {
      if (op === "ack" && first) {
        first = false;
        throw new Error("db transport");
      }
      return command(s, op, d);
    });
    const service = new ChatBookingService(
      provider,
      store,
      () => now,
      () => dispatchId,
    );
    expect(await service.create(scope, input)).toMatchObject({
      ok: true,
      data: { state: "confirmed" },
    });
    expect(provider.create).toHaveBeenCalledTimes(1);
  });
  it("persists the known ID via finish if both ack responses fail and reconciles on next read", async () => {
    const { provider, store } = setup();
    const command = store.command.bind(store);
    store.command = vi.fn(async (s, op, d) => {
      if (op === "ack") throw new Error("db ack timeout");
      return command(s, op, d);
    });
    const service = new ChatBookingService(
      provider,
      store,
      () => now,
      () => dispatchId,
    );
    expect(await service.create(scope, input)).toMatchObject({
      ok: true,
      data: { state: "unknown", appointmentId: "event" },
    });
    expect(store.rows.get(requestId)?.appointmentId).toBe("event");
    expect(await service.read(scope, readInput)).toMatchObject({
      ok: true,
      data: { state: "confirmed", appointmentId: "event" },
    });
    expect(provider.create).toHaveBeenCalledTimes(1);
  });
  it("tombstones a missing request before a late claim and only then allows a new request ID", async () => {
    const { service, provider } = setup();
    expect(await service.read(scope, readInput)).toMatchObject({ ok: false, code: "not_found" });
    expect(await service.abandon(scope, readInput)).toEqual({
      ok: true,
      data: { abandoned: true },
    });
    expect(await service.abandon(scope, readInput)).toEqual({
      ok: true,
      data: { abandoned: true },
    });
    expect(await service.create(scope, input)).toMatchObject({
      ok: false,
      code: "request_abandoned",
    });
    expect(provider.create).not.toHaveBeenCalled();
    expect(await service.create(scope, { ...input, requestId: secondId })).toMatchObject({
      ok: true,
      data: { state: "confirmed" },
    });
  });
  it("cannot abandon a dispatch that won the race and keeps its unresolved receipt", async () => {
    const { service, provider, store } = setup();
    store.rows.set(requestId, seeded());
    expect(await service.abandon(scope, readInput)).toMatchObject({
      ok: true,
      data: { abandoned: false, receipt: { state: "pending" } },
    });
    expect(await service.create(scope, input)).toMatchObject({
      ok: true,
      data: { state: "pending" },
    });
    expect(provider.create).not.toHaveBeenCalled();
    expect(await service.abandon(scope, { ...readInput, organizationId: secondId })).toMatchObject({
      ok: false,
      code: "forbidden",
    });
  });
  it("preserves a known ID in the uncertain receipt when both acknowledgement and finish fail", async () => {
    const { provider, store } = setup();
    const command = store.command.bind(store);
    store.command = vi.fn(async (s, op, d) => {
      if (op === "ack" || op === "finish") throw new Error("db down");
      return command(s, op, d);
    });
    const service = new ChatBookingService(
      provider,
      store,
      () => now,
      () => dispatchId,
    );
    expect(await service.create(scope, input)).toMatchObject({
      ok: true,
      data: { state: "unknown", appointmentId: "event" },
    });
    expect(provider.create).toHaveBeenCalledTimes(1);
    expect(provider.event).not.toHaveBeenCalled();
  });
});

describe("GHL v3 adapter and server-only ledger boundary", () => {
  it("sends exact v3 headers and payload once, without changing the global legacy version", async () => {
    const transport = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify(event), { status: 201 }),
    );
    const provider = new ChatBookingGhl("synthetic-secret", "location", transport);
    const body = {
      calendarId: "calendar",
      locationId: "location",
      contactId: "patient",
      startTime: input.startAt,
      endTime: input.endAt,
      appointmentStatus: "new" as const,
      toNotify: false,
      ignoreFreeSlotValidation: false as const,
      ignoreDateRange: false as const,
    };
    await provider.create(body);
    expect(transport).toHaveBeenCalledOnce();
    expect(String(transport.mock.calls[0]![0])).toBe(
      "https://services.leadconnectorhq.com/calendars/events/appointments",
    );
    expect(transport.mock.calls[0]![1]).toMatchObject({
      method: "POST",
      headers: { Version: "v3" },
      redirect: "manual",
      body: JSON.stringify(body),
    });
  });
  it.each([400, 401, 403, 404, 409, 422, 429, 408, 500, 503, 302])(
    "classifies %i and never retries a create",
    async (status) => {
      const transport = vi.fn(async () => new Response("opaque", { status }));
      const provider = new ChatBookingGhl("synthetic", "location", transport);
      const result = await provider.create({
        calendarId: "calendar",
        locationId: "location",
        contactId: "patient",
        startTime: input.startAt,
        endTime: input.endAt,
        appointmentStatus: "new",
        toNotify: false,
        ignoreFreeSlotValidation: false as const,
        ignoreDateRange: false as const,
      });
      expect(result).toMatchObject({
        ok: false,
        definitive: [400, 401, 403, 404, 409, 422, 429].includes(status),
        status,
      });
      expect(transport).toHaveBeenCalledOnce();
    },
  );
  it("treats invalid JSON on successful HTTP as uncertain", async () => {
    const provider = new ChatBookingGhl(
      "synthetic",
      "location",
      async () => new Response("not-json", { status: 200 }),
    );
    expect(
      await provider.create({
        calendarId: "calendar",
        locationId: "location",
        contactId: "patient",
        startTime: input.startAt,
        endTime: input.endAt,
        appointmentStatus: "new",
        toNotify: false,
        ignoreFreeSlotValidation: false as const,
        ignoreDateRange: false as const,
      }),
    ).toMatchObject({ ok: false, definitive: false });
  });
  it("maps missing migration and rejects foreign ledger snapshots", async () => {
    const absent = new ChatBookingRpcStore({
      rpc: async () => ({ data: null, error: { code: "PGRST202" } }),
    });
    await expect(absent.command(scope, "read", readInput)).rejects.toMatchObject({
      code: "migration_required",
    });
    const rpc = vi.fn(async () => ({
      data: { request: { ...seeded(), contactId: secondId } },
      error: null,
    }));
    await expect(
      new ChatBookingRpcStore({ rpc }).command(scope, "read", {
        requestId,
        ghlContactId: "patient",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(rpc).toHaveBeenCalledWith("chat_booking_command", {
      _op: "read",
      _org: org,
      _actor: actor,
      _data: { requestId, ghlContactId: "patient" },
    });
  });
});

describe("booking session authorization", () => {
  it("requests only authorized roles and rejects denied access before contact or token reads", async () => {
    const resolve = vi
      .spyOn(accessModule, "resolverAcesso")
      .mockResolvedValue({ ok: false, code: "forbidden", message: "denied" });
    const from = vi.fn();
    const context = { supabase: { from } as unknown as SupabaseClient, userId: actor };
    try {
      expect(await authenticatedChatBooking(context, input)).toMatchObject({
        failure: { ok: false, code: "forbidden" },
      });
      expect(resolve).toHaveBeenCalledWith(context, ["administrador", "gestor", "comercial"]);
      expect(from).not.toHaveBeenCalled();
    } finally {
      resolve.mockRestore();
    }
  });
  it("never treats client organization ID as the session's tenant", async () => {
    const resolve = vi.spyOn(accessModule, "resolverAcesso").mockResolvedValue({
      ok: true,
      acesso: {
        orgId: secondId,
        nome: null,
        papeis: ["administrador"],
        locationId: "location",
        conn: {},
      },
    });
    const from = vi.fn();
    try {
      expect(
        await authenticatedChatBooking(
          { supabase: { from } as unknown as SupabaseClient, userId: actor },
          input,
        ),
      ).toMatchObject({ failure: { ok: false, code: "forbidden" } });
      expect(from).not.toHaveBeenCalled();
    } finally {
      resolve.mockRestore();
    }
  });
  it("requires one local non-demo contact in the session tenant and refuses duplicates", async () => {
    const resolve = vi.spyOn(accessModule, "resolverAcesso").mockResolvedValue({
      ok: true,
      acesso: { orgId: org, nome: null, papeis: ["comercial"], locationId: "location", conn: {} },
    });
    const contacts = {
      select: vi.fn(),
      eq: vi.fn(),
      limit: vi.fn(async () => ({ data: [{ id: contact }, { id: secondId }], error: null })),
    };
    contacts.select.mockReturnValue(contacts);
    contacts.eq.mockReturnValue(contacts);
    const organization = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn(async () => ({ data: { timezone: "Europe/Lisbon" }, error: null })),
    };
    organization.select.mockReturnValue(organization);
    organization.eq.mockReturnValue(organization);
    const from = vi.fn((table: string) => (table === "contacts" ? contacts : organization));
    try {
      expect(
        await authenticatedChatBooking(
          { supabase: { from } as unknown as SupabaseClient, userId: actor },
          input,
        ),
      ).toMatchObject({ failure: { ok: false, code: "contact_not_found" } });
      expect(contacts.eq.mock.calls).toEqual([
        ["organization_id", org],
        ["ghl_contact_id", "patient"],
        ["is_demo", false],
      ]);
    } finally {
      resolve.mockRestore();
    }
  });
});
