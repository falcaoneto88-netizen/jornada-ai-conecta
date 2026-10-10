import { describe, expect, it, vi } from "vitest";
import { AgentError, type Event, type Snapshot } from "./core";
import { HighLevel, type ManualConversationScope } from "./providers.server";

type Call = NonNullable<ConstructorParameters<typeof HighLevel>[2]>;
const scope: ManualConversationScope = {
  locationId: "location-fictional",
  contactId: "contact-fictional",
  conversationId: "conversation-fictional",
};
const clock = () => Date.parse("2026-10-08T16:00:00Z");
const incoming = {
  ...scope,
  id: "inbound-fictional",
  dateAdded: "2026-10-08T12:00:00Z",
  direction: "inbound",
  messageType: "TYPE_CUSTOM_SMS",
  type: 20,
  conversationProviderId: "sms-provider-fictional",
  body: "Pergunta fictícia",
  attachments: [],
  contentType: "text/plain",
};
const humanReply = {
  ...incoming,
  id: "human-reply-fictional",
  dateAdded: "2026-10-08T12:01:00Z",
  direction: "outbound",
  messageType: "TYPE_INSTAGRAM",
  type: 18,
  conversationProviderId: "outbound-provider-fictional",
  body: "Resposta humana fictícia",
};
const event: Event = { ...scope, type: "InboundMessage", messageId: incoming.id };
const page = (messages: unknown[], nextPage = false, lastMessageId?: string) => ({
  messages: { messages, nextPage, ...(lastMessageId ? { lastMessageId } : {}) },
});
const sentText = "Continuação manual fictícia aprovada";
const receipt = {
  ...incoming,
  id: "manual-sent-fictional",
  dateAdded: "2026-10-08T12:02:01Z",
  direction: "outbound",
  body: sentText,
  status: "sent",
};

function fixture(pages: unknown[] = [page([humanReply, incoming])]) {
  let pageIndex = 0;
  const data = {
    conversation: { id: scope.conversationId, ...scope } as unknown,
    contact: {
      contact: { id: scope.contactId, locationId: scope.locationId, dnd: false },
    } as unknown,
    receipt: receipt as unknown,
    pages,
  };
  const call = vi.fn<Call>(async (_config, path, init) => {
    if (path === `conversations/${scope.conversationId}`)
      return { ok: true, status: 200, data: data.conversation };
    if (path === `contacts/${scope.contactId}`)
      return { ok: true, status: 200, data: data.contact };
    if (path === `conversations/${scope.conversationId}/messages`)
      return { ok: true, status: 200, data: data.pages[pageIndex++] };
    if (path === "conversations/messages" && init?.method === "POST")
      return {
        ok: true,
        status: 200,
        data: { conversationId: scope.conversationId, messageId: receipt.id },
      };
    if (path === `conversations/messages/${receipt.id}`)
      return { ok: true, status: 200, data: data.receipt };
    throw new Error("Unexpected fake request");
  });
  const provider = new HighLevel("fake-token-only", scope.locationId, call, clock);
  const resetPages = () => {
    pageIndex = 0;
  };
  return { provider, call, data, resetPages };
}

describe("histórico e rota canônica para atendimento manual", () => {
  it("inclui a resposta humana atual sem relaxar history da IA", async () => {
    const manual = fixture();
    const snapshot = await manual.provider.manualHistory(scope);
    expect(snapshot.event).toEqual(event);
    expect(snapshot.messages.map((message) => [message.id, message.direction])).toEqual([
      [incoming.id, "inbound"],
      [humanReply.id, "outbound"],
    ]);
    expect(snapshot.messages.at(-1)?.text).toBe(humanReply.body);
    expect(snapshot.messages[0]?.provider).toBe(incoming.conversationProviderId);
    expect(snapshot.dnd).toBe(false);
    expect(manual.call.mock.calls.map(([, path]) => path)).toEqual([
      `conversations/${scope.conversationId}`,
      `contacts/${scope.contactId}`,
      `conversations/${scope.conversationId}/messages`,
    ]);
    expect(manual.call.mock.calls.every(([, , init]) => !init?.method)).toBe(true);
    await expect(fixture().provider.history(event)).rejects.toThrow("newer_message_exists");
  });

  it("envia pelo inbound referenciado, mesmo quando o último outbound tem outro canal/provedor", async () => {
    const { provider, call } = fixture();
    const snapshot = await provider.manualHistory(scope);
    expect((await provider.sendManual(snapshot, sentText)).state).toBe("sent");
    expect(call.mock.calls.at(-1)?.[2]).toEqual({
      method: "POST",
      body: {
        type: "SMS",
        contactId: scope.contactId,
        replyMessageId: incoming.id,
        message: sentText,
        status: "pending",
        conversationProviderId: incoming.conversationProviderId,
      },
    });
    expect(call.mock.calls.filter(([, , init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("permite segunda continuação manual mantendo o inbound e atualizando o hash do histórico", async () => {
    const f = fixture();
    const first = await f.provider.manualHistory(scope);
    await f.provider.sendManual(first, sentText);
    f.data.pages = [page([receipt, humanReply, incoming])];
    f.resetPages();
    const second = await f.provider.manualHistory(scope);
    expect(second.event).toEqual(first.event);
    expect(second.messages.at(-1)?.id).toBe(receipt.id);
    expect(second.historyHash).not.toBe(first.historyHash);
    await f.provider.sendManual(second, "Segunda resposta fictícia");
    const writes = f.call.mock.calls.filter(([, , init]) => init?.method === "POST");
    expect(writes).toHaveLength(2);
    for (const [, , init] of writes)
      expect(init?.body).toMatchObject({
        type: "SMS",
        replyMessageId: incoming.id,
        conversationProviderId: incoming.conversationProviderId,
      });
  });

  it("escolhe novo último inbound com seu próprio provedor e rejeita referência antiga", async () => {
    const newest = {
      ...incoming,
      id: "newest-inbound",
      dateAdded: "2026-10-08T12:03:00Z",
      conversationProviderId: "new-provider-fictional",
    };
    const f = fixture([page([incoming, newest, humanReply])]);
    const snapshot = await f.provider.manualHistory(scope);
    expect(snapshot.event.messageId).toBe(newest.id);
    await f.provider.sendManual(snapshot, sentText);
    expect(f.call.mock.calls.at(-1)?.[2]?.body).toMatchObject({
      replyMessageId: newest.id,
      conversationProviderId: newest.conversationProviderId,
    });
    f.call.mockClear();
    await expect(
      f.provider.sendManual(
        { ...snapshot, event: { ...snapshot.event, messageId: incoming.id } },
        sentText,
      ),
    ).rejects.toThrow("manual_route_changed");
    expect(f.call).not.toHaveBeenCalled();
  });

  it("não herda provedor do outbound quando o inbound é WhatsApp sem provedor", async () => {
    const native = { ...incoming, messageType: "TYPE_WHATSAPP", conversationProviderId: undefined };
    const f = fixture([page([native, humanReply])]);
    const snapshot = await f.provider.manualHistory(scope);
    await f.provider.sendManual(snapshot, sentText);
    expect(f.call.mock.calls.at(-1)?.[2]?.body).toMatchObject({ type: "WhatsApp" });
    expect(f.call.mock.calls.at(-1)?.[2]?.body).not.toHaveProperty("conversationProviderId");
  });

  it("lê páginas completas, mantém texto HTML como revisão e descarta atividade interna", async () => {
    const old = { ...incoming, id: "older-inbound", dateAdded: Date.parse("2026-10-07T12:00:00Z") };
    const activity = {
      ...scope,
      id: "activity-fictional",
      dateAdded: "2026-10-08T12:01:30Z",
      messageType: "TYPE_ACTIVITY_APPOINTMENT",
      direction: undefined,
      locationId: undefined,
      contactId: undefined,
    };
    const f = fixture([
      page(
        [humanReply, { ...incoming, contentType: "text/html", body: "<p>Fictício</p>" }, activity],
        true,
        incoming.id,
      ),
      page([old]),
    ]);
    const snapshot = await f.provider.manualHistory(scope);
    expect(snapshot.messages).toHaveLength(3);
    expect(snapshot.messages.find((message) => message.id === incoming.id)?.text).toBe(
      "[Mensagem HTML: revisão no HighLevel]",
    );
    expect(f.call.mock.calls[3]?.[2]?.query).toEqual({ limit: "50", lastMessageId: incoming.id });
    expect(snapshot.event.messageId).toBe(incoming.id);
  });

  it.each(["locationId", "contactId", "conversationId"])(
    "nega escopo estrangeiro na página: %s",
    async (key) => {
      const f = fixture([page([{ ...incoming, [key]: "foreign" }])]);
      await expect(f.provider.manualHistory(scope)).rejects.toThrow("scope_mismatch");
    },
  );

  it.each(["locationId", "contactId"])("exige %s explícito na mensagem externa", async (key) => {
    const f = fixture([page([{ ...incoming, [key]: undefined }])]);
    await expect(f.provider.manualHistory(scope)).rejects.toThrow("history_invalid");
  });

  it.each([
    { ...scope, locationId: "foreign" },
    { ...scope, conversationId: "../invalid" },
    { ...scope, contactId: "" },
  ])("nega escopo inválido antes da API %#", async (requested) => {
    const f = fixture();
    await expect(f.provider.manualHistory(requested)).rejects.toThrow("scope_mismatch");
    expect(f.call).not.toHaveBeenCalled();
  });

  it.each([
    { id: "foreign", ...scope },
    { id: scope.conversationId, ...scope, contactId: "foreign" },
    { id: scope.conversationId, ...scope, locationId: "foreign" },
    { id: scope.conversationId, ...scope, deleted: true },
  ])("nega conversa estrangeira/excluída antes de ler contato %#", async (conversation) => {
    const f = fixture();
    f.data.conversation = conversation;
    await expect(f.provider.manualHistory(scope)).rejects.toThrow("scope_mismatch");
    expect(f.call).toHaveBeenCalledTimes(1);
  });

  it.each([
    { id: "foreign", locationId: scope.locationId },
    { id: scope.contactId, locationId: "foreign" },
  ])("nega identidade do contato divergente %#", async (contact) => {
    const f = fixture();
    f.data.contact = { contact };
    await expect(f.provider.manualHistory(scope)).rejects.toThrow("scope_mismatch");
    expect(f.call).toHaveBeenCalledTimes(2);
  });

  it.each([
    { dnd: true },
    { dndSettings: { SMS: { status: "active" } } },
    { dndSettings: { Email: { status: "permanent" } } },
  ])("preserva bloqueio DND no snapshot manual %#", async (preferences) => {
    const f = fixture();
    f.data.contact = {
      contact: { id: scope.contactId, locationId: scope.locationId, ...preferences },
    };
    expect((await f.provider.manualHistory(scope)).dnd).toBe(true);
  });

  it.each([{ dnd: null }, { dndSettings: null }, { dndSettings: { SMS: { status: "unknown" } } }])(
    "recusa preferências malformadas %#",
    async (preferences) => {
      const f = fixture();
      f.data.contact = {
        contact: { id: scope.contactId, locationId: scope.locationId, ...preferences },
      };
      await expect(f.provider.manualHistory(scope)).rejects.toThrow("history_invalid");
      expect(f.call).toHaveBeenCalledTimes(2);
    },
  );

  it.each([{ messages: [] }, { messages: [humanReply] }])(
    "recusa conversa sem inbound verificável %#",
    async ({ messages }) => {
      await expect(fixture([page(messages)]).provider.manualHistory(scope)).rejects.toThrow(
        "inbound_not_verified",
      );
    },
  );

  it("recusa dois últimos inbounds com o mesmo instante", async () => {
    const f = fixture([page([incoming, { ...incoming, id: "other-inbound" }, humanReply])]);
    await expect(f.provider.manualHistory(scope)).rejects.toThrow("manual_route_ambiguous");
  });

  it("permite empate antigo quando há um último inbound inequivocamente mais recente", async () => {
    const newer = { ...incoming, id: "newer-inbound", dateAdded: "2026-10-08T12:03:00Z" };
    const f = fixture([page([incoming, { ...incoming, id: "old-tie" }, newer])]);
    expect((await f.provider.manualHistory(scope)).event.messageId).toBe(newer.id);
  });

  it.each([
    "invalid",
    "2026-02-30T12:00:00Z",
    "2026-10-08T12:00:00",
    "2026-10-08T16:00:00.001Z",
    -1,
    1.5,
  ])("recusa datas inválidas/futuras mesmo em outbound %#", async (dateAdded) => {
    const f = fixture([page([incoming, { ...humanReply, dateAdded }])]);
    await expect(f.provider.manualHistory(scope)).rejects.toThrow("history_invalid");
  });

  it.each([
    { direction: undefined },
    { direction: "internal" },
    { messageType: undefined, type: 20 },
    { messageType: "" },
    { messageType: "TYPE_" },
    { conversationProviderId: "../invalid" },
  ])("recusa rota externa indeterminada %#", async (change) => {
    const f = fixture([page([{ ...incoming, ...change }])]);
    await expect(f.provider.manualHistory(scope)).rejects.toThrow("history_invalid");
  });

  it("deduplica IDs idênticos entre páginas e dentro da mesma página", async () => {
    const f = fixture([
      page([incoming, incoming], true, incoming.id),
      page([incoming, humanReply]),
    ]);
    expect((await f.provider.manualHistory(scope)).messages).toHaveLength(2);
  });

  it.each([
    { body: "Outra resposta" },
    { conversationProviderId: "different-provider" },
    { direction: "outbound" },
    { messageType: "TYPE_WHATSAPP" },
    { dateAdded: "2026-10-08T12:00:01Z" },
    { attachments: ["https://private.invalid/changed"] },
  ])("recusa duplicata conflitante sem ecoar conteúdo privado %#", async (change) => {
    const f = fixture([page([incoming, { ...incoming, ...change }])]);
    await expect(f.provider.manualHistory(scope)).rejects.toEqual(
      new AgentError("history_conflict"),
    );
  });

  it.each(
    [
      [page([incoming], true)],
      [page([incoming], true, "not-in-page")],
      [page([], true, incoming.id)],
      [page([incoming], true, incoming.id), page([incoming], true, incoming.id)],
    ].map((pages) => ({ pages })),
  )("recusa cursor ausente, incoerente ou em loop %#", async ({ pages }) => {
    await expect(fixture(pages).provider.manualHistory(scope)).rejects.toThrow(
      "history_incomplete",
    );
  });

  it("recusa histórico que continua após vinte páginas", async () => {
    const pages = Array.from({ length: 20 }, (_, i) => {
      const row = { ...incoming, id: `message-${i}` };
      return page([row], true, row.id);
    });
    const f = fixture(pages);
    await expect(f.provider.manualHistory(scope)).rejects.toThrow("history_incomplete");
    expect(f.call).toHaveBeenCalledTimes(22);
  });

  it("não repete envio com resultado incerto", async () => {
    const f = fixture();
    const snapshot = await f.provider.manualHistory(scope);
    f.call.mockClear();
    f.call.mockResolvedValueOnce({
      ok: false,
      status: 504,
      code: "outcome_unknown",
      message: "fake",
    });
    expect(await f.provider.sendManual(snapshot, sentText)).toEqual({
      state: "unknown",
      code: "outcome_unknown",
      messageId: null,
    });
    expect(f.call).toHaveBeenCalledTimes(1);
  });

  it("sanitiza erros de transporte na leitura manual", async () => {
    const f = fixture();
    f.call.mockRejectedValueOnce(new Error("private-provider-payload"));
    await expect(f.provider.manualHistory(scope)).rejects.toEqual(
      new AgentError("ghl_read_failed"),
    );
  });

  it("exceção após despacho vira resultado incerto sem repetir ou expor erro", async () => {
    const f = fixture();
    const snapshot = await f.provider.manualHistory(scope);
    f.call.mockClear();
    f.call.mockRejectedValueOnce(new Error("private-provider-response"));
    expect(await f.provider.sendManual(snapshot, sentText)).toEqual({
      state: "unknown",
      code: "outcome_unknown",
      messageId: null,
    });
    expect(f.call).toHaveBeenCalledTimes(1);
  });

  it.each([
    { conversationId: "foreign-conversation", messageId: receipt.id },
    { conversationId: scope.conversationId, messageId: "../invalid" },
  ])("recibo de envio inválido mantém estado incerto %#", async (result) => {
    const f = fixture();
    const snapshot = await f.provider.manualHistory(scope);
    f.call.mockClear();
    f.call.mockResolvedValueOnce({ ok: true, status: 200, data: result });
    expect(await f.provider.sendManual(snapshot, sentText)).toEqual({
      state: "unknown",
      code: "send_receipt_mismatch",
      messageId: null,
    });
    expect(f.call).toHaveBeenCalledTimes(1);
  });
});

describe("recibo manual vinculado ao inbound de origem", () => {
  it.each([false, true])(
    "aceita aprovação PostgreSQL com microssegundos e recibo envelope=%s",
    async (enveloped) => {
      const f = fixture();
      const snapshot = await f.provider.manualHistory(scope);
      const precise = { ...receipt, dateAdded: "2026-10-08T12:02:01.029408Z" };
      f.data.receipt = enveloped ? { message: precise, traceId: "trace-fictional" } : precise;
      expect(
        await f.provider.verifyManualReceipt(
          snapshot,
          sentText,
          receipt.id,
          "2026-10-08T12:02:00.029408Z",
        ),
      ).toBe(true);
    },
  );

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9])(
    "aceita ISO válido com %i casas fracionárias sem alterar os IDs",
    async (digits) => {
      const f = fixture();
      const snapshot = await f.provider.manualHistory(scope);
      const fraction = "1".repeat(digits);
      f.data.receipt = {
        message: { ...receipt, dateAdded: `2026-10-08T13:02:01.${fraction}+01:00` },
      };
      expect(
        await f.provider.verifyManualReceipt(
          snapshot,
          sentText,
          receipt.id,
          `2026-10-08T12:02:00.${fraction}Z`,
        ),
      ).toBe(true);
    },
  );

  it("trunca microssegundos em vez de arredondar a janela de cinco minutos", async () => {
    const f = fixture();
    const snapshot = await f.provider.manualHistory(scope);
    f.data.receipt = { ...receipt, dateAdded: "2026-10-08T12:07:00.001000001Z" };
    expect(
      await f.provider.verifyManualReceipt(
        snapshot,
        sentText,
        receipt.id,
        "2026-10-08T12:02:00.000999999Z",
      ),
    ).toBe(false);
    f.data.receipt = { ...receipt, dateAdded: "2026-10-08T12:07:00.000999999Z" };
    expect(
      await f.provider.verifyManualReceipt(
        snapshot,
        sentText,
        receipt.id,
        "2026-10-08T12:02:00.000000001Z",
      ),
    ).toBe(true);
  });

  it.each([
    null,
    [],
    { message: null },
    { message: [receipt] },
    { message: { message: receipt }, traceId: "trace-fictional" },
    { ...receipt, message: receipt },
    { ...receipt, message: { ...receipt, contactId: "foreign" } },
    { message: { ...receipt, message: receipt } },
    { message: receipt, traceId: 123 },
    { message: receipt, contactId: "foreign" },
    { messages: receipt },
  ])("recusa envelope malformado, aninhado ou com identidades ambíguas %#", async (raw) => {
    const f = fixture();
    const snapshot = await f.provider.manualHistory(scope);
    f.data.receipt = raw;
    expect(
      await f.provider.verifyManualReceipt(
        snapshot,
        sentText,
        receipt.id,
        "2026-10-08T12:02:00.029408Z",
      ),
    ).toBe(false);
  });

  it.each([
    { id: "foreign" },
    { locationId: "foreign" },
    { contactId: "foreign" },
    { conversationId: "foreign" },
    { conversationProviderId: "foreign-provider" },
    { body: "Outro texto" },
  ])("mantém verificações exatas dentro do envelope observado %#", async (change) => {
    const f = fixture();
    const snapshot = await f.provider.manualHistory(scope);
    f.data.receipt = { message: { ...receipt, ...change }, traceId: "trace-fictional" };
    expect(
      await f.provider.verifyManualReceipt(
        snapshot,
        sentText,
        receipt.id,
        "2026-10-08T12:02:00.029408Z",
      ),
    ).toBe(false);
  });

  it.each([
    "2026-10-08T12:02:00.1234567890Z",
    "2026-02-30T12:02:00.029408Z",
    "2026-10-08T12:02:00.029408",
  ])("recusa ISO inválido antes de truncar: %s", async (date) => {
    const f = fixture();
    const snapshot = await f.provider.manualHistory(scope);
    expect(await f.provider.verifyManualReceipt(snapshot, sentText, receipt.id, date)).toBe(false);
    f.data.receipt = { message: { ...receipt, dateAdded: date } };
    expect(
      await f.provider.verifyManualReceipt(snapshot, sentText, receipt.id, "2026-10-08T12:02:00Z"),
    ).toBe(false);
  });

  async function waSnapshot(f: ReturnType<typeof fixture>) {
    const snap = await f.provider.manualHistory(scope);
    snap.messages = snap.messages.map((m) =>
      m.id === snap.event.messageId
        ? {
            ...m,
            channel: "WhatsApp" as const,
            provider: null,
            from: "+351910000001",
            to: "+351210000009",
          }
        : m,
    );
    snap.route = {
      channel: "WhatsApp",
      providerId: null,
      name: "WhatsApp",
      defaultId: null,
      fromNumber: "+351210000009",
      toNumber: "+351910000001",
    };
    return snap;
  }
  const waReceipt = {
    ...receipt,
    messageType: "TYPE_WHATSAPP",
    conversationProviderId: undefined,
    from: "+351210000009",
    to: "+351910000001",
  };
  it("recibo WhatsApp com o par remetente/destino canónico exato é aceite", async () => {
    const f = fixture();
    const snap = await waSnapshot(f);
    f.data.receipt = { message: waReceipt };
    expect(
      await f.provider.verifyManualReceipt(snap, sentText, receipt.id, "2026-10-08T12:02:00Z"),
    ).toBe(true);
  });
  it.each([
    { from: "+351210000777" },
    { to: "+351910000999" },
    { from: undefined },
    { to: undefined },
  ])("recibo WhatsApp de outro número comercial/destino é recusado %#", async (change) => {
    const f = fixture();
    const snap = await waSnapshot(f);
    f.data.receipt = { message: { ...waReceipt, ...change } };
    expect(
      await f.provider.verifyManualReceipt(snap, sentText, receipt.id, "2026-10-08T12:02:00Z"),
    ).toBe(false);
  });
  it("payload nativo WhatsApp: tipo exato, pending, fromNumber/toNumber, sem provedor SMS", async () => {
    const f = fixture();
    const snap = await waSnapshot(f);
    f.call.mockClear();
    await f.provider.sendManual(snap, sentText).catch(() => null);
    const post = f.call.mock.calls.find(([, , init]) => init?.method === "POST");
    expect(post?.[2]?.body).toMatchObject({
      type: "WhatsApp",
      status: "pending",
      message: sentText,
      fromNumber: "+351210000009",
      toNumber: "+351910000001",
    });
    expect(post?.[2]?.body).not.toHaveProperty("conversationProviderId");
  });

  it("confere SMS/provedor do inbound e não Instagram/provedor do outbound mais recente", async () => {
    const f = fixture();
    const snapshot = await f.provider.manualHistory(scope);
    f.call.mockClear();
    expect(
      await f.provider.verifyManualReceipt(snapshot, sentText, receipt.id, "2026-10-08T12:02:00Z"),
    ).toBe(true);
    expect(f.call.mock.calls.map(([, path]) => path)).toEqual([
      `conversations/${scope.conversationId}`,
      `conversations/messages/${receipt.id}`,
    ]);
    expect(f.call.mock.calls.every(([, , init]) => !init?.method)).toBe(true);
  });

  it.each([
    { id: "foreign" },
    { locationId: "foreign" },
    { contactId: "foreign" },
    { conversationId: "foreign" },
    { conversationProviderId: humanReply.conversationProviderId },
    { messageType: humanReply.messageType },
    { direction: "inbound" },
    { body: "Outro texto" },
    { status: "failed" },
    { dateAdded: "2026-10-08T12:01:54Z" },
    { dateAdded: "2026-10-08T12:07:01Z" },
    { dateAdded: "2026-02-30T12:02:00Z" },
    { locationId: undefined },
  ])("recibo divergente não confirma o envio %#", async (change) => {
    const f = fixture();
    const snapshot = await f.provider.manualHistory(scope);
    f.data.receipt = { ...receipt, ...change };
    expect(
      await f.provider.verifyManualReceipt(snapshot, sentText, receipt.id, "2026-10-08T12:02:00Z"),
    ).toBe(false);
  });

  it("não confirma um provedor inesperado quando a rota original não possui provedor", async () => {
    const f = fixture([page([{ ...incoming, conversationProviderId: undefined }, humanReply])]);
    const snapshot = await f.provider.manualHistory(scope);
    expect(
      await f.provider.verifyManualReceipt(snapshot, sentText, receipt.id, "2026-10-08T12:02:00Z"),
    ).toBe(false);
    f.data.receipt = { ...receipt, conversationProviderId: undefined };
    expect(
      await f.provider.verifyManualReceipt(snapshot, sentText, receipt.id, "2026-10-08T12:02:00Z"),
    ).toBe(true);
  });

  it.each(["invalid", "2026-10-08T16:00:01Z"])(
    "nega horário de aprovação inválido/futuro: %s",
    async (approvedAt) => {
      const f = fixture();
      const snapshot = await f.provider.manualHistory(scope);
      f.call.mockClear();
      expect(await f.provider.verifyManualReceipt(snapshot, sentText, receipt.id, approvedAt)).toBe(
        false,
      );
      expect(f.call).not.toHaveBeenCalled();
    },
  );

  it("nega snapshot alterado de outra location sem rede ou envio", async () => {
    const f = fixture();
    const snapshot: Snapshot = await f.provider.manualHistory(scope);
    snapshot.event.locationId = "foreign";
    f.call.mockClear();
    await expect(f.provider.sendManual(snapshot, sentText)).rejects.toThrow("scope_mismatch");
    await expect(
      f.provider.verifyManualReceipt(snapshot, sentText, receipt.id, "2026-10-08T12:02:00Z"),
    ).rejects.toThrow("scope_mismatch");
    expect(f.call).not.toHaveBeenCalled();
  });
});
