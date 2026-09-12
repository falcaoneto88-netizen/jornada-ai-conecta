import { describe, expect, it, vi } from "vitest";
import { receiveBioreportRequest } from "./bioreport-events.server";

const request = (body: string, signature = "a".repeat(64), contentType = "application/json") =>
  new Request("https://example.invalid/api", {
    method: "POST",
    headers: { "Content-Type": contentType, "x-bioreport-signature": signature },
    body,
  });
describe("ingresso BioReport", () => {
  it("rejeita assinatura ausente antes de acessar o banco", async () => {
    const rpc = vi.fn();
    expect((await receiveBioreportRequest(request("{}", ""), rpc)).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("limita o tamanho real mesmo sem Content-Length", async () => {
    const rpc = vi.fn();
    expect((await receiveBioreportRequest(request("x".repeat(4097)), rpc)).status).toBe(413);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("mantém os bytes assinados e recebe sem enviar mensagem", async () => {
    const rpc = vi.fn(async () => ({
      data: { status: "received", messages_sent: 0 },
      error: null,
    }));
    const response = await receiveBioreportRequest(request('{ "event": "teste" }'), rpc);
    expect(rpc).toHaveBeenCalledWith('{ "event": "teste" }', "a".repeat(64));
    expect(await response.json()).toEqual({ status: "received", messages_sent: 0 });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
  it.each([
    ["28000", 401],
    ["23505", 409],
    ["23503", 409],
    ["22P02", 400],
    ["42P01", 503],
  ])("sanitiza erros do banco %s", async (code, status) => {
    const response = await receiveBioreportRequest(request("{}"), async () => ({
      data: null,
      error: { code: String(code), message: "private-data" },
    }));
    expect(response.status).toBe(status);
    expect(await response.text()).not.toContain("private-data");
  });
});
