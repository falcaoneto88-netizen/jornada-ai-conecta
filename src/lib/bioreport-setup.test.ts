import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { configureBioreport } from "./bioreport-setup.server";

const config = {
  secret: "c".repeat(64),
  keyId: "unit-test",
  locationId: "location-test",
  organizationId: "f07ab3be-7419-4779-a901-ef71c5fc27f0",
};
function setup(options: { authenticated?: boolean; admin?: boolean; failure?: boolean } = {}) {
  const getUser = vi.fn().mockResolvedValue({
    data: { user: options.authenticated === false ? null : { id: "admin" } },
    error: null,
  });
  const rpc = vi.fn().mockImplementation(async (name: string) =>
    name === "tem_papel"
      ? { data: options.admin !== false, error: null }
      : {
          data: { configured: true },
          error: options.failure ? { message: config.secret } : null,
        },
  );
  const readConfig = vi.fn(() => config);
  return {
    client: { auth: { getUser }, rpc } as unknown as SupabaseClient,
    getUser,
    rpc,
    readConfig,
  };
}
describe("cadastro privado da integração", () => {
  it("exige confirmação antes de qualquer operação", async () => {
    const m = setup();
    expect((await configureBioreport(m.client, false, m.readConfig)).ok).toBe(false);
    expect(m.getUser).not.toHaveBeenCalled();
    expect(m.readConfig).not.toHaveBeenCalled();
  });
  it("não lê secrets nem consulta o banco com sessão expirada", async () => {
    const m = setup({ authenticated: false });
    expect((await configureBioreport(m.client, true, m.readConfig)).message).toContain(
      "Sessão expirada",
    );
    expect(m.rpc).not.toHaveBeenCalled();
    expect(m.readConfig).not.toHaveBeenCalled();
  });
  it("recusa não administrador antes de ler a chave", async () => {
    const m = setup({ admin: false });
    expect((await configureBioreport(m.client, true, m.readConfig)).ok).toBe(false);
    expect(m.rpc).toHaveBeenCalledTimes(1);
    expect(m.readConfig).not.toHaveBeenCalled();
  });
  it("recusa configuração malformada antes de cadastrar", async () => {
    const m = setup();
    expect(
      (await configureBioreport(m.client, true, () => ({ ...config, secret: "invalid" }))).ok,
    ).toBe(false);
    expect(m.rpc).toHaveBeenCalledTimes(1);
  });
  it("retorna somente confirmação, nunca o segredo", async () => {
    const m = setup();
    const result = await configureBioreport(m.client, true, m.readConfig);
    expect(result.ok).toBe(true);
    expect(m.rpc.mock.calls[1]).toEqual([
      "configure_bioreport_integration",
      {
        _organization_id: config.organizationId,
        _key_id: config.keyId,
        _secret: config.secret,
        _location_id: config.locationId,
        _confirm: true,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain(config.secret);
  });
  it("sanitiza erros retornados pelo banco", async () => {
    const m = setup({ failure: true });
    const result = await configureBioreport(m.client, true, m.readConfig);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(config.secret);
  });
  it("sanitiza também exceções", async () => {
    const m = setup();
    const result = await configureBioreport(m.client, true, () => {
      throw new Error(config.secret);
    });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(config.secret);
  });
});
