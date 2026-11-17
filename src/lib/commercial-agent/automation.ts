import { z } from "zod";
import type { Settings, Snapshot } from "./core";

/** Public projection. No secrets, policy text, patient data or client-selected location. */
export type AutomationState = {
  enabled: boolean;
  version: number;
  since: string | null;
  channels: string[];
  canManage: boolean;
  activationBlock: string | null;
  policyCurrent: boolean;
};
export const automationInput = z
  .object({
    organizationId: z.string().uuid(),
    enabled: z.boolean(),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();

/** Receipt is not authorization. Automatic replies require a separately activated epoch. */
export function automationReason(
  config: Settings,
  snapshot: Snapshot,
  now: number,
  policyHash: string,
): string | null {
  if (
    config.automation_enabled !== true ||
    config.mode !== "supervised" ||
    config.receive_all_contacts !== true
  )
    return "automation_disabled";
  if (config.automation_policy_hash !== policyHash) return "automation_policy_changed";
  if (config.location_id !== snapshot.event.locationId) return "scope_mismatch";
  const last = snapshot.messages.at(-1);
  if (!last || last.direction !== "inbound" || last.id !== snapshot.event.messageId)
    return "draft_stale";
  if (
    !config.automation_channels?.includes(last.channel) ||
    !config.allowed_channels.includes(last.channel)
  )
    return "unsupported_channel";
  const since = Date.parse(config.automation_since ?? ""),
    at = Date.parse(last.at);
  if (!Number.isFinite(since) || !Number.isFinite(at) || since > now || at > now || at < since)
    return "before_automation_since";
  return null;
}
