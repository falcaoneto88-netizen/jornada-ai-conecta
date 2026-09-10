import { afterEach, describe, expect, it, vi } from "vitest";
import { caminhoSeguro } from "./auth-redirect";
import { ghlFetch, type GhlConfig } from "./ghl.server";
import { sincronizarContactos, ErroContacto, type DepsSyncContactos } from "./ghl-contacts.core";
import { executarEscritaAuditada } from "./ghl-write.core";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("destino após autenticação", () => {
  it.each([
    "//evil.test",
    "/\\evil.test",
    "/\n/evil.test",
    "/\t/evil.test",
    "https://evil.test",
    "/a/..//evil.test",
    null,
    123,
  ])("recusa destino externo ou ambíguo %s", (valor) => expect(caminhoSeguro(valor)).toBe(""));
  it.each([
    "/",
    "/clientes?nome=Jo%C3%A3o#detalhes",
    "/mcp/authorize?redirect_uri=https%3A%2F%2Fclient.test%2Fcallback",
  ])("preserva caminho interno %s", (valor) => expect(caminhoSeguro(valor)).toBe(valor));
});

const cfg: GhlConfig = {
  baseUrl: "",
  version: "",
  token: "token-ficticio",
  locationId: "loc-teste",
};
describe("auditoria de escrita remota", () => {
  it("não envia se não conseguir gravar a intenção", async () => {
    const executar = vi.fn();
    expect(
      await executarEscritaAuditada({ executar, registar: vi.fn().mockResolvedValue(false) }),
    ).toMatchObject({ ok: false });
    expect(executar).not.toHaveBeenCalled();
  });
  it("preserva sucesso confirmado se o log final falhar", async () => {
    const executar = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, data: { id: "msg-teste" } });
    const result = await executarEscritaAuditada({
      executar,
      registar: vi.fn().mockResolvedValueOnce(true).mockRejectedValueOnce(new Error("db")),
    });
    expect(result).toMatchObject({ ok: true, warning: expect.any(String) });
    expect(executar).toHaveBeenCalledTimes(1);
  });
  it("regista resultado incerto sem repetir execução", async () => {
    const executar = vi.fn().mockRejectedValue(new Error("network"));
    const registar = vi.fn().mockResolvedValue(true);
    expect(await executarEscritaAuditada({ executar, registar })).toMatchObject({
      ok: false,
      code: "outcome_unknown",
    });
    expect(registar).toHaveBeenNthCalledWith(1, "tentativa", undefined);
    expect(registar).toHaveBeenNthCalledWith(
      2,
      "resultado",
      expect.objectContaining({ code: "outcome_unknown" }),
    );
    expect(executar).toHaveBeenCalledTimes(1);
  });
});
describe("escritas GHL sem repetição automática", () => {
  it.each(["POST", "PATCH", "PUT", "DELETE"])(
    "não repete %s após falha de rede",
    async (method) => {
      const fetch = vi.fn().mockRejectedValue(new Error("connection reset"));
      vi.stubGlobal("fetch", fetch);
      expect(await ghlFetch(cfg, "conversations/messages", { method })).toMatchObject({
        ok: false,
        code: "outcome_unknown",
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
  it.each([429, 500, 503])("não repete POST após HTTP %s", async (status) => {
    const fetch = vi.fn().mockResolvedValue(new Response("", { status }));
    vi.stubGlobal("fetch", fetch);
    const result = await ghlFetch(cfg, "conversations/messages", { method: "POST" });
    expect(result).toMatchObject({
      ok: false,
      code: status === 429 ? "rate_limited" : "outcome_unknown",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("não reenvia quando a resposta de sucesso é ilegível", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("not-json", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    expect(await ghlFetch(cfg, "conversations/messages", { method: "POST" })).toMatchObject({
      code: "outcome_unknown",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("ainda repete GET transitório, com backoff", async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockResolvedValueOnce(new Response('{"contacts":[]}'));
    vi.stubGlobal("fetch", fetch);
    const result = ghlFetch(cfg, "contacts/");
    await vi.runAllTimersAsync();
    expect(await result).toMatchObject({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});

function deps(): DepsSyncContactos {
  return {
    locationId: "loc-teste",
    pagina: vi.fn().mockResolvedValue({ contacts: [{ id: "c1" }], meta: { total: 1 } }),
    detalhe: vi.fn(async (id) => ({
      id,
      locationId: "loc-teste",
      dateUpdated: "2026-09-10T00:00:00Z",
    })),
    aplicar: vi.fn().mockResolvedValue("aplicado"),
  };
}
describe("sincronização completa de contactos", () => {
  it("importa mais de 100, usando cursor validado e detalhe por contacto", async () => {
    const d = deps();
    d.pagina = vi
      .fn()
      .mockResolvedValueOnce({
        contacts: Array.from({ length: 100 }, (_, i) => ({ id: `c${i}` })),
        meta: {
          total: 101,
          startAfterId: "c99",
          startAfter: 123,
          nextPageUrl: "https://evil.test",
        },
      })
      .mockResolvedValueOnce({ contacts: [{ id: "c100" }], meta: { total: 101 } });
    expect(await sincronizarContactos(d)).toMatchObject({ ok: true, importados: 101 });
    expect(d.pagina).toHaveBeenNthCalledWith(2, { startAfterId: "c99", startAfter: "123" });
    expect(d.detalhe).toHaveBeenCalledTimes(101);
  });
  it("falha de página não grava lista truncada", async () => {
    const d = deps();
    d.pagina = vi
      .fn()
      .mockResolvedValueOnce({ contacts: [{ id: "c1" }], meta: { total: 2, startAfterId: "c1" } })
      .mockRejectedValueOnce(new Error("HTTP 503"));
    expect(await sincronizarContactos(d)).toMatchObject({ ok: false, importados: 0 });
    expect(d.aplicar).not.toHaveBeenCalled();
  });
  it("recusa cursor ausente com total maior", async () => {
    const d = deps();
    d.pagina = vi.fn().mockResolvedValue({ contacts: [{ id: "c1" }], meta: { total: 2 } });
    expect(await sincronizarContactos(d)).toMatchObject({ ok: false, importados: 0 });
  });
  it("recusa página cheia sem total nem cursor", async () => {
    const d = deps();
    d.pagina = vi
      .fn()
      .mockResolvedValue({ contacts: Array.from({ length: 100 }, (_, i) => ({ id: `c${i}` })) });
    expect(await sincronizarContactos(d)).toMatchObject({ ok: false });
  });
  it("detecta repetição de contactos", async () => {
    const d = deps();
    d.pagina = vi
      .fn()
      .mockResolvedValue({ contacts: [{ id: "c1" }], meta: { startAfterId: "c1" } });
    expect(await sincronizarContactos(d)).toMatchObject({ ok: false, importados: 0 });
  });
  it.each([
    { id: "outro", locationId: "loc-teste" },
    { id: "c1", locationId: "outra" },
    { id: "c1" },
  ])("não grava detalhe de identidade/location divergente", async (c) => {
    const d = deps();
    d.detalhe = vi.fn().mockResolvedValue({ ...c, dateUpdated: "2026-09-10" });
    expect(await sincronizarContactos(d)).toMatchObject({ ok: false });
    expect(d.aplicar).not.toHaveBeenCalled();
  });
  it("não grava versão sem data", async () => {
    const d = deps();
    d.detalhe = vi.fn().mockResolvedValue({ id: "c1", locationId: "loc-teste" });
    expect(await sincronizarContactos(d)).toMatchObject({ ok: false });
    expect(d.aplicar).not.toHaveBeenCalled();
  });
  it("informa progresso parcial sem devolver sucesso", async () => {
    const d = deps();
    d.pagina = vi
      .fn()
      .mockResolvedValue({ contacts: [{ id: "c1" }, { id: "c2" }], meta: { total: 2 } });
    d.aplicar = vi
      .fn()
      .mockResolvedValueOnce("aplicado")
      .mockRejectedValueOnce(new Error("conflito"));
    expect(await sincronizarContactos(d)).toMatchObject({
      ok: false,
      importados: 1,
      encontrados: 2,
      code: "partial_sync",
    });
  });
  it("contabiliza versão já atualizada separadamente", async () => {
    const d = deps();
    d.aplicar = vi.fn().mockResolvedValue("ignorado");
    expect(await sincronizarContactos(d)).toMatchObject({ ok: true, importados: 0, ignorados: 1 });
  });
});

describe("aceitação R1/R2", () => {
  it("preserva contato sem data e processa os seguros depois dele", async () => {
    const d = deps();
    d.pagina = vi
      .fn()
      .mockResolvedValue({ contacts: [{ id: "sem-data" }, { id: "seguro" }], meta: { total: 2 } });
    d.detalhe = vi.fn(async (id) => ({
      id,
      locationId: "loc-teste",
      ...(id === "seguro" ? { dateUpdated: "2026-09-10T12:00:00Z" } : {}),
    }));
    const r = await sincronizarContactos(d);
    expect(r).toMatchObject({
      ok: false,
      importados: 1,
      pendencias: [{ contactId: "sem-data", code: "sem_versao" }],
    });
    expect(d.aplicar).toHaveBeenCalledTimes(1);
    expect(d.aplicar).toHaveBeenCalledWith(expect.objectContaining({ id: "seguro" }));
  });
  it("mantém IDs e categorias de dois conflitos distintos", async () => {
    const d = deps();
    d.pagina = vi
      .fn()
      .mockResolvedValue({
        contacts: [{ id: "fone" }, { id: "corrida" }, { id: "seguro" }],
        meta: { total: 3 },
      });
    d.aplicar = vi.fn(async (c) => {
      if (c.id === "fone") throw new ErroContacto("conflito_telefone", "Telefone em conflito.");
      if (c.id === "corrida")
        throw new ErroContacto("conflito_concorrente", "Escrita concorrente.");
      return "aplicado" as const;
    });
    expect(await sincronizarContactos(d)).toMatchObject({
      ok: false,
      importados: 1,
      pendencias: [
        { contactId: "fone", code: "conflito_telefone" },
        { contactId: "corrida", code: "conflito_concorrente" },
      ],
    });
  });
  it("oculta dados de outra location e mensagens internas", async () => {
    const d = deps();
    d.pagina = vi
      .fn()
      .mockResolvedValue({ contacts: [{ id: "divergente" }, { id: "rede" }], meta: { total: 2 } });
    d.detalhe = vi.fn(async (id) => {
      if (id === "rede") throw Error("token-secreto telefone-privado");
      return { id: "id-de-outra-conta", locationId: "outra", phone: "telefone-privado" };
    });
    const r = await sincronizarContactos(d);
    expect(r).toMatchObject({
      ok: false,
      pendencias: [
        { contactId: null, code: "identidade_divergente" },
        { contactId: null, code: "leitura_falhou" },
      ],
    });
    expect(JSON.stringify(r)).not.toMatch(/token-secreto|telefone-privado|id-de-outra-conta/);
    expect(d.aplicar).not.toHaveBeenCalled();
  });
});
