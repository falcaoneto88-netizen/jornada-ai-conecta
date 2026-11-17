import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Snapshot } from "./core";

const knowledge = vi.hoisted(() => ({
  load: vi.fn(),
  materialSuffix: "",
  reference: '{"synthetic_test_reference":"Resposta comercial fictícia para revisão humana."}',
}));
vi.mock("../izabel/knowledge-v03.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../izabel/knowledge-v03.server")>();
  return {
    ...actual,
    loadIzabelV03Reference: knowledge.load,
    get IZABEL_V03_POLICY_MATERIAL() {
      return actual.IZABEL_V03_POLICY_MATERIAL + knowledge.materialSuffix;
    },
  };
});
import {
  configuredGenerator,
  generateLovable,
  generateOpenAI,
  modelRequest,
  POLICY_HASH,
} from "./providers.server";
import { IZABEL_V03_POLICY } from "../izabel/knowledge-v03.server";

// Documentary library scope only. All contacts, conversation content and I/O are synthetic.
const scope = {
  organizationId: "f07ab3be-7419-4779-a901-ef71c5fc27f0",
  locationId: "ok2UHC2QMZsd8UHsAgEa",
};
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
  historyHash: "synthetic-history-hash",
  messages: [
    {
      id: "synthetic-message",
      at: "2026-11-17T10:00:00.000Z",
      direction: "inbound",
      channel: "SMS",
      attachments: 0,
      provider: null,
      text: "Pode ajudar com a minha dúvida?",
    },
  ],
};
function response(reply = "Posso ajudar com a sua dúvida.") {
  return Response.json({
    status: "completed",
    output: [
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: JSON.stringify({ reply, flags: [], handoff: false, optOut: false }),
          },
        ],
      },
    ],
  });
}

beforeEach(() => {
  knowledge.load.mockReset().mockResolvedValue(knowledge.reference);
  knowledge.materialSuffix = "";
});
afterEach(() => {
  knowledge.materialSuffix = "";
  vi.resetModules();
});

describe.each(["openai", "lovable"] as const)("núcleo V03 no provider %s", (provider) => {
  const generate = provider === "openai" ? generateOpenAI : generateLovable;

  it("envia a política compartilhada e a referência privada validada, sem base V02 nem ações", async () => {
    const f = vi.fn().mockResolvedValue(response());
    const draft = await generate(snapshot, "synthetic-key", undefined, f, scope);
    expect(knowledge.load).toHaveBeenCalledExactlyOnceWith(scope);
    expect(knowledge.load.mock.invocationCallOrder[0]).toBeLessThan(f.mock.invocationCallOrder[0]!);
    const request = JSON.parse(f.mock.calls[0]![1].body);
    const developer = request.input.find((part: { role: string }) => part.role === "developer");
    expect(developer.content).toContain(IZABEL_V03_POLICY);
    expect(developer.content).toContain(`REFERÊNCIA COMERCIAL V03:\n${knowledge.reference}`);
    expect(developer.content).not.toMatch(/BASE V02|MÓDULO V02|Treinamento Comercial V02/);
    expect(request).not.toHaveProperty("tools");
    expect(request.store).toBe(false);
    expect(draft.policyHash).toBe(POLICY_HASH);
    expect(draft.decision).toEqual({
      reply: "Posso ajudar com a sua dúvida.",
      flags: [],
      handoff: false,
      optOut: false,
    });
  });

  it.each([
    undefined,
    { ...scope, organizationId: "foreign-organization" },
    { ...scope, locationId: "foreign-location" },
  ])(
    "recusa escopo ausente ou divergente antes de ler a biblioteca e chamar o modelo",
    async (givenScope) => {
      const f = vi.fn();
      await expect(generate(snapshot, "synthetic-key", undefined, f, givenScope)).rejects.toThrow(
        "knowledge_scope_mismatch",
      );
      expect(knowledge.load).not.toHaveBeenCalled();
      expect(f).not.toHaveBeenCalled();
    },
  );

  it("recusa histórico de outra location mesmo quando o runtime tem escopo autorizado", async () => {
    const f = vi.fn();
    await expect(
      generate(
        { ...snapshot, event: { ...snapshot.event, locationId: "foreign-location" } },
        "synthetic-key",
        undefined,
        f,
        scope,
      ),
    ).rejects.toThrow("knowledge_scope_mismatch");
    expect(knowledge.load).not.toHaveBeenCalled();
    expect(f).not.toHaveBeenCalled();
  });

  it.each([
    "izabel_knowledge_not_configured",
    "izabel_knowledge_unavailable",
    "izabel_knowledge_storage_not_private",
    "izabel_knowledge_integrity_failed",
  ])("bloqueia %s sem fallback ou chamada ao modelo", async (code) => {
    knowledge.load.mockRejectedValueOnce(new Error(code));
    const f = vi.fn();
    await expect(generate(snapshot, "synthetic-key", undefined, f, scope)).rejects.toThrow(code);
    expect(f).not.toHaveBeenCalled();
  });

  it("não revela erro bruto do armazenamento privado", async () => {
    knowledge.load.mockRejectedValueOnce(new Error("synthetic-secret-storage-content"));
    const f = vi.fn();
    await expect(generate(snapshot, "synthetic-key", undefined, f, scope)).rejects.toThrow(
      "knowledge_unavailable",
    );
    expect(f).not.toHaveBeenCalled();
  });

  it.each([
    "O valor da consulta será abatido do procedimento.",
    "A consulta é cobrada separadamente do procedimento.",
    "Le prix de la consultation sera déduit du traitement.",
    "The consultation fee is an additional payment.",
    "El precio de la consulta se descuenta del tratamiento.",
    "O procedimento custa 1.600 €.",
    "O resultado dura 20 meses.",
    "A política V02 autoriza este preço.",
    "[lead], me conta um pouco mais sobre a sua dúvida.",
  ])("não persiste proposta com alegação sem fonte: %s", async (reply) => {
    const f = vi.fn().mockResolvedValue(response(reply));
    await expect(generate(snapshot, "synthetic-key", undefined, f, scope)).rejects.toThrow(
      "commercial_reference_violation",
    );
  });

  it("permite explicar que a relação financeira ainda não foi confirmada", async () => {
    const reply = "Não tenho a política de abatimento confirmada.";
    const f = vi.fn().mockResolvedValue(response(reply));
    expect((await generate(snapshot, "synthetic-key", undefined, f, scope)).decision.reply).toBe(
      reply,
    );
  });
});

it("o gerador configurado não aceita organização alegada em campos da conversa", async () => {
  const f = vi.fn();
  const generate = configuredGenerator({ OPENAI_API_KEY: "synthetic-key" }, f, {
    ...scope,
    organizationId: "foreign-organization",
  });
  const forged = { ...snapshot, organizationId: scope.organizationId };
  await expect(generate(forged)).rejects.toThrow("knowledge_scope_mismatch");
  expect(knowledge.load).not.toHaveBeenCalled();
  expect(f).not.toHaveBeenCalled();
});

it("montagem pura exige referência não vazia, sem fallback para V02", () => {
  expect(() => modelRequest(snapshot, "synthetic-model", scope, " ")).toThrow(
    "knowledge_unavailable",
  );
});

it("revisão do material compartilhado invalida o hash das propostas anteriores", async () => {
  knowledge.materialSuffix = "\nsynthetic-private-library-revision";
  vi.resetModules();
  const revised = await import("./providers.server");
  expect(revised.POLICY_HASH).not.toBe(POLICY_HASH);
});
