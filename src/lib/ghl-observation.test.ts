import { describe, expect, it, vi } from "vitest";
import {
  normalizarConversas,
  normalizarMensagens,
  normalizarWorkflows,
  pedidoMensagens,
  pesquisaConversas,
  respostaLiteral,
} from "./ghl-observation.core";
import { observarGhl } from "./ghl-observation.server";
import { analiseSchema } from "./ai-analysis";

const org = "f07ab3be-7419-4779-a901-ef71c5fc27f0";
const ctx = { userId: "user", supabase: {} as never };
const conv = {
  id: "convA",
  contactId: "contactA",
  locationId: "locA",
  fullName: "Contacto de teste",
  lastMessageDate: 1789387200000,
};
const msg = {
  id: "msgA",
  conversationId: "convA",
  locationId: "locA",
  contactId: "contactA",
  body: "SIM",
  dateAdded: "2026-09-14T12:00:00Z",
  messageType: "SMS",
  direction: "inbound",
  status: "delivered",
};
const scope = { conversationId: "convA", locationId: "locA", contactId: "contactA" };
function deps() {
  return {
    acesso: vi.fn(async () => ({
      ok: true as const,
      acesso: {
        orgId: org,
        locationId: "locA",
        nome: "Nome",
        papeis: ["visualizador" as const],
        conn: { write_enabled: false },
      },
    })),
    token: vi.fn(() => "fake-test-token"),
    get: vi.fn(
      async () =>
        ({ ok: true as const, status: 200, data: { conversations: [conv], total: 1 } }) as {
          ok: true;
          status: number;
          data: unknown;
        },
    ),
  };
}
describe("leitura do executor GHL", () => {
  it("autoriza primeiro, fixa a location no servidor e nunca pede escrita", async () => {
    const d = deps();
    const r = await observarGhl(ctx, "conversas", { organizationId: org, query: "Felipe" }, d);
    expect(d.acesso).toHaveBeenCalledBefore(d.token);
    expect(d.token).toHaveBeenCalledBefore(d.get);
    expect(d.get.mock.calls[0]).toEqual([
      expect.objectContaining({ locationId: "locA" }),
      "conversations/search",
      { query: expect.objectContaining({ locationId: "locA", query: "Felipe" }) },
    ]);
    expect(JSON.stringify(r)).not.toContain("fake-test-token");
  });
  it("sessão de outra organização não lê token nem chama GHL", async () => {
    const d = deps();
    await expect(
      observarGhl(ctx, "conversas", { organizationId: "11111111-1111-4111-8111-111111111111" }, d),
    ).rejects.toThrow("organização");
    expect(d.token).not.toHaveBeenCalled();
    expect(d.get).not.toHaveBeenCalled();
  });
  it("recusa sem binding/papel chega antes das credenciais", async () => {
    const d = {
      ...deps(),
      acesso: vi.fn(async () => ({
        ok: false as const,
        code: "forbidden" as const,
        message: "Sem permissão",
      })),
    };
    await expect(observarGhl(ctx, "workflows", { organizationId: org }, d)).rejects.toThrow(
      "Sem permissão",
    );
    expect(d.token).not.toHaveBeenCalled();
    expect(d.get).not.toHaveBeenCalled();
  });
  it("não permite location, URLs ou caminhos controlados pelo cliente", () => {
    expect(pesquisaConversas.safeParse({ organizationId: org, locationId: "outra" }).success).toBe(
      false,
    );
    for (const conversationId of [
      "../outra",
      "https://malicious.invalid",
      "id?locationId=outra",
      "id%2Fmessages",
    ]) {
      expect(pedidoMensagens.safeParse({ organizationId: org, conversationId }).success).toBe(
        false,
      );
    }
  });
  it("verifica a conversa antes de ler qualquer mensagem", async () => {
    const d = deps();
    d.get.mockResolvedValueOnce({ ok: true, status: 200, data: { ...conv, locationId: "outra" } });
    await expect(
      observarGhl(ctx, "mensagens", { organizationId: org, conversationId: "convA" }, d),
    ).rejects.toThrow("subconta");
    expect(d.get).toHaveBeenCalledTimes(1);
  });
  it("lê páginas de mensagens somente após validar propriedade", async () => {
    const d = deps();
    d.get.mockResolvedValueOnce({ ok: true, status: 200, data: conv }).mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { messages: { messages: [msg], nextPage: false } },
    });
    const r = await observarGhl(
      ctx,
      "mensagens",
      { organizationId: org, conversationId: "convA", cursor: "older" },
      d,
    );
    expect(r.tipo).toBe("mensagens");
    expect(d.get.mock.calls[1]).toEqual([
      expect.anything(),
      "conversations/convA/messages",
      { query: { limit: "50", lastMessageId: "older" } },
    ]);
  });
  it("falha de escopo ou formato nunca vira lista vazia", () => {
    expect(() =>
      normalizarConversas({ conversations: [{ ...conv, locationId: "outra" }] }, "locA"),
    ).toThrow();
    expect(() => normalizarConversas({ error: "sem escopo" }, "locA")).toThrow();
    expect(() =>
      normalizarWorkflows(
        { workflows: [{ id: "wf", name: "Teste", status: "published", locationId: "outra" }] },
        "locA",
      ),
    ).toThrow();
  });
  it.each(["contactId", "locationId", "conversationId"])(
    "recusa mensagem com %s incompatível",
    (chave) => {
      expect(() =>
        normalizarMensagens(
          { messages: { messages: [{ ...msg, [chave]: "outra" }], nextPage: false } },
          scope,
        ),
      ).toThrow();
    },
  );
  it("deduplica e ordena mensagens, preservando estado e canal", () => {
    const raw = {
      messages: {
        messages: [{ ...msg, id: "maisNova", dateAdded: "2026-09-14T13:00:00Z" }, msg, msg],
        nextPage: true,
        lastMessageId: "msgA",
      },
    };
    const r = normalizarMensagens(raw, scope);
    expect(r.mensagens.map((m) => m.id)).toEqual(["msgA", "maisNova"]);
    expect(r.mensagens[0]).toMatchObject({ tipo: "SMS", estado: "delivered", direcao: "inbound" });
    expect(r.proximoCursor).toBe("msgA");
    expect(normalizarMensagens(raw, scope, "msgA").limitePaginacao).toBe(true);
  });
  it("paginação de conversas informa cursor ausente ou repetido", () => {
    const conversations = Array.from({ length: 25 }, (_, i) => ({ ...conv, id: `conv${i}` }));
    expect(normalizarConversas({ conversations }, "locA").proximoCursor).toBe("1789387200000");
    expect(normalizarConversas({ conversations }, "locA", "1789387200000").limitePaginacao).toBe(
      true,
    );
    expect(
      normalizarConversas(
        { conversations: conversations.map((c) => ({ ...c, lastMessageDate: null })) },
        "locA",
      ).limitePaginacao,
    ).toBe(true);
  });
  it("marca apenas SIM/NÃO literal recebido, sem inferir confirmação", () => {
    expect(respostaLiteral({ direcao: "inbound", texto: " SIM! " })).toBe("SIM");
    expect(respostaLiteral({ direcao: "inbound", texto: "Não." })).toBe("NÃO");
    expect(respostaLiteral({ direcao: "outbound", texto: "sim" })).toBeNull();
    expect(respostaLiteral({ direcao: "inbound", texto: "sim, mas não posso ir" })).toBeNull();
  });
  it("workflows mantêm o estado publicado sem fabricar execuções", () => {
    const r = normalizarWorkflows(
      {
        workflows: [
          { id: "wfA", name: "Teste", locationId: "locA", status: "published", version: 2 },
        ],
      },
      "locA",
    );
    expect(r[0]).toMatchObject({ estado: "published", versao: 2 });
    expect(r[0]!.url).toBe(
      "https://app.gohighlevel.com/v2/location/locA/automation/workflow/wfA/logs",
    );
    expect(r[0]).not.toHaveProperty("runs");
  });
  it("valida a estrutura da IA antes de usar sugestões", () => {
    expect(analiseSchema.safeParse({ resumo: "ok", sugestoes: "texto" }).success).toBe(false);
    const a = {
      resumo: "ok",
      intencao: "agendamento",
      sentimento: "neutro",
      prioridade: "media",
      revisao_humana: false,
      sugestoes: ["objetiva", "acolhedora", "premium"].map((tom) => ({ tom, texto: "Resposta" })),
    };
    expect(analiseSchema.safeParse(a).success).toBe(true);
    expect(analiseSchema.safeParse({ ...a, revisao_humana: "false" }).success).toBe(false);
  });
});
