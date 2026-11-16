import { z } from "zod";
import { PILOT_KINDS, type PilotKind } from "./n8n-bridge-pilot";

export const RUNTIME_MODES = ["off", "pilot", "production"] as const;
export const PRODUCTION_KINDS = ["booking", "req24", "req12"] as const;
export type ProductionKind = (typeof PRODUCTION_KINDS)[number];
export type RuntimeMode = (typeof RUNTIME_MODES)[number];
const id = z.string().regex(/^[A-Za-z0-9_-]{6,64}$/);
const kinds = z
  .array(z.enum(PILOT_KINDS))
  .max(PILOT_KINDS.length)
  .refine((values) => new Set(values).size === values.length);

/** Client may request a mode, never a tenant, provider, proof or activation flag. */
export const runtimeInputSchema = z
  .object({
    mode: z.enum(RUNTIME_MODES),
    expectedRevision: z
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER - 1),
    allowedKinds: kinds,
  })
  .strict()
  .refine(
    (value) =>
      value.mode !== "production" ||
      (value.allowedKinds.length > 0 &&
        value.allowedKinds.every((kind) => (PRODUCTION_KINDS as readonly string[]).includes(kind))),
  );
export type RuntimeInput = z.infer<typeof runtimeInputSchema>;

/** Persisted authority is tied to the exact verified integration configuration. */
export const runtimePolicySchema = z
  .object({
    organization_id: z.string().uuid(),
    mode: z.enum(RUNTIME_MODES),
    location_id: id.nullable(),
    calendar_id: id.nullable(),
    channel: z.literal("whatsapp_zaptos").nullable(),
    zaptos_provider_id: id.nullable(),
    allowed_kinds: kinds,
    revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    verified_at: z.string().datetime({ offset: true }).nullable(),
    updated_by: z.string().uuid(),
    updated_at: z.string().datetime({ offset: true }),
  })
  .strict()
  .refine(
    (value) =>
      value.mode !== "production" ||
      Boolean(
        value.location_id &&
        value.calendar_id &&
        value.channel &&
        value.zaptos_provider_id &&
        value.verified_at &&
        value.allowed_kinds.length &&
        value.allowed_kinds.every((kind) => (PRODUCTION_KINDS as readonly string[]).includes(kind)),
      ),
  );
export type RuntimePolicy = z.infer<typeof runtimePolicySchema>;
export type RuntimeStatus = {
  available: boolean;
  mode: RuntimeMode;
  revision: number;
  allowedKinds: PilotKind[];
  locationId: string | null;
  calendarId: string | null;
  channel: "whatsapp_zaptos" | null;
  zaptosProviderId: string | null;
  verifiedAt: string | null;
  updatedAt: string | null;
};

export const emptyRuntimeStatus = (available = false): RuntimeStatus => ({
  available,
  mode: "pilot",
  revision: 0,
  allowedKinds: [],
  locationId: null,
  calendarId: null,
  channel: null,
  zaptosProviderId: null,
  verifiedAt: null,
  updatedAt: null,
});
