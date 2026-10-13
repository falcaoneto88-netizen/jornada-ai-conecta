import { describe, expect, it, vi } from "vitest";
import {
  attendanceCivilToUtc,
  attendanceSaveSchema,
  type AttendanceContext,
  type AttendanceSaveInput,
} from "./attendance-context.core";
import {
  AttendanceContextService,
  authenticatedAttendanceContext,
} from "./attendance-context.server";
import type { SupabaseClient } from "@supabase/supabase-js";

const org = "11111111-1111-4111-8111-111111111111",
  actor = "22222222-2222-4222-8222-222222222222";
const scope = { organizationId: org, ghlContactId: "contact-fictional", actorId: actor };
const input: AttendanceSaveInput = {
  organizationId: org,
  ghlContactId: scope.ghlContactId,
  expectedTimezone: "Europe/Lisbon",
  expectedVersion: 0,
  ownerId: actor,
  returnAction: "set",
  returnText: "Retornar ligação",
  dueLocal: "2026-10-13T14:00",
};
const context: AttendanceContext = {
  organizationId: org,
  timezone: "Europe/Lisbon",
  canEdit: true,
  checkedAt: "2026-10-13T12:00:00Z",
  contact: {
    id: actor,
    ghlContactId: scope.ghlContactId,
    name: "Contato fictício",
    phone: null,
    email: null,
    updatedAt: "2026-10-13T12:00:00Z",
  },
  stage: null,
  nextAppointment: null,
  team: [{ id: actor, name: "Operador" }],
  attendance: { version: 0, ownerId: null, nextAction: null, nextActionAt: null },
};

describe("civil return deadlines", () => {
  it.each([
    ["2026-10-13T14:00", "Europe/Lisbon", "2026-10-13T13:00:00.000Z"],
    ["2026-12-13T14:00", "Europe/Lisbon", "2026-12-13T14:00:00.000Z"],
    ["2026-10-13T14:00", "America/Bahia", "2026-10-13T17:00:00.000Z"],
    ["2026-10-13T14:00", "Asia/Kathmandu", "2026-10-13T08:15:00.000Z"],
    ["2028-02-29T00:00", "Europe/Lisbon", "2028-02-29T00:00:00.000Z"],
  ])("converts %s in %s explicitly", (civil, zone, expected) => {
    expect(attendanceCivilToUtc(civil, zone)).toEqual({ ok: true, data: expected });
  });
  it.each([
    "2026-02-29T12:00",
    "2026-04-31T00:00",
    "2026-12-13T24:00",
    "2026-13-01T00:00",
    "2026-03-29T01:30",
    "2026-10-13T14:00Z",
    "2026-01-01T12:60",
  ])("rejects invalid local time %s", (civil) => {
    expect(attendanceCivilToUtc(civil, "Europe/Lisbon")).toMatchObject({
      ok: false,
      code: "invalid_datetime",
    });
  });
  it("rejects repeated DST time and invalid organization zone", () => {
    expect(attendanceCivilToUtc("2026-10-25T01:30", "Europe/Lisbon")).toMatchObject({
      ok: false,
      code: "ambiguous_datetime",
    });
    expect(attendanceCivilToUtc("2026-10-25T14:30", "invalid/zone")).toMatchObject({
      ok: false,
      code: "invalid_datetime",
    });
  });
});

it("requires exact scope/CAS, rejects timezone/actor injection and requires a bounded return", () => {
  expect(attendanceSaveSchema.safeParse(input).success).toBe(true);
  for (const patch of [
    { timezone: "UTC" },
    { actorId: actor },
    { expectedVersion: -1 },
    { dueLocal: undefined },
    { returnText: " " },
    { returnText: "x".repeat(501) },
    { returnAction: "complete" },
  ])
    expect(attendanceSaveSchema.safeParse({ ...input, ...patch }).success).toBe(false);
});

it("reads then saves a UTC deadline in server-sourced organization zone", async () => {
  const rpc = vi.fn().mockResolvedValue({ data: context, error: null });
  const result = await new AttendanceContextService({ rpc }).save(scope, input);
  expect(result.ok).toBe(true);
  expect(rpc).toHaveBeenNthCalledWith(
    2,
    "attendance_context_command",
    expect.objectContaining({
      _org: org,
      _actor: actor,
      _contact: scope.ghlContactId,
      _data: expect.objectContaining({
        dueAt: "2026-10-13T13:00:00.000Z",
        timezone: "Europe/Lisbon",
        expectedVersion: 0,
      }),
    }),
  );
});

it("does not issue a save on invalid or ambiguous time, read-only role, or mismatched scope", async () => {
  const rpc = vi.fn().mockResolvedValue({ data: context, error: null });
  const service = new AttendanceContextService({ rpc });
  expect(await service.save(scope, { ...input, dueLocal: "2026-10-25T01:30" })).toMatchObject({
    ok: false,
    code: "ambiguous_datetime",
  });
  expect(rpc).toHaveBeenCalledTimes(1);
  rpc.mockClear().mockResolvedValue({ data: { ...context, canEdit: false }, error: null });
  expect(await service.save(scope, input)).toMatchObject({ ok: false, code: "forbidden" });
  expect(rpc).toHaveBeenCalledTimes(1);
  rpc.mockClear();
  expect(await service.save(scope, { ...input, ghlContactId: "another" })).toMatchObject({
    ok: false,
    code: "forbidden",
  });
  expect(rpc).not.toHaveBeenCalled();
});

it("rejects a changed organization timezone before converting the reviewed civil deadline", async () => {
  const rpc = vi
    .fn()
    .mockResolvedValue({ data: { ...context, timezone: "America/Bahia" }, error: null });
  expect(await new AttendanceContextService({ rpc }).save(scope, input)).toMatchObject({
    ok: false,
    code: "conflict",
  });
  expect(rpc).toHaveBeenCalledTimes(1);
});

it("keeps owner-only changes distinct from set/completion without synthesizing deadlines", async () => {
  const rpc = vi.fn().mockResolvedValue({ data: context, error: null });
  const { returnText: _text, dueLocal: _date, ...ownerOnly } = input;
  await new AttendanceContextService({ rpc }).save(scope, { ...ownerOnly, returnAction: "keep" });
  expect(rpc.mock.calls[1]?.[1]._data).toMatchObject({
    returnAction: "keep",
    dueAt: null,
    returnText: null,
  });
});

it("returns fail-closed and sanitized errors for missing migration, conflicts and malformed RPC data", async () => {
  const rpc = vi
    .fn()
    .mockResolvedValue({ data: null, error: { code: "PGRST202", message: "secret token" } });
  const service = new AttendanceContextService({ rpc });
  expect(await service.read(scope)).toMatchObject({ ok: false, code: "migration_required" });
  rpc.mockResolvedValue({ data: { error: "conflict" }, error: null });
  expect(await service.read(scope)).toMatchObject({ ok: false, code: "conflict" });
  rpc.mockResolvedValue({
    data: { ...context, contact: { ...context.contact, ghlContactId: "wrong" } },
    error: null,
  });
  expect(await service.read(scope)).toMatchObject({ ok: false, code: "unavailable" });
  rpc.mockRejectedValue(new Error("secret token"));
  expect(JSON.stringify(await service.read(scope))).not.toContain("secret token");
});

it("derives tenant from session profile and refuses the client-selected tenant before admin access", async () => {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: { organization_id: actor }, error: null }),
  };
  const supabase = { from: vi.fn(() => query) } as unknown as SupabaseClient;
  expect(await authenticatedAttendanceContext({ supabase, userId: actor }, scope)).toMatchObject({
    failure: { ok: false, code: "forbidden" },
  });
  expect(query.eq).toHaveBeenCalledWith("id", actor);
});
