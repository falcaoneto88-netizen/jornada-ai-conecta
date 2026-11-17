import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Decision, Snapshot } from "./core";

const knowledge = vi.hoisted(() => ({ load: vi.fn(), supervisedLoad: vi.fn(), suffix: "" }));
vi.mock("../izabel/knowledge-v03.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../izabel/knowledge-v03.server")>();
  return {
    ...actual,
    loadIzabelV03AutomaticReference: knowledge.load,
    loadIzabelV03Reference: knowledge.supervisedLoad,
    get IZABEL_V03_AUTOMATION_POLICY_MATERIAL() {
      return actual.IZABEL_V03_AUTOMATION_POLICY_MATERIAL + knowledge.suffix;
    },
  };
});
import {
  AUTOMATION_POLICY_HASH,
  POLICY_HASH,
  configuredAutomaticGenerator,
  modelRequest,
  replyHash,
} from "./providers.server";
import { IZABEL_V03_AUTOMATION_POLICY } from "../izabel/knowledge-v03.server";

const scope = {
  organizationId: "f07ab3be-7419-4779-a901-ef71c5fc27f0",
  locationId: "ok2UHC2QMZsd8UHsAgEa",
};
const source = {
  id: "SYNTHETIC_APPROVED",
  phase: "fixture",
  intents: ["fixture"],
  text: "Synthetic approved factual reference, not clinic policy.",
  language: "pt",
  mode: "fixed_facts",
  status: "approved_owner",
  scope: "commercial",
  source_id: "DESIGN_V1",
  source_pages: [],
  guards: [],
  note: "Synthetic fixture only.",
};
const reference = JSON.stringify({ records: [{ record: source }] });
const snapshot: Snapshot = {
  event: {
    type: "InboundMessage",
    locationId: scope.locationId,
    contactId: "synthetic-contact",
    conversationId: "synthetic-conversation",
    messageId: "synthetic-message",
  },
  name: "Pessoa Fictícia",
  dnd: false,
  historyHash: "synthetic-history",
  messages: [
    {
      id: "synthetic-message",
      direction: "inbound",
      at: "2026-11-17T10:00:00.000Z",
      text: "Como funciona a avaliação?",
      attachments: 0,
      channel: "SMS",
      provider: null,
    },
  ],
};
function inbound(text: string, attachments = 0): Snapshot {
  return { ...snapshot, messages: [{ ...snapshot.messages[0]!, text, attachments }] };
}
function response(overrides: Partial<Decision> & { sourceRecordIds?: string[] } = {}) {
  return Response.json({
    status: "completed",
    output: [
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: JSON.stringify({
              reply: "A avaliação permite conversar sobre os objetivos.",
              flags: [],
              handoff: false,
              optOut: false,
              sourceRecordIds: [source.id],
              ...overrides,
            }),
          },
        ],
      },
    ],
  });
}
function generator(provider: "openai" | "lovable", f: typeof fetch, customScope = scope) {
  return configuredAutomaticGenerator(
    {
      COMMERCIAL_AGENT_AI_PROVIDER: provider,
      OPENAI_API_KEY: "synthetic-openai",
      LOVABLE_API_KEY: "synthetic-lovable",
    },
    f,
    customScope,
  );
}

beforeEach(() => {
  knowledge.load.mockReset().mockResolvedValue(reference);
  knowledge.supervisedLoad.mockReset();
  knowledge.suffix = "";
});
afterEach(() => {
  knowledge.suffix = "";
  vi.resetModules();
});

describe.each(["openai", "lovable"] as const)("automatic commercial provider %s", (provider) => {
  it("uses only the independent automatic policy and persists source evidence separately from human approval", async () => {
    const f = vi.fn().mockResolvedValue(response());
    const payload = await generator(provider, f)(snapshot);
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe(
      provider === "lovable"
        ? "https://ai.gateway.lovable.dev/v1/responses"
        : "https://api.openai.com/v1/responses",
    );
    const request = JSON.parse(init.body);
    expect(request.input[0].content).toContain(IZABEL_V03_AUTOMATION_POLICY);
    expect(request.input[0].content).not.toMatch(
      /O humano decide o envio|resposta comercial para revisão humana|draft_supervised/,
    );
    expect(request.input[0].content).toContain(reference);
    expect(request.text.format.schema.required).toContain("sourceRecordIds");
    expect(request).not.toHaveProperty("tools");
    expect(request.store).toBe(false);
    expect(knowledge.load).toHaveBeenCalledExactlyOnceWith(scope);
    expect(knowledge.supervisedLoad).not.toHaveBeenCalled();
    expect(payload).toMatchObject({
      generationMode: "automatic",
      policyHash: AUTOMATION_POLICY_HASH,
      sourceRecordIds: [source.id],
      decision: { flags: [], handoff: false, optOut: false },
    });
    expect(payload.policyHash).not.toBe(POLICY_HASH);
    expect(replyHash({ ...payload, sourceRecordIds: ["OTHER"] })).not.toBe(replyHash(payload));
  });

  it.each([{ sourceRecordIds: [] }, { sourceRecordIds: ["UNKNOWN_SOURCE"] }])(
    "holds responses with absent or ineligible evidence $sourceRecordIds",
    async ({ sourceRecordIds }) => {
      const payload = await generator(
        provider,
        vi.fn().mockResolvedValue(response({ sourceRecordIds })),
      )(snapshot);
      expect(payload.decision.flags).toContain("missing_policy");
      expect(payload.decision.handoff).toBe(true);
    },
  );

  it.each([
    ["Quero falar com um humano", "human_requested"],
    ["Estou com falta de ar", "urgent"],
    ["Qual o preço da consulta?", "commercial_conflict"],
  ])("enforces explicit safety signals even if the model omits them: %s", async (text, flag) => {
    const payload = await generator(provider, vi.fn().mockResolvedValue(response()))(inbound(text));
    expect(payload.decision.flags).toContain(flag);
    expect(payload.decision.handoff).toBe(true);
  });

  it("enforces opt-out and unread current attachments independently of model flags", async () => {
    const f = vi.fn().mockImplementation(() => Promise.resolve(response()));
    const generate = generator(provider, f);
    expect((await generate(inbound("Não quero mais mensagens"))).decision).toMatchObject({
      optOut: true,
      handoff: true,
    });
    const attached = await generate(inbound("Pode analisar?", 1));
    expect(attached.decision.flags).toContain("unsupported_attachment");
    expect(attached.decision.handoff).toBe(true);
  });

  it("holds unconfirmed monetary offers and model-detected clinical cases", async () => {
    const money = await generator(
      provider,
      vi.fn().mockResolvedValue(response({ reply: "A consulta custa 50 euros." })),
    )(snapshot);
    expect(money.decision.flags).toContain("commercial_conflict");
    expect(money.decision.handoff).toBe(true);
    const clinical = await generator(
      provider,
      vi.fn().mockResolvedValue(response({ flags: ["clinical"] })),
    )(snapshot);
    expect(clinical.decision.handoff).toBe(true);
  });

  it("does not permit invented V03 financial relationships", async () => {
    await expect(
      generator(
        provider,
        vi.fn().mockResolvedValue(response({ reply: "O valor será abatido do procedimento." })),
      )(snapshot),
    ).rejects.toThrow("commercial_reference_violation");
  });

  it.each([
    "izabel_knowledge_unavailable",
    "izabel_knowledge_storage_not_private",
    "izabel_knowledge_integrity_failed",
    "izabel_knowledge_no_automatic_reference",
  ])("fails closed on %s without supervised or provider fallback", async (code) => {
    knowledge.load.mockRejectedValueOnce(new Error(code));
    const f = vi.fn();
    await expect(generator(provider, f)(snapshot)).rejects.toThrow(code);
    expect(f).not.toHaveBeenCalled();
    expect(knowledge.supervisedLoad).not.toHaveBeenCalled();
  });

  it("rejects wrong tenant before private knowledge or model I/O", async () => {
    const f = vi.fn();
    await expect(
      generator(provider, f, { ...scope, organizationId: "foreign-org" })(snapshot),
    ).rejects.toThrow("knowledge_scope_mismatch");
    expect(knowledge.load).not.toHaveBeenCalled();
    expect(f).not.toHaveBeenCalled();
  });

  it.each(["in_progress", "incomplete", "failed"])(
    "rejects provider status %s without retry",
    async (status) => {
      const f = vi.fn().mockResolvedValue(Response.json({ status }));
      await expect(generator(provider, f)(snapshot)).rejects.toThrow(`${provider}_incomplete`);
      expect(f).toHaveBeenCalledTimes(1);
    },
  );
});

it("prevents injecting supervised drafts into an automatic prompt", () => {
  const draftReference = JSON.stringify({
    records: [{ record: { ...source, status: "draft_supervised" } }],
  });
  expect(() =>
    modelRequest(snapshot, "synthetic-model", scope, draftReference, "automatic"),
  ).toThrow("knowledge_unavailable");
});

it("rejects an outbound or mismatched latest message as the automatic trigger", async () => {
  const f = vi.fn();
  await expect(
    generator(
      "openai",
      f,
    )({ ...snapshot, messages: [{ ...snapshot.messages[0]!, direction: "outbound" }] }),
  ).rejects.toThrow("generation_snapshot_invalid");
  await expect(
    generator("openai", f)({ ...snapshot, event: { ...snapshot.event, messageId: "old-message" } }),
  ).rejects.toThrow("generation_snapshot_invalid");
  expect(f).not.toHaveBeenCalled();
});

it("changes automatic authorization hash without invalidating the supervised hash when only the automatic policy changes", async () => {
  knowledge.suffix = "synthetic-automatic-revision";
  vi.resetModules();
  const revised = await import("./providers.server");
  expect(revised.AUTOMATION_POLICY_HASH).not.toBe(AUTOMATION_POLICY_HASH);
  expect(revised.POLICY_HASH).toBe(POLICY_HASH);
});

it("binds the automatic draft hash to the verified sending route", async () => {
  const generated = await generator(
    "openai",
    vi.fn(async () => response()) as typeof fetch,
  )(snapshot);
  const pinned = {
    ...generated,
    snapshot: {
      ...snapshot,
      route: {
        channel: "SMS" as const,
        providerId: "provider-A",
        name: "Synthetic A",
        defaultId: "provider-A",
      },
    },
  };
  const changed = {
    ...pinned,
    snapshot: { ...pinned.snapshot, route: { ...pinned.snapshot.route, providerId: "provider-B" } },
  };
  expect(replyHash(pinned)).not.toBe(replyHash(changed));
});
