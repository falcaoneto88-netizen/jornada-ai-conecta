import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { GHL_ORIGIN, GHL_VERSION, type GhlConfig } from "../ghl.server";
import { AgentError, eventSchema, id, type Event } from "./core";
import { discoverContactEvents, type DiscoveryGet } from "./discovery.server";
import { createStore, runtime } from "./runtime.server";
import type { Store } from "./service.server";

export type ObserverResult = {
  status: "disabled" | "ignored" | "idle" | "observed";
  discovered: number;
  accepted: number;
  duplicates: number;
  ownMessages: number;
};
export type ObserverDependencies = {
  env: Record<string, string | undefined>;
  store: Store;
  config: GhlConfig;
  receiver: (locationId: string) => { receive(org: string, event: Event): Promise<unknown> };
  discover?: typeof discoverContactEvents;
  call?: DiscoveryGet;
  now?: () => number;
};

const settingsSchema = z.object({
  organization_id: z.uuid(),
  location_id: id,
  mode: z.enum(["off", "supervised"]),
  allowed_contacts: z.array(id),
  allowed_channels: z.array(z.string()),
});
const ingressSchema = z.object({
  status: z.enum(["accepted", "duplicate", "own_message", "disabled"]),
});
const empty = (status: ObserverResult["status"]): ObserverResult => ({
  status,
  discovered: 0,
  accepted: 0,
  duplicates: 0,
  ownMessages: 0,
});

/** Discovery only enqueues canonical IDs; generation and human-approved sends remain elsewhere. */
export function createObserver(deps: ObserverDependencies) {
  async function observe(
    org: string,
    locationId: string,
    requestedContact: string | undefined,
    pilot: boolean,
  ) {
    if (
      deps.env["COMMERCIAL_AGENT_ENABLED"] !== "true" ||
      deps.env["COMMERCIAL_AGENT_DISCOVERY_ENABLED"] !== "true"
    )
      return empty("disabled");
    if (
      !z.uuid().safeParse(org).success ||
      !id.safeParse(locationId).success ||
      locationId !== deps.config.locationId ||
      (!pilot && !id.safeParse(requestedContact).success)
    )
      throw new AgentError("scope_mismatch");
    if (deps.config.baseUrl !== GHL_ORIGIN || deps.config.version !== GHL_VERSION)
      throw new AgentError("discovery_config_invalid");

    const parsed = settingsSchema.safeParse(await deps.store.command("settings", org));
    if (!parsed.success) throw new AgentError("discovery_settings_invalid");
    const settings = parsed.data;
    if (settings.organization_id !== org || settings.location_id !== locationId)
      throw new AgentError("scope_mismatch");
    if (settings.mode !== "supervised") return empty("disabled");
    const contacts = [...new Set(settings.allowed_contacts)];
    if (requestedContact !== undefined && !contacts.includes(requestedContact))
      throw new AgentError("contact_not_allowed");
    // The initial pilot has exactly one distinct authorized contact, never a bulk scan.
    if (contacts.length > 1) throw new AgentError("discovery_contact_limit");
    const contactId = requestedContact ?? contacts[0];
    if (!contactId) return empty("ignored");

    const parsedSince = z.iso
      .datetime({ offset: true })
      .safeParse(deps.env["COMMERCIAL_AGENT_PILOT_SINCE"]);
    const now = (deps.now ?? Date.now)();
    if (
      !parsedSince.success ||
      !Number.isFinite(now) ||
      !Number.isFinite(Date.parse(parsedSince.data)) ||
      Date.parse(parsedSince.data) > now
    )
      throw new AgentError("discovery_since_invalid");

    const rawEvents = await (deps.discover ?? discoverContactEvents)(
      { locationId, contactId, since: parsedSince.data },
      { config: deps.config, ...(deps.call ? { call: deps.call } : {}), now: () => now },
    );
    const parsedEvents = z.array(eventSchema).max(1000).safeParse(rawEvents);
    if (!parsedEvents.success) throw new AgentError("discovery_history_invalid");
    const events = parsedEvents.data;
    // Validate the entire completed discovery before the first durable ingress.
    if (events.some((event) => event.locationId !== locationId || event.contactId !== contactId))
      throw new AgentError("scope_mismatch");
    if (!events.length) return empty("idle");

    const result = { ...empty("observed"), discovered: events.length };
    const receiver = deps.receiver(locationId);
    for (const event of events) {
      // Keep discovery's chronological order. Store.ingress handles duplicates and human pauses.
      const ingress = ingressSchema.safeParse(await receiver.receive(org, event));
      if (!ingress.success) throw new AgentError("observer_ingress_invalid");
      switch (ingress.data.status) {
        case "accepted":
          result.accepted++;
          break;
        case "duplicate":
          result.duplicates++;
          break;
        case "own_message":
          result.ownMessages++;
          break;
        case "disabled":
          result.status = "disabled";
          return result;
      }
    }
    return result;
  }

  return {
    observerContact: (org: string, locationId: string, contactId: string) =>
      observe(org, locationId, contactId, false),
    observerPilot: (org: string, locationId: string) => observe(org, locationId, undefined, true),
  };
}

function configuredObserver() {
  return createObserver({
    env: process.env,
    store: createStore(supabaseAdmin as unknown as Parameters<typeof createStore>[0]),
    config: {
      baseUrl: GHL_ORIGIN,
      version: GHL_VERSION,
      token: process.env["GHL_PRIVATE_TOKEN"] ?? "",
      locationId: process.env["GHL_LOCATION_ID"] ?? "",
    },
    receiver: runtime,
  });
}

export function observerContact(org: string, locationId: string, contactId: string) {
  return configuredObserver().observerContact(org, locationId, contactId);
}
export function observerPilot(org: string, locationId: string) {
  return configuredObserver().observerPilot(org, locationId);
}
