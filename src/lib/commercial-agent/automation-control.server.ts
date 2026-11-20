import type { AutomationState } from "./automation";
import { AgentError, type Settings } from "./core";
import type { Store } from "./service.server";

type StateRow = Settings & { canManage: boolean };
export type AutomationControlDeps = {
  store: Store;
  organizationId: string;
  locationId: string;
  actorId: string;
  writeEnabled: boolean;
  policyHash: string;
  runtimeReady: boolean;
  verifyKnowledge(): Promise<void>;
};
const channelsFor = (settings: Settings) => [
  ...new Set(settings.allowed_channels.filter((c) => ["SMS", "WhatsApp", "IG", "FB"].includes(c))),
];
// Revalidating policy must not broaden the channels shown in the existing authorization.
const activationChannels = (settings: Settings) =>
  settings.automation_enabled ? [...(settings.automation_channels ?? [])] : channelsFor(settings);
function activationBlock(settings: Settings, deps: AutomationControlDeps) {
  if (!deps.runtimeReady) return "automation_not_configured";
  if (!deps.writeEnabled || settings.mode !== "supervised") return "send_disabled";
  if (!settings.receive_all_contacts) return "automation_receipt_required";
  const allowed = channelsFor(settings);
  const requested = activationChannels(settings);
  if (
    !requested.length ||
    new Set(requested).size !== requested.length ||
    requested.some((channel) => !allowed.includes(channel))
  )
    return "unsupported_channel";
  return null;
}
function publicState(settings: StateRow, deps: AutomationControlDeps): AutomationState {
  if (settings.organization_id !== deps.organizationId || settings.location_id !== deps.locationId)
    throw new AgentError("scope_mismatch");
  if (
    typeof settings.automation_enabled !== "boolean" ||
    !Number.isSafeInteger(settings.automation_version) ||
    settings.automation_version! < 0
  )
    throw new AgentError("automation_not_configured");
  return {
    enabled: settings.automation_enabled,
    version: settings.automation_version!,
    since: settings.automation_since ?? null,
    channels: settings.automation_enabled
      ? (settings.automation_channels ?? [])
      : channelsFor(settings),
    canManage: settings.canManage === true,
    activationBlock: activationBlock(settings, deps),
    policyCurrent:
      !settings.automation_enabled || settings.automation_policy_hash === deps.policyHash,
  };
}
export async function readAutomation(deps: AutomationControlDeps): Promise<AutomationState> {
  return publicState(
    await deps.store.command<StateRow>("automation_state", deps.organizationId, {}, deps.actorId),
    deps,
  );
}
export async function changeAutomation(
  deps: AutomationControlDeps,
  input: { enabled: boolean; expectedVersion: number },
): Promise<AutomationState> {
  const settings = await deps.store.command<StateRow>(
    "automation_state",
    deps.organizationId,
    {},
    deps.actorId,
  );
  const state = publicState(settings, deps);
  if (!state.canManage) throw new AgentError("forbidden");
  if (state.version !== input.expectedVersion) throw new AgentError("version_conflict");
  if (input.enabled) {
    const blocked = activationBlock(settings, deps);
    if (blocked) throw new AgentError(blocked);
    await deps.verifyKnowledge();
  }
  const next = await deps.store.command<StateRow>(
    "automation_set",
    deps.organizationId,
    {
      enabled: input.enabled,
      expectedVersion: input.expectedVersion,
      policyHash: deps.policyHash,
      channels: input.enabled ? activationChannels(settings) : channelsFor(settings),
    },
    deps.actorId,
  );
  return publicState(next, deps);
}
