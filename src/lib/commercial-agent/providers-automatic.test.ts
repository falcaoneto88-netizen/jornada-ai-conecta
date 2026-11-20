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
const budgetSource = {
  ...source,
  id: "PRECO_INICIAL",
  text: "Synthetic budget reference: an assessment in consultation is required. No prices.",
};
const budgetReference = JSON.stringify({ records: [{ record: budgetSource }] });
const budgetReply = "O orçamento do procedimento só é definido em consulta.";
const procedureBudgetQuestion = "Qual o valor da harmonização de glúteos?";
const completeBudgetReply = `${budgetReply} Posso explicar como funciona a consulta?`;
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

  it("does not classify the number in a sourced nonfinancial address as a price", async () => {
    const addressSource = {
      ...source,
      id: "SYNTHETIC_ADDRESS",
      text: "O endereço fictício de teste é Rua Exemplo, 10.",
    };
    knowledge.load.mockResolvedValue(JSON.stringify({ records: [{ record: addressSource }] }));
    const reply = "O endereço fictício de teste é Rua Exemplo, 10.";
    const payload = await generator(
      provider,
      vi.fn().mockResolvedValue(response({ reply, sourceRecordIds: [addressSource.id] })),
    )(inbound("Qual é o endereço?"));
    expect(payload.decision).toEqual({ reply, flags: [], handoff: false, optOut: false });
  });

  it.each([
    "Qual o preço do procedimento?",
    "Quanto custa?",
    "Quanto é?",
    "Quanto fica?",
    "How much?",
    "Combien ?",
  ])("holds a bare numeric quote when the current request is financial: %s", async (text) => {
    const payload = await generator(
      provider,
      vi.fn().mockResolvedValue(response({ reply: "50" })),
    )(inbound(text));
    expect(payload.decision.flags).toContain("commercial_conflict");
    expect(payload.decision.handoff).toBe(true);
  });

  it.each([
    ["Qual o valor do procedimento?", budgetReply],
    ["Qual o orçamento?", `${budgetReply} Posso explicar como funciona a consulta?`],
    [
      "Quel est le prix du traitement ?",
      "Le devis du traitement est défini uniquement en consultation.",
    ],
    [
      "Combien coûte le traitement ?",
      "Le devis du traitement est défini uniquement en consultation. Puis-je expliquer comment se déroule la consultation ?",
    ],
    [
      "How much does the procedure cost?",
      "The procedure quote is determined only during a consultation.",
    ],
    [
      "What is the procedure price?",
      "The procedure quote is determined only during a consultation. May I explain how the consultation works?",
    ],
  ])(
    "continues a sourced informational budget question without quoting: %s",
    async (text, reply) => {
      knowledge.load.mockResolvedValue(budgetReference);
      const payload = await generator(
        provider,
        vi.fn().mockResolvedValue(response({ reply, sourceRecordIds: [budgetSource.id] })),
      )(inbound(text));
      expect(payload.decision).toEqual({ reply, flags: [], handoff: false, optOut: false });
    },
  );

  it("sends the complete sourced PT example and permits its neutral budget decision", async () => {
    knowledge.load.mockResolvedValue(budgetReference);
    const decision = {
      reply: completeBudgetReply,
      flags: [],
      handoff: false,
      optOut: false,
      sourceRecordIds: [budgetSource.id],
    };
    const f = vi.fn().mockResolvedValue(response(decision));
    const payload = await generator(provider, f)(inbound(procedureBudgetQuestion));
    const request = JSON.parse(f.mock.calls[0]![1].body);
    expect(request.input[0].content).toContain(JSON.stringify(decision));
    expect(request.input[0].content).toContain(
      "A ausência de um preço aprovado, por si só, não acrescenta commercial_conflict nem handoff",
    );
    expect(JSON.parse(request.input[1].content).ultimaMensagem.texto).toBe(procedureBudgetQuestion);
    expect(payload).toMatchObject({
      sourceRecordIds: [budgetSource.id],
      decision: { reply: completeBudgetReply, flags: [], handoff: false, optOut: false },
    });
  });

  it.each(["Gostaria de saber o valor pra 200 mls", "Gostaria de saber o valor para cinquenta ml"])(
    "uses the quantity source without endorsing an inbound quantity: %s",
    async (text) => {
      knowledge.load.mockResolvedValue(
        JSON.stringify({ records: [{ record: { ...budgetSource, id: "QUANTIDADE" } }] }),
      );
      const payload = await generator(
        provider,
        vi
          .fn()
          .mockResolvedValue(response({ reply: budgetReply, sourceRecordIds: ["QUANTIDADE"] })),
      )(inbound(text));
      expect(payload.decision.flags).toEqual([]);
      expect(payload.decision.handoff).toBe(false);
      expect(payload.decision.reply).not.toMatch(/\d|ml|€|euros/i);
    },
  );

  it.each([
    "Qual o preço da consulta?",
    "Confirma o valor do procedimento?",
    "O valor é 50 euros?",
    "Qual o custo da avaliação?",
    "Qual o valor com desconto?",
    "Qual o valor? Posso parcelar?",
    "Qual o valor com crédito?",
    "Qual o valor e a forma de pagamento?",
    "Qual o valor à vista?",
    "Qual o valor no cartão de débito?",
    "Qual o valor de entrada ou sinal?",
    "Qual o valor? Há reembolso?",
    "Qual o valor? Manda IBAN ou MB WAY",
    "Quel est le prix de la consultation ?",
    "Quel est le prix avec remise ?",
    "Quel est le prix et le mode de paiement ?",
    "Quel est le prix en espèces ?",
    "Quel est le prix avec carte ?",
    "Quel est le prix avec remboursement ?",
    "What is the appointment fee?",
    "What is the price with a discount?",
    "What is the price in installments?",
    "What is the price and payment method?",
    "What is the price with cash?",
    "What is the price by card?",
    "What is the price with a deposit?",
    "What is the price with a refund?",
    "Qual o preço, is it free?",
    "Qual o valor da oferta?",
  ])("keeps financial terms and consultation prices with the team: %s", async (text) => {
    knowledge.load.mockResolvedValue(budgetReference);
    const reply = text.startsWith("Quel")
      ? "Le devis du traitement est défini uniquement en consultation."
      : text.startsWith("What")
        ? "The procedure quote is determined only during a consultation."
        : budgetReply;
    const payload = await generator(
      provider,
      vi.fn().mockResolvedValue(response({ reply, sourceRecordIds: [budgetSource.id] })),
    )(inbound(text));
    expect(payload.decision.flags).toContain("commercial_conflict");
    expect(payload.decision.handoff).toBe(true);
  });

  it.each([
    `Olá! ${budgetReply}`,
    `${budgetReply} A consulta custa 50 euros.`,
    `${budgetReply} O investimento é de cinquenta.`,
    `${budgetReply} É grátis.`,
    `${budgetReply} Temos desconto.`,
    `${budgetReply} Aceitamos cartão.`,
    `${budgetReply} Vou reservar um horário.`,
    `${budgetReply} Pode pagar 50.`,
    `${budgetReply} Qual é seu nome?`,
    `${budgetReply} Posso explicar como funciona a consulta? Posso explicar como funciona a consulta?`,
    `${budgetReply} May I explain how the consultation works?`,
    "The procedure quote is determined only during a consultation.",
  ])(
    "does not exempt any extra financial claim, action or unapproved wording: %s",
    async (reply) => {
      knowledge.load.mockResolvedValue(budgetReference);
      const payload = await generator(
        provider,
        vi.fn().mockResolvedValue(response({ reply, sourceRecordIds: [budgetSource.id] })),
      )(inbound("Qual o valor do procedimento?"));
      expect(payload.decision.flags).toContain("commercial_conflict");
      expect(payload.decision.handoff).toBe(true);
    },
  );

  it.each([[], [source.id], ["UNKNOWN_SOURCE"], [budgetSource.id, "UNKNOWN_SOURCE"]])(
    "does not send a budget deferral without complete eligible citations: %j",
    async (...ids) => {
      knowledge.load.mockResolvedValue(
        JSON.stringify({ records: [{ record: source }, { record: budgetSource }] }),
      );
      const payload = await generator(
        provider,
        vi.fn().mockResolvedValue(response({ reply: budgetReply, sourceRecordIds: ids })),
      )(inbound("Qual o valor?"));
      expect(payload.decision.flags.length).toBeGreaterThan(0);
      expect(payload.decision.handoff).toBe(true);
    },
  );

  it.each(["draft_supervised", "human_only", "conditional_review"])(
    "rejects an ineligible budget source with status %s before model I/O",
    async (status) => {
      knowledge.load.mockResolvedValue(
        JSON.stringify({ records: [{ record: { ...budgetSource, status } }] }),
      );
      const f = vi.fn();
      await expect(generator(provider, f)(inbound("Qual o valor?"))).rejects.toThrow(
        "knowledge_unavailable",
      );
      expect(f).not.toHaveBeenCalled();
    },
  );

  it.each([
    { flags: ["commercial_conflict"] },
    { flags: ["clinical"] },
    { flags: ["missing_policy"] },
    { flags: ["human_requested"] },
    { flags: ["urgent"] },
    { flags: ["unsupported_attachment"] },
    { flags: ["unsupported_action"] },
    { handoff: true },
    { optOut: true },
  ] satisfies Array<Partial<Decision>>)(
    "preserves an existing hold on a safe deferral: %j",
    async (hold) => {
      knowledge.load.mockResolvedValue(budgetReference);
      const payload = await generator(
        provider,
        vi
          .fn()
          .mockResolvedValue(
            response({ reply: completeBudgetReply, sourceRecordIds: [budgetSource.id], ...hold }),
          ),
      )(inbound(procedureBudgetQuestion));
      expect(payload.decision).toMatchObject({ ...hold, handoff: true });
    },
  );

  it.each([
    ["Qual o valor? Quero falar com um humano", 0, "human_requested"],
    ["Qual o valor? Estou com falta de ar", 0, "urgent"],
    ["Qual o valor?", 1, "unsupported_attachment"],
  ] as const)(
    "retains independent safeguards on a sourced deferral: %s",
    async (text, attachments, flag) => {
      knowledge.load.mockResolvedValue(budgetReference);
      const payload = await generator(
        provider,
        vi
          .fn()
          .mockResolvedValue(response({ reply: budgetReply, sourceRecordIds: [budgetSource.id] })),
      )(inbound(text, attachments));
      expect(payload.decision.flags).toContain(flag);
      expect(payload.decision.handoff).toBe(true);
    },
  );

  it("keeps unclear or mixed-language budget requests for review", async () => {
    knowledge.load.mockResolvedValue(budgetReference);
    for (const text of ["???", "Qual o valor, what is the price?"]) {
      const payload = await generator(
        provider,
        vi
          .fn()
          .mockResolvedValue(response({ reply: budgetReply, sourceRecordIds: [budgetSource.id] })),
      )(inbound(text));
      expect(payload.decision.flags).toContain("commercial_conflict");
      expect(payload.decision.handoff).toBe(true);
    }
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
