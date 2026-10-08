import {
  AgentError,
  checkReply,
  checkSend,
  classifySafety,
  eventSchema,
  type DraftPayload,
  type DraftRow,
  type Event,
  type Job,
  type Settings,
  type Snapshot,
  type QueueError,
  type SessionRow,
} from "./core";
import { POLICY_HASH, replyHash, seal, unseal } from "./providers.server";

export interface Store {
  command<T>(op: string, org: string, data?: Record<string, unknown>, actor?: string): Promise<T>;
}
export type Provider = {
  verifyReceipt?(
    snapshot: Snapshot,
    text: string,
    messageId: string,
    approvedAt: string,
  ): Promise<boolean>;
  history(event: Event): Promise<Snapshot>;
  send(
    snapshot: Snapshot,
    text: string,
  ): Promise<{
    state: "sent" | "unknown" | "rejected";
    code: string | null;
    messageId: string | null;
  }>;
};
export type Dependencies = {
  store: Store;
  provider: Provider;
  generate(s: Snapshot): Promise<DraftPayload>;
  encryptionKey: string;
  enabled: boolean;
  sendEnabled: boolean;
  now?: () => number;
};
export class CommercialAgent {
  private now: () => number;
  constructor(private d: Dependencies) {
    this.now = d.now ?? Date.now;
  }
  async receive(org: string, event: Event, observedAt?: string) {
    if (!this.d.enabled) return { status: "disabled" };
    // Only canonical server-side discovery supplies this metadata. It is not
    // part of the callback Event or the persisted deduplication identity.
    return this.d.store.command("ingress", org, {
      ...eventSchema.parse(event),
      ...(observedAt === undefined ? {} : { observedAt }),
    });
  }
  async work(org: string) {
    if (!this.d.enabled) return { status: "disabled" };
    const job = await this.d.store.command<Job | null>("claim", org);
    if (!job) return { status: "idle" };
    try {
      const config = await this.d.store.command<Settings>("settings", org);
      if (
        config.mode !== "supervised" ||
        config.organization_id !== org ||
        config.location_id !== job.event.locationId ||
        (config.receive_all_contacts !== true &&
          !config.allowed_contacts.includes(job.event.contactId))
      )
        throw new AgentError("contact_not_allowed");
      const snapshot = await this.d.provider.history(job.event);
      const latest = snapshot.messages.at(-1);
      if (!latest) throw new AgentError("history_invalid");
      const observedAt = latest.at;
      if (config.receive_all_contacts === true) {
        const since = Date.parse(config.receive_since ?? "");
        const observed = Date.parse(observedAt);
        if (!Number.isFinite(since) || since > this.now())
          throw new AgentError("receive_since_invalid");
        // Recheck the canonical history, rather than trusting ingress metadata
        // alone, before paying for a model response to a new contact.
        if (!Number.isFinite(observed) || observed > this.now())
          throw new AgentError("observed_at_invalid");
        if (observed < since) throw new AgentError("before_receive_since");
      }
      const safety = classifySafety(latest.text);
      // An older STOP may have arrived just before this message. Never let a
      // superseded queue item erase that refusal; clearing it needs a separate
      // consent workflow, which this service deliberately does not implement.
      safety.optOut ||= snapshot.messages.some(
        (message) => message.direction === "inbound" && classifySafety(message.text).optOut,
      );
      const unsupportedChannel = !config.allowed_channels.includes(latest.channel);
      if (unsupportedChannel && config.receive_all_contacts !== true)
        throw new AgentError("unsupported_channel");
      // Safety events do not need an external model call; still never auto-send.
      let payload: DraftPayload;
      if (snapshot.dnd || safety.optOut || safety.handoff || safety.urgent) {
        payload = {
          snapshot,
          policyHash: POLICY_HASH,
          model: "deterministic_safety",
          inputTokens: 0,
          outputTokens: 0,
          decision: {
            reply: safety.urgent
              ? "Procure imediatamente um serviço de urgência local. Não aguarde o retorno da clínica."
              : safety.optOut || snapshot.dnd
                ? "Entendido. Seu pedido de interrupção será respeitado."
                : "Seu atendimento precisa da equipe da clínica.",
            flags: safety.urgent ? ["urgent"] : safety.handoff ? ["human_requested"] : [],
            handoff: true,
            optOut: safety.optOut || snapshot.dnd,
          },
        };
      } else if (unsupportedChannel) {
        payload = {
          snapshot,
          policyHash: POLICY_HASH,
          model: "deterministic_manual_review",
          inputTokens: 0,
          outputTokens: 0,
          decision: {
            reply: "Este canal precisa de revisão pela equipe da clínica.",
            flags: ["unsupported_action"],
            handoff: true,
            optOut: false,
          },
        };
      } else payload = await this.d.generate(snapshot);
      if (unsupportedChannel) payload.decision.flags.push("unsupported_action");
      if (latest.attachments > 0) payload.decision.flags.push("unsupported_attachment");
      if (checkReply(payload.decision.reply).length)
        payload.decision.flags.push("unsupported_action");
      payload.decision.flags = [...new Set(payload.decision.flags)];
      return await this.d.store.command("ready", org, {
        id: job.id,
        lease: job.lease,
        payload: seal(payload, this.d.encryptionKey, `${org}:${job.id}`),
        replyHash: replyHash(payload),
        policyHash: payload.policyHash,
        inputTokens: payload.inputTokens,
        outputTokens: payload.outputTokens,
        flags: payload.decision.flags,
        observedAt,
        pause: payload.decision.handoff || payload.decision.optOut,
        optOut: payload.decision.optOut,
      });
    } catch (e) {
      const code = e instanceof AgentError ? e.code : "processing_failed";
      await this.d.store.command("fail", org, { id: job.id, lease: job.lease, code });
      return { status: "failed", code };
    }
  }
  async list(org: string, actor: string) {
    const r = await this.d.store.command<{
      settings: Settings;
      items: DraftRow[];
      errors: QueueError[];
    }>("list", org, {}, actor);
    return {
      ...r,
      enabled: this.d.enabled,
      sendEnabled: this.d.sendEnabled,
      items: r.items.map((row) => ({
        ...row,
        payload: undefined,
        content: row.payload
          ? unseal<DraftPayload>(row.payload, this.d.encryptionKey, `${org}:${row.event_id}`)
          : null,
      })),
    };
  }
  async approve(
    org: string,
    actor: string,
    input: { draftId: string; version: number; replyHash: string },
    writeEnabled: boolean,
  ) {
    const row = await this.d.store.command<DraftRow>("detail", org, input, actor);
    if (
      row.state !== "pending" ||
      row.version !== input.version ||
      row.reply_hash !== input.replyHash
    )
      throw new AgentError("version_conflict");
    const payload = unseal<DraftPayload>(
      row.payload,
      this.d.encryptionKey,
      `${org}:${row.event_id}`,
    );
    if (payload.policyHash !== POLICY_HASH || replyHash(payload) !== input.replyHash)
      throw new AgentError("draft_stale");
    const config = await this.d.store.command<Settings>("settings", org);
    const last = payload.snapshot.messages.at(-1);
    if (!last) throw new AgentError("history_invalid");
    const state = {
      enabled: this.d.enabled && config.mode === "supervised",
      sendEnabled: this.d.sendEnabled,
      writeEnabled,
      allowed:
        config.allowed_contacts.includes(row.contact_id) &&
        config.allowed_channels.includes(last.channel),
      paused: row.paused ?? true,
      optOut: row.opt_out ?? true,
      dnd: payload.snapshot.dnd,
      expired: Date.parse(row.expires_at) <= this.now(),
      historyChanged: row.contact_version !== row.session_version,
      channel: last.channel,
      inboundAgeMs: this.now() - Date.parse(last.at),
      flags: [...payload.decision.flags, ...checkReply(payload.decision.reply)],
    };
    const reason = checkSend(state);
    if (reason) throw new AgentError(reason);
    const current = await this.d.provider.history(payload.snapshot.event);
    const fresh = checkSend({
      ...state,
      dnd: current.dnd,
      historyChanged: current.historyHash !== payload.snapshot.historyHash,
    });
    if (fresh) throw new AgentError(fresh);
    const claimed = await this.d.store.command<DraftRow & { dispatch_id: string }>(
      "start_send",
      org,
      input,
      actor,
    );
    let result: {
      state: "sent" | "unknown" | "rejected";
      code: string | null;
      messageId: string | null;
    };
    try {
      await this.d.store.command("check_dispatch", org, {
        draftId: row.id,
        dispatchId: claimed.dispatch_id,
      });
    } catch {
      await this.d.store.command("finish_send", org, {
        draftId: row.id,
        dispatchId: claimed.dispatch_id,
        state: "rejected",
        code: "dispatch_blocked",
        messageId: null,
      });
      throw new AgentError("dispatch_blocked");
    }
    try {
      result = await this.d.provider.send(current, payload.decision.reply);
    } catch {
      result = { state: "unknown", code: "send_unknown", messageId: null };
    }
    try {
      await this.d.store.command("finish_send", org, {
        draftId: row.id,
        dispatchId: claimed.dispatch_id,
        ...result,
      });
    } catch {
      throw new AgentError("send_unknown");
    }
    return result;
  }
  async pause(
    org: string,
    actor: string,
    contactId: string,
    expectedVersion: number,
    paused: boolean,
  ) {
    return this.d.store.command<SessionRow>(
      paused ? "pause" : "resume",
      org,
      { contactId, expectedVersion },
      actor,
    );
  }
  async reject(
    org: string,
    actor: string,
    input: { draftId: string; version: number; replyHash: string },
  ) {
    return this.d.store.command<{ status: string }>("reject", org, input, actor);
  }
  async reconcile(org: string, actor: string, input: { draftId: string; messageId: string }) {
    const row = await this.d.store.command<DraftRow>("detail", org, input, actor);
    if (
      !["unknown", "sending"].includes(row.state) ||
      !row.approved_at ||
      !this.d.provider.verifyReceipt
    )
      throw new AgentError("reconcile_blocked");
    const p = unseal<DraftPayload>(row.payload, this.d.encryptionKey, `${org}:${row.event_id}`);
    if (
      !(await this.d.provider.verifyReceipt(
        p.snapshot,
        p.decision.reply,
        input.messageId,
        row.approved_at,
      ))
    )
      throw new AgentError("receipt_not_verified");
    return this.d.store.command<{ status: string }>("reconcile", org, input, actor);
  }
}
