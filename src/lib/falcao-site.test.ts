import { describe, expect, it, vi } from "vitest";

import { configurarIntegracaoSite, lerEstadoIntegracaoSite } from "./falcao-site.server";

type Resposta = { data: unknown; error: unknown };

function cliente(opcoes: {
  papel?: boolean;
  rpcConfig?: Resposta;
  integracao?: Record<string, unknown> | null;
  user?: string | null;
}) {
  const rpc = vi.fn(async (fn: string) =>
    fn === "tem_papel"
      ? { data: opcoes.papel === true, error: null }
      : (opcoes.rpcConfig ?? { data: { configured: true, enabled: true }, error: null }),
  );
  const from = (tabela: string) => {
    if (tabela === "site_lead_submissions") {
      return { select: () => ({ limit: async () => ({ data: [], error: null }) }) };
    }
    if (tabela === "profiles") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: opcoes.user ? { organization_id: "f07ab3be-7419-4779-a901-ef71c5fc27f0" } : null,
              error: null,
            }),
          }),
        }),
      };
    }
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: opcoes.integracao ?? null, error: null }),
        }),
      }),
    };
  };
  return {
    rpc,
    from,
    auth: {
      getUser: async () => ({ data: { user: opcoes.user ? { id: opcoes.user } : null }, error: null }),
    },
  } as never;
}

describe("configuração da integração Experiência Falcão", () => {
  it("recusa quem não é administrador", async () => {
    const c = cliente({ papel: false, user: "u1" });
    const r = await configurarIntegracaoSite(c, { confirm: true, enabled: true });
    expect(r).toEqual({ ok: false, message: "Acesso restrito a administradores." });
  });

  it("exige confirmação explícita", async () => {
    const c = cliente({ papel: true, user: "u1" });
    const r = await configurarIntegracaoSite(c, { confirm: false, enabled: true });
    expect(r.ok).toBe(false);
  });

  it("não liga sem o segredo do site no servidor", async () => {
    delete process.env["FALCAO_SITE_SIGNING_SECRET"];
    const c = cliente({ papel: true, user: "u1" });
    const r = await configurarIntegracaoSite(c, { confirm: true, enabled: true });
    expect(r.ok).toBe(false);
    expect(r.message).toContain("FALCAO_SITE_SIGNING_SECRET");
  });

  it("recusa quando o destino não pertence à organização", async () => {
    process.env["FALCAO_SITE_SIGNING_SECRET"] = "a".repeat(64);
    const c = cliente({
      papel: true,
      user: "u1",
      rpcConfig: { data: null, error: { code: "42501" } },
    });
    const r = await configurarIntegracaoSite(c, { confirm: true, enabled: true });
    expect(r.ok).toBe(false);
    delete process.env["FALCAO_SITE_SIGNING_SECRET"];
  });

  it("apresenta as pendências e nunca revela o segredo", async () => {
    process.env["FALCAO_SITE_SIGNING_SECRET"] = "b".repeat(64);
    const estado = await lerEstadoIntegracaoSite(cliente({ papel: true, user: "u1" }));
    expect(estado.segredoPresente).toBe(true);
    expect(JSON.stringify(estado)).not.toContain("b".repeat(64));
    expect(estado.ativa).toBe(false);
    expect(estado.escritaGhl).toBe("pendente");
    expect(estado.pendencias.join(" ")).toContain("Escrita no GoHighLevel");
    expect(estado.acolhimento).toContain("responda SAIR");
    delete process.env["FALCAO_SITE_SIGNING_SECRET"];
  });
});
