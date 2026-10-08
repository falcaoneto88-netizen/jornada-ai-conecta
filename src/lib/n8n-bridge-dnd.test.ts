/** GHL DND is a deny setting, not evidence of opt-in or authorization to message. */
import { describe, expect, it, vi } from "vitest";
import {
  CONFIG_PADRAO,
  dndPermite,
  parseContacto,
  parseIdentidadeContacto,
  processarBridge,
  type DepsBridge,
} from "./n8n-bridge.core";
const LOC = "location01",
  CONTACT = "contact01";
const raw = (extra: Record<string, unknown> = {}) => ({
  total: 1,
  contacts: [
    { id: CONTACT, locationId: LOC, phone: "+351910000000", dnd: false, dndSettings: {}, ...extra },
  ],
});

describe("GHL DND representation", () => {
  it("omitted global means false as documented across GHL APIs", () => {
    const c = parseContacto(raw({ dnd: undefined }), CONTACT, LOC);
    expect(c).toMatchObject({ dnd: false, dndSettings: {} });
    expect(dndPermite(c!, "whatsapp_zaptos")).toBe(true);
    expect(c).not.toHaveProperty("consent");
    expect(c).not.toHaveProperty("optIn");
    expect(c).not.toHaveProperty("smsConsent");
  });
  it("valid empty settings represent no configured channel block", () => {
    const c = parseContacto(raw(), CONTACT, LOC)!;
    expect(dndPermite(c, "sms")).toBe(true);
    expect(dndPermite(c, "whatsapp_zaptos")).toBe(true);
    expect(c.dndSettings).toEqual({});
  });
  it("does not require a fabricated inactive entry for the absent channel", () => {
    const c = parseContacto(raw({ dndSettings: { SMS: { status: "inactive" } } }), CONTACT, LOC)!;
    expect(dndPermite(c, "whatsapp_zaptos")).toBe(true);
    expect(c.dndSettings).not.toHaveProperty("WhatsApp");
  });
  it("global true overrides inactive channels", () => {
    const c = parseContacto(
      raw({
        dnd: true,
        dndSettings: { SMS: { status: "inactive" }, WhatsApp: { status: "inactive" } },
      }),
      CONTACT,
      LOC,
    )!;
    expect(dndPermite(c, "sms")).toBe(false);
    expect(dndPermite(c, "whatsapp_zaptos")).toBe(false);
  });
  it.each(["SMS", "WhatsApp"])("active or permanent %s blocks Zaptos", (channel) => {
    for (const status of ["active", "permanent"] as const) {
      const c = parseContacto(raw({ dndSettings: { [channel]: { status } } }), CONTACT, LOC)!;
      expect(c).not.toBeNull();
      expect(dndPermite(c, "whatsapp_zaptos")).toBe(false);
    }
  });
  it("unrelated valid Email block does not become an SMS block", () => {
    const c = parseContacto(
      raw({ dndSettings: { Email: { status: "permanent" } } }),
      CONTACT,
      LOC,
    )!;
    expect(dndPermite(c, "sms")).toBe(true);
    expect(dndPermite(c, "whatsapp_zaptos")).toBe(true);
  });
  it.each([null, "false", 0, {}, []])("malformed global %j cannot normalize to allowed", (dnd) => {
    expect(parseContacto(raw({ dnd }), CONTACT, LOC)).toBeNull();
  });
  it.each([undefined, null, [], "", false])(
    "missing/malformed settings %j cannot normalize to allowed",
    (dndSettings) => {
      expect(parseContacto(raw({ dndSettings }), CONTACT, LOC)).toBeNull();
    },
  );
  it.each([{}, null, [], { status: "pending" }, { status: false }, { status: null }])(
    "malformed existing channel %j fails closed",
    (SMS) => {
      expect(parseContacto(raw({ dndSettings: { SMS } }), CONTACT, LOC)).toBeNull();
      expect(parseContacto(raw({ dndSettings: { Email: SMS } }), CONTACT, LOC)).toBeNull();
    },
  );
  it("no relaxation of exact contact, location and unique-result checks", () => {
    expect(parseContacto(raw(), "contact02", LOC)).toBeNull();
    expect(parseContacto(raw(), CONTACT, "location02")).toBeNull();
    expect(parseContacto({ ...raw(), total: 2 }, CONTACT, LOC)).toBeNull();
  });
});

describe("absence of DND does not authorize a real send", () => {
  function setup() {
    const send = vi.fn(async () => ({ ok: true as const, messageId: "message01" }));
    const claim = vi.fn(async () => ({ reserved: true as const, id: "reservation01" }));
    const cfg = {
      ...CONFIG_PADRAO,
      bridgeEnabled: true,
      calendarId: "calendar01",
      channel: "whatsapp_zaptos" as const,
      channelVerified: true,
      zaptosProviderId: "provider01",
    };
    const deps: DepsBridge = {
      token: "synthetic-test-token-only-32-characters",
      now: () => Date.parse("2026-10-06T10:00:00Z"),
      resolver: async () => ({
        orgId: "org01",
        locationId: LOC,
        writeEnabled: true,
        integracaoConectada: true,
      }),
      lerConfig: async () => ({ ok: true, cfg }),
      hit: async () => true,
      contacto: async () => ({ ok: true, data: raw() }),
      consulta: async () => ({
        ok: true,
        data: {
          appointment: {
            id: "appoint01",
            locationId: LOC,
            calendarId: "calendar01",
            contactId: CONTACT,
            startTime: "2026-10-07T10:00:00Z",
            endTime: "2026-10-07T10:30:00Z",
            appointmentStatus: "new",
          },
        },
      }),
      utilizadorNaLocation: async () => false,
      enviar: send,
      claim,
      finish: async () => true,
    };
    const run = async () => {
      const r = await processarBridge(
        new Request("https://test.invalid/bridge", {
          method: "POST",
          headers: { authorization: `Bearer ${deps.token}`, "content-type": "application/json" },
          body: JSON.stringify({
            op: "message.send",
            appointmentId: "appoint01",
            contactId: CONTACT,
            expectedStartTime: "2026-10-07T10:00:00Z",
            kind: "booking",
          }),
        }),
        deps,
      );
      return { status: r.status, body: await r.json() };
    };
    return { cfg, deps, send, claim, run };
  }
  it("simulation remains simulation with zero reservations or posts", async () => {
    const f = setup();
    expect((await f.run()).body).toMatchObject({
      simulated: true,
      messageId: null,
      delivered: false,
    });
    expect(f.claim).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });
  it("live send remains disabled independently of DND", async () => {
    const f = setup();
    f.cfg.simulation = false;
    expect((await f.run()).body.error).toBe("live_send_disabled");
    expect(f.claim).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });
  it("unverified channel remains blocked independently of DND", async () => {
    const f = setup();
    f.cfg.channelVerified = false;
    expect((await f.run()).body.error).toBe("channel_not_verified");
    expect(f.claim).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });
  it.each(["active", "permanent"])(
    "explicit %s block prevents reservation even with live flags",
    async (status) => {
      const f = setup();
      f.cfg.simulation = false;
      f.cfg.liveSendEnabled = true;
      f.deps.contacto = async () => ({ ok: true, data: raw({ dndSettings: { SMS: { status } } }) });
      expect((await f.run()).body.error).toBe("dnd_not_confirmed");
      expect(f.claim).not.toHaveBeenCalled();
      expect(f.send).not.toHaveBeenCalled();
    },
  );
});

describe("contact identity diagnostics do not authorize DND", () => {
  it("identifies exact contact while the full parser still rejects omitted preferences", () => {
    const payload = { total: 1, contacts: [{ id: CONTACT, locationId: LOC }] };
    expect(parseIdentidadeContacto(payload, CONTACT, LOC)).toMatchObject({
      id: CONTACT,
      locationId: LOC,
    });
    expect(parseContacto(payload, CONTACT, LOC)).toBeNull();
    expect(payload.contacts[0]).not.toHaveProperty("dndSettings");
  });
  it.each([
    { total: 0, contacts: [] },
    { total: 1, contacts: [{ id: "other001", locationId: LOC }] },
    { total: 1, contacts: [{ id: CONTACT, locationId: "other001" }] },
    {
      total: 2,
      contacts: [
        { id: CONTACT, locationId: LOC },
        { id: CONTACT, locationId: LOC },
      ],
    },
  ])("cannot infer identity from a wrong/ambiguous envelope %#", (payload) => {
    expect(parseIdentidadeContacto(payload, CONTACT, LOC)).toBeNull();
    expect(parseContacto(payload, CONTACT, LOC)).toBeNull();
  });
});
