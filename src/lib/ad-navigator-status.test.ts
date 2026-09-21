import { describe, expect, it } from "vitest";
import { estadoConcessao, resumoPareamento } from "./ad-navigator-status";
import type { EstadoAdNavigator } from "./ad-navigator.server";
const agora = Date.parse("2026-09-21T12:00:00Z");
const grant = {
  grant_id: "test",
  receiver_tenant_id: "test",
  created_at: "2026-09-20T12:00:00Z",
  expires_at: "2026-09-22T12:00:00Z",
  revoked_at: null,
  last_used_at: null,
  use_count: 0,
  scope: "commercial_summary:read",
};
const estado: EstadoAdNavigator = {
  organization_id: "test",
  organization_name: "Teste",
  location_id: "test",
  pipeline_id: "test",
  binding_ok: true,
  connection_ok: true,
  scope: grant.scope,
  pending_pairing: null,
  grants: [],
};
describe("evidência do pareamento", () => {
  it("não chama ausência de concessão de conexão", () =>
    expect(resumoPareamento(estado, agora).rotulo).toBe("Aguardando receptor/ativação"));
  it("troca sem leitura não é conexão", () =>
    expect(resumoPareamento({ ...estado, grants: [grant] }, agora).rotulo).toContain(
      "aguardando leitura",
    ));
  it("concessão expirada não é vigente", () => {
    const g = { ...grant, expires_at: "2026-09-21T12:00:00Z" };
    expect(estadoConcessao(g, agora)).toBe("expirado");
    expect(resumoPareamento({ ...estado, grants: [g] }, agora).rotulo).toBe(
      "Aguardando receptor/ativação",
    );
  });
  it("recusa validade inválida", () =>
    expect(estadoConcessao({ ...grant, expires_at: "invalid" }, agora)).toBe("expirado"));
  it("concessão revogada não serve como evidência", () =>
    expect(estadoConcessao({ ...grant, revoked_at: "2026-09-21T10:00:00Z" }, agora)).toBe(
      "revogado",
    ));
  it("leitura não prova persistência no receptor", () => {
    const result = resumoPareamento(
      { ...estado, grants: [{ ...grant, use_count: 1, last_used_at: "2026-09-21T11:00:00Z" }] },
      agora,
    );
    expect(result.rotulo).toBe("Leitura registrada");
    expect(result.detalhe).toContain("ainda precisa ser comprovada");
  });
  it("vínculo inválido prevalece sobre concessão", () =>
    expect(resumoPareamento({ ...estado, binding_ok: false, grants: [grant] }, agora).rotulo).toBe(
      "Vínculo indisponível",
    ));
});
