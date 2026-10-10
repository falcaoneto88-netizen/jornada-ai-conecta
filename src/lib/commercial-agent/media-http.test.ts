import { beforeEach, expect, it, vi } from "vitest";
import { inboxMediaResponse, type MediaRow } from "./media-http.server";
import { INBOX_MEDIA_TTL_MS, mediaUrls, validateInboxAttachments } from "./inbox-media.server";
import { manualHash, type ManualPayload } from "./service.server";
import { seal } from "./providers.server";

const key = Buffer.alloc(32, 7).toString("base64");
const now = Date.parse("2026-10-10T14:00:00.000Z");
const attachment = {
  name: "privado.png",
  mimeType: "image/png",
  base64:
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=",
};
let row: MediaRow, payload: ManualPayload, url: string;
const read = vi.fn();
beforeEach(() => {
  row = {
    id: "11111111-1111-4111-8111-111111111111",
    organization_id: "org-test",
    request_id: "req-test",
    location_id: "loc-test",
    contact_id: "contact-test",
    conversation_id: "conv-test",
    state: "sending",
    dispatch_id: "dispatch-test",
    payload: "",
    reply_hash: "",
    created_at: new Date(now).toISOString(),
  };
  payload = {
    text: "",
    snapshot: {
      event: {
        type: "InboundMessage",
        locationId: row.location_id,
        contactId: row.contact_id,
        conversationId: row.conversation_id,
        messageId: "inbound-test",
      },
      name: "Fictício",
      messages: [],
      historyHash: "a".repeat(64),
      dnd: false,
      route: { channel: "SMS", providerId: "zap-test", defaultId: "zap-test", name: "Zaptos" },
    },
    media: {
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + INBOX_MEDIA_TTL_MS).toISOString(),
      attachments: validateInboxAttachments([attachment]),
    },
  };
  reseal();
  url = mediaUrls(row, payload.media!, key)[0]!;
  read.mockReset().mockImplementation(async () => row);
});
function reseal() {
  row.payload = seal(payload, key, `manual:${row.organization_id}:${row.request_id}`);
  row.reply_hash = manualHash(payload);
}
const call = (options: RequestInit = {}, at = now) =>
  inboxMediaResponse(new Request(url, options), new URL(url).pathname.split("/").at(-1)!, {
    key,
    read,
    now: () => at,
  });

it("serves exact bytes only for valid scoped capability, suppressing cache and original filename", async () => {
  const response = await call();
  expect(response.status).toBe(200);
  expect(Buffer.from(await response.arrayBuffer()).toString("base64")).toBe(attachment.base64);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(response.headers.get("content-type")).toBe("image/png");
  expect(response.headers.get("content-disposition")).toBe('attachment; filename="attachment.png"');
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
});
it("supports HEAD and a single bounded byte range without DB writes", async () => {
  const head = await call({ method: "HEAD" });
  expect(head.status).toBe(200);
  expect(await head.text()).toBe("");
  const part = await call({ headers: { Range: "bytes=0-7" } });
  expect(part.status).toBe(206);
  expect(part.headers.get("content-length")).toBe("8");
  expect([...new Uint8Array(await part.arrayBuffer())]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect((await call({ headers: { Range: "bytes=99-" } })).status).toBe(416);
  expect((await call({ headers: { Range: "bytes=0-1,3-4" } })).status).toBe(416);
});
it.each(["prepared", "rejected", "invalidated"])(
  "hides file when dispatch state is %s",
  async (state) => {
    row.state = state;
    expect((await call()).status).toBe(404);
  },
);
it("expires at ten minutes, never exposes errors or auto-renews URLs", async () => {
  expect((await call({}, now + INBOX_MEDIA_TTL_MS - 1)).status).toBe(200);
  expect((await call({}, now + INBOX_MEDIA_TTL_MS)).status).toBe(404);
  read.mockRejectedValueOnce(new Error(`do not expose ${url}`));
  const failed = await call();
  expect(failed.status).toBe(404);
  expect(await failed.text()).toBe("");
});

it("expiry uses one signed application timestamp, not synchronization with PostgreSQL", async () => {
  row.created_at = new Date(now - 2500).toISOString();
  expect((await call()).status).toBe(200);
  payload.media!.expiresAt = new Date(now + INBOX_MEDIA_TTL_MS + 1).toISOString();
  reseal();
  url = mediaUrls(row, payload.media!, key)[0]!;
  expect((await call()).status).toBe(404);
});
it("rejects missing, invalid, repeated token and traversal parameters", async () => {
  const original = url;
  for (const query of [
    "",
    "?token=short&index=0",
    `?index=0&index=0&token=${new URL(original).searchParams.get("token")}`,
    new URL(original).search + "&organization_id=other",
  ]) {
    url = original.split("?")[0] + query;
    expect((await call()).status).toBe(404);
  }
  url = original.replace(".png?", ".wav?");
  expect((await call()).status).toBe(404);
});
it("another tenant/request/contact and modified manifest never reveal the file", async () => {
  row.organization_id = "other-org";
  expect((await call()).status).toBe(404);
  row.organization_id = "org-test";
  row.contact_id = "other-contact";
  expect((await call()).status).toBe(404);
  row.contact_id = "contact-test";
  payload.media!.attachments[0]!.base64 = Buffer.from("not png").toString("base64");
  reseal();
  expect((await call()).status).toBe(404);
});
it("rejects altered bytes with old manifest even with valid encrypted payload", async () => {
  const bytes = Buffer.from(attachment.base64, "base64");
  bytes[32] = bytes[32]! ^ 1;
  payload.media!.attachments[0]!.base64 = bytes.toString("base64");
  reseal();
  expect((await call()).status).toBe(404);
});
