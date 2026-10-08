/** Existing session/admin/binding authority; no credential creation or activation flags. */
import { autorizar, origemConfiavel, type Sessao } from "./n8n-bridge.admin.server";
import {
  normalizarInstante,
  parseContacto,
  parseIdentidadeContacto,
  parseEvento,
} from "./n8n-bridge.core";
import {
  criarDepsBridge,
  lerConfigBridge,
  lerPilotoBridge,
  type ClienteBridge,
} from "./n8n-bridge.server";
import { pilotGrantSchema } from "./n8n-bridge-pilot";
import { pilotInputSchema } from "./n8n-bridge-pilot.schema";

export async function guardarPilotoBridge(
  ctx: Sessao,
  headers: Headers,
  input: unknown,
  dbInjected?: ClienteBridge,
  now = Date.now,
): Promise<{ ok: true } | { ok: false; code: string }> {
  if (!origemConfiavel(headers)) return { ok: false, code: "untrusted_origin" };
  const parsed = pilotInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid_request" };
  const db =
    dbInjected ??
    ((await import("@/integrations/supabase/client.server"))
      .supabaseAdmin as unknown as ClienteBridge);
  const auth = await autorizar(ctx, db);
  if (!auth?.escopo) return { ok: false, code: "forbidden" };
  const clock = now();
  if (!Number.isFinite(clock)) return { ok: false, code: "clock_unavailable" };
  const old = await lerPilotoBridge(db, auth.org).catch(() => ({ ok: false as const }));
  if (!old.ok) return { ok: false, code: "pilot_unavailable" };
  const requested = parsed.data;
  let row: Record<string, unknown>;
  if (!requested.enabled) {
    if (old.data === null) return { ok: true };
    const existing = pilotGrantSchema.safeParse(old.data);
    if (!existing.success || existing.data.organization_id !== auth.org)
      return { ok: false, code: "pilot_unavailable" };
    row = { ...existing.data, enabled: false };
  } else {
    const start = normalizarInstante(requested.expectedStartTime);
    const expiry = Date.parse(requested.expiresAt);
    if (
      !start ||
      expiry <= clock ||
      expiry > clock + 24 * 60 * 60 * 1000 ||
      expiry > Date.parse(start)
    )
      return { ok: false, code: "invalid_window" };
    const config = await lerConfigBridge(db, auth.org).catch(() => ({ ok: false as const }));
    if (!config.ok || !config.cfg.calendarId) return { ok: false, code: "bridge_unavailable" };
    const deps = criarDepsBridge(db);
    const contactRead = await deps
      .contacto(auth.escopo.locationId, requested.contactId)
      .catch(() => ({ ok: false as const }));
    if (
      !contactRead.ok ||
      !parseIdentidadeContacto(contactRead.data, requested.contactId, auth.escopo.locationId)
    )
      return { ok: false, code: "contact_not_verified" };
    if (!parseContacto(contactRead.data, requested.contactId, auth.escopo.locationId))
      return { ok: false, code: "contact_preferences_not_verified" };
    const eventRead = await deps
      .consulta(requested.appointmentId)
      .catch(() => ({ ok: false as const }));
    const event = eventRead.ok
      ? parseEvento(eventRead.data, requested.appointmentId, auth.escopo.locationId)
      : null;
    if (
      !event ||
      event.contactId !== requested.contactId ||
      event.calendarId !== config.cfg.calendarId ||
      normalizarInstante(event.startTime) !== start ||
      !["new", "booked", "confirmed"].includes(event.appointmentStatus) ||
      Date.parse(start) <= now()
    )
      return { ok: false, code: "appointment_not_verified" };
    row = {
      organization_id: auth.org,
      enabled: true,
      contact_id: requested.contactId,
      ghl_appointment_id: requested.appointmentId,
      start_time: start,
      expires_at: new Date(expiry).toISOString(),
      allowed_kinds: requested.allowedKinds,
    };
  }
  const persistedAt = now();
  if (
    !Number.isFinite(persistedAt) ||
    (requested.enabled && Date.parse(String(row["expires_at"])) <= persistedAt)
  )
    return { ok: false, code: "invalid_window" };
  const result = await Promise.resolve(
    db.from("n8n_bridge_pilot_grants").upsert(
      {
        ...row,
        updated_by: ctx.userId,
        updated_at: new Date(persistedAt).toISOString(),
      },
      { onConflict: "organization_id" },
    ),
  ).catch(() => ({ error: {} }));
  if (result.error) return { ok: false, code: "persist_failed" };
  const check = await lerPilotoBridge(db, auth.org).catch(() => ({ ok: false as const }));
  if (!check.ok) return { ok: false, code: "persist_failed" };
  const verified = pilotGrantSchema.safeParse(check.data);
  if (
    !verified.success ||
    verified.data.organization_id !== auth.org ||
    verified.data.enabled !== requested.enabled
  )
    return { ok: false, code: "persist_failed" };
  for (const key of ["contact_id", "ghl_appointment_id", "allowed_kinds"] as const) {
    if (JSON.stringify(verified.data[key]) !== JSON.stringify(row[key]))
      return { ok: false, code: "persist_failed" };
  }
  if (
    Date.parse(verified.data.start_time) !== Date.parse(String(row["start_time"])) ||
    Date.parse(verified.data.expires_at) !== Date.parse(String(row["expires_at"]))
  )
    return { ok: false, code: "persist_failed" };
  return { ok: true };
}
