import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { guardarPoliticaBridge, lerEstadoPolitica } from "./n8n-bridge-runtime.admin.server";
import { lerEstadoPonte, type Sessao } from "./n8n-bridge.admin.server";
import type { ClienteBridge } from "./n8n-bridge.server";

const ORG = "11111111-1111-4111-8111-111111111111",
  OTHER = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333",
  LOC = "location01";
const NOW = Date.parse("2026-11-16T12:00:00Z");
const input = {
  mode: "production",
  expectedRevision: 0,
  allowedKinds: ["booking", "req24", "req12"],
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
        channel: "whatsapp_zaptos",
        zaptos_provider_id: "provider01",
        clinic_address: "Morada sintética",
        simulation: true,
        live_send_enabled: false,
        channel_verified: false,
      },
    ],
    n8n_bridge_runtime_policies: [],
    n8n_bridge_credentials: [{ organization_id: ORG, key_sha256: "a".repeat(64) }],
  };
  let errorTable: string | null = null;
  const rpc = vi.fn(async (_fn: string, args: Record<string, unknown>) => ({
    data: { revision: Number(args["_expected_revision"]) + 1 } as unknown,
    error: null as unknown,
  }));
  const mutation = vi.fn(async () => {
    throw new Error("nontransactional mutation prohibited");
  });
  const db: ClienteBridge = {
    rpc: rpc as ClienteBridge["rpc"],
    from: (table) => ({
      select: (columns) => {
        const filters: [string, unknown][] = [];
        const q = {
          eq: (key: string, value: unknown) => {
            filters.push([key, value]);
            return q;
          },
          maybeSingle: async () => {
            const row = rows[table]?.find((r) => filters.every(([key, value]) => r[key] === value));
            return {
              data: row
                ? Object.fromEntries(
                    columns
                      .split(",")
                      .filter((k) => k in row)
                      .map((k) => [k, row[k]]),
                  )
                : null,
              error: errorTable === table ? { code: "synthetic" } : null,
            };
          },
        };
        return q;
      },
      upsert: mutation,
      insert: mutation,
    }),
  };
  const user = { id: USER },
    profile = { organization_id: ORG };
  const role = vi.fn(async () => ({ data: true, error: null }));
  const ctx: Sessao = {
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
  const channels = {
    conversationChannel: {
      defaults: { SMS: "provider01" },
      SMS: [{ conversationProvider: { _id: "provider01", name: "ZaptosWPP", type: "SMS" } }],
    },
  };
  const calendars = { calendars: [{ id: "calendar01", locationId: LOC }] };
  const fetch = vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method !== "GET") throw new Error("unexpected external mutation");
    return Response.json(url.includes("conversationChannels") ? channels : calendars);
  });
  vi.stubGlobal("fetch", fetch);
  return {
    db,
    ctx,
    rows,
    rpc,
    mutation,
    user,
    profile,
    role,
    channels,
    calendars,
    fetch,
    fail: (table: string) => {
      errorTable = table;
    },
    run: (value: unknown = input, h = headers()) =>
      guardarPoliticaBridge(ctx, h, value, db, () => NOW),
  };
}
beforeEach(() => {
  vi.stubEnv("GHL_PRIVATE_TOKEN", "synthetic-runtime-admin-token");
  vi.stubEnv("GHL_LOCATION_ID", LOC);
  vi.stubEnv("JORNADA_AI_ORGANIZATION_ID", ORG);
  vi.stubEnv("N8N_JORNADA_BRIDGE_TOKEN", "b".repeat(64));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("runtime authority admin contract", () => {
  it("verifies only authenticated GHL reads then delegates flags, policy and audit to one CAS transaction", async () => {
    const f = fixture();
    expect(await f.run()).toEqual({ ok: true, revision: 1 });
    expect(f.fetch).toHaveBeenCalledTimes(2);
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith("n8n_bridge_set_runtime_policy", {
      _actor: USER,
      _mode: "production",
      _expected_revision: 0,
      _allowed_kinds: input.allowedKinds,
      _location: LOC,
      _calendar: "calendar01",
      _provider: "provider01",
      _verified_at: "2026-11-16T12:00:00.000Z",
    });
    expect(f.mutation).not.toHaveBeenCalled();
  });
  it.each(["session", "role", "org", "binding"])(
    "denies %s before external reads or writes",
    async (reason) => {
      const f = fixture();
      if (reason === "session") f.user.id = "wrong-user";
      if (reason === "role") f.role.mockResolvedValue({ data: false, error: null });
      if (reason === "org") f.profile.organization_id = OTHER;
      if (reason === "binding") f.rows["ghl_location_bindings"] = [];
      expect(await f.run()).toMatchObject({ ok: false, code: "forbidden" });
      expect(f.rpc).not.toHaveBeenCalled();
      expect(f.fetch).not.toHaveBeenCalled();
    },
  );
  it.each([
    new Headers(),
    new Headers({ origin: "https://evil.test" }),
    new Headers({
      origin: "https://jornada-ai-conecta.lovable.app",
      "sec-fetch-site": "cross-site",
    }),
  ])("requires exact trusted Origin", async (h) => {
    const f = fixture();
    expect(await f.run(input, h)).toMatchObject({ code: "untrusted_origin" });
    expect(f.rpc).not.toHaveBeenCalled();
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it.each([
    { organizationId: OTHER },
    { locationId: LOC },
    { channelVerified: true },
    { mode: "live" },
    { expectedRevision: -1 },
    { expectedRevision: 0.5 },
    { allowedKinds: [] },
    { allowedKinds: ["booking", "booking"] },
    { allowedKinds: ["handoff"] },
    { allowedKinds: ["confirm"] },
    { allowedKinds: ["appointment.confirm"] },
  ])("rejects unsafe caller contract %#", async (change) => {
    const f = fixture();
    expect(await f.run({ ...input, ...change })).toMatchObject({ code: "invalid_request" });
    expect(f.rpc).not.toHaveBeenCalled();
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it("rejects an outdated form before GHL reads", async () => {
    const f = fixture();
    expect(await f.run({ ...input, expectedRevision: 1 })).toMatchObject({
      code: "revision_conflict",
    });
    expect(f.rpc).not.toHaveBeenCalled();
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it.each(["default", "provider", "name", "type"])(
    "rejects unproved channel %s",
    async (reason) => {
      const f = fixture();
      if (reason === "default") f.channels.conversationChannel.defaults.SMS = "other001";
      if (reason === "provider")
        f.channels.conversationChannel.SMS[0]!.conversationProvider._id = "other001";
      if (reason === "name")
        f.channels.conversationChannel.SMS[0]!.conversationProvider.name = "Other";
      if (reason === "type")
        f.channels.conversationChannel.SMS[0]!.conversationProvider.type = "Email";
      expect(await f.run()).toMatchObject({ code: "channel_not_verified" });
      expect(f.rpc).not.toHaveBeenCalled();
    },
  );
  it.each(["id", "location", "duplicate"])("rejects unproved calendar %s", async (reason) => {
    const f = fixture();
    if (reason === "id") f.calendars.calendars[0]!.id = "other001";
    if (reason === "location") f.calendars.calendars[0]!.locationId = "other001";
    if (reason === "duplicate") f.calendars.calendars.push(f.calendars.calendars[0]!);
    expect(await f.run()).toMatchObject({ code: "calendar_not_verified" });
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("cannot activate without a valid bridge key", async () => {
    const f = fixture();
    vi.stubEnv("N8N_JORNADA_BRIDGE_TOKEN", "");
    f.rows["n8n_bridge_credentials"] = [];
    expect(await f.run()).toMatchObject({ code: "credentials_unavailable" });
    expect(f.rpc).not.toHaveBeenCalled();
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it("does not override existing GHL write permission", async () => {
    const f = fixture();
    f.rows["ghl_connections"]![0]!["write_enabled"] = false;
    expect(await f.run()).toMatchObject({ code: "binding_unavailable" });
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("activating booking and reminders does not depend on the pilot-only thanks address", async () => {
    const f = fixture();
    f.rows["n8n_bridge_settings"]![0]!["clinic_address"] = " ";
    expect(await f.run()).toEqual({ ok: true, revision: 1 });
  });
  it("revokes own-org policy without an external API, key, valid binding or active connection", async () => {
    const f = fixture();
    f.rows["ghl_location_bindings"] = [];
    vi.stubEnv("GHL_PRIVATE_TOKEN", "");
    vi.stubEnv("N8N_JORNADA_BRIDGE_TOKEN", "");
    expect(await f.run({ mode: "off", expectedRevision: 0, allowedKinds: [] })).toEqual({
      ok: true,
      revision: 1,
    });
    expect(f.fetch).not.toHaveBeenCalled();
    expect(f.rpc.mock.calls[0]?.[1]).toMatchObject({
      _actor: USER,
      _mode: "off",
      _allowed_kinds: [],
      _location: null,
      _verified_at: null,
    });
  });
  it("switching to pilot creates no grant or credential", async () => {
    const f = fixture();
    expect(await f.run({ mode: "pilot", expectedRevision: 0, allowedKinds: [] })).toEqual({
      ok: true,
      revision: 1,
    });
    expect(f.fetch).not.toHaveBeenCalled();
    expect(f.mutation).not.toHaveBeenCalled();
  });
  it.each([
    "revision_conflict",
    "configuration_changed",
    "binding_unavailable",
    "verification_expired",
  ])("surfaces transactional rejection %s without retry", async (code) => {
    const f = fixture();
    f.rpc.mockResolvedValue({ data: { error: code }, error: null });
    expect(await f.run()).toMatchObject({ code });
    expect(f.rpc).toHaveBeenCalledTimes(1);
  });
  it("does not report activation if persistence/audit failed or outcome is ambiguous", async () => {
    const f = fixture();
    f.rpc.mockResolvedValue({ data: null, error: { code: "audit_failed" } });
    expect(await f.run()).toMatchObject({ code: "persist_failed" });
    expect(f.rpc).toHaveBeenCalledTimes(1);
  });
  it("missing runtime migration is unavailable, never interpreted as a pilot grant", async () => {
    const f = fixture();
    f.fail("n8n_bridge_runtime_policies");
    expect(await f.run()).toMatchObject({ code: "runtime_unavailable" });
    expect(f.rpc).not.toHaveBeenCalled();
  });
});

describe("admin runtime visibility", () => {
  it("no persisted policy preserves legacy pilot revision zero", async () => {
    const f = fixture();
    expect(await lerEstadoPolitica(f.db, ORG)).toMatchObject({
      available: true,
      mode: "pilot",
      revision: 0,
    });
  });
  it("includes runtime in the existing admin card without returning secrets", async () => {
    const f = fixture();
    const state = await lerEstadoPonte(f.ctx, f.db);
    expect(state.runtime).toMatchObject({ available: true, mode: "pilot", revision: 0 });
    expect(JSON.stringify(state)).not.toContain("b".repeat(64));
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it("forbidden sessions cannot read policy", async () => {
    const f = fixture();
    f.role.mockResolvedValue({ data: false, error: null });
    expect((await lerEstadoPonte(f.ctx, f.db)).runtime.available).toBe(false);
  });
});
