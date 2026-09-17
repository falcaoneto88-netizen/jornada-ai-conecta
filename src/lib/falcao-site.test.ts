import { describe, expect, it, vi } from "vitest";

import { BLOQUEIO_ACOLHIMENTO, configurarIntegracaoSite, lerEstadoIntegracaoSite } from "./falcao-site.server";

type Resposta = { data: unknown; error: unknown };
type Contagem = { count: number | null; error: unknown };

function contagens(total: Contagem, revisao: Contagem) {
  // select(...) é aguardável (total) e também aceita .eq(...) (em revisão).
  return {
    select: () => {
      const alvo = {
        eq: () => Promise.resolve(revisao),
        then: (r: (v: Contagem) => unknown) => Promise.resolve(total).then(r),
      };
      return alvo;
    },
  };
}

function cliente(opcoes: {
  papel?: boolean;
  rpcConfig?: Resposta;
  integracao?: Record<string, unknown> | null;
  user?: string | null;
  total?: Contagem;
  revisao?: Contagem;
}) {
  const rpc = vi.fn(async (fn: string) =>
    fn === "tem_papel"
      ? { data: opcoes.papel === true, error: null }
      : (opcoes.rpcConfig ?? { data: { configured: true, enabled: true }, error: null }),
  );
  const from = (tabela: string) => {
    if (tabela === "site_lead_submissions") {
      return contagens(
        opcoes.total ?? { count: 3, error: null },
        opcoes.revisao ?? { count: 1, error: null },
      );
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
      getUser: async () => ({
        data: { user: opcoes.user ? { id: opcoes.user } : null },
        error: null,
      }),
    },
  } as never;
}

const destinoOk = async () => ({ ok: true }) as const;
const destinoMau = async () => ({ ok: false, message: "O funil fixo não existe nesta conta do GoHighLevel." }) as const;

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

  it("não guarda nada quando o funil fixo não é confirmado no GoHighLevel", async () => {
    process.env["FALCAO_SITE_SIGNING_SECRET"] = "a".repeat(64);
    const c = cliente({ papel: true, user: "u1" });
    const r = await configurarIntegracaoSite(
      c,
      { confirm: true, enabled: true },
      { validarDestino: destinoMau },
    );
    expect(r.ok).toBe(false);
    expect(r.message).toContain("funil fixo");
    expect((c as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc).not.toHaveBeenCalledWith(
      "configure_site_integration",
      expect.anything(),
    );
    delete process.env["FALCAO_SITE_SIGNING_SECRET"];
  });

  it("recusa quando o destino não pertence à organização", async () => {
    process.env["FALCAO_SITE_SIGNING_SECRET"] = "a".repeat(64);
    const c = cliente({
      papel: true,
      user: "u1",
      rpcConfig: { data: null, error: { code: "42501" } },
    });
    const r = await configurarIntegracaoSite(
      c,
      { confirm: true, enabled: true },
      { validarDestino: destinoOk },
    );
    expect(r.ok).toBe(false);
    delete process.env["FALCAO_SITE_SIGNING_SECRET"];
  });

  it("apresenta as pendências, contagens exatas e nunca revela o segredo", async () => {
    process.env["FALCAO_SITE_SIGNING_SECRET"] = "b".repeat(64);
    const estado = await lerEstadoIntegracaoSite(cliente({ papel: true, user: "u1" }));
    expect(estado.segredoPresente).toBe(true);
    expect(JSON.stringify(estado)).not.toContain("b".repeat(64));
    expect(estado.ativa).toBe(false);
    expect(estado.escritaGhl).toBe("pendente");
    expect(estado.leads).toEqual({ total: 3, emRevisao: 1, erro: false });
    expect(estado.pendencias.join(" ")).toContain("Escrita no GoHighLevel");
    expect(estado.pendencias).toContain(BLOQUEIO_ACOLHIMENTO);
    expect(estado.acolhimento).toContain("{{nome}}");
    delete process.env["FALCAO_SITE_SIGNING_SECRET"];
  });

  it("um erro de leitura não vira contagem zero", async () => {
    const estado = await lerEstadoIntegracaoSite(
      cliente({
        papel: true,
        user: "u1",
        total: { count: null, error: { message: "falha" } },
        revisao: { count: null, error: { message: "falha" } },
      }),
    );
    expect(estado.leads).toEqual({ total: null, emRevisao: null, erro: true });
    expect(estado.pendencias.join(" ")).toContain("contagens");
  });
});
