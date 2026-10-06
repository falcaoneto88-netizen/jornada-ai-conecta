/** Regressão na fronteira do adaptador real: só 4xx explícito é definitivo. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { criarDepsBridge, type ClienteBridge } from "./n8n-bridge.server";
import { dndPermite, parseContacto } from "./n8n-bridge.core";

const db = {} as ClienteBridge;
const corpo = { type: "SMS", contactId: "contact01", message: "x" };

beforeEach(() => {
  vi.stubEnv("GHL_PRIVATE_TOKEN", "token-sintetico-de-teste");
  vi.stubEnv("GHL_LOCATION_ID", "ok2UHC2QMZsd8UHsAgEa");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function comFetch(impl: () => Promise<Response>) {
  const f = vi.fn(impl);
  vi.stubGlobal("fetch", f);
  return f;
}

describe("enviar (adaptador GHL)", () => {
  it("timeout -> não definitivo, uma tentativa", async () => {
    const f = comFetch(async () => {
      throw Object.assign(new Error("t"), { name: "TimeoutError" });
    });
    const r = await criarDepsBridge(db).enviar(corpo);
    expect(r).toMatchObject({ ok: false, definitivo: false });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("erro de rede -> não definitivo", async () => {
    comFetch(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await criarDepsBridge(db).enviar(corpo)).toMatchObject({ ok: false, definitivo: false });
  });
  it("5xx -> não definitivo, sem retry", async () => {
    const f = comFetch(async () => new Response("x", { status: 503 }));
    expect(await criarDepsBridge(db).enviar(corpo)).toMatchObject({ ok: false, definitivo: false });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("3xx -> não definitivo", async () => {
    comFetch(async () => new Response(null, { status: 302, headers: { location: "https://x" } }));
    expect(await criarDepsBridge(db).enviar(corpo)).toMatchObject({ ok: false, definitivo: false });
  });
  it("2xx JSON inválido -> não definitivo", async () => {
    comFetch(async () => new Response("{", { status: 200 }));
    expect(await criarDepsBridge(db).enviar(corpo)).toMatchObject({ ok: false, definitivo: false });
  });
  it("400/422 explícito -> definitivo", async () => {
    comFetch(async () => new Response("{}", { status: 422 }));
    expect(await criarDepsBridge(db).enviar(corpo)).toMatchObject({ ok: false, definitivo: true });
  });
  it("2xx com messageId", async () => {
    comFetch(async () => Response.json({ messageId: "m1" }));
    expect(await criarDepsBridge(db).enviar(corpo)).toEqual({ ok: true, messageId: "m1" });
  });
});

describe("contacto (leitura individual GHL)", () => {
  const locationId = "ok2UHC2QMZsd8UHsAgEa";
  const contact = {
    id: "contact01",
    locationId,
    phone: "+5511999990000",
    dnd: false,
    dndSettings: { SMS: { status: "inactive" }, Email: { status: "inactive" } },
  };

  it("usa GET por ID e preserva DND completo sem fallback para search", async () => {
    const fetch = comFetch(async () => Response.json({ contact }));
    const result = await criarDepsBridge(db).contacto(locationId, "contact01");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "https://services.leadconnectorhq.com/contacts/contact01",
      expect.objectContaining({ method: "GET", redirect: "manual" }),
    );
    expect(result).toEqual({ ok: true, data: { total: 1, contacts: [contact] } });
    expect(result.ok && parseContacto(result.data, "contact01", locationId)).toMatchObject({
      dnd: false,
      dndSettings: contact.dndSettings,
    });
  });

  it.each(["active", "permanent"])("DND SMS %s do GET impede a rota Zaptos", async (status) => {
    comFetch(async () =>
      Response.json({ contact: { ...contact, dndSettings: { SMS: { status } } } }),
    );
    const result = await criarDepsBridge(db).contacto(locationId, "contact01");
    const parsed = result.ok && parseContacto(result.data, "contact01", locationId);
    expect(parsed).toBeTruthy();
    expect(parsed && dndPermite(parsed, "whatsapp_zaptos")).toBe(false);
  });

  it("canal WhatsApp ausente não fabrica opt-in nem bloqueio no GET válido", async () => {
    comFetch(async () => Response.json({ contact }));
    const result = await criarDepsBridge(db).contacto(locationId, "contact01");
    const parsed = result.ok && parseContacto(result.data, "contact01", locationId);
    expect(parsed && dndPermite(parsed, "whatsapp_zaptos")).toBe(true);
    expect(parsed).not.toHaveProperty("smsConsent");
    expect(parsed).not.toHaveProperty("dndSettings.WhatsApp");
  });

  it.each([
    null,
    [],
    {},
    { contact: null },
    { contact: [] },
    { contacts: [contact], total: 1 },
    { contact: { ...contact, id: "other" } },
    { contact: { ...contact, locationId: "another-location" } },
    { contact: { ...contact, dndSettings: undefined } },
    { contact: { ...contact, dndSettings: { SMS: { status: "unknown" } } } },
  ])("resposta inválida/identidade divergente continua recusada %#", async (raw) => {
    comFetch(async () => Response.json(raw));
    const result = await criarDepsBridge(db).contacto(locationId, "contact01");
    expect(result.ok).toBe(true);
    expect(result.ok && parseContacto(result.data, "contact01", locationId)).toBeNull();
  });

  it("erro autenticado não consulta search para contornar a recusa", async () => {
    const fetch = comFetch(async () => Response.json({}, { status: 401 }));
    expect(await criarDepsBridge(db).contacto(locationId, "contact01")).toMatchObject({
      ok: false,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
