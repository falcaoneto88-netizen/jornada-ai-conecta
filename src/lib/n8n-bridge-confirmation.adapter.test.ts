import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { criarDepsConfirmacao, type ClienteBridge } from "./n8n-bridge.server";
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
    data: { requestId: "request01", inboundMessageId: "reply001", replyAt: "2026-10-06T12:00:00Z" },
  });
  expect(from).toHaveBeenCalledExactlyOnceWith("n8n_bridge_confirmations");
  expect(select).toHaveBeenCalledExactlyOnceWith("request_send_id,inbound_message_id,reply_at");
  expect(eq.mock.calls).toEqual([
    ["organization_id", "org01"],
    ["ghl_appointment_id", "appoint01"],
    ["start_time", "2026-10-07T12:00:00Z"],
    ["state", "confirmed"],
  ]);
});
