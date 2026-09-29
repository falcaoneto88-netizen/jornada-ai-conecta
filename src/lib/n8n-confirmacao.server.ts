import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";

export const N8N_MAX_BYTES = 4096;
export const N8N_JANELA_MS = 5 * 60 * 1000;

export const eventoSchema = z
  .object({
    event_id: z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/),
    ghl_appointment_id: z.string().regex(/^[A-Za-z0-9_-]{6,64}$/),
    status: z.enum(["confirmada", "cancelada", "reagendamento_pedido", "sem_resposta"]),
    occurred_at: z.string().datetime({ offset: true }),
  })
  .strict();
export type EventoN8n = z.infer<typeof eventoSchema>;

export type Deps = {
  secret: string | undefined;
  org: string | undefined;
  now: () => number;
  gravar: (org: string, e: EventoN8n) => Promise<{ data: unknown; error: { code?: string } | null }>;
};

const reply = (body: unknown, status: number) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export function assinar(secret: string, timestamp: string, body: string) {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export async function receberConfirmacao(request: Request, deps: Deps): Promise<Response> {
  if (!deps.secret || deps.secret.length < 32 || !deps.org) return reply({ error: "integration_unavailable" }, 503);
  const sig = request.headers.get("x-jornada-signature") ?? "";
  const ts = request.headers.get("x-jornada-timestamp") ?? "";
  if (!/^[a-f0-9]{64}$/.test(sig) || !/^\d{10}$/.test(ts)) return reply({ error: "unauthorized" }, 401);
  if (Math.abs(deps.now() - Number(ts) * 1000) > N8N_JANELA_MS) return reply({ error: "unauthorized" }, 401);
  if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json")
    return reply({ error: "invalid_content_type" }, 415);
  const buf = new Uint8Array(await request.arrayBuffer());
  if (buf.byteLength > N8N_MAX_BYTES) return reply({ error: "event_too_large" }, 413);
  let body: string;
  try {
    body = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return reply({ error: "invalid_event" }, 400);
  }
  const esperado = Buffer.from(assinar(deps.secret, ts, body), "hex");
  if (!timingSafeEqual(esperado, Buffer.from(sig, "hex"))) return reply({ error: "unauthorized" }, 401);
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return reply({ error: "invalid_event" }, 400);
  }
  const p = eventoSchema.safeParse(json);
  if (!p.success) return reply({ error: "invalid_event" }, 400);
  try {
    const { data, error } = await deps.gravar(deps.org, p.data);
    if (error) {
      if (error.code === "28000") return reply({ error: "unauthorized" }, 401);
      if (error.code === "22023") return reply({ error: "invalid_event" }, 400);
      return reply({ error: "integration_unavailable" }, 503);
    }
    return reply(data, 200);
  } catch {
    return reply({ error: "integration_unavailable" }, 503);
  }
}

export async function receberConfirmacaoN8n(request: Request) {
  return receberConfirmacao(request, {
    secret: process.env["N8N_JORNADA_SIGNING_SECRET"],
    org: process.env["JORNADA_AI_ORGANIZATION_ID"],
    now: () => Date.now(),
    gravar: async (org, e) => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      return supabaseAdmin.rpc("record_n8n_appointment_event", {
        _org: org,
        _event_id: e.event_id,
        _ghl_appointment_id: e.ghl_appointment_id,
        _status: e.status,
        _occurred_at: e.occurred_at,
      });
    },
  });
}
