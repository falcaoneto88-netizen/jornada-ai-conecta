import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  FALCAO_CONSENT_VERSION,
  conteudoCanonico,
  hashConteudo,
  leadSchema,
  lerCorpoLimitado,
  processarLeadFalcao,
  type LeadStore,
  type ResultadoIngresso,
} from "./falcao-lead.core";
import { compararHex, hmacHex } from "./falcao-lead.server";

const SEGREDO = "a".repeat(64);

const leadValido = (extra: Record<string, unknown> = {}) => ({
  source: "experiencia-falcao",
  requestId: "11111111-2222-4333-8444-555555555555",
  timestamp: new Date("2026-09-17T20:00:00.000Z").toISOString(),
  adult: true,
  name: "Maria Exemplo",
  phone: "+351912345678",
  consent: { contact: true, version: FALCAO_CONSENT_VERSION },
  ...extra,
});

const bytes = (corpo: unknown) => new TextEncoder().encode(JSON.stringify(corpo));
const assinar = (corpo: Uint8Array) =>
  createHmac("sha256", Buffer.from(SEGREDO, "utf8")).update(Buffer.from(corpo)).digest("hex");

const recibo = (over: Partial<ResultadoIngresso & Record<string, unknown>> = {}) => ({
  receipt_id: "r-1",
  request_id: "11111111-2222-4333-8444-555555555555",
  status: "registado",
  local_state: "contacto_criado",
  remote_state: "pendente",
  welcome_state: "pendente",
  duplicate: false,
  ...over,
});

function store(resultado: ResultadoIngresso): LeadStore & { ingest: ReturnType<typeof vi.fn> } {
  return { ingest: vi.fn(async () => resultado) } as never;
}

const deps = (s: LeadStore, over: Record<string, unknown> = {}) => ({
  segredo: SEGREDO,
  store: s,
  hmac: hmacHex,
  compararAssinatura: compararHex,
  agoraMs: Date.parse("2026-09-17T20:00:10.000Z"),
  ...over,
});

describe("ingresso Experiência Falcão", () => {
  it("recusa assinatura inválida sem tocar no banco", async () => {
    const s = store({ outcome: "ok", recibo: recibo() });
    const corpo = bytes(leadValido());
    const r = await processarLeadFalcao({ corpo, assinatura: "b".repeat(64) }, deps(s));
    expect(r.status).toBe(401);
    expect(s.ingest).not.toHaveBeenCalled();
  });

  it("falha fechada sem segredo configurado", async () => {
    const s = store({ outcome: "ok", recibo: recibo() });
    const corpo = bytes(leadValido());
    const r = await processarLeadFalcao(
      { corpo, assinatura: assinar(corpo) },
      deps(s, { segredo: null }),
    );
    expect(r.status).toBe(503);
    expect(s.ingest).not.toHaveBeenCalled();
  });

  it("aceita um lead consentido e nunca declara sucesso no GoHighLevel", async () => {
    const s = store({ outcome: "ok", recibo: recibo() });
    const corpo = bytes(leadValido());
    const r = await processarLeadFalcao({ corpo, assinatura: assinar(corpo) }, deps(s));
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      ok: true,
      status: "registado",
      localState: "contacto_criado",
      ghlState: "pendente",
      welcomeState: "pendente",
      duplicate: false,
    });
    expect(s.ingest).toHaveBeenCalledWith(
      expect.objectContaining({ source: "experiencia-falcao", phoneNormalized: "351912345678" }),
    );
  });

  it("devolve o recibo existente num reenvio idêntico", async () => {
    const s = store({ outcome: "ok", recibo: recibo({ duplicate: true }) });
    const corpo = bytes(leadValido());
    const r = await processarLeadFalcao({ corpo, assinatura: assinar(corpo) }, deps(s));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ duplicate: true });
  });

  it("devolve conflito quando o mesmo pedido traz outros dados", async () => {
    const s = store({ outcome: "conflito" });
    const corpo = bytes(leadValido({ name: "Outro Nome" }));
    const r = await processarLeadFalcao({ corpo, assinatura: assinar(corpo) }, deps(s));
    expect(r.status).toBe(409);
  });

  it("mantém a identidade do pedido quando só o instante muda", async () => {
    const a = leadSchema.parse(leadValido());
    const b = leadSchema.parse(
      leadValido({ timestamp: new Date("2026-09-17T20:01:00.000Z").toISOString() }),
    );
    expect(await hashConteudo(conteudoCanonico(a))).toBe(await hashConteudo(conteudoCanonico(b)));
  });

  it("recusa envios fora da janela de cinco minutos", async () => {
    const s = store({ outcome: "ok", recibo: recibo() });
    const corpo = bytes(leadValido());
    const r = await processarLeadFalcao(
      { corpo, assinatura: assinar(corpo) },
      deps(s, { agoraMs: Date.parse("2026-09-17T20:10:00.000Z") }),
    );
    expect(r.status).toBe(400);
    expect(s.ingest).not.toHaveBeenCalled();
  });

  it.each([
    ["foto", { photo: "data:image/png;base64,AAA" }],
    ["quiz", { quiz: { peso: 90 } }],
    ["saúde", { health: "diabetes" }],
    ["utm", { utm_source: "meta" }],
    ["destino", { locationId: "ok2UHC2QMZsd8UHsAgEa" }],
    ["organização", { organizationId: "f07ab3be-7419-4779-a901-ef71c5fc27f0" }],
  ])("recusa o campo extra %s", async (_nome, extra) => {
    const s = store({ outcome: "ok", recibo: recibo() });
    const corpo = bytes(leadValido(extra));
    const r = await processarLeadFalcao({ corpo, assinatura: assinar(corpo) }, deps(s));
    expect(r.status).toBe(400);
    expect(s.ingest).not.toHaveBeenCalled();
  });

  it.each([
    ["sem consentimento", { consent: { contact: false, version: FALCAO_CONSENT_VERSION } }],
    ["versão errada", { consent: { contact: true, version: "2020.v0" } }],
    ["menor de idade", { adult: false }],
    ["telefone inválido", { phone: "912345678" }],
    ["origem diferente", { source: "outro-site" }],
  ])("recusa payload %s", async (_nome, extra) => {
    const s = store({ outcome: "ok", recibo: recibo() });
    const corpo = bytes(leadValido(extra));
    const r = await processarLeadFalcao({ corpo, assinatura: assinar(corpo) }, deps(s));
    expect(r.status).toBe(400);
    expect(s.ingest).not.toHaveBeenCalled();
  });

  it("não devolve sucesso falso quando o banco falha", async () => {
    const s = { ingest: vi.fn(async () => Promise.reject(new Error("db"))) } as never as LeadStore;
    const corpo = bytes(leadValido());
    const r = await processarLeadFalcao({ corpo, assinatura: assinar(corpo) }, deps(s));
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ ok: false });
  });

  it("recusa erro do banco sem expor detalhes", async () => {
    const s = store({ outcome: "erro" });
    const corpo = bytes(leadValido());
    const r = await processarLeadFalcao({ corpo, assinatura: assinar(corpo) }, deps(s));
    expect(JSON.stringify(r.body)).not.toContain("db");
    expect(r.status).toBe(503);
  });

  it("corta o corpo acima de 4096 bytes durante a leitura", async () => {
    const grande = new Request("https://exemplo.invalid", {
      method: "POST",
      body: "x".repeat(5000),
    });
    const r = await lerCorpoLimitado(grande);
    expect(r).toEqual({ ok: false, status: 413 });
  });
});
