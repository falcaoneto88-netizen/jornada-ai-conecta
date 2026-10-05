import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { startCommercialDb, ORG, OTHER, ACTOR, FOREIGN } from "../../../test/commercial-agent-db";
import { CommercialAgent, type Provider } from "./service.server";
import { POLICY_HASH, sha } from "./providers.server";
import type { DraftPayload, DraftRow, Event, Snapshot } from "./core";
let db: Awaited<ReturnType<typeof startCommercialDb>>;
const event: Event = {
  type: "InboundMessage",
  locationId: "loc-test",
  contactId: "c-test",
  conversationId: "v-test",
  messageId: "m-test",
};
let snapshot: Snapshot, provider: Provider, agent: CommercialAgent;
const key = randomBytes(32).toString("base64");
const generate = vi.fn(async (s: Snapshot): Promise<DraftPayload> => ({
  snapshot: s,
  policyHash: POLICY_HASH,
  decision: {
    reply: "A consulta de avaliação custa 50 €. Posso explicar como funciona?",
    flags: [],
    handoff: false,
    optOut: false,
  },
  model: "fixture",
  inputTokens: 100,
  outputTokens: 20,
}));
beforeAll(async () => {
  db = await startCommercialDb();
}, 60000);
afterAll(async () => db?.stop());
beforeEach(async () => {
  await db.sql`truncate commercial_agent_drafts,commercial_agent_inbox,commercial_agent_sessions,commercial_agent_audit restart identity cascade`;
  await db.sql`update commercial_agent_settings set mode='supervised'`;
  snapshot = {
    event,
    name: "Ana Teste — fictícia",
    dnd: false,
    historyHash: sha("first"),
    messages: [
      {
        id: "m-test",
        at: new Date().toISOString(),
        text: "Quanto custa a consulta?",
        direction: "inbound",
        channel: "WhatsApp",
        attachments: 0,
        provider: null,
      },
    ],
  };
  provider = {
    history: vi.fn(async () => structuredClone(snapshot)),
    send: vi.fn(async () => ({ state: "sent" as const, code: null, messageId: "sent-test" })),
  };
  generate.mockClear();
  agent = new CommercialAgent({
    store: db.store,
    provider,
    generate,
    encryptionKey: key,
    enabled: true,
    sendEnabled: true,
  });
});
async function draft() {
  await agent.receive(ORG, event);
  await agent.work(ORG);
  return (await agent.list(ORG, ACTOR)).items[0]!;
}
const approval = (d: { id: string; version: number; reply_hash: string }) => ({
  draftId: d.id,
  version: d.version,
  replyHash: d.reply_hash,
});
describe("fluxo supervisionado sobre PostgreSQL real e contatos fictícios", () => {
  it("recebe, recupera histórico, gera e só envia após aprovação autenticada", async () => {
    const d = await draft();
    expect(provider.history).toHaveBeenCalledWith(event);
    expect(provider.send).not.toHaveBeenCalled();
    expect(d.content?.decision.reply).toContain("50 €");
    expect(d.content?.policyHash).toBe(POLICY_HASH);
    expect((await agent.approve(ORG, ACTOR, approval(d), true)).state).toBe("sent");
    expect(provider.send).toHaveBeenCalledWith(snapshot, d.content?.decision.reply);
    const rows = await db.sql`select code from commercial_agent_audit order by id`;
    expect(rows.map((r) => r["code"])).toEqual([
      "message_received",
      "draft_ready",
      "human_approved",
      "provider_accepted",
    ]);
    const stored = await db.sql`select payload from commercial_agent_drafts`;
    expect(stored[0]?.["payload"]).not.toContain("Ana");
  });
  it("duplicação do webhook e duas aprovações simultâneas resultam em um envio", async () => {
    const d = await draft();
    expect(await agent.receive(ORG, event)).toMatchObject({ status: "duplicate" });
    await agent.work(ORG);
    expect(generate).toHaveBeenCalledTimes(1);
    const results = await Promise.allSettled([
      agent.approve(ORG, ACTOR, approval(d), true),
      agent.approve(ORG, ACTOR, approval(d), true),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(provider.send).toHaveBeenCalledTimes(1);
  });
  it("mesmo messageId com outro contato não altera a identidade", async () => {
    await agent.receive(ORG, event);
    await expect(agent.receive(ORG, { ...event, contactId: "c-second" })).rejects.toThrow(
      "duplicate_mismatch",
    );
  });
  it("novo inbound invalida aprovação anterior", async () => {
    const d = await draft();
    await agent.receive(ORG, { ...event, messageId: "new-inbound" });
    await expect(agent.approve(ORG, ACTOR, approval(d), true)).rejects.toThrow("version_conflict");
    expect(provider.send).not.toHaveBeenCalled();
  });
  it("histórico mudou no GHL antes do webhook chegar: bloqueia envio", async () => {
    const d = await draft();
    snapshot.historyHash = sha("changed");
    await expect(agent.approve(ORG, ACTOR, approval(d), true)).rejects.toThrow("draft_stale");
  });
  it("DND atualizado entre geração e aprovação bloqueia", async () => {
    const d = await draft();
    snapshot.dnd = true;
    await expect(agent.approve(ORG, ACTOR, approval(d), true)).rejects.toThrow("do_not_contact");
  });
  it("humano que escreve em outro canal pausa o contato inteiro", async () => {
    const d = await draft();
    await agent.receive(ORG, {
      ...event,
      type: "OutboundMessage",
      messageId: "human",
      conversationId: "other-channel",
    });
    const list = await agent.list(ORG, ACTOR);
    expect(list.items[0]?.paused).toBe(true);
    await expect(agent.approve(ORG, ACTOR, approval(d), true)).rejects.toThrow();
    expect(provider.send).not.toHaveBeenCalled();
  });
  it("recusa persistida não é apagada por retomar", async () => {
    snapshot.messages[0]!.text = "Parem de me procurar";
    const d = await draft();
    expect(d.opt_out).toBe(true);
    expect(generate).not.toHaveBeenCalled();
    await expect(
      agent.pause(ORG, ACTOR, event.contactId, d.session_version!, false),
    ).rejects.toThrow("do_not_contact");
    await expect(agent.approve(ORG, ACTOR, approval(d), true)).rejects.toThrow("do_not_contact");
  });
  it("recusa anterior não é perdida quando outra mensagem chega logo depois", async () => {
    snapshot.messages.unshift({
      ...snapshot.messages[0]!,
      id: "stop-earlier",
      text: "Parem de me procurar",
    });
    const d = await draft();
    expect(d.opt_out).toBe(true);
    expect(generate).not.toHaveBeenCalled();
    expect(provider.send).not.toHaveBeenCalled();
  });
  it("envio incerto pausa o contato e exige recibo conferido antes de retomar", async () => {
    const d = await draft();
    provider.send = vi.fn(async () => ({
      state: "unknown" as const,
      code: "send_unknown",
      messageId: null,
    }));
    provider.verifyReceipt = vi.fn(async () => false);
    await agent.approve(ORG, ACTOR, approval(d), true);
    const paused = (await agent.list(ORG, ACTOR)).items[0]!;
    expect(paused.paused).toBe(true);
    await expect(
      agent.pause(ORG, ACTOR, event.contactId, paused.session_version!, false),
    ).rejects.toThrow("reconciliation_required");
    await expect(
      agent.reconcile(ORG, ACTOR, { draftId: d.id, messageId: "wrong" }),
    ).rejects.toThrow("receipt_not_verified");
    provider.verifyReceipt = vi.fn(async () => true);
    await agent.reconcile(ORG, ACTOR, { draftId: d.id, messageId: "verified" });
    const confirmed = (await agent.list(ORG, ACTOR)).items[0]!;
    expect(confirmed.state).toBe("sent");
    expect(confirmed.paused).toBe(true);
    await agent.pause(ORG, ACTOR, event.contactId, confirmed.session_version!, false);
    expect(provider.send).toHaveBeenCalledTimes(1);
  });
  it("terceiro processamento interrompido vira falha visível", async () => {
    await agent.receive(ORG, event);
    await db.sql`update commercial_agent_inbox set state='processing',attempts=3,lease_until=now()-interval '1 minute'`;
    await agent.work(ORG);
    const errors = (await agent.list(ORG, ACTOR)).errors;
    expect(errors[0]).toMatchObject({
      state: "failed",
      error_code: "processing_interrupted",
      attempts: 3,
    });
    expect(generate).not.toHaveBeenCalled();
  });
  it("pausa explícita e retomada são autenticadas e versionadas", async () => {
    const d = await draft();
    await agent.pause(ORG, ACTOR, event.contactId, d.session_version!, true);
    await expect(
      agent.pause(ORG, ACTOR, event.contactId, d.session_version!, false),
    ).rejects.toThrow("version_conflict");
    await expect(
      agent.pause(ORG, FOREIGN, event.contactId, d.session_version! + 1, false),
    ).rejects.toThrow("forbidden");
  });
  it("aprovação de outra organização não consegue ler nem enviar", async () => {
    const d = await draft();
    await expect(agent.list(ORG, FOREIGN)).rejects.toThrow("forbidden");
    await expect(agent.approve(OTHER, FOREIGN, approval(d), true)).rejects.toThrow("not_found");
  });
  it("hash alterado não é aprovação", async () => {
    const d = await draft();
    await expect(
      agent.approve(ORG, ACTOR, { ...approval(d), replyHash: "a".repeat(64) }, true),
    ).rejects.toThrow("version_conflict");
  });
  it("timeout após possível envio fica incerto e não é repetido", async () => {
    const d = await draft();
    provider.send = vi.fn(async () => {
      throw new Error("unexpected sensitive upstream details");
    });
    expect((await agent.approve(ORG, ACTOR, approval(d), true)).state).toBe("unknown");
    await expect(agent.approve(ORG, ACTOR, approval(d), true)).rejects.toThrow("version_conflict");
    await agent.work(ORG);
    expect(provider.send).toHaveBeenCalledTimes(1);
    const list = await agent.list(ORG, ACTOR);
    expect(list.items[0]?.state).toBe("unknown");
    expect(JSON.stringify(list)).not.toContain("sensitive");
  });
  it("crash durante envio torna estado incerto sem recolocar em fila", async () => {
    const d = await draft();
    await db.store.command<DraftRow>("start_send", ORG, approval(d), ACTOR);
    await db.sql`update commercial_agent_drafts set approved_at=now()-interval '3 minutes'`;
    await agent.work(ORG);
    expect((await agent.list(ORG, ACTOR)).items[0]?.state).toBe("unknown");
    expect(provider.send).not.toHaveBeenCalled();
  });
  it("resposta do próprio serviço não aciona outra geração", async () => {
    const d = await draft();
    await agent.approve(ORG, ACTOR, approval(d), true);
    expect(
      await agent.receive(ORG, { ...event, type: "OutboundMessage", messageId: "sent-test" }),
    ).toMatchObject({ status: "own_message" });
    expect((await agent.list(ORG, ACTOR)).items[0]?.paused).toBe(false);
  });
  it("falha de modelo registra código, mantém retry durável e não vaza erro bruto", async () => {
    generate.mockRejectedValueOnce(new Error("token secret patient text"));
    await agent.receive(ORG, event);
    expect(await agent.work(ORG)).toEqual({ status: "failed", code: "processing_failed" });
    const rows = await db.sql`select state,error_code,attempts from commercial_agent_inbox`;
    expect(rows[0]).toMatchObject({
      state: "pending",
      error_code: "processing_failed",
      attempts: 1,
    });
    expect(provider.send).not.toHaveBeenCalled();
  });
  it("desativado não lê histórico, não chama OpenAI e não envia", async () => {
    const disabled = new CommercialAgent({
      store: db.store,
      provider,
      generate,
      encryptionKey: key,
      enabled: false,
      sendEnabled: false,
    });
    expect(await disabled.receive(ORG, event)).toEqual({ status: "disabled" });
    expect(await disabled.work(ORG)).toEqual({ status: "disabled" });
    expect(provider.history).not.toHaveBeenCalled();
  });
  it("anon e authenticated não conseguem escrever diretamente nem chamar RPC privilegiada", async () => {
    for (const role of ["anon", "authenticated"]) {
      await expect(
        db.sql.begin(async (tx) => {
          await tx.unsafe(`set local role ${role}`);
          await tx`select public.commercial_agent_command('claim',${ORG}::uuid)`;
        }),
      ).rejects.toThrow();
      await expect(
        db.sql.begin(async (tx) => {
          await tx.unsafe(`set local role ${role}`);
          await tx`select * from commercial_agent_drafts`;
        }),
      ).rejects.toThrow();
    }
  });
});
