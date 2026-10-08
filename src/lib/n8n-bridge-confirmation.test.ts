import { describe, expect, it, vi } from "vitest";
import { CONFIG_PADRAO, processarBridge, type DepsBridge } from "./n8n-bridge.core";
import type { RequestEvidence } from "./n8n-bridge-confirmation";
import { testPilot } from "../../test/n8n-pilot-fixture";

const TOKEN = "synthetic-confirmation-token-32-characters-only";
const LOC = "location01",
  ORG = "org01",
  CAL = "calendar01",
  START = "2026-10-07T12:00:00.000Z";
const NOW = Date.parse("2026-10-06T12:05:00Z");
const pedido = {
  op: "appointment.confirm",
  appointmentId: "appoint01",
  contactId: "contact01",
  expectedStartTime: START,
  inboundMessageId: "inbound01",
};
function fixture() {
  const event = {
    id: "appoint01",
    contactId: "contact01",
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
  const inbound = {
    id: "inbound01",
    locationId: LOC,
    contactId: "contact01",
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
  const evidence: RequestEvidence[] = [
    {
      id: "reserved01",
      appointmentId: "appoint01",
      startTime: START,
      messageId: "outbound01",
      acceptedAt: "2026-10-06T11:59:00Z",
    },
  ];
  const conf = {
    confirmedReply: vi.fn(async () => ({
      ok: true as const,
      data: {
        requestId: "reserved01",
        inboundMessageId: "inbound01",
        replyAt: "2026-10-06T12:00:00Z",
      },
    })),
    conversationMessages: vi.fn(async () => ({
      ok: true as const,
      data: { messages: { nextPage: false, messages: history } },
    })),
    message: vi.fn(async (_loc: string, id: string) => ({
      ok: true as const,
      data: id === inbound.id ? inbound : { ...outbound, id },
    })),
    requests: vi.fn(async () => ({ ok: true as const, data: evidence })),
    claim: vi.fn(async () => ({ reserved: true as const, id: "confirmation01" })),
    finish: vi.fn(async () => true),
    confirm: vi.fn(async () => {
      event.appointmentStatus = "confirmed";
      return { ok: true as const };
    }),
  };
  const deps: DepsBridge = {
    token: TOKEN,
    lerPiloto: testPilot(ORG, "contact01", "appoint01", START),
    now: () => NOW,
    resolver: async () => scope,
    lerConfig: async () => ({ ok: true, cfg }),
    hit: async () => true,
    contacto: vi.fn(async () => ({
      ok: true as const,
      data: {
        total: 1,
        contacts: [{ id: "contact01", locationId: LOC, dnd: false, dndSettings: {} }],
      },
    })),
    consulta: vi.fn(async () => ({ ok: true as const, data: { appointment: { ...event } } })),
    utilizadorNaLocation: vi.fn(),
    enviar: vi.fn(),
    claim: vi.fn(),
    finish: vi.fn(),
    confirmacao: conf,
  };
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
  return { deps, conf, cfg, scope, event, inbound, outbound, history, evidence, run };
}

describe("appointment.confirm evidence and persistence", () => {
  it("confirms an ordinary SMS reply linked to the exact custom Zaptos request", async () => {
    const f = fixture();
    Object.assign(f.cfg, { channel: "whatsapp_zaptos", zaptosProviderId: "provider01" });
    Object.assign(f.outbound, {
      messageType: "TYPE_CUSTOM_SMS",
      type: 20,
      source: "api",
      conversationProviderId: "provider01",
    });
    expect((await f.run()).body.confirmed).toBe(true);
    expect(f.conf.confirm).toHaveBeenCalledExactlyOnceWith(LOC, "appoint01");
  });
  it.each([undefined, "another-provider"])(
    "rejects custom provider %s before confirming",
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
      expect(f.conf.claim).not.toHaveBeenCalled();
      expect(f.conf.confirm).not.toHaveBeenCalled();
    },
  );
  it("persists verified confirmation after one PUT and fresh read", async () => {
    const f = fixture();
    expect(await f.run()).toMatchObject({
      status: 200,
      body: { confirmed: true, appointmentId: "appoint01", duplicate: false },
    });
    expect(f.conf.confirm).toHaveBeenCalledExactlyOnceWith(LOC, "appoint01");
    expect(f.conf.requests).toHaveBeenCalledExactlyOnceWith(
      ORG,
      "contact01",
      "2026-10-06T12:00:00.000Z",
    );
    expect(f.conf.finish).toHaveBeenCalledWith(ORG, "confirmation01", "confirmed", null);
    expect(f.deps.consulta).toHaveBeenCalledTimes(3);
    expect(f.deps.enviar).not.toHaveBeenCalled();
  });
  it.each(["SIM", "sim", " Confirmo "])("allows exact confirmation %s", async (body) => {
    const f = fixture();
    f.inbound.body = body;
    expect((await f.run()).status).toBe(200);
  });
  it.each(["nao", "sim mas quero remarcar", "SIM?", "não confirmo", "✅"])(
    "does not infer affirmative %s",
    async (body) => {
      const f = fixture();
      f.inbound.body = body;
      expect((await f.run()).body.error).toBe("reply_not_confirmation");
      expect(f.conf.claim).not.toHaveBeenCalled();
    },
  );
  it.each([
    { locationId: "other001" },
    { contactId: "other001" },
    { direction: "outbound" },
    { contentType: "text/html" },
    { messageType: "TYPE_EMAIL" },
  ])("rejects forged or incompatible inbound %j", async (extra) => {
    const f = fixture();
    Object.assign(f.inbound, extra);
    expect((await f.run()).body.error).toBe("reply_not_verified");
    expect(f.conf.confirm).not.toHaveBeenCalled();
  });
  it("authenticates and rejects caller scope/text", async () => {
    const f = fixture();
    expect((await f.run(pedido, "Bearer wrong")).status).toBe(401);
    expect((await f.run({ ...pedido, text: "SIM" })).status).toBe(400);
    expect((await f.run({ ...pedido, organizationId: ORG })).status).toBe(400);
    expect(f.conf.message).not.toHaveBeenCalled();
  });
  it.each(["2026-10-06T11:59:00Z", "2026-10-06T12:06:00Z", START])(
    "rejects invalid reply window %s",
    async (dateAdded) => {
      const f = fixture();
      f.inbound.dateAdded = dateAdded;
      expect((await f.run()).status).toBe(409);
      expect(f.conf.confirm).not.toHaveBeenCalled();
    },
  );
  it("requires durable accepted request", async () => {
    const f = fixture();
    f.evidence.length = 0;
    expect((await f.run()).body.error).toBe("confirmation_request_missing");
  });
  it("refuses competing appointment even when caller picks one", async () => {
    const f = fixture();
    f.evidence.push({
      ...f.evidence[0]!,
      id: "reserved02",
      appointmentId: "appoint02",
      messageId: "outbound02",
    });
    expect((await f.run()).body.error).toBe("confirmation_ambiguous");
    expect(f.conf.claim).not.toHaveBeenCalled();
  });
  it("two request kinds for same appointment are one candidate", async () => {
    const f = fixture();
    f.evidence.push({ ...f.evidence[0]!, id: "reserved02", messageId: "outbound02" });
    expect((await f.run()).status).toBe(200);
  });
  it("refuses incomplete candidate pages and read errors", async () => {
    const f = fixture();
    f.evidence.push(...Array.from({ length: 50 }, () => ({ ...f.evidence[0]! })));
    expect((await f.run()).body.error).toBe("confirmation_evidence_overflow");
    expect(f.conf.confirm).not.toHaveBeenCalled();
  });
  it("does not use requests from another conversation", async () => {
    const f = fixture();
    f.outbound.conversationId = "conversation02";
    expect((await f.run()).body.error).toBe("confirmation_request_missing");
  });
  it.each(["locationId", "contactId", "calendarId", "startTime"])(
    "checks fresh appointment %s",
    async (key) => {
      const f = fixture();
      Object.assign(f.event, { [key]: key === "startTime" ? "2026-10-08T12:00:00Z" : "other001" });
      expect((await f.run()).status).toBe(409);
      expect(f.conf.confirm).not.toHaveBeenCalled();
    },
  );
  it("simulation never reserves, writes, or returns confirmed", async () => {
    const f = fixture();
    f.cfg.simulation = true;
    expect((await f.run()).body).toMatchObject({ simulated: true, confirmed: false });
    expect(f.conf.claim).not.toHaveBeenCalled();
    expect(f.conf.confirm).not.toHaveBeenCalled();
  });
  it.each(["writeEnabled", "integracaoConectada"])("honors scope gate %s", async (key) => {
    const f = fixture();
    Object.assign(f.scope, { [key]: false });
    expect((await f.run()).status).toBe(403);
    expect(f.conf.claim).not.toHaveBeenCalled();
  });
  it("honors live flag", async () => {
    const f = fixture();
    f.cfg.liveSendEnabled = false;
    expect((await f.run()).status).toBe(403);
  });
  it("returns unknown after uncertain PUT; no retry", async () => {
    const f = fixture();
    f.conf.confirm.mockRejectedValue(new Error("timeout"));
    expect((await f.run()).body.error).toBe("confirmation_outcome_unknown");
    expect(f.conf.confirm).toHaveBeenCalledTimes(1);
    expect(f.conf.finish).toHaveBeenCalledWith(ORG, "confirmation01", "unknown", "outcome_unknown");
  });
  it("PUT response alone cannot confirm", async () => {
    const f = fixture();
    f.conf.confirm.mockImplementation(async () => ({ ok: true }));
    expect((await f.run()).body.error).toBe("confirmation_outcome_unknown");
    expect(f.conf.finish).toHaveBeenCalledWith(
      ORG,
      "confirmation01",
      "unknown",
      "verification_failed",
    );
  });
  it("persistence failure cannot report success", async () => {
    const f = fixture();
    f.conf.finish.mockResolvedValue(false);
    expect((await f.run()).body.error).toBe("confirmation_outcome_unknown");
  });
  it("unknown duplicate cannot repeat PUT", async () => {
    const f = fixture();
    f.deps.confirmacao!.claim = async () => ({
      reserved: false,
      id: "confirmation01",
      state: "unknown",
    });
    expect((await f.run()).body.error).toBe("confirmation_already_attempted");
    expect(f.conf.confirm).not.toHaveBeenCalled();
  });
  it("verified duplicate requires GHL still confirmed", async () => {
    const f = fixture();
    f.deps.confirmacao!.claim = async () => ({
      reserved: false,
      id: "confirmation01",
      state: "confirmed",
    });
    expect((await f.run()).status).toBe(409);
    f.event.appointmentStatus = "confirmed";
    expect((await f.run()).body).toMatchObject({ confirmed: true, duplicate: true });
    expect(f.conf.confirm).not.toHaveBeenCalled();
  });
  it("rechecks just before PUT", async () => {
    const f = fixture();
    f.conf.claim.mockImplementation(async () => {
      f.event.appointmentStatus = "cancelled";
      return { reserved: true, id: "confirmation01" };
    });
    expect((await f.run()).body.error).toBe("appointment_changed");
    expect(f.conf.confirm).not.toHaveBeenCalled();
  });
});

describe("authenticated appointment source timestamp", () => {
  it("preserves dateUpdated with explicit timezone", async () => {
    const f = fixture();
    Object.assign(f.event, { dateUpdated: "2026-10-06T13:00:00+01:00" });
    expect(
      (await f.run({ op: "appointment.get", appointmentId: "appoint01" })).body.event.dateUpdated,
    ).toBe("2026-10-06T13:00:00+01:00");
  });
  it("does not invent dateUpdated when absent", async () => {
    const f = fixture();
    expect(
      (await f.run({ op: "appointment.get", appointmentId: "appoint01" })).body.event,
    ).not.toHaveProperty("dateUpdated");
  });
  it.each(["yesterday", "2026-99-99T00:00:00Z", "2026-10-06T13:00:00", 1000, null])(
    "fails closed on invalid source dateUpdated %s",
    async (dateUpdated) => {
      const f = fixture();
      Object.assign(f.event, { dateUpdated });
      expect((await f.run({ op: "appointment.get", appointmentId: "appoint01" })).body.error).toBe(
        "appointment_not_verified",
      );
    },
  );
});

describe("fresh reply context", () => {
  it("rejects an old SIM superseded by NAO or REMARCAR", async () => {
    const f = fixture();
    f.history.unshift({
      ...f.inbound,
      id: "inbound02",
      dateAdded: "2026-10-06T12:01:00Z",
      body: "REMARCAR",
    });
    expect((await f.run()).body.error).toBe("reply_superseded");
    expect(f.conf.claim).not.toHaveBeenCalled();
  });
  it("rejects SIM after an unrelated human question", async () => {
    const f = fixture();
    f.history.push({
      ...f.outbound,
      id: "humanmsg01",
      dateAdded: "2026-10-06T11:59:30Z",
      body: "Deseja outro tratamento?",
    });
    expect((await f.run()).body.error).toBe("confirmation_context_changed");
    expect(f.conf.confirm).not.toHaveBeenCalled();
  });
  it("rechecks latest reply immediately before PUT", async () => {
    const f = fixture();
    f.conf.claim.mockImplementation(async () => {
      f.history.unshift({
        ...f.inbound,
        id: "inbound02",
        dateAdded: "2026-10-06T12:01:00Z",
        body: "NAO",
      });
      return { reserved: true, id: "confirmation01" };
    });
    expect((await f.run()).body.error).toBe("reply_superseded");
    expect(f.conf.confirm).not.toHaveBeenCalled();
    expect(f.conf.finish).toHaveBeenCalledWith(
      ORG,
      "confirmation01",
      "rejected",
      "reply_superseded",
    );
  });
  it("requires complete history instead of trusting a truncated page", async () => {
    const f = fixture();
    f.deps.confirmacao!.conversationMessages = async () => ({
      ok: true,
      data: { messages: { nextPage: true, messages: f.history } },
    });
    expect((await f.run()).body.error).toBe("reply_history_unavailable");
    expect(f.conf.confirm).not.toHaveBeenCalled();
  });
  it("paginates bounded history and accepts older unrelated messages", async () => {
    const f = fixture();
    const read = vi.fn(async (_loc: string, _conv: string, cursor?: string) => ({
      ok: true as const,
      data: {
        messages: cursor
          ? {
              nextPage: false,
              messages: [{ ...f.outbound, id: "oldermsg01", dateAdded: "2026-10-01T10:00:00Z" }],
            }
          : { nextPage: true, lastMessageId: "outbound01", messages: f.history },
      },
    }));
    f.deps.confirmacao!.conversationMessages = read;
    expect((await f.run()).status).toBe(200);
    expect(read).toHaveBeenCalledTimes(4);
  });
  it("blocks tied timestamps instead of choosing an arbitrary latest reply", async () => {
    const f = fixture();
    f.history.push({ ...f.inbound, id: "inbound02", body: "NAO" });
    expect((await f.run()).body.error).toBe("reply_superseded");
  });
});

function acknowledgementFixture() {
  const f = fixture();
  Object.assign(f.cfg, {
    channel: "whatsapp_zaptos",
    channelVerified: true,
    zaptosProviderId: "provider01",
    clinicAddress: "Endereco de teste",
  });
  f.event.appointmentStatus = "confirmed";
  f.deps.verifiedConfirmation = async () => true;
  f.deps.contacto = vi.fn(async () => ({
    ok: true as const,
    data: {
      total: 1,
      contacts: [
        {
          id: "contact01",
          locationId: LOC,
          dnd: false,
          phone: "+351910000000",
          dndSettings: { SMS: { status: "inactive" }, WhatsApp: { status: "inactive" } },
        },
      ],
    },
  }));
  const reserve = vi.fn(async () => ({ reserved: true as const, id: "acksend01" }));
  const send = vi.fn(async () => ({ ok: true as const, messageId: "ackmsg01" }));
  const finish = vi.fn(async () => true);
  f.deps.claim = reserve;
  f.deps.enviar = send;
  f.deps.finish = finish;
  const sendAck = () =>
    f.run({
      op: "message.send",
      appointmentId: "appoint01",
      contactId: "contact01",
      expectedStartTime: START,
      kind: "confirm",
    });
  return { ...f, reserve, send, finish, sendAck };
}

describe("acknowledgement revalidates the persisted reply", () => {
  it("acknowledges the SMS reply linked to the configured custom Zaptos request", async () => {
    const f = acknowledgementFixture();
    Object.assign(f.outbound, {
      messageType: "TYPE_CUSTOM_SMS",
      type: 20,
      source: "api",
      conversationProviderId: "provider01",
    });
    expect((await f.sendAck()).body.status).toBe("accepted");
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.conf.confirm).not.toHaveBeenCalled();
  });
  it.each([undefined, "another-provider"])(
    "blocks acknowledgement for custom provider %s",
    async (provider) => {
      const f = acknowledgementFixture();
      Object.assign(f.outbound, {
        messageType: "TYPE_CUSTOM_SMS",
        type: 20,
        source: "api",
        conversationProviderId: provider,
      });
      expect((await f.sendAck()).body.error).toBe("confirmation_evidence_invalid");
      expect(f.reserve).not.toHaveBeenCalled();
      expect(f.send).not.toHaveBeenCalled();
    },
  );
  it("valid current SIM permits acknowledgement without repeating appointment PUT", async () => {
    const f = acknowledgementFixture();
    expect((await f.sendAck()).body.status).toBe("accepted");
    expect(f.reserve).toHaveBeenCalledTimes(1);
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.conf.confirmedReply).toHaveBeenCalledTimes(2);
    expect(f.conf.conversationMessages).toHaveBeenCalledTimes(2);
    expect(f.conf.confirm).not.toHaveBeenCalled();
    expect(f.conf.claim).not.toHaveBeenCalled();
  });
  it.each(["NAO", "REMARCAR"])(
    "blocks ack after a newer %s even when GHL remains confirmed",
    async (body) => {
      const f = acknowledgementFixture();
      f.history.push({ ...f.inbound, id: "newreply01", dateAdded: "2026-10-06T12:01:00Z", body });
      expect((await f.sendAck()).body.error).toBe("reply_superseded");
      expect(f.reserve).not.toHaveBeenCalled();
      expect(f.send).not.toHaveBeenCalled();
      expect(f.conf.confirm).not.toHaveBeenCalled();
    },
  );
  it("blocks ack after human intervention", async () => {
    const f = acknowledgementFixture();
    f.history.push({
      ...f.outbound,
      id: "humanreply01",
      dateAdded: "2026-10-06T12:01:00Z",
      body: "Vamos alterar a consulta.",
    });
    expect((await f.sendAck()).body.error).toBe("reply_superseded");
    expect(f.reserve).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });
  it("blocks new reply arriving while send reservation is acquired", async () => {
    const f = acknowledgementFixture();
    f.reserve.mockImplementation(async () => {
      f.history.push({
        ...f.inbound,
        id: "newreply01",
        dateAdded: "2026-10-06T12:01:00Z",
        body: "REMARCAR",
      });
      return { reserved: true, id: "acksend01" };
    });
    expect((await f.sendAck()).body.error).toBe("reply_superseded");
    expect(f.send).not.toHaveBeenCalled();
    expect(f.finish).toHaveBeenCalledWith(ORG, "acksend01", "rejected", null, "reply_superseded");
    expect(f.conf.confirm).not.toHaveBeenCalled();
  });
  it("fails closed on unavailable history before reservation", async () => {
    const f = acknowledgementFixture();
    f.conf.conversationMessages.mockRejectedValue(new Error("read failed"));
    expect((await f.sendAck()).body.error).toBe("reply_history_unavailable");
    expect(f.reserve).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });
  it("fails closed on unavailable persisted reference", async () => {
    const f = acknowledgementFixture();
    f.conf.confirmedReply.mockRejectedValue(new Error("read failed"));
    expect((await f.sendAck()).body.error).toBe("confirmation_evidence_unavailable");
    expect(f.reserve).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });
  it("refuses a ledger reference with mismatched reply timestamp", async () => {
    const f = acknowledgementFixture();
    f.conf.confirmedReply.mockResolvedValue({
      ok: true,
      data: {
        requestId: "reserved01",
        inboundMessageId: "inbound01",
        replyAt: "2026-10-06T11:00:00Z",
      },
    });
    expect((await f.sendAck()).body.error).toBe("reply_outside_window");
    expect(f.reserve).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });
  it("refuses an unrelated or missing linked request", async () => {
    const f = acknowledgementFixture();
    f.evidence[0]!.id = "another01";
    expect((await f.sendAck()).body.error).toBe("confirmation_request_missing");
    expect(f.reserve).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });
  it("fresh appointment cancellation during evidence reads prevents acknowledgement", async () => {
    const f = acknowledgementFixture();
    f.conf.conversationMessages.mockImplementation(async () => {
      f.event.appointmentStatus = "cancelled";
      return { ok: true, data: { messages: { nextPage: false, messages: f.history } } };
    });
    expect((await f.sendAck()).body.error).toBe("appointment_changed");
    expect(f.reserve).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });
});

describe("appointment.confirm pilot authorization", () => {
  it.each(["absent", "other-contact", "other-appointment", "other-start", "other-kind", "expired"])(
    "denies %s before the claim or PUT",
    async (reason) => {
      const f = fixture();
      const grant = await testPilot(ORG, "contact01", "appoint01", START)(ORG);
      const row = grant.data!;
      if (reason === "other-contact") row.contact_id = "other001";
      if (reason === "other-appointment") row.ghl_appointment_id = "other001";
      if (reason === "other-start") row.start_time = "2026-10-07T13:00:00Z";
      if (reason === "other-kind") row.allowed_kinds = ["booking"];
      if (reason === "expired") row.expires_at = new Date(NOW).toISOString();
      f.deps.lerPiloto = async () => ({ ok: true, data: reason === "absent" ? null : row });
      expect((await f.run()).status).toBe(403);
      expect(f.conf.claim).not.toHaveBeenCalled();
      expect(f.conf.confirm).not.toHaveBeenCalled();
    },
  );
  it.each(["revoked", "expired", "unavailable"])(
    "rechecks %s after claim before PUT",
    async (reason) => {
      const f = fixture();
      f.conf.claim.mockImplementation(async () => {
        f.deps.lerPiloto = async () =>
          reason === "unavailable"
            ? { ok: false }
            : {
                ok: true,
                data:
                  reason === "revoked"
                    ? null
                    : {
                        ...(await testPilot(ORG, "contact01", "appoint01", START)(ORG)).data,
                        expires_at: new Date(NOW).toISOString(),
                      },
              };
        return { reserved: true, id: "confirmation01" };
      });
      expect((await f.run()).status).toBe(reason === "unavailable" ? 503 : 403);
      expect(f.conf.confirm).not.toHaveBeenCalled();
      expect(f.conf.finish).toHaveBeenCalledWith(
        ORG,
        "confirmation01",
        "rejected",
        expect.stringMatching(/^pilot_/),
      );
    },
  );
  it("a concurrently confirmed GHL event still requires authorization before persisting proof", async () => {
    const f = fixture();
    f.conf.claim.mockImplementation(async () => {
      f.event.appointmentStatus = "confirmed";
      f.deps.lerPiloto = async () => ({ ok: true, data: null });
      return { reserved: true, id: "confirmation01" };
    });
    expect((await f.run()).status).toBe(403);
    expect(f.conf.confirm).not.toHaveBeenCalled();
    expect(f.conf.finish).not.toHaveBeenCalledWith(ORG, "confirmation01", "confirmed", null);
  });
});
