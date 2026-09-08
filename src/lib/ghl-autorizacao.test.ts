/**
 * Testa as funções reais de autorização e de validação do proxy GoHighLevel.
 * Toda a rede é simulada: nenhuma chamada real é feita ao GoHighLevel.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GHL_ORIGIN,
  OPERACOES,
  filtrarBody,
  filtrarQuery,
  ghlFetch,
  isOperacaoValida,
  urlOficial,
} from "./ghl.server";
import { chaveEscopo } from "./repo";

const cfgFalsa = {
  baseUrl: "https://atacante.example",
  version: "1999-01-01",
  token: "token-de-teste",
  locationId: "ok2UHC2QMZsd8UHsAgEa",
};

afterEach(() => vi.unstubAllGlobals());

describe("origem e destino fixos", () => {
  it("recusa caminhos absolutos ou fora da origem oficial", () => {
    expect(() => urlOficial("https://atacante.example/roubar")).toThrow();
    expect(() => urlOficial("//atacante.example/roubar")).toThrow();
    expect(() => urlOficial("../../etc")).toThrow();
    expect(urlOficial("contacts/").origin).toBe(GHL_ORIGIN);
  });

  it("ignora baseUrl e versão vindas de configuração editável", async () => {
    const chamadas: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
      chamadas.push({ url, init });
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    });
    const res = await ghlFetch(cfgFalsa, "contacts/", { query: { limit: "10" } });
    expect(res.ok).toBe(true);
    expect(chamadas[0]!.url.startsWith(`${GHL_ORIGIN}/contacts/`)).toBe(true);
    expect((chamadas[0]!.init.headers as Record<string, string>)["Version"]).toBe("2021-07-28");
    expect(chamadas[0]!.init.redirect).toBe("manual");
  });

  it("bloqueia redirects em vez de reenviar o token", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(new Response(null, { status: 302, headers: { location: "https://atacante.example" } })),
    );
    const res = await ghlFetch(cfgFalsa, "contacts/");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/redirecionamento/i);
  });
});

describe("allowlist do proxy", () => {
  it("aceita apenas operações conhecidas", () => {
    expect(isOperacaoValida("contacts.list")).toBe(true);
    expect(isOperacaoValida("contacts.delete")).toBe(false);
  });

  it("recusa tentativas de mudar a location ou parâmetros desconhecidos", () => {
    const op = OPERACOES["contacts.list"]!;
    expect(filtrarQuery(op, { locationId: "outra" }).ok).toBe(false);
    expect(filtrarQuery(op, { location_id: "outra" }).ok).toBe(false);
    expect(filtrarQuery(op, { hackzor: "1" }).ok).toBe(false);
    const bom = filtrarQuery(op, { limit: "10" });
    expect(bom.ok && bom.valor).toEqual({ limit: "10" });
  });

  it("recusa contactId e campos arbitrários no body", () => {
    const op = OPERACOES["conversations.sendMessage"]!;
    expect(filtrarBody(op, { contactId: "abc", message: "olá" }).ok).toBe(false);
    expect(filtrarBody(op, { message: "olá", extra: "x" }).ok).toBe(false);
    const bom = filtrarBody(op, { type: "WhatsApp", message: "olá" });
    expect(bom.ok && bom.valor).toEqual({ type: "WhatsApp", message: "olá" });
  });

  it("todas as operações de escrita exigem contacto verificado", () => {
    for (const op of Object.values(OPERACOES)) {
      if (op.escrita) expect(op.exigeContacto).toBe(true);
    }
  });
});

describe("papéis", () => {
  it("visualizador lê mas não escreve; comercial escreve com escrita ativa", async () => {
    const { autorizarOperacao } = await import("./ghl.functions");
    const envio = OPERACOES["conversations.sendMessage"]!;
    const lista = OPERACOES["contacts.list"]!;
    expect(autorizarOperacao({ papeis: ["visualizador"], op: lista, writeEnabled: true }).ok).toBe(true);
    expect(autorizarOperacao({ papeis: ["visualizador"], op: envio, writeEnabled: true }).ok).toBe(false);
    expect(autorizarOperacao({ papeis: ["comercial"], op: envio, writeEnabled: false }).ok).toBe(false);
    expect(autorizarOperacao({ papeis: ["comercial"], op: envio, writeEnabled: true }).ok).toBe(true);
    expect(autorizarOperacao({ papeis: [], op: lista, writeEnabled: true }).ok).toBe(false);
  });
});

describe("cache por identidade", () => {
  it("nunca reaproveita dados entre contas nem entre demo e conta", () => {
    const a = chaveEscopo("11111111-1111-4111-8111-111111111111", false);
    const b = chaveEscopo("22222222-2222-4222-8222-222222222222", false);
    expect(a).not.toBe(b);
    expect(chaveEscopo(null, true)).toBe("demo");
    expect(chaveEscopo(null, false)).toBe("anonimo");
    expect(chaveEscopo(null, true)).not.toBe(a);
  });
});
