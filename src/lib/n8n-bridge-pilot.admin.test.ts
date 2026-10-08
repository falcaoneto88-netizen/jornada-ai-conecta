import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { guardarPilotoBridge } from "./n8n-bridge-pilot.admin.server";
import { lerEstadoPonte, type Sessao } from "./n8n-bridge.admin.server";
import type { ClienteBridge } from "./n8n-bridge.server";

const ORG = "11111111-1111-4111-8111-111111111111",
  OTHER = "22222222-2222-4222-8222-222222222222";
const LOC = "location01",
  USER = "33333333-3333-4333-8333-333333333333";
const NOW = Date.parse("2026-10-08T12:00:00Z");
const input = {
  enabled: true,
  contactId: "contact01",
  appointmentId: "appoint01",
  expectedStartTime: "2026-10-09T10:00:00Z",
  expiresAt: "2026-10-08T14:00:00Z",
  allowedKinds: ["booking", "req24", "appointment.confirm", "confirm"],
};
const headers = () =>
  new Headers({
    origin: "https://jornada-ai-conecta.lovable.app",
    "sec-fetch-site": "same-origin",
  });
function fixture() {
  const rows: Record<string, Record<string, unknown>[]> = {
    ghl_location_bindings: [{ organization_id: ORG, location_id: LOC }],
    ghl_connections: [
      { organization_id: ORG, location_id: LOC, status: "conectada", write_enabled: true },
    ],
    n8n_bridge_settings: [
      {
        organization_id: ORG,
        calendar_id: "calendar01",
        simulation: true,
        live_send_enabled: false,
      },
    ],
    n8n_bridge_pilot_grants: [],
  };
  let dbError: string | null = null,
    savedMismatch = false;
  const writes: { table: string; value: Record<string, unknown> }[] = [];
  const db: ClienteBridge = {
    from: (table) => ({
      select: (columns) => {
        const filters: [string, unknown][] = [];
        const q = {
          eq: (key: string, value: unknown) => {
            filters.push([key, value]);
            return q;
          },
          maybeSingle: async () => {
            const row = rows[table]?.find((r) => filters.every(([k, v]) => r[k] === v));
            return {
              data: row
                ? Object.fromEntries(
                    columns
                      .split(",")
                      .filter((c) => c in row)
                      .map((c) => [c, row[c]]),
                  )
                : null,
              error: dbError === table ? { code: "synthetic" } : null,
            };
          },
        };
        return q;
      },
      upsert: async (value) => {
        writes.push({ table, value });
        if (dbError === "upsert") return { data: null, error: { code: "synthetic" } };
        rows[table] = [{ ...value, ...(savedMismatch ? { contact_id: "other001" } : {}) }];
        return { data: null, error: null };
      },
      insert: async () => {
        throw new Error("unexpected insert");
      },
    }),
    rpc: async () => {
      throw new Error("unexpected db rpc");
    },
  };
  const user = { id: USER },
    profile = { organization_id: ORG };
  const role = vi.fn(async () => ({ data: true, error: null }));
  const session: Sessao = {
    userId: USER,
    supabase: {
      auth: { getUser: async () => ({ data: { user }, error: null }) },
      rpc: role,
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: profile, error: null }) }),
        }),
      }),
    },
  };
  const contact = { id: "contact01", locationId: LOC, dnd: false, dndSettings: {} };
  const event = {
    id: "appoint01",
    contactId: "contact01",
    locationId: LOC,
    calendarId: "calendar01",
    startTime: input.expectedStartTime,
    endTime: "2026-10-09T10:30:00Z",
    appointmentStatus: "new",
  };
  const fetch = vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method !== "GET") throw new Error("unexpected GHL write");
    return Response.json(url.includes("/contacts/") ? { contact } : { appointment: event });
  });
  vi.stubGlobal("fetch", fetch);
  return {
    rows,
    writes,
    db,
    session,
    user,
    profile,
    role,
    contact,
    event,
    fetch,
    fail: (table: string) => {
      dbError = table;
    },
    mismatch: () => {
      savedMismatch = true;
    },
    run: (value: unknown = input, h = headers(), clock = () => NOW) =>
      guardarPilotoBridge(session, h, value, db, clock),
  };
}
beforeEach(() => {
  vi.stubEnv("GHL_PRIVATE_TOKEN", "synthetic-pilot-admin-only");
  vi.stubEnv("GHL_LOCATION_ID", LOC);
  vi.stubEnv("JORNADA_AI_ORGANIZATION_ID", ORG);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("administrative pilot setup", () => {
  it("persists only the verified scoped grant; no flag, credential, CRM mutation", async () => {
    const f = fixture();
    expect(await f.run()).toEqual({ ok: true });
    expect(f.role).toHaveBeenCalledWith("tem_papel", { _papeis: ["administrador"] });
    expect(f.writes).toHaveLength(1);
    expect(f.writes[0]).toMatchObject({
      table: "n8n_bridge_pilot_grants",
      value: {
        organization_id: ORG,
        contact_id: "contact01",
        ghl_appointment_id: "appoint01",
        enabled: true,
        updated_by: USER,
      },
    });
    expect(f.fetch).toHaveBeenCalledTimes(2);
    expect(f.rows["n8n_bridge_settings"]?.[0]).toMatchObject({
      simulation: true,
      live_send_enabled: false,
    });
  });
  it.each(["role", "session", "org", "binding"])(
    "denies unauthorized %s before external reads/write",
    async (reason) => {
      const f = fixture();
      if (reason === "role") f.role.mockResolvedValue({ data: false, error: null });
      if (reason === "session") f.user.id = "different-user";
      if (reason === "org") f.profile.organization_id = OTHER;
      if (reason === "binding") f.rows["ghl_location_bindings"] = [];
      expect(await f.run()).toEqual({ ok: false, code: "forbidden" });
      expect(f.fetch).not.toHaveBeenCalled();
      expect(f.writes).toHaveLength(0);
    },
  );
  it.each([
    new Headers(),
    new Headers({ origin: "https://evil.test" }),
    new Headers({
      origin: "https://jornada-ai-conecta.lovable.app",
      "sec-fetch-site": "cross-site",
    }),
  ])("rejects missing/foreign origin", async (h) => {
    const f = fixture();
    expect(await f.run(input, h)).toEqual({ ok: false, code: "untrusted_origin" });
    expect(f.writes).toHaveLength(0);
  });
  it.each([
    { organizationId: OTHER },
    { locationId: "other001" },
    { liveSendEnabled: true },
    { allowedKinds: [] },
    { allowedKinds: ["booking", "booking"] },
    { allowedKinds: ["handoff"] },
    { expectedStartTime: "2026-10-09T10:00:00" },
  ])("rejects caller authority or malformed contract %#", async (change) => {
    const f = fixture();
    expect(await f.run({ ...input, ...change })).toEqual({ ok: false, code: "invalid_request" });
    expect(f.fetch).not.toHaveBeenCalled();
    expect(f.writes).toHaveLength(0);
  });
  it.each([
    "2026-10-08T12:00:00Z",
    "2026-10-08T11:59:59Z",
    "2026-10-09T13:00:00Z",
    "2026-10-09T10:00:01Z",
  ])("denies invalid expiry %s", async (expiresAt) => {
    const f = fixture();
    expect(await f.run({ ...input, expiresAt })).toMatchObject({ code: "invalid_window" });
    expect(f.writes).toHaveLength(0);
  });
  it.each([{ id: "other001" }, { locationId: "other001" }])(
    "verifies contact identity/location %#",
    async (change) => {
      const f = fixture();
      Object.assign(f.contact, change);
      expect(await f.run()).toMatchObject({ code: "contact_not_verified" });
      expect(f.writes).toHaveLength(0);
    },
  );
  it.each([
    { id: "other001" },
    { locationId: "other001" },
    { contactId: "other001" },
    { calendarId: "other001" },
    { startTime: "2026-10-09T11:00:00Z" },
    { appointmentStatus: "cancelled" },
  ])("verifies appointment tuple %#", async (change) => {
    const f = fixture();
    Object.assign(f.event, change);
    expect(await f.run()).toMatchObject({ code: "appointment_not_verified" });
    expect(f.writes).toHaveLength(0);
  });
  it("revokes without contacting GHL or altering flags", async () => {
    const f = fixture();
    expect(await f.run()).toEqual({ ok: true });
    f.fetch.mockClear();
    expect(await f.run({ enabled: false })).toEqual({ ok: true });
    expect(f.fetch).not.toHaveBeenCalled();
    expect(f.writes[1]?.value["enabled"]).toBe(false);
  });
  it("revoke without a row stays off without writing", async () => {
    const f = fixture();
    expect(await f.run({ enabled: false })).toEqual({ ok: true });
    expect(f.writes).toHaveLength(0);
  });
  it.each(["n8n_bridge_pilot_grants", "upsert"])(
    "persistence failure %s cannot report success",
    async (table) => {
      const f = fixture();
      f.fail(table);
      expect((await f.run()).ok).toBe(false);
    },
  );
  it("readback mismatch cannot report success", async () => {
    const f = fixture();
    f.mismatch();
    expect(await f.run()).toEqual({ ok: false, code: "persist_failed" });
  });
  it("expiry while verifying is rejected before upsert", async () => {
    const f = fixture();
    const clock = vi
      .fn()
      .mockReturnValueOnce(NOW)
      .mockReturnValueOnce(NOW)
      .mockReturnValue(Date.parse(input.expiresAt));
    expect(await f.run(input, headers(), clock)).toMatchObject({ code: "invalid_window" });
    expect(f.writes).toHaveLength(0);
  });
});

describe("authenticated pilot state for existing integration card", () => {
  it("reads the persisted grant through the admin session without credentials or GHL effects", async () => {
    const f = fixture();
    await f.run();
    f.fetch.mockClear();
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const state = await lerEstadoPonte(f.session, f.db);
    expect(state).toMatchObject({
      autorizado: true,
      simulation: true,
      liveSendEnabled: false,
      pilot: {
        status: "active",
        contactId: "contact01",
        appointmentId: "appoint01",
        expectedStartTime: "2026-10-09T10:00:00.000Z",
      },
    });
    expect(state.pilotCheckedAt).toEqual(expect.any(String));
    expect(state).not.toHaveProperty("token");
    expect(state).not.toHaveProperty("updated_by");
    expect(f.fetch).not.toHaveBeenCalled();
    expect(f.writes).toHaveLength(1);
  });
  it("returns off for no grant and unavailable for failed grant read", async () => {
    const f = fixture();
    expect((await lerEstadoPonte(f.session, f.db)).pilot.status).toBe("off");
    f.fail("n8n_bridge_pilot_grants");
    expect((await lerEstadoPonte(f.session, f.db)).pilot.status).toBe("unavailable");
  });
  it("does not reveal an existing grant to a non-admin or a mismatched org", async () => {
    const f = fixture();
    await f.run();
    f.role.mockResolvedValue({ data: false, error: null });
    expect(await lerEstadoPonte(f.session, f.db)).toMatchObject({
      autorizado: false,
      pilot: { contactId: null, appointmentId: null },
    });
    f.role.mockResolvedValue({ data: true, error: null });
    f.profile.organization_id = OTHER;
    expect(await lerEstadoPonte(f.session, f.db)).toMatchObject({
      bindingOk: false,
      pilot: { status: "unavailable", contactId: null },
    });
  });
});
