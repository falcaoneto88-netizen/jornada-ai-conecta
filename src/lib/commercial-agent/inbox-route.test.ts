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
      route: {
        channel: "SMS",
        providerId: "native-fictional",
        name: "Nome native-fictional",
        defaultId: Z,
      },
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
  it("IG/FB nativos: rota do próprio canal, sem conversationProviderId nem leitura SMS", () => {
    for (const channel of ["IG", "FB"]) {
      const s = snap("sms-provider-que-nao-deve-ser-herdado");
      s.messages[1] = { ...s.messages[1]!, channel };
      const r = resolveInboxRoute(s, null, Z);
      expect(r).toMatchObject({ ok: true, route: { channel, providerId: null, defaultId: null } });
    }
  });
  it("WhatsApp: fixa o par número comercial ↔ contato da mensagem recebida", () => {
    const s = snap(null);
    s.messages[1] = { ...s.messages[1]!, channel: "WhatsApp", from: "+351910000001", to: "+351210000009" };
    expect(resolveInboxRoute(s, null, Z)).toMatchObject({
      ok: true,
      route: { channel: "WhatsApp", fromNumber: "+351210000009", toNumber: "+351910000001", providerId: null },
    });
  });
  it("WhatsApp sem número comercial identificado bloqueia (nunca o default)", () => {
    const s = snap(null);
    s.messages[1] = { ...s.messages[1]!, channel: "WhatsApp", from: "+351910000001", to: null };
    expect(resolveInboxRoute(s, canais(Z), Z)).toMatchObject({ code: "whatsapp_sender_unverified" });
    s.messages[1] = { ...s.messages[1]!, channel: "WhatsApp", from: "+351910000001", to: "invalido" };
    expect(resolveInboxRoute(s, canais(Z), Z)).toMatchObject({ code: "whatsapp_sender_unverified" });
  });
  it("canal desconhecido fica indisponível com motivo", () => {
    const s = snap("p");
    s.messages[1] = { ...s.messages[1]!, channel: "Email" };
    expect(resolveInboxRoute(s, canais(Z), Z)).toMatchObject({ code: "unsupported_channel" });
  });
});
