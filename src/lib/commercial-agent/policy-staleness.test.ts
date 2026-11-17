import { describe, expect, it, vi } from "vitest";
import { CommercialAgent } from "./service.server";
import { POLICY_HASH, replyHash, seal } from "./providers.server";
import type { DraftPayload, DraftRow, Settings, Snapshot } from "./core";

const org = "00000000-0000-4000-8000-000000000001";
const actor = "00000000-0000-4000-8000-000000000002";
const key = Buffer.alloc(32, 29).toString("base64");
const now = Date.parse("2026-11-17T12:00:00Z");

function fixture() {
  const snapshot: Snapshot = {
    event: {
      type: "InboundMessage",
      locationId: "synthetic-location",
      contactId: "synthetic-contact",
      conversationId: "synthetic-conversation",
      messageId: "synthetic-message",
    },
    name: "Pessoa Fictícia",
    dnd: false,
    historyHash: "a".repeat(64),
    messages: [
      {
        id: "synthetic-message",
        at: "2026-11-17T11:59:00Z",
        direction: "inbound",
        channel: "IG",
        attachments: 0,
        provider: null,
        text: "Pode ajudar?",
      },
    ],
  };
  const payload: DraftPayload = {
    snapshot,
    policyHash: "synthetic-obsolete-v02-policy",
    decision: { reply: "Rascunho fictício anterior.", flags: [], handoff: false, optOut: false },
    model: "synthetic-model",
    inputTokens: 0,
    outputTokens: 0,
  };
  const row: DraftRow = {
    id: "00000000-0000-4000-8000-000000000003",
    organization_id: org,
    location_id: snapshot.event.locationId,
    contact_id: snapshot.event.contactId,
    conversation_id: snapshot.event.conversationId,
    message_id: snapshot.event.messageId,
    event_id: "synthetic-event",
    state: "pending",
    version: 1,
    contact_version: 1,
    session_version: 1,
    paused: false,
    opt_out: false,
    payload: seal(payload, key, `${org}:synthetic-event`),
    reply_hash: replyHash(payload),
    expires_at: "2026-11-18T12:00:00Z",
    created_at: "2026-11-17T11:59:30Z",
    result_message_id: null,
    error_code: null,
  };
  const settings: Settings = {
    organization_id: org,
    location_id: snapshot.event.locationId,
    mode: "supervised",
    allowed_contacts: [snapshot.event.contactId],
    allowed_channels: ["IG"],
    manual_send_all_contacts: true,
  };
  const session = {
    locationId: snapshot.event.locationId,
    contactId: snapshot.event.contactId,
    conversationId: snapshot.event.conversationId,
    sessionVersion: 1,
    paused: false,
    optOut: false,
    busy: false,
  };
  const command = vi.fn(async (operation: string) => {
    if (operation === "detail") return row;
    if (operation === "settings") return settings;
    if (operation === "manual_lookup") return null;
    if (operation === "manual_inbox_context") return session;
    throw new Error(`Unexpected write: ${operation}`);
  });
  const provider = {
    history: vi.fn(),
    manualHistory: vi.fn().mockResolvedValue(snapshot),
    send: vi.fn(),
    sendManual: vi.fn(),
  };
  const agent = new CommercialAgent({
    store: {
      async command<T>(op: string): Promise<T> {
        return (await command(op)) as T;
      },
    },
    provider,
    generate: vi.fn(),
    encryptionKey: key,
    enabled: true,
    sendEnabled: true,
    now: () => now,
  });
  const source = { draftId: row.id, version: row.version, replyHash: row.reply_hash };
  return { agent, source, snapshot, provider, command, payload };
}

describe("propostas anteriores à política V03", () => {
  it("aprovação direta rejeita a política antiga antes de ler o CRM ou escrever", async () => {
    const f = fixture();
    expect(f.payload.policyHash).not.toBe(POLICY_HASH);
    await expect(f.agent.approve(org, actor, f.source, true)).rejects.toThrow("draft_stale");
    expect(f.command.mock.calls).toEqual([["detail"]]);
    expect(f.provider.history).not.toHaveBeenCalled();
    expect(f.provider.send).not.toHaveBeenCalled();
  });

  it("editar uma sugestão no Meu Chat não contorna a exigência de gerar novamente", async () => {
    const f = fixture();
    await expect(
      f.agent.inboxSend(
        org,
        actor,
        {
          contactId: f.snapshot.event.contactId,
          conversationId: f.snapshot.event.conversationId,
          text: "Texto fictício revisado pelo atendente.",
          requestId: "00000000-0000-4000-8000-000000000004",
          sourceAgentDraft: f.source,
          revision: {
            historyHash: f.snapshot.historyHash,
            sessionVersion: 1,
            channel: "IG",
            providerId: null,
            defaultId: null,
          },
        },
        true,
        null,
      ),
    ).rejects.toThrow("draft_stale");
    expect(f.command.mock.calls.some(([op]) => op === "detail")).toBe(true);
    expect(
      f.command.mock.calls.every(([op]) =>
        ["manual_lookup", "settings", "manual_inbox_context", "detail"].includes(op),
      ),
    ).toBe(true);
    expect(f.provider.send).not.toHaveBeenCalled();
    expect(f.provider.sendManual).not.toHaveBeenCalled();
  });
});
