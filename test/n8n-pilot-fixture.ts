import { PILOT_KINDS, type PilotGrant } from "../src/lib/n8n-bridge-pilot";
/** Explicit synthetic grant for existing live-path regression fixtures. */
export function testPilot(org: string, contact: string, appointment: string, start: string) {
  return async (_org?: string): Promise<{ ok: true; data: PilotGrant }> => ({
    ok: true,
    data: {
      organization_id: org,
      enabled: true,
      contact_id: contact,
      ghl_appointment_id: appointment,
      start_time: start,
      expires_at: start,
      allowed_kinds: [...PILOT_KINDS],
    },
  });
}
