import {
  AgentError,
  checkReply,
  checkSend,
  classifySafety,
  eventSchema,
  manualPrepareSchema,
  manualSendSchema,
  type DraftPayload,
  type DraftRow,
  type Event,
  type Job,
  type Settings,
  type Snapshot,
  type QueueError,
  type SessionRow,
  type ManualContext,
  type ManualConversation,
  type ManualDispatchState,
  type ManualPrepared,
  type ManualScope,
} from "./core";
import { resolveInboxRoute, sameRoute, type InboxRoute, type SmsChannels } from "./inbox-route";
import { POLICY_HASH, replyHash, seal, sha, unseal } from "./providers.server";

export interface Store {
  command<T>(op: string, org: string, data?: Record<string, unknown>, actor?: string): Promise<T>;
}
export type Provider = {
  smsChannels?(): Promise<SmsChannels | null>;
  manualHistory?(scope: ManualScope): Promise<Snapshot>;
  sendManual?(snapshot: Snapshot, text: string): ReturnType<Provider["send"]>;
  verifyManualReceipt?(
    snapshot: Snapshot,
    text: string,
    messageId: string,
    approvedAt: string,
  ): Promise<boolean>;
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
type ManualPayload = { snapshot: Snapshot; text: string };
type ManualRow = {
  id: string;
  request_id: string;
  contact_id: string;
  conversation_id: string;
  location_id: string;
  session_version: number;
  payload: string;
  reply_hash: string;
  state: ManualDispatchState;
  expires_at: string;
  prepared_by: string;
  approved_at: string | null;
  dispatch_id: string | null;
  result_message_id: string | null;
  error_code: string | null;
};
type ManualSession = ManualConversation & {
  busy: boolean;
  lastDispatch?: ManualContext["lastDispatch"];
};
const manualHash = (payload: ManualPayload) =>
  sha(
    JSON.stringify({
      kind: "manual",
      event: payload.snapshot.event,
      historyHash: payload.snapshot.historyHash,
      text: payload.text,
      ...(payload.snapshot.route ? { route: payload.snapshot.route } : {}),
    }),
  );
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
      manualConversations: await this.manualList(org, actor),
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
  async manualList(org: string, actor: string): Promise<ManualConversation[]> {
    return this.d.store.command("manual_list", org, {}, actor);
  }
  private manualReason(
    config: Settings,
    session: ManualSession,
    snapshot: Snapshot,
    writeEnabled: boolean,
  ): string | null {
    if (
      !this.d.enabled ||
      !this.d.sendEnabled ||
      !writeEnabled ||
      config.mode !== "supervised" ||
      config.manual_send_all_contacts !== true
    )
      return "send_disabled";
    if (
      config.location_id !== session.locationId ||
      snapshot.event.locationId !== session.locationId ||
      snapshot.event.contactId !== session.contactId ||
      snapshot.event.conversationId !== session.conversationId
    )
      return "scope_mismatch";
    if (session.busy) return "reconciliation_required";
    if (
      session.optOut ||
      snapshot.dnd ||
      snapshot.messages.some((m) => m.direction === "inbound" && classifySafety(m.text).optOut)
    )
      return "do_not_contact";
    const inbound = snapshot.messages.find(
      (m) => m.id === snapshot.event.messageId && m.direction === "inbound",
    );
    if (!inbound) return "inbound_not_verified";
    // Only the currently homologated manual channel is enabled. AI contact and
    // channel allowlists are deliberately not extended by this permission.
    if (inbound.channel !== "SMS") return "unsupported_channel";
    const age = this.now() - Date.parse(inbound.at);
    if (!Number.isFinite(age) || age < 0 || age >= 23 * 3600000) return "channel_window";
    return null;
  }
  async manualContext(
    org: string,
    actor: string,
    input: Pick<ManualScope, "contactId" | "conversationId">,
    writeEnabled: boolean,
  ): Promise<ManualContext> {
    const session = await this.d.store.command<ManualSession>(
      "manual_context",
      org,
      { contactId: input.contactId, conversationId: input.conversationId },
      actor,
    );
    if (!this.d.provider.manualHistory) throw new AgentError("manual_not_configured");
    const snapshot = await this.d.provider.manualHistory({
      locationId: session.locationId,
      contactId: session.contactId,
      conversationId: session.conversationId,
    });
    const config = await this.d.store.command<Settings>("settings", org);
    const blockedReason = this.manualReason(config, session, snapshot, writeEnabled);
    return {
      snapshot,
      sessionVersion: session.sessionVersion,
      paused: session.paused,
      optOut: session.optOut,
      sendAllowed: blockedReason === null,
      blockedReason,
      ...(session.lastDispatch ? { lastDispatch: session.lastDispatch } : {}),
    };
  }
  private manualPayload(org: string, row: ManualRow): ManualPayload {
    if (!row.payload) throw new AgentError("manual_content_expired");
    const payload = unseal<ManualPayload>(
      row.payload,
      this.d.encryptionKey,
      `manual:${org}:${row.request_id}`,
    );
    if (
      manualHash(payload) !== row.reply_hash ||
      payload.snapshot.event.contactId !== row.contact_id ||
      payload.snapshot.event.conversationId !== row.conversation_id ||
      payload.snapshot.event.locationId !== row.location_id
    )
      throw new AgentError("draft_stale");
    return payload;
  }
  private preparedManual(org: string, row: ManualRow): ManualPrepared {
    if (row.state !== "prepared") throw new AgentError("manual_request_used");
    const p = this.manualPayload(org, row);
    return {
      id: row.id,
      replyHash: row.reply_hash,
      text: p.text,
      snapshot: p.snapshot,
      expiresAt: row.expires_at,
      sessionVersion: row.session_version,
    };
  }
  async manualPrepare(
    org: string,
    actor: string,
    input: {
      contactId: string;
      conversationId: string;
      expectedVersion: number;
      historyHash: string;
      text: string;
      requestId: string;
    },
    writeEnabled: boolean,
    route?: InboxRoute,
  ): Promise<ManualPrepared> {
    const data = manualPrepareSchema.parse(input);
    const existing = await this.d.store.command<ManualRow | null>(
      "manual_lookup",
      org,
      { requestId: data.requestId },
      actor,
    );
    if (existing) {
      const old = this.manualPayload(org, existing);
      if (
        existing.prepared_by !== actor ||
        existing.contact_id !== data.contactId ||
        existing.conversation_id !== data.conversationId ||
        old.text !== data.text
      )
        throw new AgentError("manual_request_mismatch");
      return this.preparedManual(org, existing);
    }
    const context = await this.manualContext(org, actor, data, writeEnabled);
    if (context.blockedReason) throw new AgentError(context.blockedReason);
    if (context.sessionVersion !== data.expectedVersion) throw new AgentError("version_conflict");
    if (context.snapshot.historyHash !== data.historyHash) throw new AgentError("draft_stale");
    const inbound = context.snapshot.messages.find(
      (m) => m.id === context.snapshot.event.messageId && m.direction === "inbound",
    )!;
    const payload = {
      snapshot: route ? { ...context.snapshot, route } : context.snapshot,
      text: data.text,
    };
    const row = await this.d.store.command<ManualRow>(
      "manual_prepare",
      org,
      {
        contactId: data.contactId,
        conversationId: data.conversationId,
        locationId: context.snapshot.event.locationId,
        expectedVersion: data.expectedVersion,
        requestId: data.requestId,
        historyHash: data.historyHash,
        inboundId: inbound.id,
        inboundAt: inbound.at,
        channel: inbound.channel,
        dnd: context.snapshot.dnd,
        stop: context.snapshot.messages.some(
          (m) => m.direction === "inbound" && classifySafety(m.text).optOut,
        ),
        payload: seal(payload, this.d.encryptionKey, `manual:${org}:${data.requestId}`),
        replyHash: manualHash(payload),
      },
      actor,
    );
    return this.preparedManual(org, row);
  }
  async manualSend(
    org: string,
    actor: string,
    input: { manualId: string; replyHash: string },
    writeEnabled: boolean,
  ) {
    const data = manualSendSchema.parse(input);
    const row = await this.d.store.command<ManualRow>("manual_detail", org, data, actor);
    if (row.reply_hash !== data.replyHash || row.prepared_by !== actor)
      throw new AgentError("version_conflict");
    if (["sent", "unknown", "rejected"].includes(row.state))
      return { state: row.state, code: row.error_code, messageId: row.result_message_id };
    if (row.state !== "prepared")
      throw new AgentError(row.state === "sending" ? "reconciliation_required" : "draft_stale");
    if (Date.parse(row.expires_at) <= this.now()) throw new AgentError("draft_stale");
    const payload = this.manualPayload(org, row);
    const context = await this.manualContext(
      org,
      actor,
      { contactId: row.contact_id, conversationId: row.conversation_id },
      writeEnabled,
    );
    if (context.blockedReason) throw new AgentError(context.blockedReason);
    if (
      !context.paused ||
      context.sessionVersion !== row.session_version ||
      context.snapshot.historyHash !== payload.snapshot.historyHash
    )
      throw new AgentError("draft_stale");
    if (!this.d.provider.sendManual) throw new AgentError("manual_not_configured");
    const claimed = await this.d.store.command<ManualRow>(
      "manual_start_send",
      org,
      { ...data, historyHash: context.snapshot.historyHash },
      actor,
    );
    // A concurrent confirmation may already own or have finished this dispatch.
    if (claimed.state !== "sending" || !claimed.dispatch_id)
      return {
        state: claimed.state,
        code: claimed.error_code,
        messageId: claimed.result_message_id,
      };
    try {
      await this.d.store.command(
        "manual_check_dispatch",
        org,
        { manualId: row.id, dispatchId: claimed.dispatch_id },
        actor,
      );
    } catch {
      await this.d.store.command(
        "manual_finish_send",
        org,
        {
          manualId: row.id,
          dispatchId: claimed.dispatch_id,
          state: "rejected",
          code: "dispatch_blocked",
          messageId: null,
        },
        actor,
      );
      throw new AgentError("dispatch_blocked");
    }
    let result: Awaited<ReturnType<Provider["send"]>>;
    try {
      // Só a caixa de entrada fixa rota; os outros fluxos mantêm o comportamento.
      const routed = payload.snapshot.route
        ? { ...context.snapshot, route: payload.snapshot.route }
        : context.snapshot;
      result = await this.d.provider.sendManual(routed, payload.text);
    } catch {
      result = { state: "unknown", code: "send_unknown", messageId: null };
    }
    try {
      await this.d.store.command(
        "manual_finish_send",
        org,
        { manualId: row.id, dispatchId: claimed.dispatch_id, ...result },
        actor,
      );
    } catch {
      throw new AgentError("send_unknown");
    }
    return result;
  }
  /** Rota explícita verificada para a caixa de entrada; nunca o default implícito. */
  async inboxRoute(snapshot: Snapshot, configuredProviderId: string | null) {
    if (!this.d.provider.smsChannels) return { ok: false as const, code: "route_unverified" };
    return resolveInboxRoute(snapshot, await this.d.provider.smsChannels(), configuredProviderId);
  }
  /** Contexto + referência da revisão humana (hash, versão e rota) para exigir no envio. */
  async inboxContext(
    org: string,
    actor: string,
    input: Pick<ManualScope, "contactId" | "conversationId">,
    writeEnabled: boolean,
    configuredProviderId: string | null,
  ) {
    const context = await this.manualContext(org, actor, input, writeEnabled);
    const route = await this.inboxRoute(context.snapshot, configuredProviderId);
    const blockedReason = context.blockedReason ?? (route.ok ? null : route.code);
    return {
      context,
      route: route.ok ? route.route : null,
      blockedReason,
      revision: {
        historyHash: context.snapshot.historyHash,
        sessionVersion: context.sessionVersion,
        providerId: route.ok ? route.route.providerId : null,
        defaultId: route.ok ? route.route.defaultId : null,
      },
    };
  }
  /** Leitura do estado durável de um pedido (recuperação após falha do navegador). */
  async inboxStatus(org: string, actor: string, requestId: string) {
    const row = await this.d.store.command<ManualRow | null>(
      "manual_lookup",
      org,
      { requestId },
      actor,
    );
    if (!row) return null;
    if (row.prepared_by !== actor) throw new AgentError("forbidden");
    return {
      manualId: row.id,
      state: row.state,
      code: row.error_code,
      messageId: row.result_message_id,
      contactId: row.contact_id,
      conversationId: row.conversation_id,
    };
  }
  /**
   * One human click from the GHL inbox: prepare + send through the durable manual ledger.
   * The requestId is the idempotency key; a repeated request never issues a second POST.
   * The reviewed revision is required and re-checked; it is never silently renewed.
   */
  async inboxSend(
    org: string,
    actor: string,
    input: {
      contactId: string;
      conversationId: string;
      text: string;
      requestId: string;
      revision: {
        historyHash: string;
        sessionVersion: number;
        providerId: string;
        defaultId: string | null;
      };
    },
    writeEnabled: boolean,
    configuredProviderId: string | null,
  ): Promise<{ state: string; code: string | null; messageId: string | null; manualId: string }> {
    const { revision, ...scope } = input;
    const existing = await this.d.store.command<ManualRow | null>(
      "manual_lookup",
      org,
      { requestId: input.requestId },
      actor,
    );
    let row = existing;
    if (row) {
      const old = this.manualPayload(org, row);
      if (
        row.prepared_by !== actor ||
        row.contact_id !== input.contactId ||
        row.conversation_id !== input.conversationId ||
        old.text !== input.text.trim()
      )
        throw new AgentError("manual_request_mismatch");
    } else {
      const fresh = await this.inboxContext(org, actor, scope, writeEnabled, configuredProviderId);
      if (fresh.blockedReason) throw new AgentError(fresh.blockedReason);
      if (
        fresh.revision.historyHash !== revision.historyHash ||
        fresh.revision.sessionVersion !== revision.sessionVersion
      )
        throw new AgentError("revision_changed");
      if (
        !fresh.route ||
        !sameRoute(fresh.route, {
          providerId: revision.providerId,
          name: fresh.route.name,
          defaultId: revision.defaultId,
        })
      )
        throw new AgentError("route_changed");
      try {
        const prepared = await this.manualPrepare(
          org,
          actor,
          {
            ...scope,
            expectedVersion: revision.sessionVersion,
            historyHash: revision.historyHash,
          },
          writeEnabled,
          fresh.route,
        );
        row = await this.d.store.command<ManualRow>(
          "manual_detail",
          org,
          { manualId: prepared.id },
          actor,
        );
      } catch (e) {
        // A concurrent request with the same key may have already prepared/claimed it.
        if (!(e instanceof AgentError) || e.code !== "manual_request_used") throw e;
        row = await this.d.store.command<ManualRow | null>(
          "manual_lookup",
          org,
          { requestId: input.requestId },
          actor,
        );
        if (!row) throw e;
      }
    }
    if (row.state !== "prepared")
      return {
        state: row.state,
        code: row.error_code,
        messageId: row.result_message_id,
        manualId: row.id,
      };
    // Rota fixada na revisão: revalidar antes de reclamar o envio.
    const pinned = this.manualPayload(org, row).snapshot;
    if (!pinned.route) throw new AgentError("route_unverified");
    const now = await this.inboxRoute(pinned, configuredProviderId);
    if (!now.ok || !sameRoute(now.route, pinned.route)) throw new AgentError("route_changed");
    const result = await this.manualSend(
      org,
      actor,
      { manualId: row.id, replyHash: row.reply_hash },
      writeEnabled,
    );
    return { ...result, manualId: row.id };
  }
  async manualReconcile(
    org: string,
    actor: string,
    input: { manualId: string; messageId: string },
  ) {
    const row = await this.d.store.command<ManualRow>("manual_detail", org, input, actor);
    if (
      !["unknown", "sending"].includes(row.state) ||
      !row.approved_at ||
      !this.d.provider.verifyManualReceipt
    )
      throw new AgentError("reconcile_blocked");
    const p = this.manualPayload(org, row);
    if (
      !(await this.d.provider.verifyManualReceipt(
        p.snapshot,
        p.text,
        input.messageId,
        row.approved_at,
      ))
    )
      throw new AgentError("receipt_not_verified");
    return this.d.store.command<{ status: string }>("manual_reconcile", org, input, actor);
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
