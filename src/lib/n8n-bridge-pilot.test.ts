import { describe, expect, it, vi } from "vitest";
import { autorizarPiloto, estadoPiloto, type PilotGrant, type PilotRead } from "./n8n-bridge-pilot";
import { CONFIG_PADRAO, processarBridge, type DepsBridge, type Reserva } from "./n8n-bridge.core";
import { lerPilotoBridge, type ClienteBridge } from "./n8n-bridge.server";

const NOW = Date.parse("2026-10-08T12:00:00Z"),
  START = "2026-10-09T10:00:00.000Z";
const ORG = "org01",
  LOC = "location01",
  TOKEN = "synthetic-pilot-token-32-characters-only";
const grant = (): PilotGrant => ({
  organization_id: ORG,
  enabled: true,
  contact_id: "contact01",
  ghl_appointment_id: "appoint01",
  start_time: START,
  expires_at: "2026-10-08T14:00:00.000Z",
  allowed_kinds: ["booking", "req24", "appointment.confirm", "confirm"],
});
const target = {
  contactId: "contact01",
  appointmentId: "appoint01",
  startTime: START,
  kind: "booking",
};
function fixture() {
  const row = grant();
  let clock = NOW;
  const cfg = {
    ...CONFIG_PADRAO,
    bridgeEnabled: true,
    liveSendEnabled: true,
    simulation: false,
    calendarId: "calendar01",
    channel: "whatsapp_zaptos" as const,
    channelVerified: true,
    zaptosProviderId: "provider01",
    clinicAddress: "Rua de teste",
  };
  const event = {
    id: "appoint01",
    contactId: "contact01",
    locationId: LOC,
    calendarId: "calendar01",
    startTime: START,
    endTime: "2026-10-09T10:30:00Z",
    appointmentStatus: "new",
  };
  const read = vi.fn(async (): Promise<PilotRead> => ({ ok: true, data: row }));
  const send = vi.fn(async () => ({ ok: true as const, messageId: "message01" }));
  const claim = vi.fn(async (): Promise<Reserva> => ({ reserved: true, id: "reserve01" }));
  const finish = vi.fn(async () => true);
  const deps: DepsBridge = {
    token: TOKEN,
    now: () => clock,
    lerPiloto: read,
    resolver: async () => ({
      orgId: ORG,
      locationId: LOC,
      writeEnabled: true,
      integracaoConectada: true,
    }),
    lerConfig: async () => ({ ok: true, cfg }),
    hit: async () => true,
    contacto: async () => ({
      ok: true,
      data: {
        total: 1,
        contacts: [
          { id: "contact01", locationId: LOC, dnd: false, dndSettings: {}, phone: "+351910000000" },
        ],
      },
    }),
    consulta: async () => ({ ok: true, data: { appointment: event } }),
    utilizadorNaLocation: async () => true,
    enviar: send,
    claim,
    finish,
  };
  const run = async (
    body: unknown = {
      op: "message.send",
      contactId: target.contactId,
      appointmentId: target.appointmentId,
      expectedStartTime: START,
      kind: "booking",
    },
    token = TOKEN,
  ) => {
    const r = await processarBridge(
      new Request("https://example.test/bridge", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      }),
      deps,
    );
    return { status: r.status, body: await r.json() };
  };
  return {
    row,
    cfg,
    event,
    read,
    send,
    claim,
    finish,
    deps,
    run,
    clock: (time: number) => {
      clock = time;
    },
  };
}

describe("pilot authority", () => {
  it("reads the authenticated org and accepts exactly the approved tuple", async () => {
    const f = fixture();
    expect(await autorizarPiloto(f.deps, ORG, target)).toEqual({ ok: true });
    expect(f.read).toHaveBeenCalledExactlyOnceWith(ORG);
  });
  it("same instant with an explicit offset is equivalent", async () => {
    const f = fixture();
    expect(
      await autorizarPiloto(f.deps, ORG, { ...target, startTime: "2026-10-09T11:00:00+01:00" }),
    ).toEqual({ ok: true });
  });
  it.each([
    { contactId: "contact02" },
    { appointmentId: "appoint02" },
    { startTime: "2026-10-09T10:01:00Z" },
    { startTime: "2026-10-09T10:00:00" },
    { kind: "req12" },
    { kind: "handoff" },
    { kind: "escalation" },
  ])("denies an unapproved target %#", async (change) => {
    expect(await autorizarPiloto(fixture().deps, ORG, { ...target, ...change })).toMatchObject({
      code: "pilot_not_authorized",
      status: 403,
    });
  });
  it("a different organization cannot use the same exact IDs", async () => {
    expect(await autorizarPiloto(fixture().deps, "otherorg", target)).toMatchObject({
      code: "pilot_unavailable",
    });
  });
  it.each([
    false,
    null,
    [],
    { ...grant(), allowed_kinds: ["booking", "booking"] },
    { ...grant(), enabled: "true" },
    { ...grant(), expires_at: "tomorrow" },
    { ...grant(), allowed_kinds: ["handoff"] },
    { ...grant(), unexpected: true },
  ])("does not infer authority from malformed data %#", async (data) => {
    const f = fixture();
    f.read.mockResolvedValue({ ok: true, data });
    expect((await autorizarPiloto(f.deps, ORG, target)).ok).toBe(false);
  });
  it("no grant and disabled/empty grants are off, not broad authority", async () => {
    const f = fixture();
    f.read.mockResolvedValueOnce({ ok: true, data: null });
    expect(await estadoPiloto(f.deps, ORG)).toMatchObject({
      status: "off",
      contactId: null,
      allowedKinds: [],
    });
    f.row.enabled = false;
    expect((await estadoPiloto(f.deps, ORG)).status).toBe("off");
    f.row.enabled = true;
    f.row.allowed_kinds = [];
    expect((await estadoPiloto(f.deps, ORG)).status).toBe("off");
  });
  it.each(["equal-expiry", "past-expiry", "past-start"])(
    "strict server clock denies %s",
    async (mode) => {
      const f = fixture();
      f.clock(
        mode === "past-start"
          ? Date.parse(START)
          : Date.parse(f.row.expires_at) + (mode === "past-expiry" ? 1 : 0),
      );
      expect(await autorizarPiloto(f.deps, ORG, target)).toMatchObject({ code: "pilot_expired" });
    },
  );
  it("missing adapter, read failure and invalid clock fail closed", async () => {
    const f = fixture();
    delete f.deps.lerPiloto;
    expect((await estadoPiloto(f.deps, ORG)).status).toBe("unavailable");
    f.deps.lerPiloto = f.read;
    f.read.mockRejectedValueOnce(new Error("private details"));
    expect(await autorizarPiloto(f.deps, ORG, target)).toEqual({
      ok: false,
      code: "pilot_unavailable",
      status: 503,
    });
    f.clock(Number.NaN);
    expect((await estadoPiloto(f.deps, ORG)).status).toBe("unavailable");
  });
});

describe("live write admission and revocation", () => {
  it("health reports the grant without implying live enablement", async () => {
    const f = fixture();
    f.cfg.simulation = true;
    f.cfg.liveSendEnabled = false;
    expect(await f.run({ op: "health" })).toMatchObject({
      status: 200,
      body: {
        simulation: true,
        liveSendEnabled: false,
        pilot: {
          status: "active",
          contactId: "contact01",
          appointmentId: "appoint01",
          expectedStartTime: START,
        },
      },
    });
    expect(f.claim).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });
  it("authentication and strict request schema precede any grant read", async () => {
    const f = fixture();
    expect((await f.run({ op: "health" }, "wrong-token")).status).toBe(401);
    expect((await f.run({ op: "message.send", ...target, pilot: grant() })).status).toBe(400);
    expect(f.read).not.toHaveBeenCalled();
  });
  it("simulation never reserves or sends even with an active grant", async () => {
    const f = fixture();
    f.cfg.simulation = true;
    expect(await f.run()).toMatchObject({ status: 200, body: { simulated: true } });
    expect(f.read).not.toHaveBeenCalled();
    expect(f.claim).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });
  it("existing live flags and GHL identity checks are not overridden", async () => {
    const f = fixture();
    f.cfg.liveSendEnabled = false;
    expect(await f.run()).toMatchObject({ status: 403, body: { error: "live_send_disabled" } });
    f.cfg.liveSendEnabled = true;
    f.event.contactId = "contact02";
    expect(await f.run()).toMatchObject({ status: 409, body: { error: "contact_mismatch" } });
    expect(f.read).not.toHaveBeenCalled();
    expect(f.claim).not.toHaveBeenCalled();
  });
  it("missing grant denies before reservation", async () => {
    const f = fixture();
    f.read.mockResolvedValue({ ok: true, data: null });
    expect(await f.run()).toMatchObject({ status: 403, body: { error: "pilot_not_authorized" } });
    expect(f.claim).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });
  it.each(["contact", "appointment", "time", "kind"])(
    "grant mismatch %s denies before reserve",
    async (part) => {
      const f = fixture();
      if (part === "contact") f.row.contact_id = "contact02";
      if (part === "appointment") f.row.ghl_appointment_id = "appoint02";
      if (part === "time") f.row.start_time = "2026-10-09T10:01:00Z";
      if (part === "kind") f.row.allowed_kinds = ["confirm"];
      expect((await f.run()).status).toBe(403);
      expect(f.claim).not.toHaveBeenCalled();
      expect(f.send).not.toHaveBeenCalled();
    },
  );
  it.each(["revoked", "expired", "read-failed"])(
    "rechecks %s after reservation before the only POST",
    async (reason) => {
      const f = fixture();
      f.claim.mockImplementation(async () => {
        if (reason === "revoked") f.row.enabled = false;
        if (reason === "expired") f.clock(Date.parse(f.row.expires_at));
        if (reason === "read-failed") f.read.mockResolvedValue({ ok: false });
        return { reserved: true, id: "reserve01" };
      });
      const result = await f.run();
      expect(result.status).toBe(reason === "read-failed" ? 503 : 403);
      expect(f.finish).toHaveBeenCalledWith(
        ORG,
        "reserve01",
        "rejected",
        null,
        expect.stringMatching(/^pilot_/),
      );
      expect(f.send).not.toHaveBeenCalled();
    },
  );
  it("valid grant cannot substitute persisted confirmation proof for the acknowledgement", async () => {
    const f = fixture();
    f.event.appointmentStatus = "confirmed";
    expect(
      await f.run({
        op: "message.send",
        contactId: "contact01",
        appointmentId: "appoint01",
        expectedStartTime: START,
        kind: "confirm",
      }),
    ).toMatchObject({ status: 503, body: { error: "confirmation_evidence_unavailable" } });
    expect(f.claim).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });
  it("concurrent duplicate booking retains one durable winner and one POST", async () => {
    const f = fixture();
    let claimed = false;
    f.claim.mockImplementation(async () => {
      if (claimed) return { reserved: false, id: "reserve01", state: "reserved", messageId: null };
      claimed = true;
      return { reserved: true, id: "reserve01" };
    });
    const results = await Promise.all([f.run(), f.run()]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(f.send).toHaveBeenCalledTimes(1);
  });
  it("accepted re-delivery uses the existing message ID and never posts again", async () => {
    const f = fixture();
    f.claim.mockResolvedValue({
      reserved: false,
      id: "reserve01",
      state: "accepted",
      messageId: "prior001",
    });
    expect(await f.run()).toMatchObject({
      status: 200,
      body: { duplicate: true, messageId: "prior001" },
    });
    expect(f.send).not.toHaveBeenCalled();
  });
});

it("service adapter scopes grant by authenticated organization and does not fetch settings/secrets", async () => {
  const eq = vi.fn();
  const query = { eq, maybeSingle: async () => ({ data: grant(), error: null }) };
  eq.mockReturnValue(query);
  const select = vi.fn(() => query),
    from = vi.fn(() => ({ select }));
  expect(await lerPilotoBridge({ from } as unknown as ClienteBridge, ORG)).toEqual({
    ok: true,
    data: grant(),
  });
  expect(from).toHaveBeenCalledExactlyOnceWith("n8n_bridge_pilot_grants");
  expect(eq.mock.calls).toEqual([["organization_id", ORG]]);
  expect(select).toHaveBeenCalledExactlyOnceWith(
    "organization_id,enabled,contact_id,ghl_appointment_id,start_time,expires_at,allowed_kinds",
  );
});
