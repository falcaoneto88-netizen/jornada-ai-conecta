/** Narrow live authority. A grant never enables simulation, live flags, channel or evidence. */
import { z } from "zod";

export const PILOT_KINDS = ["booking", "req24", "req12", "confirm", "appointment.confirm"] as const;
export type PilotKind = (typeof PILOT_KINDS)[number];
const id = z.string().regex(/^[A-Za-z0-9_-]{6,64}$/);
const instant = z.string().datetime({ offset: true });
const kinds = z
  .array(z.enum(PILOT_KINDS))
  .max(PILOT_KINDS.length)
  .refine((v) => new Set(v).size === v.length);
export const pilotGrantSchema = z
  .object({
    organization_id: z.string().min(1),
    enabled: z.boolean(),
    contact_id: id,
    ghl_appointment_id: id,
    start_time: instant,
    expires_at: instant,
    allowed_kinds: kinds,
  })
  .strict();
export type PilotGrant = z.infer<typeof pilotGrantSchema>;
export type PilotRead = { ok: true; data: unknown | null } | { ok: false };
export type PilotDeps = { lerPiloto?: (orgId: string) => Promise<PilotRead>; now: () => number };
export type PilotTarget = {
  contactId: string;
  appointmentId: string;
  startTime: string;
  kind: string;
};
export type PilotStatus = {
  status: "off" | "active" | "expired" | "unavailable";
  contactId: string | null;
  appointmentId: string | null;
  expectedStartTime: string | null;
  expiresAt: string | null;
  allowedKinds: PilotKind[];
};
const empty = (status: PilotStatus["status"]): PilotStatus => ({
  status,
  contactId: null,
  appointmentId: null,
  expectedStartTime: null,
  expiresAt: null,
  allowedKinds: [],
});
const second = (time: number) => Math.floor(time / 1000) * 1000;

/** Fresh scoped read each time; unavailable/malformed data never grants authority. */
export async function estadoPiloto(deps: PilotDeps, orgId: string): Promise<PilotStatus> {
  if (!deps.lerPiloto) return empty("unavailable");
  const read = await deps.lerPiloto(orgId).catch(() => ({ ok: false as const }));
  if (!read.ok) return empty("unavailable");
  if (read.data === null) return empty("off");
  const parsed = pilotGrantSchema.safeParse(read.data);
  if (!parsed.success || parsed.data.organization_id !== orgId) return empty("unavailable");
  const grant = parsed.data;
  if (!grant.enabled || !grant.allowed_kinds.length) return empty("off");
  const now = deps.now();
  if (!Number.isFinite(now)) return empty("unavailable");
  const expiry = Date.parse(grant.expires_at);
  const start = Date.parse(grant.start_time);
  return {
    status: now < expiry && now < start ? "active" : "expired",
    contactId: grant.contact_id,
    appointmentId: grant.ghl_appointment_id,
    expectedStartTime: new Date(second(start)).toISOString(),
    expiresAt: new Date(expiry).toISOString(),
    allowedKinds: grant.allowed_kinds,
  };
}

export async function autorizarPiloto(
  deps: PilotDeps,
  orgId: string,
  target: PilotTarget,
): Promise<{ ok: true } | { ok: false; code: string; status: number }> {
  const state = await estadoPiloto(deps, orgId);
  if (state.status === "unavailable") return { ok: false, code: "pilot_unavailable", status: 503 };
  if (state.status === "expired") return { ok: false, code: "pilot_expired", status: 403 };
  if (
    state.status !== "active" ||
    state.contactId !== target.contactId ||
    state.appointmentId !== target.appointmentId ||
    !instant.safeParse(target.startTime).success ||
    Date.parse(state.expectedStartTime!) !== second(Date.parse(target.startTime)) ||
    !state.allowedKinds.includes(target.kind as PilotKind)
  )
    return { ok: false, code: "pilot_not_authorized", status: 403 };
  return { ok: true };
}
