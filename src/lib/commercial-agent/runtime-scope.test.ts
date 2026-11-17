import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  generator: vi.fn(),
  query: vi.fn(),
  single: vi.fn(),
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: mocks.query },
}));
vi.mock("../ghl.functions", () => ({ resolverAcesso: mocks.access }));
vi.mock("./providers.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./providers.server")>()),
  configuredGenerator: mocks.generator,
}));
import { authenticatedAgent, resolveAgentLocation } from "./runtime.server";

const ctx = { supabase: {} as SupabaseClient, userId: "synthetic-actor" };
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("GHL_LOCATION_ID", "synthetic-location");
  vi.stubEnv("COMMERCIAL_AGENT_ENCRYPTION_KEY", Buffer.alloc(32, 1).toString("base64"));
  mocks.generator.mockReturnValue(vi.fn());
  mocks.query.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: mocks.single }) }) });
  mocks.single.mockResolvedValue({ data: { organization_id: "bound-org" }, error: null });
  mocks.access.mockResolvedValue({
    ok: true,
    acesso: {
      orgId: "session-org",
      locationId: "synthetic-location",
      conn: { write_enabled: true },
    },
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("escopo de geração derivado pelo servidor", () => {
  it("passa a organização e location autorizadas ao gerador", async () => {
    const result = await authenticatedAgent(ctx, "session-org");
    expect(mocks.access).toHaveBeenCalledWith(ctx, ["administrador", "gestor", "comercial"]);
    expect(mocks.generator).toHaveBeenCalledWith(process.env, fetch, {
      organizationId: "session-org",
      locationId: "synthetic-location",
    });
    expect(result.actor).toBe("synthetic-actor");
    expect(result.writeEnabled).toBe(true);
  });

  it("não usa uma organização alegada pelo solicitante", async () => {
    await expect(authenticatedAgent(ctx, "forged-org")).rejects.toThrow("forbidden");
    expect(mocks.generator).not.toHaveBeenCalled();
  });

  it("não constrói gerador quando o acesso é negado ou a location difere da configuração", async () => {
    mocks.access.mockResolvedValueOnce({ ok: false });
    await expect(authenticatedAgent(ctx, "session-org")).rejects.toThrow("forbidden");
    mocks.access.mockResolvedValueOnce({
      ok: true,
      acesso: { orgId: "session-org", locationId: "foreign-location" },
    });
    await expect(authenticatedAgent(ctx, "session-org")).rejects.toThrow("scope_mismatch");
    expect(mocks.generator).not.toHaveBeenCalled();
  });

  it("webhook/worker resolvem organização pelo vínculo persistido e falham sem vínculo", async () => {
    expect(await resolveAgentLocation("synthetic-location")).toBe("bound-org");
    expect(mocks.query).toHaveBeenCalledWith("ghl_location_bindings");
    mocks.single.mockResolvedValueOnce({ data: null, error: null });
    await expect(resolveAgentLocation("synthetic-location")).rejects.toThrow("scope_mismatch");
    await expect(resolveAgentLocation("foreign-location")).rejects.toThrow("scope_mismatch");
    expect(mocks.single).toHaveBeenCalledTimes(2);
  });
});
