import { createHmac, randomUUID } from "node:crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { seal, unseal } from "./commercial-agent/providers.server";
import { AgentError } from "./commercial-agent/core";
import { confirmarConversa } from "./ghl-observation.core";
import { GHL_ORIGIN, GHL_VERSION, ghlFetch, type GhlConfig, type GhlResult } from "./ghl.server";
import {
  attendanceDraftScopeSchema,
  attendanceDraftSaveSchema,
  attendanceDraftClearSchema,
  type AttendanceDraftResult,
  type AttendanceDraftScope,
  type AttendanceDraftSnapshot,
} from "./attendance-draft.core";

export type VerifiedDraftScope = AttendanceDraftScope & { userId: string; locationId: string };
export type AttendanceDraftRpc = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};
type DraftDeps = {
  rpc: AttendanceDraftRpc;
  encryptionKey: string;
  verifyScope(scope: VerifiedDraftScope): Promise<void>;
};
type Operation = "load" | "save" | "clear";
class DraftFailure extends Error {
  constructor(
    readonly code: "draft_unavailable" | "forbidden" | "scope_mismatch" | "invalid_input",
  ) {
    super(code);
  }
}
const rowSchema = z.object({
  organization_id: z.string().uuid(),
  user_id: z.string().uuid(),
  location_id: z.string(),
  contact_id: z.string(),
  conversation_id: z.string(),
  revision: z.string().uuid(),
  payload: z.string().max(20000).nullable(),
  text_hash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  updated_at: z.iso.datetime({ offset: true }),
  expires_at: z.iso.datetime({ offset: true }).nullable(),
});
const aad = (s: VerifiedDraftScope, revision: string) =>
  JSON.stringify([
    "attendance-draft-v1",
    s.organizationId,
    s.userId,
    s.locationId,
    s.contactId,
    s.conversationId,
    revision,
  ]);
const contentHash = (s: VerifiedDraftScope, text: string, key: string) =>
  createHmac("sha256", Buffer.from(key, "base64"))
    .update(
      JSON.stringify([
        "attendance-draft-text-v1",
        s.organizationId,
        s.userId,
        s.locationId,
        s.contactId,
        s.conversationId,
        text,
      ]),
    )
    .digest("hex");

export type AttendanceDraftDispatch = VerifiedDraftScope & {
  manualId: string;
  requestId: string;
  revision: string;
  text: string;
};

/** Trusted pre-send binding only: never accepts a client-provided receipt, author or hash. */
export async function bindAttendanceDraftDispatch(
  rpc: AttendanceDraftRpc,
  encryptionKey: string,
  input: AttendanceDraftDispatch,
): Promise<void> {
  const uuid = z.string().uuid();
  if (
    ![input.organizationId, input.userId, input.manualId, input.requestId, input.revision].every(
      (id) => uuid.safeParse(id).success,
    ) ||
    ![input.locationId, input.contactId, input.conversationId].every((id) =>
      /^[A-Za-z0-9_-]{1,100}$/.test(id),
    ) ||
    typeof input.text !== "string" ||
    !input.text.length ||
    input.text.length > 1500
  )
    throw new AgentError("draft_binding_invalid");
  const key = Buffer.from(encryptionKey, "base64");
  if (key.length !== 32 || key.toString("base64") !== encryptionKey)
    throw new AgentError("draft_binding_unavailable");
  try {
    const result = await rpc.rpc("attendance_draft_bind_dispatch", {
      _org: input.organizationId,
      _actor: input.userId,
      _location: input.locationId,
      _contact: input.contactId,
      _conversation: input.conversationId,
      _manual: input.manualId,
      _request: input.requestId,
      _revision: input.revision,
      _text_hash: contentHash(input, input.text, encryptionKey),
    });
    if (result.error) throw new AgentError("draft_binding_unavailable");
    const resultSchema = z.object({
      bound: z.literal(true).optional(),
      error: z.string().optional(),
    });
    const response = resultSchema.parse(result.data);
    if (response.error || response.bound !== true)
      throw new AgentError(
        response.error === "draft_conflict"
          ? "draft_binding_conflict"
          : "draft_binding_unavailable",
      );
  } catch (error) {
    throw new AgentError(error instanceof AgentError ? error.code : "draft_binding_unavailable");
  }
}

/** Personal text storage; load reconciles only proven sent manual ledger entries. Never sends. */
export class AttendanceDraftService {
  constructor(private readonly deps: DraftDeps) {}
  load(scope: VerifiedDraftScope) {
    return this.run("load", scope, {});
  }
  save(scope: VerifiedDraftScope, data: { text: string; expectedRevision: string | null }) {
    return this.run("save", scope, data);
  }
  clear(
    scope: VerifiedDraftScope,
    data: { expectedText: string; expectedRevision: string | null },
  ) {
    return this.run("clear", scope, data);
  }

  private snapshot(raw: unknown, scope: VerifiedDraftScope): AttendanceDraftSnapshot {
    if (raw === null) return { revision: null, draft: null };
    const row = rowSchema.parse(raw);
    if (
      row.organization_id !== scope.organizationId ||
      row.user_id !== scope.userId ||
      row.location_id !== scope.locationId ||
      row.contact_id !== scope.contactId ||
      row.conversation_id !== scope.conversationId
    )
      throw new DraftFailure("scope_mismatch");
    if (row.payload === null) {
      if (row.text_hash !== null || row.expires_at !== null)
        throw new DraftFailure("draft_unavailable");
      return { revision: row.revision, draft: null };
    }
    if (
      !row.expires_at ||
      Date.parse(row.expires_at) <= Date.parse(row.updated_at) ||
      Date.parse(row.expires_at) - Date.parse(row.updated_at) > 7 * 86400000
    )
      throw new DraftFailure("draft_unavailable");
    const decoded = z
      .object({ text: z.string().min(1).max(1500) })
      .strict()
      .parse(unseal(row.payload, this.deps.encryptionKey, aad(scope, row.revision)));
    if (row.text_hash !== contentHash(scope, decoded.text, this.deps.encryptionKey))
      throw new DraftFailure("draft_unavailable");
    return {
      revision: row.revision,
      draft: { text: decoded.text, updatedAt: row.updated_at, expiresAt: row.expires_at },
    };
  }

  private async run(
    op: Operation,
    scope: VerifiedDraftScope,
    data: Record<string, unknown>,
  ): Promise<AttendanceDraftResult> {
    try {
      const context = {
        organizationId: scope.organizationId,
        contactId: scope.contactId,
        conversationId: scope.conversationId,
      };
      const schema =
        op === "load"
          ? attendanceDraftScopeSchema
          : op === "save"
            ? attendanceDraftSaveSchema
            : attendanceDraftClearSchema;
      if (
        !schema.safeParse({ ...context, ...data }).success ||
        !z.string().uuid().safeParse(scope.userId).success ||
        !/^[A-Za-z0-9_-]{1,100}$/.test(scope.locationId)
      )
        return { ok: false, code: "invalid_input" };
      const key = Buffer.from(this.deps.encryptionKey, "base64");
      if (key.length !== 32 || key.toString("base64") !== this.deps.encryptionKey)
        return { ok: false, code: "draft_unavailable" };
      // Prove contact/conversation/location before reading or changing a personal draft.
      await this.deps.verifyScope(scope);
      let payload: Record<string, unknown> = {};
      if (op === "save") {
        const text = data["text"] as string,
          revision = randomUUID();
        payload = {
          expectedRevision: data["expectedRevision"],
          revision,
          empty: text.length === 0,
          ...(text.length
            ? {
                payload: seal({ text }, this.deps.encryptionKey, aad(scope, revision)),
                textHash: contentHash(scope, text, this.deps.encryptionKey),
              }
            : {}),
        };
      } else if (op === "clear")
        payload = {
          expectedRevision: data["expectedRevision"],
          expectedTextHash: contentHash(
            scope,
            data["expectedText"] as string,
            this.deps.encryptionKey,
          ),
        };
      const result = await this.deps.rpc.rpc(
        op === "load" ? "attendance_draft_load_reconciled" : "attendance_draft_command",
        {
          _op: op,
          _org: scope.organizationId,
          _actor: scope.userId,
          _location: scope.locationId,
          _contact: scope.contactId,
          _conversation: scope.conversationId,
          _data: payload,
        },
      );
      if (result.error) return { ok: false, code: "draft_unavailable" };
      const response = z
        .object({ error: z.string().optional(), row: z.unknown().optional() })
        .parse(result.data);
      if (response.error === "draft_conflict")
        return { ok: false, code: "draft_conflict", current: this.snapshot(response.row, scope) };
      if (response.error)
        return {
          ok: false,
          code: ["forbidden", "scope_mismatch", "invalid_input"].includes(response.error)
            ? (response.error as "forbidden" | "scope_mismatch" | "invalid_input")
            : "draft_unavailable",
        };
      if (!("row" in response)) return { ok: false, code: "draft_unavailable" };
      return { ok: true, data: this.snapshot(response.row, scope) };
    } catch (error) {
      // Never return ciphertext, hashes, raw provider/database errors or draft content in errors.
      return { ok: false, code: error instanceof DraftFailure ? error.code : "draft_unavailable" };
    }
  }
}

export async function verifyAttendanceDraftScope(
  config: GhlConfig,
  scope: VerifiedDraftScope,
  get: (config: GhlConfig, path: string) => Promise<GhlResult<unknown>> = ghlFetch,
): Promise<void> {
  if (config.locationId !== scope.locationId || !config.token)
    throw new DraftFailure("scope_mismatch");
  const results = await Promise.allSettled([
    get(config, `conversations/${scope.conversationId}`),
    get(config, `contacts/${scope.contactId}`),
  ]);
  const [conversation, contact] = results;
  if (
    conversation.status !== "fulfilled" ||
    contact.status !== "fulfilled" ||
    !conversation.value.ok ||
    !contact.value.ok
  )
    throw new DraftFailure("draft_unavailable");
  try {
    const conv = confirmarConversa(conversation.value.data, scope.locationId, scope.conversationId);
    const item = z
      .object({ contact: z.object({ id: z.string(), locationId: z.string() }) })
      .parse(contact.value.data).contact;
    if (
      conv.contactId !== scope.contactId ||
      item.id !== scope.contactId ||
      item.locationId !== scope.locationId
    )
      throw new Error("mismatch");
  } catch {
    throw new DraftFailure("scope_mismatch");
  }
}

/** Session-derived author and tenant; request organization is only a consistency check. */
export async function authenticatedAttendanceDraft(
  context: { supabase: SupabaseClient; userId: string },
  input: AttendanceDraftScope,
): Promise<
  | { service: AttendanceDraftService; scope: VerifiedDraftScope }
  | { failure: AttendanceDraftResult }
> {
  try {
    const { resolverAcesso } = await import("./ghl.functions");
    const access = await resolverAcesso(context, ["administrador", "gestor", "comercial"]);
    if (!access.ok)
      return {
        failure: {
          ok: false,
          code: access.code === "forbidden" ? "forbidden" : "draft_unavailable",
        },
      };
    if (input.organizationId !== access.acesso.orgId)
      return { failure: { ok: false, code: "forbidden" } };
    const token = process.env["GHL_PRIVATE_TOKEN"] ?? "";
    if (!token) return { failure: { ok: false, code: "draft_unavailable" } };
    const scope = {
      ...input,
      organizationId: access.acesso.orgId,
      userId: context.userId,
      locationId: access.acesso.locationId,
    };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const config = {
      token,
      locationId: scope.locationId,
      baseUrl: GHL_ORIGIN,
      version: GHL_VERSION,
    };
    return {
      scope,
      service: new AttendanceDraftService({
        encryptionKey: process.env["COMMERCIAL_AGENT_ENCRYPTION_KEY"] ?? "",
        rpc: supabaseAdmin as unknown as AttendanceDraftRpc,
        verifyScope: (s) => verifyAttendanceDraftScope(config, s),
      }),
    };
  } catch {
    return { failure: { ok: false, code: "draft_unavailable" } };
  }
}
