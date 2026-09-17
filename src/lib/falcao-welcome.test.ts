/**
 * Testes do acolhimento com duplos: nenhum contacto real e nenhuma chamada
 * verdadeira ao GoHighLevel.
 */
import { describe, expect, it, vi } from "vitest";

import {
  montarAcolhimento,
  processarAcolhimento,
  type DepsAcolhimento,
  type EstadoContactoRemoto,
  type PedidoAcolhimento,
} from "./falcao-welcome.core";
import { reciboAcolhimentoValido } from "./falcao-welcome.server";

const pedido: PedidoAcolhimento = {
  submission_id: "11111111-1111-4111-8111-111111111111",
  organization_id: "22222222-2222-4222-8222-222222222222",
  location_id: "loc",
  ghl_contact_id: "ghlC1",
  first_name: "Ana",
  phone_normalized: "351900000000",
  email: null,
  consent_version: "2026-09-17.contact.v1",
};

const estado = (p: Partial<EstadoContactoRemoto> = {}): EstadoContactoRemoto => ({
  id: "ghlC1",
  locationId: "loc",
  phone: "+351900000000",
  email: null,
  dnd: false,
  canaisBloqueados: [],
  ...p,
});

function deps(over: Partial<DepsAcolhimento> = {}) {
  const concluir = vi.fn(async () => ({ ok: true }));
  const enviar = vi.fn(async () => ({
    ok: true as const,
    data: { messageId: "m-1", status: "accepted" },
  }));
  const base: DepsAcolhimento = {
    estadoContacto: async () => ({ ok: true, data: estado() }),
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
      estadoContacto: async () => ({ ok: true, data: estado({ dnd: true }) }),
    });
    const r = await processarAcolhimento(pedido, d);
    expect(enviar).not.toHaveBeenCalled();
    expect(r).toMatchObject({ estado: "bloqueado", motivo: "dnd_ou_opt_out" });
  });

  it("não envia quando o canal está em opt-out", async () => {
    const { deps: d, enviar } = deps({
      estadoContacto: async () => ({ ok: true, data: estado({ canaisBloqueados: ["SMS"] }) }),
    });
    const r = await processarAcolhimento(pedido, d);
    expect(enviar).not.toHaveBeenCalled();
    expect(r.estado).toBe("bloqueado");
  });

  it("não envia para telefone diferente do consentido", async () => {
    const { deps: d, enviar } = deps({
      estadoContacto: async () => ({ ok: true, data: estado({ phone: "+351911111111" }) }),
    });
    const r = await processarAcolhimento(pedido, d);
    expect(enviar).not.toHaveBeenCalled();
    expect(r.motivo).toBe("identidade_nao_exata");
  });

  it("não envia para contacto de outra location", async () => {
    const { deps: d, enviar } = deps({
      estadoContacto: async () => ({ ok: true, data: estado({ locationId: "outra" }) }),
    });
    const r = await processarAcolhimento(pedido, d);
    expect(enviar).not.toHaveBeenCalled();
    expect(r.motivo).toBe("contacto_de_outra_location");
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
      estadoContacto: async () => ({ ok: true, data: estado({ id: "outro" }) }),
    });
    const r = await processarAcolhimento(pedido, d);
    expect(enviar).not.toHaveBeenCalled();
    expect(r.motivo).toBe("contacto_nao_corresponde");
  });

  it("falha de gravação depois da aceitação fica por reconciliar", async () => {
    const { deps: d } = deps({ concluir: async () => ({ ok: false }) });
    const r = await processarAcolhimento(pedido, d);
    expect(r.estado).toBe("pendente_reconciliacao");
    expect(r.entregue).toBe(false);
  });
});

describe("validação do recibo do acolhimento", () => {
  it("recusa recibo vazio, sem persistência ou com entrega declarada", () => {
    const esperado = {
      submissionId: pedido.submission_id,
      estado: "enviado" as const,
      messageId: "m-1",
    };
    expect(reciboAcolhimentoValido({}, esperado)).toBe(false);
    expect(
      reciboAcolhimentoValido(
        { submission_id: pedido.submission_id, welcome_state: "enviado", persisted: false },
        esperado,
      ),
    ).toBe(false);
    expect(
      reciboAcolhimentoValido(
        {
          submission_id: pedido.submission_id,
          welcome_state: "enviado",
          persisted: true,
          delivered: true,
          welcome_message_id: "m-1",
        },
        esperado,
      ),
    ).toBe(false);
    expect(
      reciboAcolhimentoValido(
        {
          submission_id: pedido.submission_id,
          welcome_state: "enviado",
          persisted: true,
          delivered: false,
          welcome_message_id: "m-1",
        },
        esperado,
      ),
    ).toBe(true);
  });
});
