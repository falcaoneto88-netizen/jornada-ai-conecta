import { describe, expect, it, vi } from "vitest";
import { autorizarRuntime, estadoRuntime, type RuntimeDeps } from "./n8n-bridge-runtime";
import { CONFIG_PADRAO } from "./n8n-bridge.core";
import type { RuntimePolicy } from "./n8n-bridge-runtime.schema";
import { testPilot } from "../../test/n8n-pilot-fixture";

const ORG = "f07ab3be-7419-4779-a901-ef71c5fc27f0";
const NOW = Date.parse("2026-11-16T10:00:00Z");
const START = "2026-11-17T10:00:00Z";
function fixture() {
  const cfg = {
    ...CONFIG_PADRAO,
    bridgeEnabled: true,
    liveSendEnabled: true,
    simulation: false,
    calendarId: "calendar01",
    channel: "whatsapp_zaptos" as const,
    zaptosProviderId: "provider01",
    channelVerified: true,
  };
  const scope = {
    orgId: ORG,
    locationId: "location01",
    writeEnabled: true,
    integracaoConectada: true,
  };
  const policy: RuntimePolicy = {
    organization_id: ORG,
    mode: "production",
    location_id: scope.locationId,
    calendar_id: cfg.calendarId,
    channel: cfg.channel,
    zaptos_provider_id: cfg.zaptosProviderId,
    allowed_kinds: ["booking", "req24", "req12"],
    revision: 1,
    verified_at: "2026-11-16T09:00:00Z",
    updated_at: "2026-11-16T09:00:00Z",
    updated_by: ORG,
  };
  const target = {
    contactId: "contact01",
    appointmentId: "appoint01",
    startTime: START,
    kind: "booking",
  };
  const pilot = vi.fn(testPilot(ORG, target.contactId, target.appointmentId, START));
  const deps: RuntimeDeps = {
    now: () => NOW,
    resolver: async () => scope,
    lerConfig: async () => ({ ok: true, cfg }),
    lerPiloto: pilot,
    lerPoliticaRuntime: async () => ({ ok: true, data: policy }),
  };
  const authorize = () => autorizarRuntime(deps, { ...scope }, { ...cfg }, target);
  return { cfg, scope, policy, target, deps, pilot, authorize };
}

describe("runtime authority", () => {
  it("production authority needs no one-contact pilot but remains scoped", async () => {
    const f = fixture();
    expect(await f.authorize()).toEqual({
      ok: true,
      authority: { mode: "production", revision: 1 },
    });
    expect(f.pilot).not.toHaveBeenCalled();
  });
  it("missing row delegates to existing pilot, never means production", async () => {
    const f = fixture();
    f.deps.lerPoliticaRuntime = async () => ({ ok: true, data: null });
    expect(await f.authorize()).toEqual({ ok: true, authority: { mode: "pilot", revision: 0 } });
    expect(f.pilot).toHaveBeenCalledWith(ORG);
    f.target.contactId = "othercontact01";
    expect(await f.authorize()).toMatchObject({ code: "pilot_not_authorized" });
  });
  it("explicit pilot ignores broad production kinds and still checks the exact grant", async () => {
    const f = fixture();
    f.policy.mode = "pilot";
    f.target.contactId = "othercontact01";
    expect(await f.authorize()).toMatchObject({ code: "pilot_not_authorized" });
  });
  it("off never falls back to an active pilot", async () => {
    const f = fixture();
    f.policy.mode = "off";
    expect(await f.authorize()).toMatchObject({ code: "runtime_disabled" });
    expect(f.pilot).not.toHaveBeenCalled();
  });
  it.each(["missing_reader", "throw", "unavailable", "malformed", "other_org"])(
    "fails closed: %s",
    async (failure) => {
      const f = fixture();
      if (failure === "missing_reader") delete f.deps.lerPoliticaRuntime;
      if (failure === "throw")
        f.deps.lerPoliticaRuntime = async () => {
          throw new Error("offline");
        };
      if (failure === "unavailable") f.deps.lerPoliticaRuntime = async () => ({ ok: false });
      if (failure === "malformed") f.deps.lerPoliticaRuntime = async () => ({ ok: true, data: {} });
      if (failure === "other_org")
        f.policy.organization_id = "12345678-1234-4234-8234-123456789012";
      expect(await f.authorize()).toMatchObject({
        code: "runtime_policy_unavailable",
        status: 503,
      });
      expect(f.pilot).not.toHaveBeenCalled();
    },
  );
  it.each(["location_id", "calendar_id", "zaptos_provider_id"] as const)(
    "refuses changed production scope %s",
    async (field) => {
      const f = fixture();
      f.policy[field] = "otherfield01";
      expect(await f.authorize()).toMatchObject({ code: "runtime_scope_changed" });
    },
  );
  it.each(["confirm", "appointment.confirm", "handoff", "escalation"])(
    "does not promote unsupported %s to production",
    async (kind) => {
      const f = fixture();
      f.target.kind = kind;
      expect(await f.authorize()).toMatchObject({ code: "production_action_not_supported" });
    },
  );
  it("respects kinds subset", async () => {
    const f = fixture();
    f.policy.allowed_kinds = ["req24"];
    expect(await f.authorize()).toMatchObject({ code: "production_not_authorized" });
  });
  it.each(["bridgeEnabled", "liveSendEnabled", "channelVerified"] as const)(
    "never overrides %s",
    async (field) => {
      const f = fixture();
      f.cfg[field] = false;
      expect(await f.authorize()).toMatchObject({ ok: false });
    },
  );
  it("simulation cannot cause a real effect", async () => {
    const f = fixture();
    f.cfg.simulation = true;
    expect(await f.authorize()).toMatchObject({ code: "live_send_disabled" });
  });
  it.each(["writeEnabled", "integracaoConectada"] as const)(
    "respects integration kill switch %s",
    async (field) => {
      const f = fixture();
      f.scope[field] = false;
      expect(await f.authorize()).toMatchObject({ code: "live_send_disabled" });
    },
  );
  it("requires readable binding and configuration", async () => {
    const f = fixture();
    f.deps.resolver = async () => null;
    expect(await f.authorize()).toMatchObject({ code: "binding_unavailable" });
    f.deps.resolver = async () => f.scope;
    f.deps.lerConfig = async () => ({ ok: false });
    expect(await f.authorize()).toMatchObject({ code: "bridge_schema_unavailable" });
  });
  it("compares revision and mode across reservation, never changes authority mid-flight", async () => {
    const f = fixture();
    const first = await f.authorize();
    if (!first.ok) throw new Error("fixture");
    f.policy.revision++;
    expect(await autorizarRuntime(f.deps, f.scope, f.cfg, f.target, first.authority)).toMatchObject(
      { code: "runtime_policy_changed" },
    );
    f.policy.revision = 1;
    f.policy.mode = "pilot";
    expect(await autorizarRuntime(f.deps, f.scope, f.cfg, f.target, first.authority)).toMatchObject(
      { code: "runtime_policy_changed" },
    );
  });
  it("checks fresh scope and config even without a changed revision", async () => {
    const f = fixture();
    const scope = { ...f.scope },
      cfg = { ...f.cfg };
    f.cfg.zaptosProviderId = "anotherprovider01";
    expect(await autorizarRuntime(f.deps, scope, cfg, f.target)).toMatchObject({
      code: "runtime_configuration_changed",
    });
    f.scope.locationId = "anotherlocation01";
    expect(await autorizarRuntime(f.deps, scope, cfg, f.target)).toMatchObject({
      code: "runtime_scope_changed",
    });
  });
  it("health distinguishes unavailable schema from an absent row", async () => {
    const f = fixture();
    f.deps.lerPoliticaRuntime = async () => ({ ok: false });
    expect(await estadoRuntime(f.deps, ORG)).toMatchObject({
      available: false,
      mode: "pilot",
      revision: 0,
    });
    f.deps.lerPoliticaRuntime = async () => ({ ok: true, data: null });
    expect(await estadoRuntime(f.deps, ORG)).toMatchObject({
      available: true,
      mode: "pilot",
      revision: 0,
    });
  });
});
