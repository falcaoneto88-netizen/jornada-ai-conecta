import { expect, it, vi } from "vitest";
import {
  attendanceWorkspaceInputSchema,
  type AttendanceWorkspace,
} from "./attendance-workspace.core";
import {
  AttendanceWorkspaceService,
  resolveAttendanceConversationsVerified,
} from "./attendance-workspace.server";
import { GHL_ORIGIN, GHL_VERSION, type GhlResult } from "./ghl.server";
const ORG = "11111111-1111-4111-8111-111111111111",
  ACTOR = "22222222-2222-4222-8222-222222222222";
const input = attendanceWorkspaceInputSchema.parse({ organizationId: ORG });
const scope = { organizationId: ORG, actorId: ACTOR };
const fixture: AttendanceWorkspace = {
  organizationId: ORG,
  timezone: "Europe/Lisbon",
  checkedAt: "2026-10-13T12:00:00Z",
  day: { date: "2026-10-13", startAt: "2026-10-12T23:00:00Z", endAt: "2026-10-13T23:00:00Z" },
  source: { kind: "local", coverage: "linked_contacts", lastContactSyncAt: null },
  counts: { awaitingResponse: null, returnsToday: 100, returnsOverdue: 31, appointmentsToday: 20 },
  awaitingResponseUnavailableReason: "message_coverage_unavailable",
  page: { index: 0, size: 25, totalItems: 140, hasMore: true },
  rows: [],
};
it("strict filters default to my local scope and reject actor, time and arbitrary pagination", () => {
  expect(input).toMatchObject({ ownerFilter: "mine", view: "all", page: 0, pageSize: 25 });
  for (const extra of [
    { actorId: ACTOR },
    { timezone: "UTC" },
    { at: "2026-10-13" },
    { page: -1 },
    { pageSize: 100 },
    { ownerFilter: "administrator" },
  ])
    expect(attendanceWorkspaceInputSchema.safeParse({ ...input, ...extra }).success).toBe(false);
});
it("keeps full counts independent of the page, with unavailable replies null rather than zero", async () => {
  const rpc = vi.fn().mockResolvedValue({ data: fixture, error: null });
  expect(await new AttendanceWorkspaceService({ rpc }).read(scope, input)).toEqual({
    ok: true,
    data: fixture,
  });
  expect(rpc).toHaveBeenCalledWith("attendance_workspace_read", {
    _org: ORG,
    _actor: ACTOR,
    _owner: "mine",
    _view: "all",
    _page: 0,
    _size: 25,
  });
});
it("refuses forged org before RPC and returns sanitized migration/unavailable errors", async () => {
  const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: "PGRST202", message: "credential" } }),
    service = new AttendanceWorkspaceService({ rpc });
  expect(await service.read(scope, { ...input, organizationId: ACTOR })).toMatchObject({
    ok: false,
    code: "forbidden",
  });
  expect(rpc).not.toHaveBeenCalled();
  expect(await service.read(scope, input)).toMatchObject({ ok: false, code: "migration_required" });
  rpc.mockResolvedValue({ data: { ...fixture, organizationId: ACTOR }, error: null });
  expect(await service.read(scope, input)).toMatchObject({ ok: false, code: "unavailable" });
  rpc.mockRejectedValue(new Error("credential"));
  expect(JSON.stringify(await service.read(scope, input))).not.toContain("credential");
});
it("fails closed when RPC page or counters do not match the contract", async () => {
  for (const data of [
    { ...fixture, page: { ...fixture.page, index: 1 } },
    { ...fixture, counts: { ...fixture.counts, awaitingResponse: 0 } },
    { ...fixture, rows: [{ id: "bad" }] },
  ]) {
    const rpc = vi.fn().mockResolvedValue({ data, error: null });
    expect(await new AttendanceWorkspaceService({ rpc }).read(scope, input)).toMatchObject({
      ok: false,
      code: "unavailable",
    });
  }
});
const cscope = { organizationId: ORG, ghlContactId: "exact-contact", locationId: "loc-test" };
const config = {
  baseUrl: GHL_ORIGIN,
  version: GHL_VERSION,
  locationId: cscope.locationId,
  token: "test-only",
};
const ok = (data: unknown): GhlResult<unknown> => ({ ok: true, status: 200, data });
const contact = ok({ contact: { id: cscope.ghlContactId, locationId: cscope.locationId } });
const conv = (id = "c1", date: string | null = "2026-10-13T12:00:00Z") => ({
  id,
  contactId: cscope.ghlContactId,
  locationId: cscope.locationId,
  fullName: "Mesmo nome",
  lastMessageType: "TYPE_SMS",
  lastMessageDate: date,
});
it.each([0, 1, 2])("resolves %i exact conversations without fetching histories", async (n) => {
  const get = vi
    .fn()
    .mockResolvedValueOnce(contact)
    .mockResolvedValueOnce(
      ok({ conversations: Array.from({ length: n }, (_, i) => conv(`c${i}`)), total: n }),
    );
  const result = await resolveAttendanceConversationsVerified(cscope, config, get);
  expect(result).toMatchObject({
    ok: true,
    data: { complete: true, resolution: n === 0 ? "none" : n === 1 ? "single" : "multiple" },
  });
  expect(get.mock.calls.map((c) => c[1])).toEqual([
    "contacts/exact-contact",
    "conversations/search",
  ]);
  expect(get.mock.calls[1]?.[2].query).toMatchObject({
    locationId: "loc-test",
    contactId: "exact-contact",
    limit: "25",
  });
});
it("does not search names and fails when contact or any returned conversation is foreign", async () => {
  const get = vi
    .fn()
    .mockResolvedValueOnce(ok({ contact: { id: cscope.ghlContactId, locationId: "foreign" } }));
  expect(await resolveAttendanceConversationsVerified(cscope, config, get)).toMatchObject({
    ok: false,
    code: "contact_not_verified",
  });
  expect(get).toHaveBeenCalledTimes(1);
  get
    .mockReset()
    .mockResolvedValueOnce(contact)
    .mockResolvedValueOnce(
      ok({ conversations: [{ ...conv(), contactId: "same-name-other-person" }] }),
    );
  expect(await resolveAttendanceConversationsVerified(cscope, config, get)).toMatchObject({
    ok: false,
    code: "contact_not_verified",
  });
});
it("does not claim completeness if a timestamp cursor is absent/stuck or provider total is larger", async () => {
  for (const response of [
    { conversations: [conv()] },
    { conversations: Array.from({ length: 25 }, (_, i) => conv(`c${i}`, null)) },
    { conversations: [conv()], total: 3 },
  ]) {
    const get = vi.fn().mockResolvedValueOnce(contact).mockResolvedValueOnce(ok(response));
    expect(await resolveAttendanceConversationsVerified(cscope, config, get)).toMatchObject({
      ok: true,
      data: { complete: false, resolution: "incomplete" },
    });
  }
  const page = { conversations: Array.from({ length: 25 }, (_, i) => conv(`c${i}`)), total: 40 };
  const get = vi.fn().mockResolvedValueOnce(contact).mockResolvedValue(ok(page));
  expect(await resolveAttendanceConversationsVerified(cscope, config, get)).toMatchObject({
    ok: true,
    data: { complete: false, resolution: "incomplete" },
  });
  expect(get).toHaveBeenCalledTimes(3);
});
it("deduplicates across pages and bounds metadata reading to four pages", async () => {
  const get = vi.fn().mockResolvedValueOnce(contact);
  for (let page = 0; page < 4; page++)
    get.mockResolvedValueOnce(
      ok({
        conversations: Array.from({ length: 25 }, (_, i) =>
          conv(`c${page * 25 + i}`, `2026-10-${String(13 - page).padStart(2, "0")}T12:00:00Z`),
        ),
        total: 101,
      }),
    );
  const result = await resolveAttendanceConversationsVerified(cscope, config, get);
  expect(result).toMatchObject({ ok: true, data: { complete: false, resolution: "incomplete" } });
  if (result.ok) expect(result.data.conversations).toHaveLength(100);
  expect(get).toHaveBeenCalledTimes(5);
});
it("fails closed after an interrupted metadata read without returning a false unique match", async () => {
  const get = vi.fn().mockResolvedValueOnce(contact).mockRejectedValueOnce(new Error("token"));
  expect(await resolveAttendanceConversationsVerified(cscope, config, get)).toMatchObject({
    ok: false,
    code: "unavailable",
  });
});
