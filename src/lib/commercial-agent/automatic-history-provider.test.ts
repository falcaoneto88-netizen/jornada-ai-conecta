import { describe, expect, it, vi } from "vitest";
import type { Event } from "./core";
import { HighLevel, sha } from "./providers.server";
import { resolveInboxRoute } from "./inbox-route";

const event: Event = {
  type: "InboundMessage",
  locationId: "loc-test",
  contactId: "contact-test",
  conversationId: "conversation-test",
  messageId: "incoming-test",
};
const instant = "2026-11-17T12:00:00.000Z";
const message = {
  id: event.messageId,
  locationId: event.locationId,
  contactId: event.contactId,
  conversationId: event.conversationId,
  dateAdded: instant,
  body: "Olá",
  messageType: "TYPE_WHATSAPP",
  direction: "inbound",
  attachments: [],
  from: "+351910000001",
  to: "+351210000002",
};
const page = (messages: unknown[], nextPage = false) => ({
  messages: { messages, nextPage, ...(nextPage ? { lastMessageId: "cursor-test" } : {}) },
});
function fixture(pages: unknown[]) {
  const call = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      data: {
        id: event.conversationId,
        contactId: event.contactId,
        locationId: event.locationId,
      },
    })
    .mockResolvedValueOnce({
      ok: true,
      data: {
        contact: { id: event.contactId, locationId: event.locationId, dnd: false },
      },
    });
  for (const data of pages) call.mockResolvedValueOnce({ ok: true, data });
  return {
    call,
    provider: new HighLevel(
      "synthetic-token",
      event.locationId,
      call,
      () => Date.parse(instant) + 1000,
    ),
  };
}

describe("histórico canônico usado pelo envio automático", () => {
  it("preserva e fixa o par WhatsApp no transporte real da classe, com HTTP simulado", async () => {
    const { provider, call } = fixture([page([message])]);
    const snapshot = await provider.history(event);
    expect(snapshot.messages[0]).toMatchObject({ from: message.from, to: message.to });
    const resolved = resolveInboxRoute(snapshot, null, null);
    expect(resolved).toMatchObject({
      ok: true,
      route: {
        channel: "WhatsApp",
        fromNumber: message.to,
        toNumber: message.from,
      },
    });
    if (!resolved.ok) throw new Error("missing synthetic route");
    call.mockResolvedValueOnce({
      ok: true,
      data: {
        conversationId: event.conversationId,
        messageId: "synthetic-outbound",
      },
    });
    expect(await provider.sendManual({ ...snapshot, route: resolved.route }, "Olá!")).toMatchObject(
      { state: "sent" },
    );
    expect(call).toHaveBeenLastCalledWith(expect.anything(), "conversations/messages", {
      method: "POST",
      body: expect.objectContaining({
        type: "WhatsApp",
        fromNumber: message.to,
        toNumber: message.from,
      }),
    });
  });
  it("inclui ambos os números no hash, impedindo reutilização após troca de rota", async () => {
    const first = await fixture([page([message])]).provider.history(event);
    for (const change of [{ from: "+351910000003" }, { to: "+351210000004" }]) {
      const changed = await fixture([page([{ ...message, ...change }])]).provider.history(event);
      expect(changed.historyHash).not.toBe(first.historyHash);
    }
  });
  it.each(["TYPE_SMS", "TYPE_INSTAGRAM", "TYPE_FACEBOOK"] as const)(
    "preserva a forma e o hash anteriores para %s",
    async (messageType) => {
      const snapshot = await fixture([page([{ ...message, messageType }])]).provider.history(event);
      const expected = [
        {
          id: event.messageId,
          at: instant,
          direction: "inbound",
          text: "Olá",
          channel: { TYPE_SMS: "SMS", TYPE_INSTAGRAM: "IG", TYPE_FACEBOOK: "FB" }[messageType],
          attachments: 0,
          provider: null,
        },
      ];
      expect(snapshot.messages).toEqual(expected);
      expect(snapshot.historyHash).toBe(sha(JSON.stringify(expected)));
    },
  );
  it.each([{ from: undefined }, { to: undefined }, { from: "invalid" }, { to: message.from }])(
    "não resolve rota WhatsApp ausente ou inválida: %j",
    async (change) => {
      const snapshot = await fixture([page([{ ...message, ...change }])]).provider.history(event);
      expect(resolveInboxRoute(snapshot, null, null)).toEqual({
        ok: false,
        code: "whatsapp_sender_unverified",
      });
    },
  );
  it.each([{ locationId: undefined }, { contactId: undefined }, { from: 123 }])(
    "recusa metadados WhatsApp não verificáveis: %j",
    async (change) => {
      await expect(
        fixture([page([{ ...message, ...change }])]).provider.history(event),
      ).rejects.toThrow();
    },
  );
  it.each([{ from: "+351910000003" }, { to: "+351210000004" }, { messageType: "TYPE_SMS" }])(
    "recusa o mesmo ID com par ou canal conflitante na mesma página: %j",
    async (change) => {
      await expect(
        fixture([page([message, { ...message, ...change }])]).provider.history(event),
      ).rejects.toThrow("history_conflict");
    },
  );
  it("recusa troca de par entre páginas, sem sobrescrever evidência", async () => {
    const { provider } = fixture([
      page([message], true),
      page([{ ...message, to: "+351210000004" }]),
    ]);
    await expect(provider.history(event)).rejects.toThrow("history_conflict");
  });
  it("aceita repetição idêntica de metadados entre páginas", async () => {
    const { provider } = fixture([page([message], true), page([message])]);
    expect((await provider.history(event)).messages).toHaveLength(1);
  });
});
