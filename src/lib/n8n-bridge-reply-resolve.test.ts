import { afterEach, describe, expect, it, vi } from "vitest";
import { CONFIG_PADRAO, processarBridge, type DepsBridge } from "./n8n-bridge.core";
import type { RequestEvidence } from "./n8n-bridge-confirmation";

const TOKEN = "synthetic-resolver-token-32-characters-only";
const NOW = Date.parse("2026-10-06T12:05:00Z");
const START = "2026-10-07T12:00:00.000Z";
const LOC = "location01";
const ORG = "org01";
const CAL = "calendar01";
const CONTACT = "contact01";
const pedido = { op: "appointment.reply.resolve", contactId: CONTACT };
const mutations: ReturnType<typeof vi.fn>[] = [];
afterEach(() => {
  for (const spy of mutations) expect(spy).not.toHaveBeenCalled();
  mutations.length = 0;
});

function fixture() {
  const appointment = {
    id: "appoint01",
    contactId: CONTACT,
    locationId: LOC,
    calendarId: CAL,
    startTime: START,
    endTime: "2026-10-07T12:30:00Z",
    appointmentStatus: "new",
  };
  const cfg = {
    ...CONFIG_PADRAO,
    bridgeEnabled: true,
    calendarId: CAL,
    simulation: false,
    liveSendEnabled: true,
  };
  const scope = { orgId: ORG, locationId: LOC, writeEnabled: true, integracaoConectada: true };
  const inbound: Record<string, unknown> = {
    id: "inbound01",
    locationId: LOC,
    contactId: CONTACT,
    conversationId: "conversation01",
    dateAdded: "2026-10-06T12:00:00Z",
    body: "SIM",
    direction: "inbound",
    messageType: "TYPE_SMS",
    contentType: "text/plain",
  };
  const outbound = {
    ...inbound,
    id: "outbound01",
    direction: "outbound",
    dateAdded: "2026-10-06T11:58:00Z",
    body: "Responda SIM ou NAO",
  };
  const history = [inbound, outbound];
  const messages = new Map<string, Record<string, unknown>>([
    ["inbound01", inbound],
    ["outbound01", outbound],
  ]);
  const requests: RequestEvidence[] = [
    {
      id: "reserved01",
      appointmentId: "appoint01",
      startTime: START,
      messageId: "outbound01",
      acceptedAt: "2026-10-06T11:59:00Z",
    },
  ];
  const evidence = {
    requests: vi.fn(async () => ({ ok: true as const, data: requests })),
    message: vi.fn(async (_loc: string, messageId: string) => ({
      ok: true as const,
      data: messages.get(messageId),
    })),
    conversationMessages: vi.fn(async (_loc: string, _conversation: string, _cursor?: string) => ({
      ok: true as const,
      data: { messages: { nextPage: false, messages: history } } as unknown,
    })),
    confirmedReply: vi.fn(),
    claim: vi.fn(),
    finish: vi.fn(),
    confirm: vi.fn(),
  };
  const deps: DepsBridge = {
    token: TOKEN,
    now: () => NOW,
    resolver: vi.fn(async () => scope),
    lerConfig: vi.fn(async () => ({ ok: true as const, cfg })),
    hit: vi.fn(async () => true),
    contacto: vi.fn(async () => ({
      ok: true as const,
      data: { total: 1, contacts: [{ id: CONTACT, locationId: LOC, dnd: false, dndSettings: {} }] },
    })),
    consulta: vi.fn(async () => ({ ok: true as const, data: { appointment: { ...appointment } } })),
    utilizadorNaLocation: vi.fn(),
    enviar: vi.fn(),
    claim: vi.fn(),
    finish: vi.fn(),
    confirmacao: evidence,
  };
  mutations.push(
    evidence.confirmedReply,
    evidence.claim,
    evidence.finish,
    evidence.confirm,
    deps.enviar as ReturnType<typeof vi.fn>,
    deps.claim as ReturnType<typeof vi.fn>,
    deps.finish as ReturnType<typeof vi.fn>,
  );
  const run = async (body: unknown = pedido, auth = `Bearer ${TOKEN}`) => {
    const r = await processarBridge(
      new Request("https://example.test/bridge", {
        method: "POST",
        headers: { authorization: auth, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      deps,
    );
    return { status: r.status, body: await r.json() };
  };
  return {
    appointment,
    cfg,
    scope,
    inbound,
    outbound,
    history,
    messages,
    requests,
    evidence,
    deps,
    run,
  };
}

describe("appointment.reply.resolve authenticates a contact-only wakeup without side effects", () => {
  it("resolves an ordinary SMS reply to the configured custom Zaptos request", async () => {
    const f = fixture();
    Object.assign(f.cfg, { channel: "whatsapp_zaptos", zaptosProviderId: "provider01" });
    Object.assign(f.outbound, {
      messageType: "TYPE_CUSTOM_SMS",
      type: 20,
      source: "api",
      conversationProviderId: "provider01",
    });
    expect((await f.run()).body).toMatchObject({
      status: "resolved",
      reply: { intent: "confirm", inboundMessageId: "inbound01" },
    });
  });
  it.each([undefined, "another-provider"])(
    "does not resolve request with custom provider %s",
    async (provider) => {
      const f = fixture();
      Object.assign(f.cfg, { channel: "whatsapp_zaptos", zaptosProviderId: "provider01" });
      Object.assign(f.outbound, {
        messageType: "TYPE_CUSTOM_SMS",
        type: 20,
        source: "api",
        conversationProviderId: provider,
      });
      expect((await f.run()).body.error).toBe("confirmation_evidence_invalid");
    },
  );
  it("returns minimum real identity, intent and fresh appointment; never body/name/phone", async () => {
    const f = fixture();
    expect(await f.run()).toEqual({
      status: 200,
      body: {
        status: "resolved",
        readOnly: true,
        reply: {
          inboundMessageId: "inbound01",
          conversationId: "conversation01",
          contactId: CONTACT,
          locationId: LOC,
          replyAt: "2026-10-06T12:00:00.000Z",
          intent: "confirm",
        },
        appointment: {
          appointmentId: "appoint01",
          calendarId: CAL,
          startTime: START,
          appointmentStatus: "new",
        },
      },
    });
    expect(f.evidence.requests).toHaveBeenCalledExactlyOnceWith(
      ORG,
      CONTACT,
      "2026-10-06T12:05:00.000Z",
    );
    expect(f.evidence.message).toHaveBeenCalledWith(LOC, "inbound01");
    expect(f.evidence.conversationMessages).toHaveBeenCalledTimes(2);
  });
  it.each([
    ["sim", "confirm"],
    [" Confirmo ", "confirm"],
    ["NÃO", "decline"],
    ["nao", "decline"],
    ["REMARCAR", "reschedule"],
    ["SIM mas amanhã não", "other"],
    ["conteúdo clínico privado", "other"],
  ])("classifies %s without forwarding raw text", async (body, intent) => {
    const f = fixture();
    f.inbound["body"] = body;
    const r = await f.run();
    expect(r.status).toBe(200);
    expect(r.body.reply.intent).toBe(intent);
    expect(r.body.reply).not.toHaveProperty("body");
    expect(r.body.reply).not.toHaveProperty("text");
  });
  it("replay discovers the same message ID and never consumes or confirms it", async () => {
    const f = fixture();
    expect(await f.run()).toEqual(await f.run());
  });
  it.each([true, false])(
    "is read-only with simulation=%s, even when writes are enabled",
    async (simulation) => {
      const f = fixture();
      f.cfg.simulation = simulation;
      expect((await f.run()).body).toMatchObject({ readOnly: true, status: "resolved" });
    },
  );
  it("does not require or enable write flags for discovery", async () => {
    const f = fixture();
    f.scope.writeEnabled = false;
    f.cfg.liveSendEnabled = false;
    expect((await f.run()).status).toBe(200);
  });
  it.each([
    "text",
    "body",
    "inboundMessageId",
    "appointmentId",
    "locationId",
    "organizationId",
    "intent",
  ])("rejects caller-supplied %s", async (key) => {
    const f = fixture();
    expect((await f.run({ ...pedido, [key]: "forged01" })).status).toBe(400);
    expect(f.evidence.requests).not.toHaveBeenCalled();
  });
  it("rejects invalid auth before accessing evidence", async () => {
    const f = fixture();
    expect((await f.run(pedido, "Bearer wrong")).status).toBe(401);
    expect(f.deps.contacto).not.toHaveBeenCalled();
    expect(f.evidence.requests).not.toHaveBeenCalled();
  });
  it("retains quota and enabled/calendar gates", async () => {
    const f = fixture();
    f.cfg.bridgeEnabled = false;
    expect((await f.run()).body.error).toBe("bridge_disabled");
    f.cfg.bridgeEnabled = true;
    f.cfg.calendarId = null as unknown as string;
    expect((await f.run()).body.error).toBe("calendar_not_configured");
    f.cfg.calendarId = CAL;
    vi.mocked(f.deps.hit).mockResolvedValue(false);
    expect((await f.run()).status).toBe(429);
    expect(f.evidence.requests).not.toHaveBeenCalled();
  });
});

describe("reply discovery does not guess identity or appointment", () => {
  it("requires persisted accepted request evidence", async () => {
    const f = fixture();
    f.requests.length = 0;
    expect((await f.run()).body.error).toBe("confirmation_request_missing");
  });
  it.each(["appointment", "conversation", "start"])("refuses competing %s", async (kind) => {
    const f = fixture();
    f.requests.push({
      ...f.requests[0]!,
      id: "reserved02",
      messageId: "outbound02",
      ...(kind === "appointment" ? { appointmentId: "appoint02" } : {}),
      ...(kind === "start" ? { startTime: "2026-10-08T12:00:00Z" } : {}),
    });
    f.messages.set("outbound02", {
      ...f.outbound,
      id: "outbound02",
      ...(kind === "conversation" ? { conversationId: "conversation02" } : {}),
    });
    expect((await f.run()).body.error).toBe("confirmation_ambiguous");
    expect(f.evidence.conversationMessages).not.toHaveBeenCalled();
  });
  it("allows two accepted requests for the same appointment, using the latest", async () => {
    const f = fixture();
    const older = { ...f.outbound, id: "outbound02", dateAdded: "2026-10-06T10:58:00Z" };
    f.messages.set("outbound02", older);
    f.history.push(older);
    f.requests.push({
      ...f.requests[0]!,
      id: "reserved02",
      messageId: "outbound02",
      acceptedAt: "2026-10-06T10:59:00Z",
    });
    expect((await f.run()).status).toBe(200);
  });
  it.each(["locationId", "contactId", "conversationId", "direction", "messageType", "contentType"])(
    "rejects incompatible outbound %s",
    async (key) => {
      const f = fixture();
      Object.assign(f.outbound, { [key]: "unverified" });
      expect((await f.run()).status).toBe(409);
    },
  );
  it.each(["locationId", "contactId", "calendarId", "startTime", "appointmentStatus"])(
    "rejects stale appointment %s",
    async (key) => {
      const f = fixture();
      Object.assign(f.appointment, {
        [key]: key === "startTime" ? "2026-10-08T12:00:00Z" : "changed",
      });
      expect((await f.run()).body.error).toBe("appointment_changed");
    },
  );
  it("requires authenticated exact contact", async () => {
    const f = fixture();
    vi.mocked(f.deps.contacto).mockResolvedValue({ ok: true, data: { total: 0, contacts: [] } });
    expect((await f.run()).body.error).toBe("contact_not_verified");
  });
  it.each([
    "locationId",
    "contactId",
    "conversationId",
    "dateAdded",
    "body",
    "direction",
    "messageType",
    "contentType",
  ])("rejects direct message mismatch %s", async (key) => {
    const f = fixture();
    f.messages.set("inbound01", { ...f.inbound, [key]: "different" });
    expect((await f.run()).body.error).toBe("reply_not_verified");
  });
  it("rejects switching channel within the same conversation", async () => {
    const f = fixture();
    f.inbound["messageType"] = "TYPE_WHATSAPP";
    expect((await f.run()).body.error).toBe("reply_not_verified");
  });
  it("does not truncate more than 50 requests", async () => {
    const f = fixture();
    f.requests.push(...Array.from({ length: 50 }, () => ({ ...f.requests[0]! })));
    expect((await f.run()).body.error).toBe("confirmation_evidence_overflow");
  });
  it("rejects duplicated ledger/message evidence", async () => {
    const f = fixture();
    f.requests.push({ ...f.requests[0]! });
    expect((await f.run()).body.error).toBe("confirmation_evidence_invalid");
  });
});

describe("complete history and time ordering are mandatory", () => {
  it("traverses real cursors and repeats a complete read before returning", async () => {
    const f = fixture();
    f.evidence.conversationMessages.mockImplementation(async (_loc, _conv, cursor) => ({
      ok: true,
      data: {
        messages: cursor
          ? { nextPage: false, messages: [f.outbound] }
          : { nextPage: true, lastMessageId: "cursor01", messages: [f.inbound] },
      },
    }));
    expect((await f.run()).status).toBe(200);
    expect(f.evidence.conversationMessages.mock.calls.map((c) => c[2])).toEqual([
      undefined,
      "cursor01",
      undefined,
      "cursor01",
    ]);
  });
  it.each([
    "missing_cursor",
    "repeated_cursor",
    "missing_next",
    "missing_request",
    "duplicate",
    "identity",
    "invalid_date",
    "offset_missing",
  ])("fails closed for %s history", async (kind) => {
    const f = fixture();
    if (kind === "missing_cursor")
      f.evidence.conversationMessages.mockResolvedValue({
        ok: true,
        data: { messages: { nextPage: true, messages: f.history } },
      });
    if (kind === "repeated_cursor")
      f.evidence.conversationMessages.mockResolvedValue({
        ok: true,
        data: { messages: { nextPage: true, lastMessageId: "cursor01", messages: [] } },
      });
    if (kind === "missing_next")
      f.evidence.conversationMessages.mockResolvedValue({
        ok: true,
        data: { messages: { messages: f.history } },
      });
    if (kind === "missing_request") f.history.splice(1, 1);
    if (kind === "duplicate") f.history.push(f.inbound);
    if (kind === "identity")
      f.history.push({ ...f.inbound, id: "othermsg1", contactId: "other001" });
    if (kind === "invalid_date") f.inbound["dateAdded"] = "invalid";
    if (kind === "offset_missing") f.inbound["dateAdded"] = "2026-10-06T12:00:00";
    expect((await f.run()).body.error).toBe("reply_history_unavailable");
  });
  it("refuses a history still paginated at the ten-page bound", async () => {
    const f = fixture();
    let page = 0;
    f.evidence.conversationMessages.mockImplementation(async () => ({
      ok: true,
      data: { messages: { nextPage: true, lastMessageId: `cursor${++page}`, messages: [] } },
    }));
    expect((await f.run()).body.error).toBe("reply_history_unavailable");
    expect(page).toBe(10);
  });
  it("refuses more than 1000 rows", async () => {
    const f = fixture();
    f.history.push(
      ...Array.from({ length: 999 }, (_, i) => ({ ...f.outbound, id: `oldermsg${i}` })),
    );
    expect((await f.run()).body.error).toBe("reply_history_unavailable");
  });
  it.each(["2026-10-06T11:58:30Z", "2026-10-06T11:59:00Z", "2026-10-06T12:06:00Z", START])(
    "rejects reply outside request/current/appointment window %s",
    async (dateAdded) => {
      const f = fixture();
      f.inbound["dateAdded"] = dateAdded;
      expect((await f.run()).body.error).toBe("reply_outside_window");
    },
  );
  it.each(["2026-10-06T12:05:00Z", "2026-10-06T12:06:00Z", "not-a-date", "2026-10-06T11:59:00"])(
    "rejects invalid request timestamp %s",
    async (acceptedAt) => {
      const f = fixture();
      f.requests[0]!.acceptedAt = acceptedAt;
      expect((await f.run()).body.error).toBe("confirmation_evidence_invalid");
    },
  );
  it("does not pick an old SIM when the latest message is outbound", async () => {
    const f = fixture();
    f.history.push({ ...f.outbound, id: "humanmsg1", dateAdded: "2026-10-06T12:01:00Z" });
    expect((await f.run()).body.error).toBe("reply_missing");
  });
  it("does not infer which of two messages sharing the latest timestamp is last", async () => {
    const f = fixture();
    f.history.push({ ...f.inbound, id: "inbound02", body: "NÃO" });
    expect((await f.run()).body.error).toBe("reply_superseded");
  });
  it("does not pick a newer SIM after an intervening reply or human message", async () => {
    const f = fixture();
    f.history.push({
      ...f.inbound,
      id: "inbound02",
      dateAdded: "2026-10-06T11:59:30Z",
      body: "NÃO",
    });
    expect((await f.run()).body.error).toBe("confirmation_context_changed");
  });
  it("blocks a newer reply arriving during discovery", async () => {
    const f = fixture();
    let reads = 0;
    f.evidence.conversationMessages.mockImplementation(async () => ({
      ok: true,
      data: {
        messages: {
          nextPage: false,
          messages:
            ++reads === 1
              ? f.history
              : [
                  ...f.history,
                  {
                    ...f.inbound,
                    id: "inbound02",
                    body: "REMARCAR",
                    dateAdded: "2026-10-06T12:01:00Z",
                  },
                ],
        },
      },
    }));
    expect((await f.run()).body.error).toBe("reply_superseded");
  });
  it("replay after rescheduling cannot reuse historical confirmation evidence", async () => {
    const f = fixture();
    expect((await f.run()).status).toBe(200);
    f.appointment.startTime = "2026-10-08T12:00:00Z";
    expect((await f.run()).body.error).toBe("appointment_changed");
  });
  it.each(["message", "conversationMessages", "requests"])(
    "fails closed on %s availability loss",
    async (method) => {
      const f = fixture();
      f.evidence[method as "message"].mockRejectedValue(new Error("unavailable"));
      expect((await f.run()).status).not.toBe(200);
    },
  );
});
