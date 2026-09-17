/**
 * Testes do acolhimento com duplos: nenhum contacto real e nenhuma chamada
 * verdadeira ao GoHighLevel.
 */
import { describe, expect, it, vi } from "vitest";

import {
  montarAcolhimento,
  processarAcolhimento,
  type DepsAcolhimento,
  type PedidoAcolhimento,
} from "./falcao-welcome.core";

const pedido: PedidoAcolhimento = {
  submission_id: "11111111-1111-4111-8111-111111111111",
  organization_id: "22222222-2222-4222-8222-222222222222",
  ghl_contact_id: "ghlC1",
  first_name: "Ana",
  consent_version: "2026-09-17.contact.v1",
};

function deps(over: Partial<DepsAcolhimento> = {}) {
  const concluir = vi.fn(async () => undefined);
  const enviar = vi.fn(async () => ({
    ok: true as const,
    data: { messageId: "m-1", status: "accepted" },
  }));
  const base: DepsAcolhimento = {
    estadoContacto: async () => ({
      ok: true,
      data: { id: "ghlC1", dnd: false, canaisBloqueados: [] },
    }),
    enviar,
    concluir,
    ...over,
  };
  return { deps: base, enviar: (over.enviar ?? enviar) as ReturnType<typeof vi.fn>, concluir };
}

describe("texto do acolhimento", () => {
  it("é neutro, sem interesses clínicos, e trata nome em falta", () => {
    expect(montarAcolhimento("Ana")).toContain("Olá, Ana!");
    expect(montarAcolhimento(null)).not.toContain("{{nome}}");
    expect(montarAcolhimento("Ana").toLowerCase()).not.toMatch(
      /consulta|tratamento|peso|clínic|preço/,
    );
  });
});

describe("envio do acolhimento", () => {
  it("envia uma única vez e não declara entrega", async () => {
    const { deps: d, enviar, concluir } = deps();
    const r = await processarAcolhimento(pedido, d);
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ estado: "enviado", messageId: "m-1", entregue: false });
    expect(concluir).toHaveBeenCalledWith(
      expect.objectContaining({ estado: "enviado", messageId: "m-1" }),
    );
  });

  it("não envia quando o contacto tem DND", async () => {
    const { deps: d, enviar } = deps({
      estadoContacto: async () => ({
        ok: true,
        data: { id: "ghlC1", dnd: true, canaisBloqueados: [] },
      }),
    });
    const r = await processarAcolhimento(pedido, d);
    expect(enviar).not.toHaveBeenCalled();
    expect(r).toMatchObject({ estado: "bloqueado", motivo: "dnd_ou_opt_out" });
  });

  it("não envia quando o canal está em opt-out", async () => {
    const { deps: d, enviar } = deps({
      estadoContacto: async () => ({
        ok: true,
        data: { id: "ghlC1", dnd: false, canaisBloqueados: ["SMS"] },
      }),
    });
    const r = await processarAcolhimento(pedido, d);
    expect(enviar).not.toHaveBeenCalled();
    expect(r.estado).toBe("bloqueado");
  });

  it("resultado incerto bloqueia e nunca repete", async () => {
    const enviar = vi.fn(async () => ({
      ok: false as const,
      code: "outcome_unknown",
      message: "sem confirmação",
    }));
    const { deps: d } = deps({ enviar });
    const r = await processarAcolhimento(pedido, d);
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ estado: "bloqueado", motivo: "envio_incerto" });
  });

  it("aceitação sem identificador não conta como envio", async () => {
    const { deps: d } = deps({
      enviar: (async () => ({ ok: true, data: { messageId: null, status: "queued" } })) as never,
    });
    const r = await processarAcolhimento(pedido, d);
    expect(r).toMatchObject({ estado: "bloqueado", motivo: "envio_sem_identificador" });
  });

  it("contacto diferente do reservado bloqueia antes de enviar", async () => {
    const { deps: d, enviar } = deps({
      estadoContacto: async () => ({
        ok: true,
        data: { id: "outro", dnd: false, canaisBloqueados: [] },
      }),
    });
    const r = await processarAcolhimento(pedido, d);
    expect(enviar).not.toHaveBeenCalled();
    expect(r.motivo).toBe("contacto_nao_corresponde");
  });
});
