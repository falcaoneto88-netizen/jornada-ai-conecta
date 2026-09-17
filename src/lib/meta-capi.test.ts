import { describe, expect, it, vi } from "vitest";

import {
  META_DATASET_ID,
  META_EVENT_SOURCE_URL,
  META_TEST_IP,
  codigoTesteValido,
  construirEventoTeste,
  idEventoTeste,
  interpretarRespostaMeta,
  sanitizarDiagnostico,
  urlEventosMeta,
} from "./meta-capi.core";
import { estadoCredencialMeta, testarMetaCapi, type DepsTesteMeta } from "./meta-capi.server";

const PEDIDO = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const TOKEN = "A".repeat(64);
const CODIGO = "TEST53467";

function cliente(reserva: { data: unknown; error: unknown }) {
  const rpc = vi.fn(async () => reserva);
  return { rpc } as unknown as Parameters<typeof testarMetaCapi>[0] & { rpc: typeof rpc };
}

function deps(extra: Partial<DepsTesteMeta> = {}): DepsTesteMeta {
  return {
    lerToken: () => TOKEN,
    novoRequestId: () => PEDIDO,
    agora: () => new Date("2026-09-18T10:00:00.000Z"),
    hash: (v) => `sha(${v})`,
    enviar: vi.fn(async () => ({ httpStatus: 200, corpo: { events_received: 1, fbtrace_id: "Abc123" }, redirecionado: false })),
    finalizar: vi.fn(async () => true),
    ...extra,
  };
}

describe("contrato do evento de teste", () => {
  it("constrói exatamente um PageView sintético no domínio autorizado", () => {
    const evento = construirEventoTeste({
      eventId: idEventoTeste(PEDIDO),
      eventTimeSegundos: 1789000000,
      externalIdHash: "abc",
      testEventCode: CODIGO,
    });
    expect(evento).toEqual({
      data: [
        {
          event_name: "PageView",
          event_time: 1789000000,
          event_id: `jornada-capi-teste-${PEDIDO}`,
          action_source: "website",
          event_source_url: META_EVENT_SOURCE_URL,
          user_data: {
            external_id: "abc",
            client_ip_address: META_TEST_IP,
            client_user_agent: expect.stringContaining("JornadaAI-CAPI-Test") as unknown as string,
          },
        },
      ],
      test_event_code: CODIGO,
    });
    expect(META_EVENT_SOURCE_URL.endsWith("chatgpt.site")).toBe(true);
  });

  it("usa o endpoint oficial sem token no URL", () => {
    expect(urlEventosMeta()).toBe(`https://graph.facebook.com/v26.0/${META_DATASET_ID}/events`);
    expect(urlEventosMeta()).not.toContain("access_token");
  });

  it("valida o formato do código de teste", () => {
    expect(codigoTesteValido(CODIGO)).toBe(true);
    expect(codigoTesteValido("test53467")).toBe(false);
    expect(codigoTesteValido("")).toBe(false);
    expect(codigoTesteValido(null)).toBe(false);
  });

  it("sanitiza diagnósticos com aparência de credencial", () => {
    expect(sanitizarDiagnostico("erro access_token=EAAB123456789012345 fim")).not.toContain(
      "EAAB123456789012345",
    );
    expect(sanitizarDiagnostico(`ruido ${"Z".repeat(60)}`)).not.toContain("Z".repeat(60));
  });
});

describe("leitura da resposta", () => {
  it("só aceita 2xx com events_received igual a 1", () => {
    expect(interpretarRespostaMeta({ httpStatus: 200, corpo: { events_received: 1 } }).status).toBe(
      "api_accepted",
    );
  });

  it("corpo vazio, sem campos ou incoerente fica por confirmar", () => {
    expect(interpretarRespostaMeta({ httpStatus: 200, corpo: {} }).status).toBe("uncertain");
    expect(interpretarRespostaMeta({ httpStatus: 200, corpo: null }).status).toBe("uncertain");
    expect(interpretarRespostaMeta({ httpStatus: 200, corpo: { events_received: 2 } }).status).toBe(
      "uncertain",
    );
    expect(
      interpretarRespostaMeta({ httpStatus: 200, corpo: { events_received: 1 }, redirecionado: true })
        .status,
    ).toBe("uncertain");
  });

  it("erro HTTP é recusa com diagnóstico sanitizado", () => {
    const r = interpretarRespostaMeta({
      httpStatus: 400,
      corpo: { error: { message: "Invalid access_token=EAAB1234567890123456" }, fbtrace_id: "Xy1" },
    });
    expect(r.status).toBe("rejected");
    expect(r.fbtraceId).toBe("Xy1");
    expect(r.diagnostico).not.toContain("EAAB1234567890123456");
  });
});

describe("credencial", () => {
  it("distingue ausente, malformada e presente sem revelar valor", () => {
    expect(estadoCredencialMeta(() => null)).toBe("ausente");
    expect(estadoCredencialMeta(() => "curto")).toBe("malformada");
    expect(estadoCredencialMeta(() => TOKEN)).toBe("presente");
  });
});

describe("execução do teste", () => {
  const reservaOk = { data: { attempt_id: "11111111-1111-4111-8111-111111111111" }, error: null };

  it("regista aceitação com um único pedido e sem repetição", async () => {
    const d = deps();
    const c = cliente(reservaOk);
    const r = await testarMetaCapi(c, { confirm: true, testEventCode: CODIGO }, d);
    expect(r.ok).toBe(true);
    expect(r.estado).toBe("api_accepted");
    expect(d.enviar).toHaveBeenCalledTimes(1);
    const corpo = (d.enviar as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as URLSearchParams;
    expect(corpo.get("test_event_code")).toBe(CODIGO);
    expect(corpo.get("access_token")).toBe(TOKEN);
    expect(JSON.parse(corpo.get("data") ?? "[]")).toHaveLength(1);
  });

  it("sem confirmação, com código inválido ou sem credencial não chama a Meta", async () => {
    for (const [entrada, d] of [
      [{ confirm: false, testEventCode: CODIGO }, deps()],
      [{ confirm: true, testEventCode: "abc" }, deps()],
      [{ confirm: true, testEventCode: CODIGO }, deps({ lerToken: () => null })],
      [{ confirm: true, testEventCode: CODIGO }, deps({ lerToken: () => "curto" })],
    ] as const) {
      const c = cliente(reservaOk);
      const r = await testarMetaCapi(c, entrada, d);
      expect(r.ok).toBe(false);
      expect(r.estado).toBe("nao_iniciado");
      expect(d.enviar).not.toHaveBeenCalled();
      expect(c.rpc).not.toHaveBeenCalled();
    }
  });

  it("reserva recusada (não administrador, outra organização ou código repetido) não chama a Meta", async () => {
    const d = deps();
    const c = cliente({ data: null, error: { message: "permission denied" } });
    const r = await testarMetaCapi(c, { confirm: true, testEventCode: CODIGO }, d);
    expect(r.ok).toBe(false);
    expect(r.estado).toBe("nao_iniciado");
    expect(d.enviar).not.toHaveBeenCalled();
  });

  it("tempo limite ou falha de rede fica incerto, sem nova tentativa", async () => {
    const enviar = vi.fn(async () => {
      throw new Error("The operation was aborted");
    });
    const d = deps({ enviar });
    const r = await testarMetaCapi(cliente(reservaOk), { confirm: true, testEventCode: CODIGO }, d);
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(r.estado).toBe("uncertain");
    expect(r.ok).toBe(false);
  });

  it("corpo malformado nunca é sucesso", async () => {
    const d = deps({
      enviar: vi.fn(async () => ({ httpStatus: 200, corpo: {}, redirecionado: false })),
    });
    const r = await testarMetaCapi(cliente(reservaOk), { confirm: true, testEventCode: CODIGO }, d);
    expect(r.ok).toBe(false);
    expect(r.estado).toBe("uncertain");
  });

  it("falha ao gravar o resultado obriga a revisão", async () => {
    const d = deps({ finalizar: vi.fn(async () => false) });
    const r = await testarMetaCapi(cliente(reservaOk), { confirm: true, testEventCode: CODIGO }, d);
    expect(r.ok).toBe(false);
    expect(r.estado).toBe("uncertain");
    expect(r.message).toContain("por confirmar");
  });
});
