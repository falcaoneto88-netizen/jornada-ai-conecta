/** Explicit session-admin activation. Never creates credentials or sends a CRM message. */
import { autorizar, origemConfiavel, type Sessao } from "./n8n-bridge.admin.server";
import { envTokenValido } from "./n8n-bridge.core";
import {
  configGhl,
  lerConfigBridge,
  lerCredencialBridge,
  lerPoliticaBridge,
  type ClienteBridge,
} from "./n8n-bridge.server";
import { ghlFetch } from "./ghl.server";
import { parseSmsChannels } from "./commercial-agent/inbox-route";
import { runtimeInputSchema, type RuntimeStatus } from "./n8n-bridge-runtime.schema";
import { estadoRuntime } from "./n8n-bridge-runtime";

export async function lerEstadoPolitica(db: ClienteBridge, org: string): Promise<RuntimeStatus> {
  return estadoRuntime(
    { lerPoliticaRuntime: (organization) => lerPoliticaBridge(db, organization) },
    org,
  );
}

export async function guardarPoliticaBridge(
  ctx: Sessao,
  headers: Headers,
  input: unknown,
  dbInjected?: ClienteBridge,
  now = Date.now,
): Promise<{ ok: true; revision: number } | { ok: false; code: string }> {
  if (!origemConfiavel(headers)) return { ok: false, code: "untrusted_origin" };
  const parsed = runtimeInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid_request" };
  const db =
    dbInjected ??
    ((await import("@/integrations/supabase/client.server"))
      .supabaseAdmin as unknown as ClienteBridge);
  const auth = await autorizar(ctx, db);
  if (!auth) return { ok: false, code: "forbidden" };
  const requested = parsed.data;
  // Own-org revocation remains possible during a broken GHL connection/binding.
  if (requested.mode !== "off" && !auth.escopo) return { ok: false, code: "forbidden" };
  const existing = await lerEstadoPolitica(db, auth.org);
  if (!existing.available) return { ok: false, code: "runtime_unavailable" };
  if (existing.revision !== requested.expectedRevision)
    return { ok: false, code: "revision_conflict" };
  let location: string | null = null,
    calendar: string | null = null,
    provider: string | null = null,
    verifiedAt: string | null = null;
  if (requested.mode === "production") {
    const scope = auth.escopo;
    if (!scope?.integracaoConectada || !scope.writeEnabled)
      return { ok: false, code: "binding_unavailable" };
    const settings = await lerConfigBridge(db, auth.org).catch(() => ({ ok: false as const }));
    if (!settings.ok || !settings.cfg.calendarId) return { ok: false, code: "bridge_unavailable" };
    const cfg = settings.cfg;
    if (cfg.channel !== "whatsapp_zaptos" || !cfg.zaptosProviderId)
      return { ok: false, code: "channel_not_verified" };
    const envToken = process.env["N8N_JORNADA_BRIDGE_TOKEN"];
    if (envToken && !envTokenValido(envToken))
      return { ok: false, code: "credentials_unavailable" };
    if (!envToken) {
      const credential = await lerCredencialBridge(db, auth.org).catch(() => ({
        ok: false as const,
      }));
      if (!credential.ok || !credential.digest)
        return { ok: false, code: "credentials_unavailable" };
    }
    const ghl = configGhl(scope.locationId);
    if (!ghl) return { ok: false, code: "bridge_unavailable" };
    // These are authenticated GETs. The selected provider must still be the account default.
    const [channelRead, calendarRead] = await Promise.all([
      ghlFetch(ghl, `locations/${encodeURIComponent(scope.locationId)}/conversationChannels/SMS`),
      ghlFetch<{ calendars?: { id?: string; locationId?: string }[] }>(ghl, "calendars/", {
        query: { locationId: scope.locationId },
      }),
    ]);
    const channels = channelRead.ok ? parseSmsChannels(channelRead.data) : null;
    const providerName = channels?.providers.get(cfg.zaptosProviderId);
    if (
      !channels ||
      channels.defaultId !== cfg.zaptosProviderId ||
      !providerName ||
      !/zaptos/i.test(providerName)
    )
      return { ok: false, code: "channel_not_verified" };
    if (
      !calendarRead.ok ||
      !Array.isArray(calendarRead.data.calendars) ||
      calendarRead.data.calendars.filter(
        (c) =>
          c?.id === cfg.calendarId &&
          (c.locationId === undefined || c.locationId === scope.locationId),
      ).length !== 1
    )
      return { ok: false, code: "calendar_not_verified" };
    const clock = now();
    if (!Number.isFinite(clock)) return { ok: false, code: "clock_unavailable" };
    location = scope.locationId;
    calendar = cfg.calendarId;
    provider = cfg.zaptosProviderId;
    verifiedAt = new Date(clock).toISOString();
  }
  const result = await Promise.resolve(
    db.rpc("n8n_bridge_set_runtime_policy", {
      _actor: ctx.userId,
      _mode: requested.mode,
      _expected_revision: requested.expectedRevision,
      _allowed_kinds: requested.mode === "off" ? [] : requested.allowedKinds,
      _location: location,
      _calendar: calendar,
      _provider: provider,
      _verified_at: verifiedAt,
    }),
  ).catch(() => ({ data: null, error: {} }));
  if (result.error || !result.data || typeof result.data !== "object" || Array.isArray(result.data))
    return { ok: false, code: "persist_failed" };
  const out = result.data as { error?: unknown; revision?: unknown };
  if (typeof out.error === "string") {
    const known = [
      "forbidden",
      "invalid_request",
      "revision_conflict",
      "configuration_changed",
      "binding_unavailable",
      "verification_expired",
    ];
    return { ok: false, code: known.includes(out.error) ? out.error : "persist_failed" };
  }
  if (out.revision !== requested.expectedRevision + 1) return { ok: false, code: "persist_failed" };
  // CAS + audit share one transaction. UI refreshes separately; no retry on ambiguous results.
  return { ok: true, revision: out.revision as number };
}
