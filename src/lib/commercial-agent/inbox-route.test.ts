import { describe, expect, it, vi } from "vitest";
import type { Snapshot } from "./core";
import { parseSmsChannels, resolveInboxRoute } from "./inbox-route";
import { HighLevel } from "./providers.server";

const Z = "zaptos-fictional";
const canais = (defaultId: string | null, ids = [Z, "native-fictional"]) =>
  parseSmsChannels({
    conversationChannel: {
      defaults: { SMS: defaultId },
      SMS: ids.map((id) => ({
        conversationProvider: { _id: id, name: `Nome ${id}`, type: "SMS" },
      })),
    },
  });
const snap = (inboundProvider: string | null, outboundProvider: string | null = Z): Snapshot => ({
  event: {
    type: "InboundMessage",
    locationId: "loc",
    contactId: "c",
    conversationId: "v",
    messageId: "in",
  },
  messages: [
    ...(outboundProvider
      ? [
          {
            id: "out",
            at: "2026-10-08T10:00:00Z",
            direction: "outbound" as const,
            text: "x",
            channel: "SMS",
            attachments: 0,
            provider: outboundProvider,
          },
        ]
      : []),
    {
      id: "in",
      at: "2026-10-08T11:00:00Z",
      direction: "inbound",
      text: "y",
      channel: "SMS",
      attachments: 0,
      provider: inboundProvider,
    },
  ],
  dnd: false,
  name: "Contacto",
  historyHash: "a".repeat(64),
});

describe("resolução explícita da rota", () => {
  it("usa o provider da mensagem recebida quando listado", () => {
    expect(resolveInboxRoute(snap("native-fictional"), canais(Z), null)).toEqual({
      ok: true,
      route: { providerId: "native-fictional", name: "Nome native-fictional", defaultId: Z },
    });
  });
  it("provider recebido não listado bloqueia", () => {
    expect(resolveInboxRoute(snap("outro"), canais(Z), Z)).toMatchObject({
      ok: false,
      code: "route_unverified",
    });
  });
  it("sem provider: só com configuração = último envio real = default", () => {
    expect(resolveInboxRoute(snap(null), canais(Z), Z)).toMatchObject({
      ok: true,
      route: { providerId: Z },
    });
    expect(resolveInboxRoute(snap(null), canais(Z), null)).toMatchObject({
      code: "route_unverified",
    });
    expect(resolveInboxRoute(snap(null, null), canais(Z), Z)).toMatchObject({
      code: "route_unverified",
    });
    expect(resolveInboxRoute(snap(null, "native-fictional"), canais(Z), Z)).toMatchObject({
      code: "route_unverified",
    });
    expect(resolveInboxRoute(snap(null), canais("native-fictional"), Z)).toMatchObject({
      code: "route_ambiguous",
    });
    expect(resolveInboxRoute(snap(null), canais(Z, ["native-fictional"]), Z)).toMatchObject({
      code: "route_unverified",
    });
    expect(resolveInboxRoute(snap(null), null, Z)).toMatchObject({ code: "route_unverified" });
  });
  it("canal não SMS (WhatsApp/IG nativos) fica indisponível", () => {
    const s = snap("p");
    s.messages[1] = { ...s.messages[1]!, channel: "WhatsApp" };
    expect(resolveInboxRoute(s, canais(Z), Z)).toMatchObject({ code: "unsupported_channel" });
  });
});

describe("POST e recibo com rota fixada", () => {
  const route = { providerId: Z, name: `Nome ${Z}`, defaultId: Z };
  let receiptProvider: string | null = Z;
  const make = (defaultId: string) => {
    const call = vi.fn(
      async (_c: unknown, path: string, init?: { method?: string; body?: unknown }) => {
        if (path === "locations/loc/conversationChannels/SMS")
          return {
            ok: true as const,
            status: 200,
            data: {
              conversationChannel: {
                defaults: { SMS: defaultId },
                SMS: [{ conversationProvider: { _id: Z, name: `Nome ${Z}`, type: "SMS" } }],
              },
            },
          };
        if (path === "conversations/messages" && init?.method === "POST")
          return {
            ok: true as const,
            status: 200,
            data: { conversationId: "v", messageId: "msg1" },
          };
        if (path === "conversations/v")
          return {
            ok: true as const,
            status: 200,
            data: { id: "v", locationId: "loc", contactId: "c" },
          };
        if (path === "conversations/messages/msg1")
          return {
            ok: true as const,
            status: 200,
            data: {
              message: {
                id: "msg1",
                locationId: "loc",
                contactId: "c",
                conversationId: "v",
                direction: "outbound",
                body: "Olá",
                messageType: "TYPE_SMS",
                conversationProviderId: receiptProvider,
                status: "pending",
                dateAdded: "2026-10-08T11:59:59Z",
              },
            },
          };
        throw new Error("unexpected " + path);
      },
    );
    return {
      call,
      hl: new HighLevel("t", "loc", call as never, () => Date.parse("2026-10-08T12:00:00Z")),
    };
  };
  it("POST leva o conversationProviderId fixado e status pending", async () => {
    const { call, hl } = make(Z);
    expect((await hl.sendManual({ ...snap(null), route }, "Olá")).state).toBe("sent");
    const post = call.mock.calls.find((c) => c[2]?.method === "POST")!;
    expect(post[2]!.body).toMatchObject({
      type: "SMS",
      conversationProviderId: Z,
      status: "pending",
      message: "Olá",
    });
  });
  it("default mudou entre revisão e envio: zero POST", async () => {
    const { call, hl } = make("native-fictional");
    expect(await hl.sendManual({ ...snap(null), route }, "Olá")).toMatchObject({
      state: "rejected",
      code: "route_changed",
    });
    expect(call.mock.calls.some((c) => c[2]?.method === "POST")).toBe(false);
  });
  it("recibo só confere com o provider fixado", async () => {
    const { hl } = make(Z);
    const s = { ...snap(null), route };
    receiptProvider = Z;
    expect(await hl.verifyManualReceipt(s, "Olá", "msg1", "2026-10-08T11:59:58Z")).toBe(true);
    receiptProvider = "native-fictional";
    expect(await hl.verifyManualReceipt(s, "Olá", "msg1", "2026-10-08T11:59:58Z")).toBe(false);
  });
});
