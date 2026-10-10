import { describe, expect, it } from "vitest";
import {
  validateInboxAttachments,
  mediaUrls,
  mediaToken,
  validMediaToken,
  sameMediaReceipt,
} from "./inbox-media.server";
import type { InboxAttachment } from "./inbox-media";

export const PNG: InboxAttachment = {
  name: "imagem.png",
  mimeType: "image/png",
  base64:
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=",
};
const key = Buffer.alloc(32, 7).toString("base64");
const binding = {
  id: "11111111-1111-4111-8111-111111111111",
  organization_id: "org-one",
  request_id: "req-one",
};
const media = {
  issuedAt: "2026-10-10T14:00:00.000Z",
  expiresAt: "2026-10-10T14:10:00.000Z",
  attachments: validateInboxAttachments([PNG]),
};
describe("manual inbox media validation", () => {
  it("rejects header-only PNG, WAV, MP3 and M4A despite matching a magic prefix", () => {
    const png = Buffer.from(PNG.base64, "base64").subarray(0, 33);
    const wav = Buffer.alloc(44);
    wav.write("RIFF");
    wav.writeUInt32LE(36, 4);
    wav.write("WAVEfmt ", 8);
    wav.write("data", 36);
    const mp3 = Buffer.alloc(10);
    mp3.write("ID3");
    const m4a = Buffer.alloc(24);
    m4a.writeUInt32BE(24);
    m4a.write("ftypM4A ", 4);
    for (const [mimeType, bytes] of [
      ["image/png", png],
      ["audio/wav", wav],
      ["audio/mpeg", mp3],
      ["audio/mp4", m4a],
    ] as const)
      expect(() =>
        validateInboxAttachments([
          { name: "header-only", mimeType, base64: bytes.toString("base64") },
        ]),
      ).toThrow("media_unsupported");
  });
  it("accepts bounded real signatures and hashes decoded content", () => {
    expect(media.attachments[0]).toMatchObject({
      name: PNG.name,
      size: 68,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    const wav = Buffer.alloc(48);
    wav.write("RIFF");
    wav.writeUInt32LE(40, 4);
    wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(16000, 24);
    wav.writeUInt32LE(32000, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.writeUInt32LE(wav.length - 44, 40);
    wav.write("data", 36);
    expect(
      validateInboxAttachments([
        { name: "voz.wav", mimeType: "audio/wav", base64: wav.toString("base64") },
      ])[0]?.mimeType,
    ).toBe("audio/wav");
  });
  it.each([
    [{ ...PNG, base64: Buffer.from("<svg><script>alert(1)</script></svg>").toString("base64") }],
    [{ ...PNG, mimeType: "image/svg+xml" }],
    [{ ...PNG, base64: `data:image/png;base64,${PNG.base64}` }],
    [{ ...PNG, base64: `${PNG.base64}\n` }],
    [{ ...PNG, base64: PNG.base64, url: "https://attacker.invalid" }],
    [{ ...PNG, name: "../imagem.png" }],
    [{ ...PNG, name: "imagem\r\nHeader.png" }],
    [PNG, PNG],
    [{ ...PNG, base64: Buffer.alloc(5 * 1024 * 1024 + 1).toString("base64") }],
  ])("rejects malformed, spoofed, extra, oversized and remote attachments", (...value) => {
    expect(() => validateInboxAttachments(value)).toThrow(/media_/);
  });
  it("capability is bound to org, request, dispatch, index, digest and expiration", () => {
    const token = mediaToken(binding, media, 0, key);
    expect(validMediaToken(token, token)).toBe(true);
    for (const field of ["id", "organization_id", "request_id"] as const)
      expect(mediaToken({ ...binding, [field]: "other" }, media, 0, key)).not.toBe(token);
    expect(
      mediaToken(binding, { ...media, expiresAt: "2026-10-10T14:11:00.000Z" }, 0, key),
    ).not.toBe(token);
    expect(
      mediaToken(
        binding,
        { ...media, attachments: [{ ...media.attachments[0]!, sha256: "0".repeat(64) }] },
        0,
        key,
      ),
    ).not.toBe(token);
    expect(validMediaToken("short", token)).toBe(false);
    const url = new URL(mediaUrls(binding, media, key)[0]!);
    expect(url.origin).toBe("https://jornada-ai-conecta.lovable.app");
    expect(url.pathname).toBe(`/api/public/commercial-agent-media/${binding.id}.png`);
    expect(url.href).not.toContain(PNG.name);
  });
  it("receipt requires exact attachment URLs and rejects text-only or changed media", () => {
    const urls = mediaUrls(binding, media, key);
    expect(sameMediaReceipt(urls, urls)).toBe(true);
    expect(sameMediaReceipt([{ url: urls[0] }], urls)).toBe(true);
    expect(sameMediaReceipt([], urls)).toBe(false);
    expect(sameMediaReceipt(["https://other.invalid/file.png"], urls)).toBe(false);
    expect(sameMediaReceipt([...urls, ...urls], urls)).toBe(false);
    expect(sameMediaReceipt(urls, [])).toBe(false);
  });
});
