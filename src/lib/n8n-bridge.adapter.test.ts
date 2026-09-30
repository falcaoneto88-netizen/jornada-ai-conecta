/** Regressão na fronteira do adaptador real: só 4xx explícito é definitivo. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { criarDepsBridge, type ClienteBridge } from "./n8n-bridge.server";

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
