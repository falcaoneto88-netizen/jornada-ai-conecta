import { describe, expect, it, vi } from "vitest";
import { CONFIG_PADRAO, processarBridge, type DepsBridge } from "./n8n-bridge.core";
import { criarDepsLembretes, type ClienteBridge } from "./n8n-bridge.server";
import type { ReminderEvidence } from "./n8n-bridge-reminders";
import { testPilot } from "../../test/n8n-pilot-fixture";
const LOC = "location01",
  ORG = "org01",
  CAL = "calendar01",
  CONTACT = "contact01";
const NOW = Date.parse("2026-10-06T12:00:00Z"),
  START = "2026-10-07T12:00:00.000Z";
function fixture() {
  const appointment = {
    id: "appoint01",
    locationId: LOC,
    contactId: CONTACT,
    calendarId: CAL,
    startTime: START,
    endTime: "2026-10-07T12:30:00Z",
    appointmentStatus: "booked",
  };
  const contact = {
    id: CONTACT,
    locationId: LOC,
    phone: "+351910000000",
    dnd: false,
    dndSettings: {},
  };
  const cfg = {
    ...CONFIG_PADRAO,
    bridgeEnabled: true,
    liveSendEnabled: true,
    simulation: false,
    calendarId: CAL,
    channel: "whatsapp_zaptos" as const,
    zaptosProviderId: "provider01",
    channelVerified: true,
  };
  const booking: Record<string, unknown> = {
    id: "booking01",
    locationId: LOC,
    contactId: CONTACT,
    conversationId: "conversation01",
    direction: "outbound",
    messageType: "TYPE_SMS",
    contentType: "text/plain",
    dateAdded: "2026-10-06T08:00:00Z",
    body: "Agendamento",
  };
  const request = {
    ...booking,
    id: "request01",
    dateAdded: "2026-10-06T09:00:00Z",
    body: "Responda SIM",
  };
  const history: Record<string, unknown>[] = [booking, request];
  const rows: ReminderEvidence[] = [
    {
      kind: "booking",
      appointmentId: appointment.id,
      contactId: CONTACT,
      startTime: START,
      messageId: "booking01",
      acceptedAt: "2026-10-06T08:00:01Z",
    },
    {
      kind: "req24",
      appointmentId: appointment.id,
      contactId: CONTACT,
      startTime: START,
      messageId: "request01",
      acceptedAt: "2026-10-06T09:00:01Z",
    },
  ];
  const evidence = {
    sends: vi.fn(async () => ({ ok: true as const, data: rows })),
    message: vi.fn(async (_loc: string, id: string) => ({
      ok: true as const,
      data: id === "booking01" ? booking : request,
    })),
    conversationMessages: vi.fn(async () => ({
      ok: true as const,
      data: { messages: { messages: history, nextPage: false } } as unknown,
    })),
  };
  const deps: DepsBridge = {
    token: "synthetic-reminder-test-token-only-32-characters",
    lerPiloto: testPilot(ORG, CONTACT, "appoint01", START),
    now: () => NOW,
    resolver: async () => ({
      orgId: ORG,
      locationId: LOC,
      writeEnabled: true,
      integracaoConectada: true,
    }),
    lerConfig: async () => ({ ok: true, cfg }),
    hit: async () => true,
    contacto: vi.fn(async () => ({ ok: true as const, data: { total: 1, contacts: [contact] } })),
    consulta: vi.fn(async () => ({ ok: true as const, data: { appointment: { ...appointment } } })),
    utilizadorNaLocation: vi.fn(),
    lembretes: evidence,
    claim: vi.fn(async () => ({ reserved: true as const, id: "reservation01" })),
    finish: vi.fn(async () => true),
    enviar: vi.fn(async () => ({ ok: true as const, messageId: "sentmsg01" })),
  };
  const run = async (kind = "req12") => {
    const r = await processarBridge(
      new Request("https://example.test/bridge", {
        method: "POST",
        headers: { authorization: `Bearer ${deps.token}`, "content-type": "application/json" },
        body: JSON.stringify({
          op: "message.send",
          appointmentId: appointment.id,
          contactId: CONTACT,
          expectedStartTime: START,
          kind,
        }),
      }),
      deps,
    );
    return { status: r.status, body: await r.json() };
  };
  const add = (body: string, direction = "inbound", dateAdded = "2026-10-06T10:00:00Z") =>
    history.push({ ...booking, id: "intervening01", dateAdded, body, direction });
  return { appointment, contact, cfg, booking, request, history, rows, evidence, deps, run, add };
}

describe("reminders cannot rely on stale n8n pending state", () => {
  it.each(["req24", "req12"])("sends eligible %s once after two complete checks", async (kind) => {
    const f = fixture();
    expect((await f.run(kind)).body.status).toBe("accepted");
    expect(f.evidence.sends).toHaveBeenCalledTimes(2);
    expect(f.evidence.sends).toHaveBeenCalledWith(ORG, "appoint01", START, CONTACT);
    expect(f.evidence.conversationMessages).toHaveBeenCalledTimes(2);
    expect(f.deps.consulta).toHaveBeenCalledTimes(3);
    expect(f.deps.enviar).toHaveBeenCalledTimes(1);
  });
  it.each(["SIM", "NÃO", "REMARCAR", "tenho uma dúvida"])(
    "blocks reply %s before reservation",
    async (text) => {
      const f = fixture();
      f.add(text);
      expect((await f.run()).body.error).toBe("reminder_reply_or_intervention");
      expect(f.deps.claim).not.toHaveBeenCalled();
      expect(f.deps.enviar).not.toHaveBeenCalled();
    },
  );
  it("blocks human outbound after the booking", async () => {
    const f = fixture();
    f.add("Vou ajudar", "outbound");
    expect((await f.run()).body.error).toBe("reminder_reply_or_intervention");
    expect(f.deps.enviar).not.toHaveBeenCalled();
  });
  it("old conversation before this booking does not block a new appointment", async () => {
    const f = fixture();
    f.add("SIM", "inbound", "2026-10-05T10:00:00Z");
    expect((await f.run()).body.status).toBe("accepted");
  });
  it("a later accepted request never erases a prior reply boundary", async () => {
    const f = fixture();
    f.add("NÃO", "inbound", "2026-10-06T08:30:00Z");
    expect((await f.run()).body.error).toBe("reminder_reply_or_intervention");
    expect(f.deps.enviar).not.toHaveBeenCalled();
  });
  it.each(["SIM", "NÃO", "human"])("blocks %s arriving during SQL reservation", async (reply) => {
    const f = fixture();
    vi.mocked(f.deps.claim).mockImplementation(async () => {
      f.add(reply, reply === "human" ? "outbound" : "inbound");
      return { reserved: true, id: "reservation01" };
    });
    expect((await f.run()).body.error).toBe("reminder_reply_or_intervention");
    expect(f.deps.claim).toHaveBeenCalledTimes(1);
    expect(f.deps.finish).toHaveBeenCalledExactlyOnceWith(
      ORG,
      "reservation01",
      "rejected",
      null,
      "reminder_reply_or_intervention",
    );
    expect(f.deps.enviar).not.toHaveBeenCalled();
  });
  it.each(["confirmed", "cancelled"])("blocks GHL %s after reservation", async (status) => {
    const f = fixture();
    vi.mocked(f.deps.claim).mockImplementation(async () => {
      f.appointment.appointmentStatus = status;
      return { reserved: true, id: "reservation01" };
    });
    expect((await f.run()).body.error).toBe(
      status === "confirmed" ? "appointment_already_confirmed" : "appointment_changed",
    );
    expect(f.deps.enviar).not.toHaveBeenCalled();
  });
  it("blocks rescheduling after reservation", async () => {
    const f = fixture();
    vi.mocked(f.deps.claim).mockImplementation(async () => {
      f.appointment.startTime = "2026-10-08T12:00:00Z";
      return { reserved: true, id: "reservation01" };
    });
    expect((await f.run()).body.error).toBe("appointment_changed");
    expect(f.deps.enviar).not.toHaveBeenCalled();
  });
  it("fresh DND during the reservation also stops the POST", async () => {
    const f = fixture();
    vi.mocked(f.deps.claim).mockImplementation(async () => {
      f.contact.dnd = true;
      return { reserved: true, id: "reservation01" };
    });
    expect((await f.run()).body.error).toBe("dnd_not_confirmed");
    expect(f.deps.enviar).not.toHaveBeenCalled();
  });
  it("requires accepted booking for the first req24", async () => {
    const f = fixture();
    f.rows.splice(0, 1);
    expect((await f.run("req24")).body.error).toBe("reminder_request_missing");
    expect(f.deps.claim).not.toHaveBeenCalled();
  });
  it("requires a previous accepted req24 before req12", async () => {
    const f = fixture();
    f.rows.splice(1, 1);
    f.history.splice(1, 1);
    expect((await f.run()).body.error).toBe("reminder_request_missing");
    expect((await f.run("req24")).body.status).toBe("accepted");
  });
  it.each(["contactId", "appointmentId", "startTime", "acceptedAt", "messageId"])(
    "rejects forged ledger %s",
    async (key) => {
      const f = fixture();
      Object.assign(f.rows[0]!, { [key]: "wrong" });
      expect((await f.run()).body.error).toBe("reminder_evidence_invalid");
      expect(f.deps.enviar).not.toHaveBeenCalled();
    },
  );
  it.each(["contactId", "locationId", "conversationId", "direction", "contentType"])(
    "rejects message scope/channel %s",
    async (key) => {
      const f = fixture();
      Object.assign(f.request, { [key]: "wrong" });
      expect((await f.run()).body.error).toBe("reminder_evidence_invalid");
      expect(f.deps.enviar).not.toHaveBeenCalled();
    },
  );
  it("refuses incomplete history instead of inferring no reply", async () => {
    const f = fixture();
    f.evidence.conversationMessages.mockResolvedValue({
      ok: true,
      data: { messages: { messages: [], nextPage: true } },
    });
    expect((await f.run()).body.error).toBe("reminder_history_unavailable");
    expect(f.deps.claim).not.toHaveBeenCalled();
  });
  it("failure in the second history check rejects the already acquired reservation", async () => {
    const f = fixture();
    f.evidence.conversationMessages
      .mockResolvedValueOnce({
        ok: true,
        data: { messages: { messages: f.history, nextPage: false } },
      })
      .mockRejectedValueOnce(new Error("unavailable"));
    expect((await f.run()).body.error).toBe("reminder_history_unavailable");
    expect(f.deps.finish).toHaveBeenCalled();
    expect(f.deps.enviar).not.toHaveBeenCalled();
  });
  it("keeps simulation free of reservations and posts", async () => {
    const f = fixture();
    f.cfg.simulation = true;
    expect((await f.run()).body.status).toBe("simulated");
    expect(f.deps.claim).not.toHaveBeenCalled();
    expect(f.deps.enviar).not.toHaveBeenCalled();
  });
  it("concurrent attempts still use the SQL reservation and produce one POST", async () => {
    const f = fixture();
    let taken = false;
    vi.mocked(f.deps.claim).mockImplementation(async () => {
      if (taken)
        return { reserved: false, id: "reservation01", state: "reserved", messageId: null };
      taken = true;
      return { reserved: true, id: "reservation01" };
    });
    const results = await Promise.all([f.run(), f.run()]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(f.deps.enviar).toHaveBeenCalledTimes(1);
  });
  it("unknown reservation cannot automatically retry after a revalidation", async () => {
    const f = fixture();
    vi.mocked(f.deps.claim).mockResolvedValue({
      reserved: false,
      id: "reservation01",
      state: "unknown",
      messageId: null,
    });
    expect((await f.run()).body.error).toBe("send_already_attempted");
    expect(f.deps.enviar).not.toHaveBeenCalled();
  });
});

it("ledger adapter scopes every read and does not mutate or invoke RPC", async () => {
  const calls: [string, unknown][][] = [];
  const from = vi.fn(() => ({
    select: vi.fn(() => {
      const filters: [string, unknown][] = [];
      calls.push(filters);
      const query = {
        eq: (key: string, value: unknown) => {
          filters.push([key, value]);
          return query;
        },
        maybeSingle: async () => ({ data: null, error: null }),
      };
      return query;
    }),
  }));
  const rpc = vi.fn();
  const adapter = criarDepsLembretes({ from, rpc } as unknown as ClienteBridge);
  expect(await adapter.sends(ORG, "appoint01", START, CONTACT)).toEqual({ ok: true, data: [] });
  expect(from).toHaveBeenCalledTimes(3);
  for (const [index, kind] of ["booking", "req24", "req12"].entries())
    expect(calls[index]).toEqual([
      ["organization_id", ORG],
      ["ghl_appointment_id", "appoint01"],
      ["start_time", START],
      ["contact_id", CONTACT],
      ["kind", kind],
      ["state", "accepted"],
    ]);
  expect(rpc).not.toHaveBeenCalled();
});
