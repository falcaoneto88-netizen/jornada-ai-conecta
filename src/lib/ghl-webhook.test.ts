import { describe, expect, it } from "vitest";

import {
  comparacaoConstante,
  nomeDoContacto,
  normalizarTelefone,
  versaoDoContacto,
} from "./ghl-webhook.core";

describe("utilitários do recetor", () => {
  it("limpa nomes inválidos", () => {
    expect(nomeDoContacto({ id: "1", firstName: "undefined", lastName: null, email: "a@b.pt" })).toBe(
      "a@b.pt",
    );
    expect(nomeDoContacto({ id: "1" })).toBe("Sem nome");
    expect(nomeDoContacto({ id: "1", firstName: "Ana", lastName: "Silva" })).toBe("Ana Silva");
  });

  it("normaliza telefones", () => {
    expect(normalizarTelefone("+351 912 345 678")).toBe("351912345678");
    expect(normalizarTelefone("  ")).toBeNull();
  });

  it("compara segredos em tempo constante", () => {
    expect(comparacaoConstante("abc", "abc")).toBe(true);
    expect(comparacaoConstante("abc", "abd")).toBe(false);
    expect(comparacaoConstante("abc", "abcd")).toBe(false);
  });

  it("prefere dateUpdated como versão verificada", async () => {
    const v = await versaoDoContacto({ id: "1", dateUpdated: "2026-09-08T10:00:00Z" });
    expect(v).toEqual({ version: "v:2026-09-08T10:00:00Z", contentFallback: false });
  });

  it("usa impressão digital SHA-256 quando não há dateUpdated", async () => {
    const a = await versaoDoContacto({ id: "1", firstName: "Ana", phone: "911" });
    const b = await versaoDoContacto({ id: "1", firstName: "Bruno", phone: "911" });
    const a2 = await versaoDoContacto({ id: "1", firstName: "Ana", phone: "911" });
    expect(a.contentFallback).toBe(true);
    expect(a.version).toHaveLength(66);
    expect(a.version).not.toBe(b.version);
    expect(a.version).toBe(a2.version);
  });
});
