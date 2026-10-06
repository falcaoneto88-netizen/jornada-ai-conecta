import { describe, expect, it, vi } from "vitest";
import { GHL_ORIGIN, GHL_VERSION, type GhlConfig, type GhlResult } from "../ghl.server";
import { AgentError } from "./core";
import { discoverContactEvents, type DiscoveryGet, type DiscoveryInput } from "./discovery.server";

const input: DiscoveryInput = {
  locationId: "location-test",
  contactId: "contact-test",
  since: "2026-10-06T12:00:00.000Z",
};
const config: GhlConfig = {
  locationId: input.locationId,
  token: "fake-token-only",
  baseUrl: GHL_ORIGIN,
  version: GHL_VERSION,
};
const now = () => Date.parse("2026-10-06T13:00:00.000Z");
const conversation = {
  id: "conversation-test",
  contactId: input.contactId,
  locationId: input.locationId,
};
const contact = { contact: { id: input.contactId, locationId: input.locationId } };
const search = { conversations: [conversation], total: 1 };
const message = {
  id: "inbound-test",
  contactId: input.contactId,
  locationId: input.locationId,
  conversationId: conversation.id,
  dateAdded: "2026-10-06T12:01:00.000Z",
  direction: "inbound",
  messageType: "TYPE_SMS",
  body: "Conteúdo privado fictício",
};
const ok = (data: unknown): GhlResult<unknown> => ({ ok: true, status: 200, data });
const page = (messages: unknown[], nextPage = false, lastMessageId?: string) => ({
  messages: { messages, nextPage, ...(lastMessageId ? { lastMessageId } : {}) },
});
function scenario(pages: unknown[] = [page([message])], overrides: Record<string, unknown> = {}) {
  let pageIndex = 0;
  const call = vi.fn<DiscoveryGet>(async (_cfg, path) => {
    if (path in overrides) return ok(overrides[path]);
    if (path === `contacts/${input.contactId}`) return ok(contact);
    if (path === "conversations/search") return ok(search);
    if (path === `conversations/${conversation.id}`) return ok(conversation);
    if (path === `conversations/${conversation.id}/messages`) return ok(pages[pageIndex++]);
    throw new Error("Unexpected request");
  });
  const run = (requested = input, cfg = config) =>
    discoverContactEvents(requested, { config: cfg, call, now });
  return { call, run };
}

describe("descoberta autenticada de eventos do contato", () => {
  it("confirma identidade, recupera IDs reais, ordena inbound/outbound e só devolve metadados", async () => {
    const { call, run } = scenario([
      page(
        [
          {
            ...message,
            id: "outbound-test",
            direction: "outbound",
            dateAdded: "2026-10-06T12:02:00Z",
          },
          message,
        ],
        true,
        message.id,
      ),
      page([{ ...message, id: "old-test", dateAdded: "2026-10-06T11:59:59.999Z" }]),
    ]);
    const events = await run();
    expect(events).toEqual([
      {
        type: "InboundMessage",
        locationId: input.locationId,
        contactId: input.contactId,
        conversationId: conversation.id,
        messageId: message.id,
      },
      {
        type: "OutboundMessage",
        locationId: input.locationId,
        contactId: input.contactId,
        conversationId: conversation.id,
        messageId: "outbound-test",
      },
    ]);
    expect(JSON.stringify(events)).not.toContain(message.body);
    expect(call.mock.calls.map((c) => c[1])).toEqual([
      `contacts/${input.contactId}`,
      "conversations/search",
      `conversations/${conversation.id}`,
      `conversations/${conversation.id}/messages`,
      `conversations/${conversation.id}/messages`,
    ]);
    expect(call.mock.calls[1]?.[2].query).toEqual({
      contactId: input.contactId,
      locationId: input.locationId,
      limit: "2",
    });
    expect(call.mock.calls[4]?.[2].query).toEqual({ limit: "50", lastMessageId: message.id });
    for (const [cfg, path, init] of call.mock.calls) {
      expect(cfg).toEqual(config);
      expect(init.method).toBe("GET");
      expect(init).not.toHaveProperty("body");
      expect(path).not.toMatch(/https?:|\.\./);
    }
  });

  it("aceita zero conversas somente após confirmar o contato e o total exato", async () => {
    const { run, call } = scenario([], { "conversations/search": { conversations: [], total: 0 } });
    expect(await run()).toEqual([]);
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("descobre SMS do provedor e Instagram no formato observado, ignorando as atividades", async () => {
    // Only the type distribution reflects the read-only diagnosis; every ID/body/date is fictitious.
    const custom = Array.from({ length: 13 }, (_, i) => ({
      ...message,
      id: `custom-sms-${i}`,
      dateAdded: `2026-10-06T12:${String(i + 1).padStart(2, "0")}:00.000Z`,
      direction: i % 2 ? "outbound" : "inbound",
      messageType: "TYPE_CUSTOM_SMS",
      type: 20,
      conversationProviderId: "provider-test",
    }));
    const activities = [
      ...Array.from({ length: 7 }, () => ({ messageType: "TYPE_ACTIVITY_APPOINTMENT", type: 31 })),
      ...Array.from({ length: 2 }, () => ({ messageType: "TYPE_ACTIVITY_CONTACT", type: 25 })),
      { messageType: "TYPE_ACTIVITY_OPPORTUNITY", type: 28 },
    ].map((activity, i) => ({
      ...message,
      ...activity,
      id: `activity-${i}`,
      direction: undefined,
    }));
    const instagram = {
      ...message,
      id: "instagram-test",
      dateAdded: "2026-10-06T12:14:00.000Z",
      messageType: "TYPE_INSTAGRAM",
      type: 18,
    };
    const fixture = [...custom, ...activities, instagram];
    expect(fixture).toHaveLength(24);
    const { run } = scenario([page(fixture.reverse())]);
    const events = await run();
    expect(events).toEqual(
      [...custom, instagram].map((m) => ({
        type: m.direction === "inbound" ? "InboundMessage" : "OutboundMessage",
        locationId: m.locationId,
        contactId: m.contactId,
        conversationId: m.conversationId,
        messageId: m.id,
      })),
    );
    expect(JSON.stringify(events)).not.toContain("provider-test");
    expect(JSON.stringify(events)).not.toContain(message.body);
  });

  it.each([
    { conversations: [conversation] },
    { conversations: [], total: 1 },
    { conversations: [conversation], total: 2 },
    { conversations: [conversation, { ...conversation, id: "other" }], total: 2 },
    { conversations: [conversation], total: 1.5 },
    { conversations: [conversation], total: 0 },
  ])("nega busca incompleta ou ambígua %#", async (response) => {
    const { run, call } = scenario([], { "conversations/search": response });
    await expect(run()).rejects.toThrow("discovery_conversations_ambiguous");
    expect(call).toHaveBeenCalledTimes(2);
  });

  it.each([
    [`contacts/${input.contactId}`, { contact: { ...contact.contact, id: "foreign" } }, 1],
    [`contacts/${input.contactId}`, { contact: { ...contact.contact, locationId: "foreign" } }, 1],
    [
      "conversations/search",
      { conversations: [{ ...conversation, contactId: "foreign" }], total: 1 },
      2,
    ],
    [
      "conversations/search",
      { conversations: [{ ...conversation, locationId: "foreign" }], total: 1 },
      2,
    ],
    [`conversations/${conversation.id}`, { ...conversation, id: "foreign" }, 3],
    [`conversations/${conversation.id}`, { ...conversation, contactId: "foreign" }, 3],
    [`conversations/${conversation.id}`, { ...conversation, locationId: "foreign" }, 3],
    [`conversations/${conversation.id}`, { ...conversation, deleted: true }, 3],
  ])("nega escopo divergente antes de ler mensagens %#", async (path, response, count) => {
    const { run, call } = scenario([], { [String(path)]: response });
    await expect(run()).rejects.toThrow("scope_mismatch");
    expect(call).toHaveBeenCalledTimes(Number(count));
  });

  it.each(["contactId", "locationId", "conversationId"])(
    "nega mensagem com %s divergente",
    async (field) => {
      await expect(scenario([page([{ ...message, [field]: "foreign" }])]).run()).rejects.toThrow(
        "scope_mismatch",
      );
    },
  );

  it.each(["contactId", "locationId", "conversationId", "id"])(
    "nega mensagem sem %s",
    async (field) => {
      await expect(scenario([page([{ ...message, [field]: undefined }])]).run()).rejects.toThrow(
        "discovery_history_invalid",
      );
    },
  );

  it.each([
    "",
    "2026-10-06",
    "2026-10-06T12:00:00",
    "2026-02-30T12:00:00Z",
    "2026-10-06T12:00:00.0001Z",
    "invalid",
    "2026-10-06T13:00:00.001Z",
  ])("nega início inválido/futuro antes da API: %s", async (since) => {
    const { run, call } = scenario();
    await expect(run({ ...input, since })).rejects.toThrow("discovery_since_invalid");
    expect(call).not.toHaveBeenCalled();
  });

  it.each([
    { ...input, contactId: "../foreign" },
    { ...input, locationId: "foreign" },
  ])("nega escopo de entrada antes da API %#", async (value) => {
    const { run, call } = scenario();
    await expect(run(value)).rejects.toThrow("scope_mismatch");
    expect(call).not.toHaveBeenCalled();
  });

  it.each([
    { ...config, baseUrl: "https://untrusted.invalid" },
    { ...config, version: "untrusted" },
  ])("nega configuração fora do contrato oficial %#", async (cfg) => {
    const { run, call } = scenario();
    await expect(run(input, cfg)).rejects.toThrow("discovery_config_invalid");
    expect(call).not.toHaveBeenCalled();
  });

  it("inclui exatamente o início, respeita fuso e exclui mensagens anteriores", async () => {
    const { run } = scenario([
      page([
        { ...message, id: "before", dateAdded: "2026-10-06T11:59:59.999Z" },
        { ...message, id: "at-start", dateAdded: "2026-10-06T09:00:00-03:00" },
        { ...message, id: "after", dateAdded: Date.parse(message.dateAdded) },
      ]),
    ]);
    expect((await run()).map((e) => e.messageId)).toEqual(["at-start", "after"]);
  });

  it.each(["bad", "2026-02-30T12:01:00Z", "2026-10-06T12:01:00", "2026-10-06T13:00:00.001Z", -1])(
    "nega data da API inválida ou além do relógio observado: %s",
    async (dateAdded) => {
      await expect(scenario([page([{ ...message, dateAdded }])]).run()).rejects.toThrow(
        "discovery_timestamp_invalid",
      );
    },
  );

  it("nega precedência incerta entre inbound e outbound com o mesmo instante", async () => {
    await expect(
      scenario([page([message, { ...message, id: "out", direction: "outbound" }])]).run(),
    ).rejects.toThrow("discovery_order_ambiguous");
  });

  it("ordena empates da mesma direção de forma estável", async () => {
    const { run } = scenario([
      page([
        { ...message, id: "z" },
        { ...message, id: "a" },
      ]),
    ]);
    expect((await run()).map((e) => e.messageId)).toEqual(["a", "z"]);
  });

  it("ignora comentários, chamadas e atividades mesmo sem direção externa", async () => {
    const { run } = scenario([
      page([
        ...[
          "InternalComment",
          "TYPE_INTERNAL_COMMENT",
          "TYPE_ACTIVITY_APPOINTMENT",
          "TYPE_CALL",
          "TYPE_CAMPAIGN_VOICEMAIL",
        ].map((messageType, i) => ({
          ...message,
          id: `ignored-${i}`,
          messageType,
          direction: undefined,
        })),
        message,
      ]),
    ]);
    expect((await run()).map((e) => e.messageId)).toEqual([message.id]);
  });

  it.each([
    { messageType: "SMS", direction: "unknown" },
    { messageType: "unknown", direction: "outbound" },
    { messageType: undefined, type: 99 },
  ])("nega tipo/direção sem classificação segura %#", async (change) => {
    await expect(scenario([page([{ ...message, ...change }])]).run()).rejects.toThrow(
      "discovery_history_invalid",
    );
  });

  it("tolera sobreposição idêntica e repete IDs em redescoberta para deduplicação no ingresso", async () => {
    const pages = [page([message, message], true, message.id), page([message])];
    const first = await scenario(pages).run();
    expect(first).toHaveLength(1);
    expect(await scenario(pages).run()).toEqual(first);
  });

  it.each([
    { direction: "outbound" },
    { dateAdded: "2026-10-06T12:02:00Z" },
    { messageType: "EMAIL" },
  ])("nega metadados contraditórios no mesmo ID antes da deduplicação %#", async (change) => {
    await expect(scenario([page([message, { ...message, ...change }])]).run()).rejects.toThrow(
      "discovery_message_conflict",
    );
  });

  it.each([
    { messages: { messages: [message] } },
    { messages: { messages: Array.from({ length: 51 }, () => message), nextPage: false } },
  ])("nega página fora do contrato %#", async (response) => {
    await expect(scenario([response]).run()).rejects.toThrow("discovery_history_invalid");
  });

  it.each([page([message], true), page([], true, "cursor"), page([message], true, "not-in-page")])(
    "nega paginação sem avanço comprovado %#",
    async (response) => {
      await expect(scenario([response]).run()).rejects.toThrow("history_incomplete");
    },
  );

  it("nega cursor repetido ou ciclo de páginas sem devolver eventos parciais", async () => {
    const other = { ...message, id: "other", dateAdded: "2026-10-06T12:02:00Z" };
    const { run } = scenario([
      page([message], true, message.id),
      page([other], true, other.id),
      page([message], true, message.id),
    ]);
    await expect(run()).rejects.toThrow("history_incomplete");
  });

  it("não encerra ao alcançar since; exige toda a história e falha se exceder 20 páginas", async () => {
    const pages = Array.from({ length: 20 }, (_, i) =>
      page([{ ...message, id: `old-${i}`, dateAdded: "2026-10-05T12:00:00Z" }], true, `old-${i}`),
    );
    const { run, call } = scenario(pages);
    await expect(run()).rejects.toThrow("history_incomplete");
    expect(call).toHaveBeenCalledTimes(23);
  });

  it("aceita conclusão na vigésima página", async () => {
    const pages = Array.from({ length: 20 }, (_, i) =>
      page([{ ...message, id: `message-${i}` }], i < 19, `message-${i}`),
    );
    expect(await scenario(pages).run()).toHaveLength(20);
  });

  it.each(["rate_limited", "timeout", "forbidden"] as const)(
    "sanitiza falhas %s da API",
    async (code) => {
      const call = vi.fn<DiscoveryGet>().mockResolvedValue({
        ok: false,
        status: 500,
        code,
        message: "provider-secret-must-not-escape",
      });
      await expect(discoverContactEvents(input, { config, call, now })).rejects.toThrow(
        code === "rate_limited" ? "ghl_rate_limited" : "ghl_read_failed",
      );
      expect(call).toHaveBeenCalledTimes(1);
    },
  );

  it("sanitiza exceções do transporte sem retornar dados de paciente ou credenciais", async () => {
    const call = vi.fn<DiscoveryGet>().mockRejectedValue(new Error("secret-must-not-escape"));
    await expect(discoverContactEvents(input, { config, call, now })).rejects.toThrow(
      "ghl_read_failed",
    );
    call.mockRejectedValue(new AgentError("secret-must-not-escape"));
    await expect(discoverContactEvents(input, { config, call, now })).rejects.toThrow(
      "ghl_read_failed",
    );
  });
});
