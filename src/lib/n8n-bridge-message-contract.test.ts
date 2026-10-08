import { describe, expect, it } from "vitest";
import { normalizarMensagemGhl, parseMessage } from "./n8n-bridge-confirmation";

const route = { channel: "whatsapp_zaptos" as const, zaptosProviderId: "provider01" };
const custom = {
  id: "message01",
  locationId: "location01",
  contactId: "contact01",
  conversationId: "conversation01",
  direction: "outbound",
  contentType: "text/plain",
  dateAdded: "2026-10-08T17:44:28.571Z",
  body: "Synthetic booking",
  messageType: "TYPE_CUSTOM_SMS",
  type: 20,
  source: "api",
  conversationProviderId: "provider01",
};
const parse = (message: unknown, config = route) =>
  parseMessage(message, "message01", "location01", "outbound", config);

describe("authenticated GHL custom SMS evidence contract", () => {
  it("preserves known custom-provider fields and millisecond time from the authenticated envelope", () => {
    const message = normalizarMensagemGhl({ message: custom, traceId: "synthetic-trace" });
    expect(parse(message)).toEqual({
      id: "message01",
      contactId: "contact01",
      conversationId: "conversation01",
      body: "Synthetic booking",
      time: Date.parse(custom.dateAdded),
      channel: "sms",
    });
  });
  it.each([
    { conversationProviderId: undefined },
    { conversationProviderId: null },
    { conversationProviderId: "other-provider" },
    { conversationProviderId: ["provider01"] },
    { type: "20" },
    { type: 2 },
    { type: undefined },
    { source: undefined },
    { source: "app" },
    { messageType: "TYPE_CUSTOM_WHATSAPP" },
    { direction: "inbound" },
    { contentType: "text/html" },
    { locationId: "another-location" },
    { id: "another-message" },
    { dateAdded: "not-a-date" },
  ])("rejects incompatible or incomplete custom message %j", (change) => {
    expect(parse({ ...custom, ...change })).toBeNull();
  });
  it("does not accept custom SMS without the server route", () => {
    expect(parseMessage(custom, "message01", "location01", "outbound")).toBeNull();
    expect(
      parseMessage(custom, "message01", "location01", "outbound", {
        channel: "sms",
        zaptosProviderId: "provider01",
      }),
    ).toBeNull();
    expect(parse(custom, { ...route, zaptosProviderId: "" })).toBeNull();
  });
  it("does not extend the exception to custom inbound", () => {
    expect(
      parseMessage(
        { ...custom, direction: "inbound" },
        "message01",
        "location01",
        "inbound",
        route,
      ),
    ).toBeNull();
  });
  it.each(["SMS", "TYPE_SMS", "WHATSAPP", "TYPE_WHATSAPP"])(
    "preserves legacy %s inbound without provider/source",
    (messageType) => {
      const inbound = {
        ...custom,
        direction: "inbound",
        body: "SIM",
        messageType,
        conversationProviderId: undefined,
        source: undefined,
        type: 2,
      };
      expect(parseMessage(inbound, "message01", "location01", "inbound", route)).toMatchObject({
        body: "SIM",
      });
    },
  );
});
