import { beforeEach, describe, expect, it, vi } from "vitest";
import { attendanceDraftSaveSchema, attendanceDraftClearSchema } from "./attendance-draft.core";
import {
  AttendanceDraftService,
  bindAttendanceDraftDispatch,
  verifyAttendanceDraftScope,
  type VerifiedDraftScope,
} from "./attendance-draft.server";
import { GHL_ORIGIN, GHL_VERSION, type GhlResult } from "./ghl.server";

const scope: VerifiedDraftScope = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  locationId: "location-one",
  contactId: "contact-one",
  conversationId: "conversation-one",
};
const key = Buffer.alloc(32, 7).toString("base64");
const rpc = vi.fn(),
  verifyScope = vi.fn();
const make = (encryptionKey = key) =>
  new AttendanceDraftService({ rpc: { rpc }, encryptionKey, verifyScope });
let row: Record<string, unknown> | null;
beforeEach(() => {
  row = null;
  verifyScope.mockReset().mockResolvedValue(undefined);
  rpc.mockReset().mockImplementation(async (_name, args) => {
    if (args._op === "save") {
      const d = args._data;
      row = {
        organization_id: args._org,
        user_id: args._actor,
        location_id: args._location,
        contact_id: args._contact,
        conversation_id: args._conversation,
        revision: d.revision,
        payload: d.payload,
        text_hash: d.textHash,
        updated_at: "2026-10-13T10:00:00.000Z",
        expires_at: "2026-10-20T10:00:00.000Z",
      };
    }
    return { data: { row }, error: null };
  });
});
const inputScope = {
  organizationId: scope.organizationId,
  contactId: scope.contactId,
  conversationId: scope.conversationId,
};

describe("personal text drafts", () => {
  it("rejects media, client authors, oversized text and absent/non-UUID revision", () => {
    const valid = { ...inputScope, text: "Texto exato  ", expectedRevision: null };
    expect(attendanceDraftSaveSchema.safeParse(valid).success).toBe(true);
    for (const invalid of [
      { ...valid, attachments: [] },
      { ...valid, userId: scope.userId },
      { ...valid, text: "x".repeat(1501) },
      { ...valid, expectedRevision: 1 },
      { ...valid, expectedRevision: undefined },
    ])
      expect(attendanceDraftSaveSchema.safeParse(invalid).success).toBe(false);
    expect(
      attendanceDraftClearSchema.safeParse({ ...inputScope, expectedRevision: null }).success,
    ).toBe(false);
  });
  it("seals exact text with scope and revision; never sends plaintext to storage", async () => {
    const result = await make().save(scope, { text: "Rascunho pessoal  ", expectedRevision: null });
    expect(result).toMatchObject({
      ok: true,
      data: { revision: expect.any(String), draft: { text: "Rascunho pessoal  " } },
    });
    const [name, args] = rpc.mock.calls[0]!;
    expect(name).toBe("attendance_draft_command");
    expect(args._actor).toBe(scope.userId);
    expect(args._org).toBe(scope.organizationId);
    expect(JSON.stringify(args)).not.toContain("Rascunho pessoal");
    expect(args._data.payload).toMatch(/^v1\./);
    expect(verifyScope).toHaveBeenCalledWith(scope);
    expect(await make().load(scope)).toEqual(result);
    expect(rpc.mock.calls[1]![0]).toBe("attendance_draft_load_reconciled");
  });
  it("missing key or migration returns unavailable, never a saved acknowledgement", async () => {
    expect(
      await make("").save(scope, { text: "Ainda em memória", expectedRevision: null }),
    ).toEqual({ ok: false, code: "draft_unavailable" });
    expect(rpc).not.toHaveBeenCalled();
    expect(verifyScope).not.toHaveBeenCalled();
    rpc.mockResolvedValue({
      data: null,
      error: { code: "PGRST202", message: "private database diagnostics" },
    });
    expect(await make().save(scope, { text: "Ainda em memória", expectedRevision: null })).toEqual({
      ok: false,
      code: "draft_unavailable",
    });
  });
  it("throws away provider/storage diagnostics and rejects unverifiable scope", async () => {
    verifyScope.mockRejectedValueOnce(new Error("private provider payload"));
    expect(await make().load(scope)).toEqual({ ok: false, code: "draft_unavailable" });
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValueOnce({ data: { error: "forbidden" }, error: null });
    expect(await make().load(scope)).toEqual({ ok: false, code: "forbidden" });
  });
  it("scope/ciphertext/revision substitutions do not reveal a different user's draft", async () => {
    await make().save(scope, { text: "Privado", expectedRevision: null });
    row!["user_id"] = "33333333-3333-4333-8333-333333333333";
    expect(await make().load(scope)).toEqual({ ok: false, code: "scope_mismatch" });
    row!["user_id"] = scope.userId;
    row!["revision"] = "44444444-4444-4444-8444-444444444444";
    expect(await make().load(scope)).toEqual({ ok: false, code: "draft_unavailable" });
  });
  it("returns a scoped conflict snapshot instead of silently overwriting it", async () => {
    const saved = await make().save(scope, { text: "Outra aba", expectedRevision: null });
    rpc.mockResolvedValueOnce({ data: { error: "draft_conflict", row }, error: null });
    expect(
      await make().save(scope, { text: "Meu texto local", expectedRevision: null }),
    ).toMatchObject({ ok: false, code: "draft_conflict", current: saved.ok ? saved.data : null });
  });
  it("clear binds the exact expected text to the same actor and revision", async () => {
    const saved = await make().save(scope, { text: "Enviado  ", expectedRevision: null });
    if (!saved.ok) throw new Error("fixture");
    await make().clear(scope, { expectedRevision: saved.data.revision, expectedText: "Enviado  " });
    const args = rpc.mock.calls[1]![1];
    expect(args._op).toBe("clear");
    expect(args._data.expectedRevision).toBe(saved.data.revision);
    expect(args._data.expectedTextHash).toBe(row!["text_hash"]);
    expect(JSON.stringify(args)).not.toContain("Enviado");
    await make().clear(scope, { expectedRevision: saved.data.revision, expectedText: "Enviado" });
    expect(rpc.mock.calls[2]![1]._data.expectedTextHash).not.toBe(row!["text_hash"]);
  });
});

describe("trusted pre-dispatch draft binding", () => {
  const input = {
    ...scope,
    manualId: "33333333-3333-4333-8333-333333333333",
    requestId: "44444444-4444-4444-8444-444444444444",
    revision: "55555555-5555-4555-8555-555555555555",
    text: "Texto exato  ",
  };
  it("derives the scoped hash server-side without persisting plaintext or accepting a receipt", async () => {
    rpc.mockResolvedValue({ data: { bound: true }, error: null });
    await bindAttendanceDraftDispatch({ rpc }, key, input);
    const [name, args] = rpc.mock.calls[0]!;
    expect(name).toBe("attendance_draft_bind_dispatch");
    expect(args._actor).toBe(scope.userId);
    expect(args._revision).toBe(input.revision);
    expect(args._text_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(args)).not.toContain(input.text);
    expect(args).not.toHaveProperty("messageId");
    await bindAttendanceDraftDispatch({ rpc }, key, { ...input, text: input.text.trim() });
    expect(rpc.mock.calls[1]![1]._text_hash).not.toBe(args._text_hash);
    await bindAttendanceDraftDispatch({ rpc }, key, { ...input, userId: input.manualId });
    expect(rpc.mock.calls[2]![1]._text_hash).not.toBe(args._text_hash);
  });
  it("media-only cannot bind an empty text revision; invalid IDs and keys fail closed", async () => {
    for (const change of [{ text: "" }, { revision: "forged" }, { contactId: "../foreign" }])
      await expect(
        bindAttendanceDraftDispatch({ rpc }, key, { ...input, ...change }),
      ).rejects.toThrow("draft_binding_invalid");
    await expect(bindAttendanceDraftDispatch({ rpc }, "", input)).rejects.toThrow(
      "draft_binding_unavailable",
    );
    expect(rpc).not.toHaveBeenCalled();
  });
  it("missing migration, malformed acknowledgement and conflicts never confirm a binding", async () => {
    for (const data of [null, {}, { bound: false }, { error: "private detail" }]) {
      rpc.mockResolvedValueOnce({ data, error: null });
      await expect(bindAttendanceDraftDispatch({ rpc }, key, input)).rejects.toThrow(
        "draft_binding_unavailable",
      );
    }
    rpc.mockResolvedValueOnce({ data: { error: "draft_conflict" }, error: null });
    await expect(bindAttendanceDraftDispatch({ rpc }, key, input)).rejects.toThrow(
      "draft_binding_conflict",
    );
    rpc.mockResolvedValueOnce({ data: null, error: { message: "sensitive diagnostics" } });
    await expect(bindAttendanceDraftDispatch({ rpc }, key, input)).rejects.toThrow(
      "draft_binding_unavailable",
    );
  });
});

describe("canonical GHL scope proof is read-only", () => {
  const config = {
    locationId: scope.locationId,
    token: "fake-token",
    version: GHL_VERSION,
    baseUrl: GHL_ORIGIN,
  };
  const get = vi.fn(async <T>(_cfg: unknown, path: string): Promise<GhlResult<T>> => ({
    ok: true,
    status: 200,
    data: (path.startsWith("contacts/")
      ? { contact: { id: scope.contactId, locationId: scope.locationId } }
      : {
          id: scope.conversationId,
          contactId: scope.contactId,
          locationId: scope.locationId,
        }) as T,
  }));
  it("checks conversation plus contact against the same server location", async () => {
    get.mockClear();
    await verifyAttendanceDraftScope(config, scope, get);
    expect(get.mock.calls.map(([, path]) => path).sort()).toEqual([
      "contacts/contact-one",
      "conversations/conversation-one",
    ]);
    expect(get.mock.calls.every((call) => call.length === 2)).toBe(true);
  });
  it("mismatched identities and inaccessible API are refused", async () => {
    await expect(
      verifyAttendanceDraftScope(config, { ...scope, contactId: "other" }, get),
    ).rejects.toMatchObject({ code: "scope_mismatch" });
    await expect(
      verifyAttendanceDraftScope({ ...config, locationId: "other" }, scope, get),
    ).rejects.toMatchObject({ code: "scope_mismatch" });
    const rejected = vi.fn(async <T>(): Promise<GhlResult<T>> => ({
      ok: false,
      status: 403,
      code: "forbidden",
      message: "provider detail",
    }));
    await expect(verifyAttendanceDraftScope(config, scope, rejected)).rejects.toMatchObject({
      code: "draft_unavailable",
    });
  });
});
