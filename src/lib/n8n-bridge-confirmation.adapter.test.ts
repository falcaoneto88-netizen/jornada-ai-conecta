import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { criarDepsConfirmacao, type ClienteBridge } from "./n8n-bridge.server";
import { parseMessage } from "./n8n-bridge-confirmation";
const db = {} as ClienteBridge;
beforeEach(() => {
  vi.stubEnv("GHL_PRIVATE_TOKEN", "synthetic-private-test-token");
  vi.stubEnv("GHL_LOCATION_ID", "location01");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("confirmation adapter", () => {
  it("uses fixed endpoint and narrow body without triggering automations", async () => {
    const fetch = vi.fn(async () => Response.json({ appointmentStatus: "confirmed" }));
    vi.stubGlobal("fetch", fetch);
    expect(await criarDepsConfirmacao(db).confirm("location01", "appoint01")).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(1);
    const call = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe(
      "https://services.leadconnectorhq.com/calendars/events/appointments/appoint01",
    );
    expect(call[1].method).toBe("PUT");
    expect(JSON.parse(String(call[1].body))).toEqual({
      appointmentStatus: "confirmed",
      toNotify: false,
    });
    expect(call[1].redirect).toBe("manual");
  });
  it("reads evidence from authenticated message endpoint", async () => {
    const fetch = vi.fn(async () => Response.json({ id: "message01" }));
    vi.stubGlobal("fetch", fetch);
    await criarDepsConfirmacao(db).message("location01", "message01");
    expect((fetch.mock.calls[0] as unknown as [string])[0]).toBe(
      "https://services.leadconnectorhq.com/conversations/messages/message01",
    );
  });
  const message = {
    id: "message01",
    locationId: "location01",
    contactId: "contact01",
    conversationId: "conversation01",
    dateAdded: "2026-10-08T17:44:28.571Z",
    direction: "outbound",
    contentType: "text/plain",
    body: "Synthetic booking",
    messageType: "TYPE_SMS",
  };
  it.each([message, { message }, { message, traceId: "synthetic-trace" }])(
    "normalizes a supported authenticated message response without altering fields",
    async (payload) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json(payload)),
      );
      const read = await criarDepsConfirmacao(db).message("location01", "message01");
      expect(read).toEqual({ ok: true, data: message });
      expect(
        read.ok && parseMessage(read.data, "message01", "location01", "outbound"),
      ).toMatchObject({ id: "message01" });
    },
  );
  it.each([
    null,
    [],
    { message: null },
    { message: [] },
    { message: "message01" },
    { message, traceId: 1 },
    { message, id: "other-message" },
    { message, locationId: "another-location" },
    { message, unknown: true },
    { message: { ...message, message } },
  ])("rejects malformed or ambiguous message envelopes", async (payload) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(payload)),
    );
    expect(await criarDepsConfirmacao(db).message("location01", "message01")).toEqual({
      ok: true,
      data: null,
    });
  });
  it.each([{ id: "other-message" }, { locationId: "another-location" }])(
    "does not replace conflicting inner identity using request parameters",
    async (change) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json({ message: { ...message, ...change } })),
      );
      const read = await criarDepsConfirmacao(db).message("location01", "message01");
      expect(read.ok && parseMessage(read.data, "message01", "location01", "outbound")).toBeNull();
    },
  );
  it.each([503, 302])("uncertain HTTP %i never retries writes", async (status) => {
    const fetch = vi.fn(async () => new Response("{}", { status }));
    vi.stubGlobal("fetch", fetch);
    expect(await criarDepsConfirmacao(db).confirm("location01", "appoint01")).toEqual({
      ok: false,
      definitive: false,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("rejects explicit 4xx definitively", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 403 })),
    );
    expect(await criarDepsConfirmacao(db).confirm("location01", "appoint01")).toEqual({
      ok: false,
      definitive: true,
    });
  });
});

it("persistent confirmation lookup scopes organization, appointment and exact start", async () => {
  const { criarDepsBridge } = await import("./n8n-bridge.server");
  const eq = vi.fn();
  const query = { eq, maybeSingle: async () => ({ data: { id: "confirmation01" }, error: null }) };
  eq.mockReturnValue(query);
  const from = vi.fn(() => ({ select: vi.fn(() => query) }));
  const deps = criarDepsBridge({ from } as unknown as ClienteBridge);
  expect(await deps.verifiedConfirmation!("org01", "appoint01", "2026-10-07T12:00:00Z")).toBe(true);
  expect(from).toHaveBeenCalledExactlyOnceWith("n8n_bridge_confirmations");
  expect(eq.mock.calls).toEqual([
    ["organization_id", "org01"],
    ["ghl_appointment_id", "appoint01"],
    ["start_time", "2026-10-07T12:00:00Z"],
    ["state", "confirmed"],
  ]);
});

it("reads acknowledgement reference only from the scoped confirmed ledger", async () => {
  const eq = vi.fn();
  const query = {
    eq,
    maybeSingle: async () => ({
      data: {
        request_send_id: "request01",
        inbound_message_id: "reply001",
        reply_at: "2026-10-06T12:00:00Z",
        finished_at: "2026-10-06T12:01:00.043998Z",
      },
      error: null,
    }),
  };
  eq.mockReturnValue(query);
  const select = vi.fn(() => query);
  const from = vi.fn(() => ({ select }));
  const deps = criarDepsConfirmacao({ from } as unknown as ClienteBridge);
  expect(await deps.confirmedReply("org01", "appoint01", "2026-10-07T12:00:00Z")).toEqual({
    ok: true,
    data: {
      requestId: "request01",
      inboundMessageId: "reply001",
      replyAt: "2026-10-06T12:00:00Z",
      finishedAt: "2026-10-06T12:01:00.043998Z",
    },
  });
  expect(from).toHaveBeenCalledExactlyOnceWith("n8n_bridge_confirmations");
  expect(select).toHaveBeenCalledExactlyOnceWith(
    "request_send_id,inbound_message_id,reply_at,finished_at",
  );
  expect(eq.mock.calls).toEqual([
    ["organization_id", "org01"],
    ["ghl_appointment_id", "appoint01"],
    ["start_time", "2026-10-07T12:00:00Z"],
    ["state", "confirmed"],
  ]);
});

it.each([undefined, null, 123])(
  "refuses persisted confirmation without usable completion %s",
  async (finishedAt) => {
    const query = {
      eq: vi.fn(),
      maybeSingle: async () => ({
        data: {
          request_send_id: "request01",
          inbound_message_id: "reply001",
          reply_at: "2026-10-06T12:00:00Z",
          finished_at: finishedAt,
        },
        error: null,
      }),
    };
    query.eq.mockReturnValue(query);
    const deps = criarDepsConfirmacao({
      from: () => ({ select: () => query }),
    } as unknown as ClienteBridge);
    expect(await deps.confirmedReply("org01", "appoint01", "2026-10-07T12:00:00Z")).toEqual({
      ok: false,
      code: "invalid_evidence",
    });
  },
);
