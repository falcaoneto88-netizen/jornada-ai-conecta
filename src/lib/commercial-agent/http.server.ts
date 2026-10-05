import { eventSchema, AgentError } from "./core";
import { verifyMarketplace, verifyWorkflowSecret } from "./providers.server";
import { createStore, resolveAgentLocation, runtime } from "./runtime.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
async function limitedBody(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new AgentError("json_required");
  const reader = request.body?.getReader();
  if (!reader) throw new AgentError("invalid_event");
  let total = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > 32768) {
      await reader.cancel();
      throw new AgentError("body_too_large");
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
}
export async function agentWebhook(request: Request) {
  if (process.env["COMMERCIAL_AGENT_ENABLED"] !== "true") return json({ status: "disabled" }, 503);
  try {
    const raw = await limitedBody(request),
      signature = request.headers.get("x-ghl-signature");
    const valid = signature
      ? verifyMarketplace(raw, signature)
      : verifyWorkflowSecret(
          request.headers.get("x-webhook-secret"),
          process.env["COMMERCIAL_AGENT_WEBHOOK_SECRET"],
        );
    if (!valid) return json({ error: "unauthorized" }, 401);
    const event = eventSchema.parse(JSON.parse(raw));
    const org = await resolveAgentLocation(event.locationId);
    const result = await runtime(event.locationId).receive(org, event);
    return json(result, 202);
  } catch (e) {
    const code = e instanceof AgentError ? e.code : "invalid_event";
    console.warn(JSON.stringify({ component: "commercial_agent", code }));
    return json({ error: code }, code === "storage_unavailable" ? 503 : 422);
  }
}
export async function agentWorker(request: Request) {
  if (
    !verifyWorkflowSecret(
      request.headers.get("x-worker-secret"),
      process.env["COMMERCIAL_AGENT_WORKER_SECRET"],
    )
  )
    return json({ error: "unauthorized" }, 401);
  if (process.env["COMMERCIAL_AGENT_ENABLED"] !== "true") return json({ status: "disabled" }, 503);
  try {
    const location = process.env["GHL_LOCATION_ID"] ?? "",
      org = await resolveAgentLocation(location);
    const result = await runtime(location).work(org);
    // Uses the same durable store; called on each scheduler tick, never by ChatGPT.
    const store = createStore(supabaseAdmin as unknown as Parameters<typeof createStore>[0]);
    await store.command("purge", org);
    return json(result);
  } catch (e) {
    const code = e instanceof AgentError ? e.code : "worker_failed";
    console.warn(JSON.stringify({ component: "commercial_agent", code }));
    return json({ error: code }, 503);
  }
}
