import { describe, expect, it } from "vitest";
import { boundServerFunctionBody, SERVER_FUNCTION_BODY_LIMIT } from "./server-function-body";

describe("server function body before parsing", () => {
  it("preserves payload, auth and content type for allowed requests", async () => {
    const request = new Request("https://test.invalid/_serverFn/send", {
      method: "POST",
      headers: { authorization: "Bearer fictional", "content-type": "application/json" },
      body: JSON.stringify({ attachments: [{ base64: "AAAA" }] }),
    });
    const result = await boundServerFunctionBody(request);
    expect(result).toBeInstanceOf(Request);
    expect(result.headers.get("authorization")).toBe("Bearer fictional");
    expect(result.headers.get("content-type")).toBe("application/json");
    expect(await result.json()).toEqual({ attachments: [{ base64: "AAAA" }] });
  });
  it("does not intercept unrelated routes or GET", async () => {
    for (const url of [
      "https://test.invalid/api/public/ghl-webhook",
      "https://test.invalid/_serverFnOther/send",
    ]) {
      const request = new Request(url, { method: "POST", body: "original" });
      expect(await boundServerFunctionBody(request, undefined, 1)).toBe(request);
    }
    const request = new Request("https://test.invalid/_serverFn/send");
    expect(await boundServerFunctionBody(request)).toBe(request);
  });
  it("rejects a declared oversized body before reading", async () => {
    const request = new Request("https://test.invalid/_serverFn/send", {
      method: "POST",
      headers: { "content-length": "1000" },
      body: "small",
    });
    const result = await boundServerFunctionBody(request, undefined, 10);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(413);
    expect(request.bodyUsed).toBe(false);
  });
  it("enforces the actual size when content-length is absent or false", async () => {
    for (const headers of [{}, { "content-length": "1" }]) {
      const request = new Request("https://test.invalid/_serverFn/send", {
        method: "POST",
        headers,
        body: "12345678901",
      });
      const result = await boundServerFunctionBody(request, undefined, 10);
      expect((result as Response).status).toBe(413);
    }
  });
  it("enforces the limit on encoded paths normalized by TanStack", async () => {
    for (const path of ["/%5FserverFn/send", "/_server%46n/send", "/%5fserverFn/send"]) {
      const result = await boundServerFunctionBody(
        new Request(`https://test.invalid${path}`, { method: "POST", body: "12345678901" }),
        undefined,
        10,
      );
      expect(result).toBeInstanceOf(Response);
      expect((result as Response).status).toBe(413);
    }
  });
  it("supports the configured prefix and the exact boundary", async () => {
    const request = new Request("https://test.invalid/custom/send", {
      method: "POST",
      body: "1234567890",
    });
    const result = await boundServerFunctionBody(request, "/custom", 10);
    expect(await result.text()).toBe("1234567890");
  });
  it("a full 5MiB attachment fits with its JSON envelope", async () => {
    const body = JSON.stringify({
      attachments: [
        {
          name: "test.wav",
          mimeType: "audio/wav",
          base64: Buffer.alloc(5 * 1024 * 1024).toString("base64"),
        },
      ],
    });
    expect(Buffer.byteLength(body)).toBeLessThan(SERVER_FUNCTION_BODY_LIMIT);
    const result = await boundServerFunctionBody(
      new Request("https://test.invalid/_serverFn/send", { method: "POST", body }),
    );
    expect(result).toBeInstanceOf(Request);
    expect(await result.text()).toBe(body);
  });
});
