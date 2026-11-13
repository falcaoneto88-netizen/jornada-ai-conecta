import { describe, expect, it, vi } from "vitest";
import {
  MAX_TRANSLATION_RESULT,
  translateText,
  translationInput,
  translationViolations,
  type TranslationInput,
} from "./translation.core";
import { translationHandler } from "./translation.functions";

const input: TranslationInput = {
  texto:
    "Olá, Ana Maria! Consulta às 14h por 50€. Link: https://example.com/consulta para {{nome}}.",
  sourceLanguage: "pt",
  targetLanguage: "fr",
};
const translated =
  "Bonjour, Ana Maria! Consultation à 14h pour 50€. Link: https://example.com/consulta pour {{nome}}.";
const respond = (content: unknown, status = 200) =>
  vi.fn(
    async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status }),
  );

describe("translation gateway (mock only)", () => {
  it("uses the existing gateway with explicit languages and untrusted text separated from system instructions", async () => {
    const gateway = respond(translated);
    expect(await translateText(input, { apiKey: "synthetic-key", fetch: gateway })).toEqual({
      ok: true,
      texto: translated,
    });
    expect(gateway).toHaveBeenCalledTimes(1);
    const [url, request] = vi.mocked(gateway).mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://ai.gateway.lovable.dev/v1/chat/completions");
    expect(request.redirect).toBe("error");
    const body = JSON.parse(request.body as string);
    expect(body.store).toBe(false);
    expect(body.messages[0].content).toMatch(/conteúdo não confiável/);
    expect(JSON.parse(body.messages[1].content)).toEqual({
      idiomaOrigem: "Português",
      idiomaDestino: "Français",
      textoOriginal: input.texto,
    });
  });

  it.each([
    ["14h", "15h"],
    ["50€", "80€"],
    ["Ana", "Anne"],
    ["Maria", "Marie"],
    ["https://example.com/consulta", "https://evil.invalid"],
    ["{{nome}}", "pessoa"],
  ])("rejects modified protected data %s", async (before, after) => {
    expect(
      await translateText(input, {
        apiKey: "synthetic-key",
        fetch: respond(translated.replace(before, after)),
      }),
    ).toMatchObject({ ok: false, code: "invariante" });
  });
  it("rejects number order, units, duplicated names and outsize output", () => {
    expect(translationViolations("Ana toma 5 mg e 10 mcg.", "Ana prend 10 mg et 5 mcg.")).toContain(
      "protegidos",
    );
    expect(translationViolations("Ana toma 5 mg/mL.", "Ana prend 5 mg/L.")).toContain("protegidos");
    expect(translationViolations("Ana, tudo bem?", "Ana Ana, ça va ?")).toContain("nomes");
    expect(translationViolations("Olá Érica", "Bonjour Erica")).toContain("nomes");
    expect(translationViolations("Olá", "a".repeat(MAX_TRANSLATION_RESULT + 1))).toContain(
      "comprimento",
    );
    expect(translationViolations(input.texto, "Bonjour.")).toContain("comprimento");
  });
  it.each([402, 429, 500])(
    "handles gateway status %d without exposing backend details",
    async (status) => {
      const expected =
        status === 402 ? "sem_creditos" : status === 429 ? "rate_limited" : "erro_ia";
      expect(
        await translateText(input, { apiKey: "synthetic-key", fetch: respond("", status) }),
      ).toMatchObject({ ok: false, code: expected });
    },
  );
  it("handles unavailable, timeout, malformed and empty responses", async () => {
    const never = vi.fn();
    expect(await translateText(input, { apiKey: undefined, fetch: never })).toMatchObject({
      code: "ia_nao_configurada",
    });
    expect(never).not.toHaveBeenCalled();
    const timeout = vi.fn(async () => {
      throw Object.assign(new Error("mock"), { name: "TimeoutError" });
    });
    expect(await translateText(input, { apiKey: "synthetic-key", fetch: timeout })).toMatchObject({
      code: "timeout",
    });
    for (const body of [null, [], { text: "test" }])
      expect(
        await translateText(input, { apiKey: "synthetic-key", fetch: respond(body) }),
      ).toMatchObject({ code: "erro_ia" });
    expect(
      await translateText(input, { apiKey: "synthetic-key", fetch: respond("") }),
    ).toMatchObject({ code: "resposta_vazia" });
    expect(
      await translateText(input, {
        apiKey: "synthetic-key",
        fetch: vi.fn(async () => new Response("broken-json")),
      }),
    ).toMatchObject({ code: "erro_ia" });
  });
  it("bounds inputs and accepts only PT, FR, EN and ES", async () => {
    for (const invalid of [
      { ...input, texto: "" },
      { ...input, texto: "a".repeat(1501) },
      { ...input, sourceLanguage: "auto" },
      { ...input, targetLanguage: "de" },
      { ...input, targetLanguage: "pt" },
      { ...input, sourceLanguage: "constructor" },
    ])
      expect(() => translationInput(invalid)).toThrow();
    expect(() => translationInput({ ...input, texto: "a".repeat(1500) })).not.toThrow();
    const gateway = vi.fn();
    expect(
      await translateText(
        { ...input, texto: "a".repeat(1501) },
        { apiKey: "synthetic-key", fetch: gateway },
      ),
    ).toMatchObject({ code: "texto_invalido" });
    expect(gateway).not.toHaveBeenCalled();
  });
});

type Row = Record<string, unknown>;
function context(role: string, organization = "org-a") {
  const tables: Record<string, Row[]> = {
    profiles: [{ id: "operator", organization_id: organization, full_name: "Synthetic Operator" }],
    user_roles: [{ user_id: "operator", organization_id: organization, role }],
    ghl_connections: [],
  };
  const supabase = {
    from(table: string) {
      const filters: [string, unknown][] = [];
      const builder = {
        select: () => builder,
        eq: (key: string, value: unknown) => {
          filters.push([key, value]);
          return builder;
        },
        maybeSingle: async () => ({
          data:
            tables[table]?.find((row) => filters.every(([key, value]) => row[key] === value)) ??
            null,
          error: null,
        }),
        then: (resolve: (value: unknown) => void) =>
          resolve({
            data:
              tables[table]?.filter((row) => filters.every(([key, value]) => row[key] === value)) ??
              [],
            error: null,
          }),
      };
      return builder;
    },
  } as never;
  return { supabase, userId: "operator" };
}

describe("translation access (synthetic Supabase only)", () => {
  const access = {
    lerBinding: async (org: string) => (org === "org-a" ? "location-a" : null),
    locationDoToken: () => "location-a",
  };
  it.each(["administrador", "gestor", "comercial"])(
    "allows role %s in the bound tenant",
    async (role) => {
      const gateway = respond(translated);
      expect(
        await translationHandler(context(role), input, {
          acesso: access,
          lerChave: () => "synthetic-key",
          fetch: gateway,
        }),
      ).toEqual({ ok: true, texto: translated });
      expect(gateway).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    ["visualizador", "org-a"],
    ["comercial", "org-b"],
  ])("rejects %s in %s before credentials or gateway", async (role, org) => {
    const key = vi.fn(() => "synthetic-key");
    const gateway = vi.fn();
    expect(
      await translationHandler(context(role, org), input, {
        acesso: access,
        lerChave: key,
        fetch: gateway,
      }),
    ).toMatchObject({ code: "sem_permissao" });
    expect(key).not.toHaveBeenCalled();
    expect(gateway).not.toHaveBeenCalled();
  });
});
