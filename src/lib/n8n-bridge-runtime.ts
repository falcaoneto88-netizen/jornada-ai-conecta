/** Server authority for real effects. Simulation is never promoted by a policy. */
import type { ConfigBridge, Resolucao } from "./n8n-bridge.core";
import {
  autorizarPiloto,
  type PilotDeps,
  type PilotKind,
  type PilotTarget,
} from "./n8n-bridge-pilot";
import {
  emptyRuntimeStatus,
  runtimePolicySchema,
  PRODUCTION_KINDS,
  type ProductionKind,
  type RuntimeStatus,
} from "./n8n-bridge-runtime.schema";

export type RuntimeRead = { ok: true; data: unknown | null } | { ok: false };
export type RuntimeDeps = PilotDeps & {
  lerPoliticaRuntime?: (orgId: string) => Promise<RuntimeRead>;
  resolver: () => Promise<Resolucao | null>;
  lerConfig: (orgId: string) => Promise<{ ok: true; cfg: ConfigBridge } | { ok: false }>;
};
export type RuntimeAuthority = { mode: "pilot" | "production"; revision: number };
type Denied = { ok: false; code: string; status: number };
const denied = (code: string, status = 403): Denied => ({ ok: false, code, status });

export async function estadoRuntime(
  deps: Pick<RuntimeDeps, "lerPoliticaRuntime">,
  orgId: string,
): Promise<RuntimeStatus> {
  if (!deps.lerPoliticaRuntime) return emptyRuntimeStatus(false);
  const read = await deps.lerPoliticaRuntime(orgId).catch(() => ({ ok: false as const }));
  if (!read.ok) return emptyRuntimeStatus(false);
  if (read.data === null) return emptyRuntimeStatus(true);
  const parsed = runtimePolicySchema.safeParse(read.data);
  if (!parsed.success || parsed.data.organization_id !== orgId) return emptyRuntimeStatus(false);
  const row = parsed.data;
  return {
    available: true,
    mode: row.mode,
    revision: row.revision,
    allowedKinds: row.allowed_kinds,
    locationId: row.location_id,
    calendarId: row.calendar_id,
    channel: row.channel,
    zaptosProviderId: row.zaptos_provider_id,
    verifiedAt: row.verified_at,
    updatedAt: row.updated_at,
  };
}

/** Called before reservation and again immediately before an external effect. */
export async function autorizarRuntime(
  deps: RuntimeDeps,
  scope: Resolucao,
  cfg: ConfigBridge,
  target: PilotTarget,
  previous?: RuntimeAuthority,
): Promise<{ ok: true; authority: RuntimeAuthority } | Denied> {
  const policy = await estadoRuntime(deps, scope.orgId);
  if (!policy.available) return denied("runtime_policy_unavailable", 503);
  if (policy.mode === "off") return denied("runtime_disabled");
  if (previous && (previous.mode !== policy.mode || previous.revision !== policy.revision))
    return denied("runtime_policy_changed", 409);

  // Bindings and flags are independent kill switches, including when the policy is unchanged.
  const freshScope = await deps.resolver().catch(() => null);
  if (!freshScope) return denied("binding_unavailable", 503);
  if (freshScope.orgId !== scope.orgId || freshScope.locationId !== scope.locationId)
    return denied("runtime_scope_changed", 409);
  const fresh = await deps.lerConfig(scope.orgId).catch(() => ({ ok: false as const }));
  if (!fresh.ok) return denied("bridge_schema_unavailable", 503);
  if (!fresh.cfg.bridgeEnabled) return denied("bridge_disabled");
  if (
    fresh.cfg.simulation ||
    !fresh.cfg.liveSendEnabled ||
    !freshScope.writeEnabled ||
    !freshScope.integracaoConectada
  )
    return denied("live_send_disabled");
  if ((Object.keys(cfg) as (keyof ConfigBridge)[]).some((key) => fresh.cfg[key] !== cfg[key]))
    return denied("runtime_configuration_changed", 409);

  if (policy.mode === "production") {
    // The acknowledgement activity exception is only validated for supervised pilots.
    if (!PRODUCTION_KINDS.includes(target.kind as ProductionKind))
      return denied("production_action_not_supported");
    if (
      policy.locationId !== scope.locationId ||
      policy.calendarId !== cfg.calendarId ||
      policy.channel !== cfg.channel ||
      policy.zaptosProviderId !== cfg.zaptosProviderId
    )
      return denied("runtime_scope_changed", 409);
    if (cfg.channel !== "whatsapp_zaptos" || !cfg.zaptosProviderId || !cfg.channelVerified)
      return denied("channel_not_verified", 409);
    if (!policy.allowedKinds.includes(target.kind as PilotKind))
      return denied("production_not_authorized");
  } else {
    const pilot = await autorizarPiloto(deps, scope.orgId, target);
    if (!pilot.ok) return pilot;
  }
  return { ok: true, authority: { mode: policy.mode, revision: policy.revision } };
}
