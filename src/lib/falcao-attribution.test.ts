import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  attributionSchema,
  conteudoCanonico,
  hashConteudo,
  leadSchema,
  processarLeadFalcao,
} from "./falcao-lead.core";
import { criarLeadStore, hmacHex } from "./falcao-lead.server";

const attribution = () => ({
  version: "2026-11-09.attribution.v1",
  source: "ig",
  medium: "paid_social",
  campaign: "pt-s01-001",
  campaignId: "12345678901",
  adsetId: "12345678902",
  adId: "12345678903",
  capturedAt: "2026-11-09T12:00:00.000Z",
  consent: { analytics: true, version: "2026-11-09.analytics.v1" },
});
const lead = () => ({
  source: "experiencia-falcao",
  requestId: "11111111-2222-4333-8444-555555555555",
  timestamp: "2026-11-09T12:01:00.000Z",
  adult: true,
  name: "Pessoa Sintética",
  phone: "+447700900123",
  consent: { contact: true, version: "2026-09-17.contact.v1" },
});
const receipt = {
  receipt_id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
  request_id: "11111111-2222-4333-8444-555555555555",
  status: "registado",
  local_state: "contacto_criado",
  remote_state: "pendente",
  welcome_state: "pendente",
  duplicate: false,
};

describe("atribuição interna consentida", () => {
  it("preserva exatamente o conteúdo e hash legado sem atribuição", async () => {
    const old =
      '["experiencia-falcao","11111111-2222-4333-8444-555555555555",true,"Pessoa Sintética","+447700900123",null,"2026-09-17.contact.v1"]';
    const parsed = leadSchema.parse(lead());
    expect(conteudoCanonico(parsed)).toBe(old);
    expect(await hashConteudo(conteudoCanonico(parsed))).toBe(await hashConteudo(old));
    expect(leadSchema.safeParse({ ...lead(), attribution: null }).success).toBe(false);
  });

  it.each(["fb", "ig", "an", "msg", "meta"])(
    "aceita fonte enumerada %s sem afirmar validação Meta",
    (source) => {
      expect(attributionSchema.safeParse({ ...attribution(), source }).success).toBe(true);
      expect(
        attributionSchema.safeParse({ ...attribution(), campaign: "be-s02-002" }).success,
      ).toBe(true);
    },
  );

  it.each([
    { source: "instagram" },
    { source: "ig&email=x" },
    { medium: "cpc" },
    { campaign: "procedimento" },
    { campaign: "pt-s01-001?phone=1" },
    { campaignId: "{{campaign.id}}" },
    { campaignId: "1234" },
    { adsetId: "1".repeat(31) },
    { adId: 123456 },
    { capturedAt: "2026-02-31T12:00:00Z" },
    { capturedAt: "2026-11-09T12:00:00" },
    { version: "v2" },
    { consent: { analytics: false, version: "2026-11-09.analytics.v1" } },
    { consent: { analytics: true, version: "2026-09-17.contact.v1" } },
    { consent: { analytics: true, version: "2026-11-09.analytics.v1", contact: true } },
    { url: "https://example.invalid" },
    { fbclid: "opaque-click" },
    { fbp: "cookie" },
    { name: "Pessoa" },
    { phone: "+447700900123" },
    { verifiedMeta: true },
    { organizationId: "x" },
  ])("recusa campos fora do contrato: %j", (over) => {
    expect(attributionSchema.safeParse({ ...attribution(), ...over }).success).toBe(false);
  });

  it("hash inclui atribuição e consentimento, com ordem de propriedades estável", async () => {
    const a = leadSchema.parse({ ...lead(), attribution: attribution() });
    const b = leadSchema.parse({
      ...lead(),
      attribution: Object.fromEntries(Object.entries(attribution()).reverse()),
    });
    expect(conteudoCanonico(a)).toBe(conteudoCanonico(b));
    for (const changed of [
      { adId: "999999" },
      { campaign: "be-s01-001" },
      { capturedAt: "2026-11-09T11:59:00Z" },
    ]) {
      const other = leadSchema.parse({ ...lead(), attribution: { ...attribution(), ...changed } });
      expect(await hashConteudo(conteudoCanonico(a))).not.toBe(
        await hashConteudo(conteudoCanonico(other)),
      );
    }
  });

  it("assinatura válida encaminha apenas ao RPC v3 e não devolve atribuição ao público", async () => {
    const rpc = vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({
      data: receipt,
      error: null,
    }));
    const segredo = "a".repeat(64);
    const body = new TextEncoder().encode(
      JSON.stringify({ ...lead(), attribution: attribution() }),
    );
    const signature = createHmac("sha256", segredo).update(body).digest("hex");
    const response = await processarLeadFalcao(
      { corpo: body, assinatura: signature },
      {
        segredo,
        store: criarLeadStore({ rpc }, segredo),
        hmac: hmacHex,
        agoraMs: Date.parse(lead().timestamp),
      },
    );
    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "ingest_site_lead_v3",
      expect.objectContaining({ _attribution: attribution() }),
    );
    expect(response.body).not.toHaveProperty("attribution");
    expect(response.body).toMatchObject({ ghlState: "pendente", welcomeState: "pendente" });
  });

  it("pedido legado continua no RPC v2 sem depender da migração nova", async () => {
    const rpc = vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({
      data: receipt,
      error: null,
    }));
    const segredo = "a".repeat(64);
    const body = new TextEncoder().encode(JSON.stringify(lead()));
    const response = await processarLeadFalcao(
      { corpo: body, assinatura: createHmac("sha256", segredo).update(body).digest("hex") },
      {
        segredo,
        store: criarLeadStore({ rpc }, segredo),
        hmac: hmacHex,
        agoraMs: Date.parse(lead().timestamp),
      },
    );
    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]?.[0]).toBe("ingest_site_lead_v2");
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty("_attribution");
  });

  it("migração ausente não provoca fallback v2 de pedido com atribuição", async () => {
    const rpc = vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({
      data: null,
      error: { code: "PGRST202" },
    }));
    const segredo = "a".repeat(64);
    const body = new TextEncoder().encode(
      JSON.stringify({ ...lead(), attribution: attribution() }),
    );
    const response = await processarLeadFalcao(
      { corpo: body, assinatura: createHmac("sha256", segredo).update(body).digest("hex") },
      {
        segredo,
        store: criarLeadStore({ rpc }, segredo),
        hmac: hmacHex,
        agoraMs: Date.parse(lead().timestamp),
      },
    );
    expect(response.status).toBe(503);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]?.[0]).toBe("ingest_site_lead_v3");
  });

  it.each(["2026-11-08T12:00:00Z", "2026-11-09T12:07:00Z"])(
    "delega janela de atribuição ao RPC para preservar reenvios: %s",
    async (capturedAt) => {
      const rpc = vi.fn(async () => ({ data: { ...receipt, duplicate: true }, error: null }));
      const segredo = "a".repeat(64);
      const body = new TextEncoder().encode(
        JSON.stringify({ ...lead(), attribution: { ...attribution(), capturedAt } }),
      );
      const signature = createHmac("sha256", segredo).update(body).digest("hex");
      const response = await processarLeadFalcao(
        { corpo: body, assinatura: signature },
        {
          segredo,
          store: criarLeadStore({ rpc }, segredo),
          hmac: hmacHex,
          agoraMs: Date.parse(lead().timestamp),
        },
      );
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ duplicate: true });
      expect(rpc).toHaveBeenCalledTimes(1);
    },
  );
});
