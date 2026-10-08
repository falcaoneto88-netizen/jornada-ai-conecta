import { describe, expect, it, vi } from "vitest";
import { GHL_ORIGIN, GHL_VERSION, type GhlConfig, type GhlResult } from "../ghl.server";
import { AgentError } from "./core";
import type { DiscoveryGet } from "./discovery.server";
import { discoverLocationEvents, type LocationDiscoveryInput } from "./location-discovery.server";

const input: LocationDiscoveryInput = {
  locationId: "location-fictional",
  since: "2026-10-08T12:00:00.000Z",
  until: "2026-10-08T12:30:00.000Z",
};
const config: GhlConfig = {
  locationId: input.locationId,
  token: "fake-token-only",
  baseUrl: GHL_ORIGIN,
  version: GHL_VERSION,
};
const now = () => Date.parse("2026-10-08T13:00:00.000Z");
const message = {
  id: "inbound-fictional",
  locationId: input.locationId,
  contactId: "contact-fictional",
  conversationId: "conversation-fictional",
  dateAdded: "2026-10-08T12:01:00.000Z",
  direction: "inbound",
  messageType: "TYPE_CUSTOM_SMS",
  type: 20,
  body: "Texto privado fictício que não pode ser devolvido",
  attachments: ["https://private.invalid/attachment"],
  conversationProviderId: "provider-not-returned",
  from: "+5500000000000",
  to: "+5511111111111",
  meta: { private: "private-metadata" },
};
const email = {
  ...message,
  id: "email-fictional",
  messageType: "TYPE_EMAIL",
  type: 3,
};
const page = (messages: unknown[], total = messages.length, nextCursor: string | null = null) => ({
  messages,
  total,
  nextCursor,
});
const ok = (data: unknown): GhlResult<unknown> => ({ ok: true, status: 200, data });
function scenario(nonEmail: unknown[] = [page([message])], emails: unknown[] = [page([])]) {
  const indexes = { other: 0, email: 0 };
  const call = vi.fn<DiscoveryGet>(async (_cfg, path, init) => {
    if (path !== "conversations/messages/export" || init.method !== "GET")
      throw new Error("Unexpected request");
    return ok(
      init.query?.["channel"] === "Email" ? emails[indexes.email++] : nonEmail[indexes.other++],
    );
  });
  const run = (requested = input, cfg = config, clock = now) =>
    discoverLocationEvents(requested, { config: cfg, call, now: clock });
  return { call, run };
}

describe("descoberta canônica das mensagens da subconta", () => {
  it("completa os dois fluxos, preserva IDs e ordena mensagens sem devolver dados privados", async () => {
    const outgoing = {
      ...message,
      id: "outgoing-fictional",
      direction: "outbound",
      dateAdded: "2026-10-08T12:03:00Z",
    };
    const secondContact = {
      ...message,
      id: "other-message-fictional",
      contactId: "other-contact-fictional",
      conversationId: "other-conversation-fictional",
      dateAdded: "2026-10-08T12:04:00Z",
      messageType: "TYPE_NEW_CUSTOM_CHANNEL",
      type: 99,
    };
    const firstEmail = { ...email, dateAdded: "2026-10-08T12:02:00Z" };
    const secondEmail = {
      ...email,
      id: "email-second-fictional",
      dateAdded: "2026-10-08T12:05:00Z",
    };
    const { run, call } = scenario(
      [page([outgoing, message], 3, "opaque-other-2"), page([secondContact], 3, "")],
      [page([firstEmail], 2, "opaque-email-2"), page([secondEmail], 2)],
    );
    const results = await run();
    expect(results).toEqual(
      [message, firstEmail, outgoing, secondContact, secondEmail].map((item) => ({
        event: {
          type: item.direction === "inbound" ? "InboundMessage" : "OutboundMessage",
          locationId: item.locationId,
          contactId: item.contactId,
          conversationId: item.conversationId,
          messageId: item.id,
        },
        observedAt: new Date(item.dateAdded).toISOString(),
      })),
    );
    expect(call.mock.calls.map((args) => args[2].query?.["channel"])).toEqual([
      undefined,
      undefined,
      "Email",
      "Email",
    ]);
    expect(call.mock.calls.map((args) => args[2].query?.["cursor"])).toEqual([
      undefined,
      "opaque-other-2",
      undefined,
      "opaque-email-2",
    ]);
    for (const [cfg, path, init] of call.mock.calls) {
      expect(cfg).toEqual(config);
      expect(path).toBe("conversations/messages/export");
      expect(init).toMatchObject({
        method: "GET",
        query: {
          locationId: input.locationId,
          startDate: input.since,
          endDate: input.until,
          sortBy: "createdAt",
          sortOrder: "asc",
          limit: "100",
        },
      });
      expect(init).not.toHaveProperty("body");
      expect(init.query).not.toHaveProperty("contactId");
    }
    const serialized = JSON.stringify(results);
    for (const privateValue of [
      message.body,
      message.attachments[0],
      message.conversationProviderId,
      message.from,
      message.to,
      message.meta.private,
    ])
      expect(serialized).not.toContain(privateValue);
  });

  it("zero resultados exige conclusão comprovada dos dois fluxos", async () => {
    const { run, call } = scenario([page([], 0, "")], [page([])]);
    expect(await run()).toEqual([]);
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("aplica filtro de contato em todas as páginas dos dois fluxos", async () => {
    const second = { ...message, id: "second-fictional" };
    const { run, call } = scenario(
      [page([message], 2, "next-fictional"), page([second], 2)],
      [page([email])],
    );
    const results = await run({ ...input, contactId: message.contactId });
    expect(results).toHaveLength(3);
    for (const [, , init] of call.mock.calls)
      expect(init.query?.["contactId"]).toBe(message.contactId);
  });

  it.each(["other", "email"])("nega contato divergente no fluxo %s", async (stream) => {
    const wrong = { ...message, contactId: "foreign-contact" };
    const { run } =
      stream === "other" ? scenario([page([wrong])]) : scenario([page([])], [page([wrong])]);
    await expect(run({ ...input, contactId: message.contactId })).rejects.toThrow("scope_mismatch");
  });

  it("aceita duplicatas idênticas entre páginas/fluxos e retorna os mesmos IDs a cada leitura", async () => {
    const second = { ...message, id: "second-fictional" };
    const data = [page([message], 2, "next-fictional"), page([message, second], 2)];
    const first = await scenario(data, [page([message])]).run();
    const again = await scenario(data, [page([message])]).run();
    expect(first).toEqual(again);
    expect(first).toHaveLength(2);
    expect(first.map((item) => item.event.messageId)).toEqual([message.id, second.id]);
  });

  it.each([
    { contactId: "foreign-contact" },
    { conversationId: "foreign-conversation" },
    { dateAdded: "2026-10-08T12:02:00Z" },
    { direction: "outbound" },
    { messageType: "TYPE_WHATSAPP" },
    { type: 21 },
  ])("nega o mesmo ID com metadados divergentes %#", async (change) => {
    const { run } = scenario([page([message])], [page([{ ...message, ...change }])]);
    await expect(run()).rejects.toThrow("discovery_message_conflict");
  });

  it("não confunde alterações de corpo com novo evento ou conflito de metadados", async () => {
    const changedText = {
      ...message,
      body: "outro corpo que também não pode sair",
      attachments: [],
    };
    const results = await scenario([page([message, changedText], 1)]).run();
    expect(results).toHaveLength(1);
    expect(JSON.stringify(results)).not.toContain(changedText.body);
  });

  it("retém limites inclusivos, aceita Unix ms e filtra linhas fora da janela", async () => {
    const rows = [
      { ...message, id: "before", dateAdded: "2026-10-08T11:59:59.999Z" },
      { ...message, id: "at-start", dateAdded: Date.parse(input.since) },
      { ...message, id: "at-end", dateAdded: "2026-10-08T13:30:00+01:00" },
      { ...message, id: "after", dateAdded: "2026-10-08T12:30:00.001Z" },
    ];
    const results = await scenario([page(rows)]).run();
    expect(results.map((row) => [row.event.messageId, row.observedAt])).toEqual([
      ["at-start", input.since],
      ["at-end", input.until],
    ]);
  });

  it("ordena empates de inbound/outbound deterministicamente sem criar timestamps no evento", async () => {
    const outgoing = { ...message, id: "a-outgoing", direction: "outbound" };
    const incoming = { ...message, id: "z-incoming" };
    const result = await scenario([page([incoming, outgoing])]).run();
    expect(result.map((row) => row.event.type)).toEqual(["OutboundMessage", "InboundMessage"]);
    for (const row of result) expect(Object.keys(row.event)).toHaveLength(5);
    expect(result[0]?.observedAt).toBe(result[1]?.observedAt);
  });

  it.each([
    "TYPE_CALL",
    "TYPE_CUSTOM_CALL",
    "TYPE_IVR_CALL",
    "TYPE_VOICEMAIL",
    "TYPE_ACTIVITY_APPOINTMENT",
    "TYPE_ACTIVITY_CONTACT",
    "TYPE_ACTIVITY_OPPORTUNITY",
    "TYPE_INTERNAL_COMMENT",
    "InternalComment",
  ])("exclui %s mesmo sem contato/conversa/direção externa", async (messageType) => {
    const excluded = {
      ...message,
      id: "excluded-fictional",
      messageType,
      contactId: undefined,
      conversationId: undefined,
      direction: undefined,
    };
    const results = await scenario([page([excluded, message])]).run({
      ...input,
      contactId: message.contactId,
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.event.messageId).toBe(message.id);
  });

  it("comentário com direção interna não vira OutboundMessage", async () => {
    expect(
      await scenario([
        page([{ ...message, messageType: "InternalComment", direction: "internal" }]),
      ]).run(),
    ).toEqual([]);
  });

  it.each(["SMS", "CUSTOM_SMS", "NEW_CHANNEL", "WHATSAPP", "INSTAGRAM", "WEBCHAT", "EMAIL"])(
    "aceita metadados de tipo externo %s sem inferir disponibilidade do canal",
    async (messageType) => {
      const results = await scenario([page([{ ...message, messageType }])]).run();
      expect(results[0]?.event).toMatchObject({ type: "InboundMessage", messageId: message.id });
    },
  );

  it("aceita nome do tipo no campo type quando messageType não está presente", async () => {
    const results = await scenario([
      page([{ ...message, messageType: undefined, type: "TYPE_SMS" }]),
    ]).run();
    expect(results).toHaveLength(1);
  });

  it.each([
    { messages: [message], total: 2, nextCursor: null },
    { messages: [message], total: 0, nextCursor: "" },
    { messages: [], total: 1, nextCursor: "cursor-empty" },
  ])("nega término incompleto ou contagem impossível %#", async (response) => {
    await expect(scenario([response]).run()).rejects.toThrow("history_incomplete");
  });

  it("nega total que muda durante a paginação", async () => {
    const { run } = scenario([
      page([message], 2, "next-fictional"),
      page([{ ...message, id: "second-fictional" }], 3),
    ]);
    await expect(run()).rejects.toThrow("history_incomplete");
  });

  it("nega cursor repetido mesmo quando a nova página tem IDs novos", async () => {
    const { run, call } = scenario([
      page([message], 3, "loop-fictional"),
      page([{ ...message, id: "second-fictional" }], 3, "loop-fictional"),
    ]);
    await expect(run()).rejects.toThrow("history_incomplete");
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("nega página sem progresso mesmo que o cursor mude", async () => {
    const { run } = scenario([
      page([message], 2, "first-cursor"),
      page([message], 2, "different-cursor"),
    ]);
    await expect(run()).rejects.toThrow("history_incomplete");
  });

  it("nega mais de vinte páginas sem devolver o primeiro fluxo parcialmente", async () => {
    const pages = Array.from({ length: 20 }, (_, i) =>
      page([{ ...message, id: `page-message-${i}` }], 21, `cursor-${i}`),
    );
    const { run, call } = scenario(pages);
    await expect(run()).rejects.toThrow("history_incomplete");
    expect(call).toHaveBeenCalledTimes(20);
  });

  it("nega volume acima do limite antes de buscar outras páginas", async () => {
    const { run, call } = scenario([page([message], 2001, "next-fictional")]);
    await expect(run()).rejects.toThrow("history_incomplete");
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("falha por inteiro quando o fluxo Email estiver incompleto", async () => {
    const { run, call } = scenario([page([message])], [page([email], 2)]);
    await expect(run()).rejects.toThrow("history_incomplete");
    expect(call).toHaveBeenCalledTimes(2);
  });

  it.each([
    { messages: [message], total: 1 },
    { messages: [message], total: 1, nextCursor: false },
    { messages: [message], total: 1, nextCursor: " " },
    { messages: [message], total: 1, nextCursor: "cursor\ninvalid" },
    { messages: [message], total: 1, nextCursor: "x".repeat(16_385) },
    { messages: [message], nextCursor: null },
    { messages: [message], total: 1.5, nextCursor: null },
    { messages: [message], total: -1, nextCursor: null },
    { messages: Array(101).fill(message), total: 1, nextCursor: null },
    { messages: { messages: [message] }, total: 1, nextCursor: null },
  ])("nega forma ambígua da página %#", async (response) => {
    await expect(scenario([response]).run()).rejects.toThrow("discovery_history_invalid");
  });

  it.each([
    { id: undefined },
    { id: "../invalid" },
    { locationId: undefined },
    { contactId: undefined },
    { conversationId: undefined },
    { contactId: "bad/id" },
    { conversationId: "bad/id" },
    { direction: undefined },
    { direction: "internal" },
    { direction: "INBOUND" },
    { messageType: undefined, type: undefined },
    { messageType: undefined, type: 20 },
    { messageType: "" },
    { messageType: "TYPE_" },
    { messageType: "SMS", type: "EMAIL" },
    { type: -1 },
  ])("nega metadados de mensagem externa inválidos %#", async (change) => {
    await expect(scenario([page([{ ...message, ...change }])]).run()).rejects.toThrow(
      "discovery_history_invalid",
    );
  });

  it.each(["TYPE_CUSTOM_SMS", "TYPE_ACTIVITY_APPOINTMENT"])(
    "nega location estrangeira inclusive para %s",
    async (messageType) => {
      await expect(
        scenario([page([{ ...message, locationId: "foreign-location", messageType }])]).run(),
      ).rejects.toThrow("scope_mismatch");
    },
  );

  it.each([
    "invalid",
    "2026-10-08",
    "2026-10-08T12:00:00",
    "2026-02-30T12:00:00Z",
    "2026-10-08T12:00:00.0001Z",
    "2026-10-08T13:00:00.001Z",
    -1,
    123.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER,
  ])("nega data inválida/futura mesmo que fora da janela %#", async (dateAdded) => {
    await expect(scenario([page([{ ...message, dateAdded }])]).run()).rejects.toThrow(AgentError);
  });

  it("valida data de atividade excluída e não apenas de mensagens retornadas", async () => {
    await expect(
      scenario([
        page([{ ...message, messageType: "TYPE_ACTIVITY_CONTACT", dateAdded: "invalid" }]),
      ]).run(),
    ).rejects.toThrow("discovery_timestamp_invalid");
  });

  it.each([
    { since: "invalid" },
    { until: "invalid" },
    { since: "2026-10-08T12:31:00Z" },
    { until: "2026-10-08T13:00:00.001Z" },
    { since: "2026-10-08T12:00:00" },
    { until: "2026-10-08" },
    { since: 123 as unknown as string },
  ])("nega janela inválida antes de qualquer chamada %#", async (change) => {
    const { run, call } = scenario();
    await expect(run({ ...input, ...change })).rejects.toThrow("discovery_window_invalid");
    expect(call).not.toHaveBeenCalled();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])(
    "nega relógio inválido sem consulta: %s",
    async (clock) => {
      const { run, call } = scenario();
      await expect(run(input, config, () => clock)).rejects.toThrow("discovery_window_invalid");
      expect(call).not.toHaveBeenCalled();
    },
  );

  it.each([
    { ...input, locationId: "foreign-location" },
    { ...input, locationId: "../invalid" },
    { ...input, contactId: "../invalid" },
    { ...input, contactId: "" },
  ])("nega escopo de entrada inválido antes da API %#", async (requested) => {
    const { run, call } = scenario();
    await expect(run(requested)).rejects.toThrow("scope_mismatch");
    expect(call).not.toHaveBeenCalled();
  });

  it.each([
    { ...config, baseUrl: "https://foreign.invalid" },
    { ...config, version: "2020-01-01" },
  ])("nega origem/versão fora do contrato oficial %#", async (cfg) => {
    const { run, call } = scenario();
    await expect(run(input, cfg)).rejects.toThrow("discovery_config_invalid");
    expect(call).not.toHaveBeenCalled();
  });

  it.each(["rate_limited", "unauthorized", "timeout"] as const)(
    "sanitiza erro do provedor %s sem copiar resposta",
    async (code) => {
      const call = vi.fn<DiscoveryGet>(async () => ({
        ok: false,
        status: 429,
        code,
        message: "credential-and-private-response-must-not-escape",
      }));
      await expect(discoverLocationEvents(input, { config, call, now })).rejects.toEqual(
        new AgentError(code === "rate_limited" ? "ghl_rate_limited" : "ghl_read_failed"),
      );
    },
  );

  it("sanitiza exceção de transporte e não expõe eventos do primeiro fluxo", async () => {
    const call = vi
      .fn<DiscoveryGet>()
      .mockResolvedValueOnce(ok(page([message])))
      .mockRejectedValueOnce(new Error("private-response-must-not-escape"));
    await expect(discoverLocationEvents(input, { config, call, now })).rejects.toEqual(
      new AgentError("ghl_read_failed"),
    );
  });
});
