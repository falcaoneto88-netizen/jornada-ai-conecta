import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { DraftPayload, DraftRow, Settings } from "./core";
import { CommercialAgent } from "./service.server";
import { POLICY_HASH, seal } from "./providers.server";
import { readInboxReviewRows, type InboxReviewRows } from "./inbox-review.server";

const scope = { contactId: "synthetic-contact", conversationId: "synthetic-conversation" };
const org = "00000000-0000-4000-8000-000000000001";
const key = Buffer.alloc(32, 17).toString("base64");
function fixture() {
  const settings: Settings = {
    organization_id: org,
    location_id: "synthetic-location",
    mode: "supervised",
    allowed_contacts: [scope.contactId, "unrelated-contact"],
    allowed_channels: ["SMS"],
  };
  const payload: DraftPayload = {
    snapshot: {
      event: {
        type: "InboundMessage",
        locationId: settings.location_id,
        ...scope,
        messageId: "synthetic-message",
      },
      name: "Contato fictício",
      messages: [],
      dnd: false,
      historyHash: "synthetic-hash",
    },
    decision: {
      reply: "Sugestão fictícia para revisão.",
      flags: [],
      handoff: false,
      optOut: false,
    },
    model: "synthetic",
    policyHash: POLICY_HASH,
    inputTokens: 0,
    outputTokens: 0,
  };
  const row: DraftRow = {
    id: "00000000-0000-4000-8000-000000000002",
    organization_id: org,
    location_id: settings.location_id,
    contact_id: scope.contactId,
    conversation_id: scope.conversationId,
    event_id: "synthetic-event",
    message_id: "synthetic-message",
    state: "pending",
    version: 1,
    contact_version: 1,
    payload: seal(payload, key, `${org}:synthetic-event`),
    reply_hash: "synthetic-hash",
    expires_at: "2099-01-01T00:00:00Z",
    created_at: "2026-01-01T00:00:00Z",
    result_message_id: null,
    error_code: null,
  };
  const rows: InboxReviewRows = {
    items: [row],
    session: { contact_id: scope.contactId, version: 4, paused: true, opt_out: false },
    truncated: false,
  };
  const read = vi.fn().mockResolvedValue(rows);
  const store = { command: vi.fn().mockResolvedValue(settings) };
  const provider = { history: vi.fn(), send: vi.fn() };
  const generate = vi.fn();
  const agent = new CommercialAgent({
    store,
    provider,
    generate,
    encryptionKey: key,
    enabled: true,
    sendEnabled: false,
    readInboxReview: read,
  });
  return { agent, settings, row, rows, read, store, provider, generate, payload };
}

describe("leitura da supervisão no Atendimento", () => {
  it("consulta o escopo exato e mostra estado real, sem geração, envio ou mutação", async () => {
    const f = fixture();
    const result = await f.agent.inboxReview(org, "synthetic-actor", scope);
    expect(f.read).toHaveBeenCalledExactlyOnceWith({
      organizationId: org,
      locationId: f.settings.location_id,
      ...scope,
    });
    expect(f.store.command).toHaveBeenCalledExactlyOnceWith("settings", org, {}, "synthetic-actor");
    expect(result.items[0]).toMatchObject({
      paused: true,
      opt_out: false,
      session_version: 4,
      policyCurrent: true,
    });
    expect(result.items[0]).not.toHaveProperty("payload");
    expect(result.settings.allowed_contacts).toEqual([scope.contactId]);
    expect(result.sendEnabled).toBe(false);
    expect(f.provider.history).not.toHaveBeenCalled();
    expect(f.provider.send).not.toHaveBeenCalled();
    expect(f.generate).not.toHaveBeenCalled();
  });

  it.each(["organization_id", "location_id", "contact_id", "conversation_id"] as const)(
    "recusa registro de outro %s",
    async (field) => {
      const f = fixture();
      f.row[field] = "unrelated-scope";
      await expect(f.agent.inboxReview(org, "synthetic-actor", scope)).rejects.toThrow(
        "scope_mismatch",
      );
    },
  );

  it("não consulta dados se a configuração pertence a outro tenant", async () => {
    const f = fixture();
    f.settings.organization_id = "other-tenant";
    await expect(f.agent.inboxReview(org, "synthetic-actor", scope)).rejects.toThrow(
      "scope_mismatch",
    );
    expect(f.read).not.toHaveBeenCalled();
  });

  it("mantém contato sem sessão ou sugestão como vazio, sem lista global de fallback", async () => {
    const f = fixture();
    f.read.mockResolvedValue({ items: [], session: null, truncated: false });
    expect(await f.agent.inboxReview(org, "synthetic-actor", scope)).toMatchObject({
      items: [],
      session: null,
    });
    expect(f.store.command.mock.calls.map(([op]) => op)).toEqual(["settings"]);
  });

  it("não substitui o rascunho solicitado por outro da mesma conversa", async () => {
    const f = fixture();
    await expect(
      f.agent.inboxReview(org, "synthetic-actor", { ...scope, draftId: "different-draft" }),
    ).rejects.toThrow("scope_mismatch");
  });

  it("não atribui versão vigente a um rascunho de política anterior", async () => {
    const f = fixture();
    f.payload.policyHash = "old-policy";
    f.row.payload = seal(f.payload, key, `${org}:synthetic-event`);
    expect((await f.agent.inboxReview(org, "synthetic-actor", scope)).items[0]?.policyCurrent).toBe(
      false,
    );
  });

  it("recusa conteúdo cifrado cuja conversa não corresponde à linha", async () => {
    const f = fixture();
    f.payload.snapshot.event.conversationId = "another-conversation";
    f.row.payload = seal(f.payload, key, `${org}:synthetic-event`);
    await expect(f.agent.inboxReview(org, "synthetic-actor", scope)).rejects.toThrow(
      "scope_mismatch",
    );
  });

  it("aplica filtros de tenant, unidade, contato e conversa antes do limite SQL", async () => {
    const calls: Array<[string, unknown[]]> = [];
    function query(data: unknown) {
      const builder: Record<string, unknown> = {
        then: (resolve: (value: unknown) => void) =>
          Promise.resolve({ data, error: null }).then(resolve),
      };
      for (const method of ["select", "eq", "order", "limit", "maybeSingle"])
        builder[method] = (...args: unknown[]) => {
          calls.push([method, args]);
          return builder;
        };
      return builder;
    }
    const client = {
      from: vi.fn((table: string) => query(table === "commercial_agent_drafts" ? [] : null)),
    } as unknown as SupabaseClient<Database>;
    await readInboxReviewRows(client, {
      ...scope,
      organizationId: org,
      locationId: "synthetic-location",
      draftId: "synthetic-draft",
    });
    const limit = calls.findIndex(([method]) => method === "limit");
    expect(calls.slice(0, limit)).toEqual(
      expect.arrayContaining([
        ["eq", ["organization_id", org]],
        ["eq", ["location_id", "synthetic-location"]],
        ["eq", ["contact_id", scope.contactId]],
        ["eq", ["conversation_id", scope.conversationId]],
        ["eq", ["id", "synthetic-draft"]],
      ]),
    );
    expect(calls[limit]).toEqual(["limit", [31]]);
  });
});
