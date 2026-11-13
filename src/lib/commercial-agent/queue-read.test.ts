import { describe, expect, it, vi } from "vitest";
import { queuePageSchema, manualQueueSchema, type QueuePageRequest } from "./queue-read";
import { readAgentQueuePage, readManualQueuePage } from "./queue-read.server";
import { POLICY_HASH, replyHash, seal } from "./providers.server";
import type { DraftPayload } from "./core";

const org = "00000000-0000-4000-8000-000000000001";
const scope = { organizationId: org, locationId: "test-location", actorId: "test-actor" };
const key = Buffer.alloc(32, 12).toString("base64");
const input: QueuePageRequest = {
  category: "review",
  page: 2,
  pageSize: 25,
  query: "Ana",
  asOf: "2026-11-12T10:00:00Z",
};
function fixture() {
  const payload: DraftPayload = {
    snapshot: {
      event: {
        type: "InboundMessage",
        locationId: scope.locationId,
        contactId: "test-contact",
        conversationId: "test-conversation",
        messageId: "test-message",
      },
      name: "Nome antigo do snapshot",
      historyHash: "history-hash",
      dnd: false,
      messages: [
        {
          id: "test-message",
          at: "2026-11-12T09:00:00Z",
          direction: "inbound",
          text: "Dúvida fictícia",
          channel: "WhatsApp",
          attachments: 0,
          provider: null,
        },
      ],
    },
    decision: { reply: "Resposta fictícia para revisão", flags: [], handoff: false, optOut: false },
    policyHash: POLICY_HASH,
    model: "synthetic",
    inputTokens: 1,
    outputTokens: 1,
  };
  const row = {
    id: "00000000-0000-4000-8000-000000000002",
    organization_id: org,
    location_id: scope.locationId,
    event_id: "test-event",
    contact_id: "test-contact",
    conversation_id: "test-conversation",
    message_id: "test-message",
    state: "pending",
    version: 1,
    contact_version: 1,
    payload: seal(payload, key, `${org}:test-event`),
    reply_hash: replyHash(payload),
    expires_at: "2026-11-12T10:15:00Z",
    created_at: "2026-11-12T09:59:00Z",
    result_message_id: null,
    approved_at: null,
    error_code: null,
    paused: false,
    opt_out: false,
    session_version: 1,
    policy_hash: POLICY_HASH,
    contact_name: "Ana Fictícia Atualizada",
    category: "review",
    approved_by: "sensitive-unused-actor",
  };
  const result = {
    settings: {
      organization_id: org,
      location_id: scope.locationId,
      mode: "supervised",
      allowed_contacts: ["test-contact"],
      allowed_channels: ["WhatsApp"],
    },
    asOf: input.asOf,
    items: [row],
    errors: [],
    counts: { review: 68, team: 2, uncertain: 1, history: 150 },
    failedEventCount: 0,
    ignoredEventCount: 70,
  };
  const client = { rpc: vi.fn().mockResolvedValue({ data: result, error: null }) };
  const config = { encryptionKey: key, enabled: true, sendEnabled: false };
  return { payload, row, result, client, config };
}

describe("fila paginada de supervisão: fronteira de leitura", () => {
  it("passa filtros, página e escopo autenticado à projeção SQL sem RPC de comando", async () => {
    const f = fixture();
    const result = await readAgentQueuePage(f.client, scope, input, f.config);
    expect(f.client.rpc).toHaveBeenCalledExactlyOnceWith("commercial_agent_queue_read", {
      _org: org,
      _location: scope.locationId,
      _actor: scope.actorId,
      _kind: "drafts",
      _category: "review",
      _query: "Ana",
      _page: 2,
      _page_size: 25,
      _as_of: input.asOf,
      _policy_hash: POLICY_HASH,
    });
    expect(result.pagination).toMatchObject({ page: 2, total: 68, totalPages: 3, hasMore: true });
    expect(result.items[0]).toMatchObject({
      contactName: "Ana Fictícia Atualizada",
      channel: "WhatsApp",
      policyCurrent: true,
    });
    expect(result.items[0]).not.toHaveProperty("payload");
    expect(result.items[0]).not.toHaveProperty("approved_by");
    expect(result.sendEnabled).toBe(false);
    expect(result.ignoredEventCount).toBe(70);
    expect(result.errors).toEqual([]);
  });
  it.each(["organization_id", "location_id"] as const)(
    "recusa linha de outro %s antes de desencriptar",
    async (field) => {
      const f = fixture();
      f.row[field] = "foreign";
      await expect(readAgentQueuePage(f.client, scope, input, f.config)).rejects.toThrow(
        "scope_mismatch",
      );
    },
  );
  it("recusa configuração de outra clínica", async () => {
    const f = fixture();
    f.result.settings.organization_id = "foreign";
    await expect(readAgentQueuePage(f.client, scope, input, f.config)).rejects.toThrow(
      "scope_mismatch",
    );
  });
  it.each(["contactId", "conversationId", "messageId", "locationId"] as const)(
    "liga o conteúdo cifrado ao %s da linha",
    async (field) => {
      const f = fixture();
      f.payload.snapshot.event[field] = "foreign";
      f.row.payload = seal(f.payload, key, `${org}:test-event`);
      f.row.reply_hash = replyHash(f.payload);
      await expect(readAgentQueuePage(f.client, scope, input, f.config)).rejects.toThrow(
        "scope_mismatch",
      );
    },
  );
  it("valida a identidade criptográfica da resposta", async () => {
    const f = fixture();
    f.row.reply_hash = "other-hash";
    await expect(readAgentQueuePage(f.client, scope, input, f.config)).rejects.toThrow(
      "scope_mismatch",
    );
  });
  it("não promove política antiga nem exige ciphertext para preservar o histórico", async () => {
    const f = fixture();
    f.row.category = "history";
    f.payload.policyHash = "old-policy";
    f.row.policy_hash = f.payload.policyHash;
    f.row.payload = seal(f.payload, key, `${org}:test-event`);
    f.row.reply_hash = replyHash(f.payload);
    const first = await readAgentQueuePage(
      f.client,
      scope,
      { ...input, category: "history" },
      f.config,
    );
    expect(first.items[0]?.policyCurrent).toBe(false);
    f.row.payload = "";
    const second = await readAgentQueuePage(
      f.client,
      scope,
      { ...input, category: "history" },
      f.config,
    );
    expect(second.items[0]).toMatchObject({
      content: null,
      contactName: "Ana Fictícia Atualizada",
    });
  });
  it("não apresenta evento ignorado como falha mesmo se a projeção estiver incorreta", async () => {
    const f = fixture();
    f.client.rpc.mockResolvedValue({
      error: null,
      data: {
        ...f.result,
        errors: [
          {
            id: "event",
            state: "ignored",
            error_code: "newer_message_exists",
            attempts: 1,
            created_at: input.asOf,
          },
        ],
      },
    });
    await expect(readAgentQueuePage(f.client, scope, input, f.config)).rejects.toThrow(
      "storage_unavailable",
    );
  });
  it("falha de forma explícita sem fallback para lista truncada quando falta migração", async () => {
    const f = fixture();
    f.client.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202" } });
    await expect(readAgentQueuePage(f.client, scope, input, f.config)).rejects.toThrow(
      "queue_read_unavailable",
    );
    expect(f.client.rpc).toHaveBeenCalledTimes(1);
  });
  it("limita entradas e recusa escopo administrativo vindo do navegador", () => {
    expect(queuePageSchema.parse({ organizationId: org })).toMatchObject({
      category: "review",
      query: "",
      page: 1,
      pageSize: 25,
    });
    for (const addition of [
      { locationId: "other" },
      { actorId: "other" },
      { pageSize: 51 },
      { page: 0 },
      { query: "a".repeat(101) },
    ])
      expect(queuePageSchema.safeParse({ organizationId: org, ...addition }).success).toBe(false);
    expect(manualQueueSchema.safeParse({ organizationId: org, category: "review" }).success).toBe(
      false,
    );
  });
  it("pesquisa conversas com fonte canônica, sem depender de rascunho ou canal inventado", async () => {
    const f = fixture();
    const item = {
      locationId: scope.locationId,
      contactId: "contact-without-draft",
      conversationId: "conversation",
      sessionVersion: 3,
      paused: true,
      optOut: false,
      lastMessageAt: null,
      contactName: "Nome do cadastro",
      channel: null,
    };
    f.client.rpc.mockResolvedValue({
      error: null,
      data: { settings: f.result.settings, asOf: input.asOf, total: 71, items: [item] },
    });
    const result = await readManualQueuePage(f.client, scope, {
      query: "Nome",
      page: 3,
      pageSize: 25,
    });
    expect(result).toMatchObject({ items: [item], total: 71, totalPages: 3, hasMore: false });
    expect(f.client.rpc.mock.calls[0]?.[1]).toMatchObject({
      _kind: "manual",
      _org: org,
      _location: scope.locationId,
      _query: "Nome",
      _page: 3,
    });
  });
  it("reinicia uma única vez na página 1 quando a página pedida deixa de existir", async () => {
    const f = fixture();
    f.client.rpc
      .mockResolvedValueOnce({
        data: { ...f.result, items: [], counts: { ...f.result.counts, review: 1 } },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { ...f.result, counts: { ...f.result.counts, review: 1 } },
        error: null,
      });
    const result = await readAgentQueuePage(f.client, scope, { ...input, page: 4 }, f.config);
    expect(f.client.rpc).toHaveBeenCalledTimes(2);
    expect(f.client.rpc.mock.calls[1]?.[1]).toMatchObject({
      _page: 1,
      _as_of: input.asOf,
      _org: org,
      _location: scope.locationId,
    });
    expect(result.pagination).toMatchObject({ page: 1, totalPages: 1, total: 1, hasMore: false });
    expect(result.items).toHaveLength(1);
  });
  it("normaliza também a busca manual vazia sem repetir indefinidamente", async () => {
    const f = fixture();
    f.client.rpc.mockResolvedValue({
      data: { settings: f.result.settings, asOf: input.asOf, items: [], total: 0 },
      error: null,
    });
    const result = await readManualQueuePage(f.client, scope, {
      query: "sem resultado",
      page: 5,
      pageSize: 25,
    });
    expect(f.client.rpc).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ page: 1, totalPages: 1, total: 0, hasMore: false });
  });
});
