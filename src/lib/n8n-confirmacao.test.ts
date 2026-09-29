import { describe, expect, it, vi } from "vitest";
import { assinar, receberConfirmacao, type Deps } from "./n8n-confirmacao.server";

const SECRET = "s".repeat(40);
const NOW = 1_790_000_000_000;
const corpo = {
  event_id: "exec-123:no-1",
  ghl_appointment_id: "apptABC123",
  status: "confirmada",
  occurred_at: "2026-09-29T20:00:00Z",
};

function pedido(body: string, opts: { ts?: number; sig?: string } = {}) {
  const ts = String(Math.floor((opts.ts ?? NOW) / 1000));
  return new Request("http://x/api", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-jornada-timestamp": ts,
      "x-jornada-signature": opts.sig ?? assinar(SECRET, ts, body),
    },
    body,
  });
}
const deps = (over: Partial<Deps> = {}): Deps => ({
  secret: SECRET,
  org: "org-1",
  now: () => NOW,
  gravar: vi.fn(async () => ({ data: { ok: true, resultado: "atualizado" }, error: null })),
  ...over,
});

describe("entrada n8n confirmação", () => {
  it("aceita evento assinado", async () => {
    const d = deps();
    const r = await receberConfirmacao(pedido(JSON.stringify(corpo)), d);
    expect(r.status).toBe(200);
    expect(d.gravar).toHaveBeenCalledWith("org-1", corpo);
  });
  it("recusa assinatura inválida sem gravar", async () => {
    const d = deps();
    const r = await receberConfirmacao(pedido(JSON.stringify(corpo), { sig: "0".repeat(64) }), d);
    expect(r.status).toBe(401);
    expect(d.gravar).not.toHaveBeenCalled();
  });
  it("recusa fora da janela de 5 min", async () => {
    const r = await receberConfirmacao(pedido(JSON.stringify(corpo), { ts: NOW - 6 * 60_000 }), deps());
    expect(r.status).toBe(401);
  });
  it("recusa campos extra (PII)", async () => {
    const r = await receberConfirmacao(pedido(JSON.stringify({ ...corpo, phone: "+55" })), deps());
    expect(r.status).toBe(400);
  });
  it("recusa corpo grande", async () => {
    const r = await receberConfirmacao(pedido(JSON.stringify({ ...corpo, x: "a".repeat(5000) })), deps());
    expect(r.status).toBe(413);
  });
  it("sem chave cadastrada falha fechado", async () => {
    const r = await receberConfirmacao(pedido(JSON.stringify(corpo)), deps({ secret: undefined }));
    expect(r.status).toBe(503);
  });
  it("duplicado devolve resultado da base", async () => {
    const d = deps({ gravar: async () => ({ data: { ok: true, resultado: "duplicado" }, error: null }) });
    const r = await receberConfirmacao(pedido(JSON.stringify(corpo)), d);
    expect(await r.json()).toEqual({ ok: true, resultado: "duplicado" });
  });
});
