import { describe, expect, it } from "vitest";

import { avaliarProntidao, type SondaPonte } from "./ad-navigator-prontidao";
import type { EstadoAdNavigator } from "./ad-navigator.server";

const agora = Date.parse("2026-09-21T12:00:00Z");
const sondaOk: SondaPonte = { exchange_ok: true, summary_ok: true, motivo: "ok" };
const estado: EstadoAdNavigator = {
  organization_id: "org",
  organization_name: "Clínica",
  location_id: "loc",
  pipeline_id: "pipe",
  binding_ok: true,
  connection_ok: true,
  scope: "commercial_summary:read",
  pending_pairing: null,
  grants: [],
};
const grant = {
  grant_id: "g1",
  receiver_tenant_id: "r1",
  created_at: "2026-09-20T12:00:00Z",
  expires_at: "2026-09-30T12:00:00Z",
  revoked_at: null,
  last_used_at: null,
  use_count: 0,
  scope: "commercial_summary:read",
};

describe("verificação prévia da ponte", () => {
  it("permite gerar só com vínculo, autenticação e sem pendências", () =>
    expect(avaliarProntidao(estado, sondaOk, agora).podeGerar).toBe(true));

  it("bloqueia quando o caminho autenticado não responde como esperado", () => {
    const r = avaliarProntidao(
      estado,
      { exchange_ok: true, summary_ok: false, motivo: "resposta_inesperada" },
      agora,
    );
    expect(r.podeGerar).toBe(false);
    expect(r.verificacoes.find((v) => v.id === "autenticacao")?.ok).toBe(false);
  });

  it("bloqueia sem vínculo real", () =>
    expect(avaliarProntidao({ ...estado, connection_ok: false }, sondaOk, agora).podeGerar).toBe(
      false,
    ));

  it("bloqueia com código pendente ainda válido", () =>
    expect(
      avaliarProntidao(
        {
          ...estado,
          pending_pairing: {
            pairing_id: "p1",
            created_at: "2026-09-21T11:55:00Z",
            expires_at: "2026-09-21T12:05:00Z",
          },
        },
        sondaOk,
        agora,
      ).podeGerar,
    ).toBe(false));

  it("permite gerar quando o código pendente já expirou", () =>
    expect(
      avaliarProntidao(
        {
          ...estado,
          pending_pairing: {
            pairing_id: "p1",
            created_at: "2026-09-21T11:40:00Z",
            expires_at: "2026-09-21T11:50:00Z",
          },
        },
        sondaOk,
        agora,
      ).podeGerar,
    ).toBe(true));

  it("bloqueia com acesso vigente e liberta depois de revogado", () => {
    expect(avaliarProntidao({ ...estado, grants: [grant] }, sondaOk, agora).podeGerar).toBe(false);
    expect(
      avaliarProntidao(
        { ...estado, grants: [{ ...grant, revoked_at: "2026-09-21T11:00:00Z" }] },
        sondaOk,
        agora,
      ).podeGerar,
    ).toBe(true);
  });

  it("sonda não verificada não autoriza emissão", () =>
    expect(
      avaliarProntidao(
        estado,
        { exchange_ok: false, summary_ok: false, motivo: "nao_verificado" },
        agora,
      ).podeGerar,
    ).toBe(false));
});
