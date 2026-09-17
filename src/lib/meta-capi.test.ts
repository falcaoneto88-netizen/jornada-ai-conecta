import { describe, expect, it, vi } from "vitest";

import {
  DIAGNOSTICO_ERRO_EM_2XX,
  DIAGNOSTICO_REDE,
  META_DATASET_ID,
  META_EVENT_SOURCE_URL,
  META_TEST_IP,
  codigoTesteValido,
  construirEventoTeste,
  diagnosticoEstruturado,
  idEventoTeste,
  interpretarRespostaMeta,
  redigirToken,
  urlEventosMeta,
} from "./meta-capi.core";
import {
  autorizarMetaCapi,
  estadoCredencialMeta,
  lerEstadoMetaCapi,
  testarMetaCapi,
  type CtxMeta,
  type DepsTesteMeta,
} from "./meta-capi.server";

const PEDIDO = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const TOKEN = "A".repeat(64);
const CODIGO = "TEST53467";
const UID = "1a111111-1111-4111-8111-111111111111";
const ORG = "0a111111-1111-4111-8111-111111111111";
const ATTEMPT = "11111111-1111-4111-8111-111111111111";
const LOCATION = "ok2UHC2QMZsd8UHsAgEa";

type Cenario = {
  uid?: string | null;
  admin?: boolean;
  org?: string | null;
  integracao?: { id?: string; ghl_location_id?: string } | null;
  binding?: string | null;
  reserva?: { data: unknown; error: unknown };
  tentativas?: { data: unknown; error: unknown };
};

function contexto(c: Cenario = {}) {
  const rpc = vi.fn(async (fn: string) =>
    fn === "tem_papel"
      ? { data: c.admin !== false, error: null }
      : (c.reserva ?? { data: { attempt_id: ATTEMPT }, error: null }),
  );
  const from = (tabela: string) => {
    if (tabela === "meta_capi_test_attempts") {
      const resultado = c.tentativas ?? { data: [], error: null };
      const alvo = {
        select: () => alvo,
        eq: () => alvo,
        order: () => alvo,
        limit: () => Promise.resolve(resultado),
      };
      return alvo;
    }
    const resposta =
      tabela === "profiles"
        ? { data: c.org === null ? null : { organization_id: c.org ?? ORG }, error: null }
        : {
            data:
              c.integracao === null
                ? null
                : (c.integracao ?? { id: "int-1", ghl_location_id: LOCATION }),
            error: null,
          };
    const alvo = {
      select: () => alvo,
      eq: () => alvo,
      maybeSingle: () => Promise.resolve(resposta),
    };
    return alvo;
  };
  const supabase = {
    rpc,
    from,
    auth: {
      getUser: async () => ({
        data: { user: c.uid === null ? null : { id: c.uid ?? UID } },
        error: null,
      }),
    },
  } as unknown as CtxMeta["supabase"];
  return { ctx: { supabase, userId: UID } as CtxMeta, rpc };
}

function deps(extra: Partial<DepsTesteMeta> = {}, binding: string | null = LOCATION): DepsTesteMeta {
  return {
    lerBinding: async () => binding,
    lerToken: () => TOKEN,
    novoRequestId: () => PEDIDO,
    agora: () => new Date("2026-09-18T10:00:00.000Z"),
    hash: (v) => `sha(${v})`,
    enviar: vi.fn(async () => ({
      httpStatus: 200,
      corpo: { events_received: 1, fbtrace_id: "Abc123" },
      redirecionado: false,
    })),
    finalizar: vi.fn(async (e) => ({
      persisted: true,
      attempt_id: e.attemptId,
      status: e.status,
      events_received: e.eventsReceived,
    })),
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
});

describe("diagnóstico", () => {
  it("guarda só campos técnicos, nunca mensagens", () => {
    const d = diagnosticoEstruturado({
      httpStatus: 400,
      erro: { code: 190, error_subcode: 33, is_transient: false, message: `token ${TOKEN}` },
    });
    expect(d).toBe("http=400 code=190 subcode=33 transient=nao");
    expect(d).not.toContain(TOKEN);
    expect(d).not.toContain("token");
  });

  it("redige o token exato quando algum texto tiver de ser guardado", () => {
    expect(redigirToken(`erro com ${TOKEN} no fim`, TOKEN)).toBe("erro com [oculto] no fim");
    // Um token curto e com pontos também é redigido por igualdade exata.
    expect(redigirToken("erro abc.def", "abc.def")).toBe("erro [oculto]");
  });
});

describe("leitura da resposta", () => {
  it("só aceita 2xx sem erro e com events_received igual a 1", () => {
    expect(interpretarRespostaMeta({ httpStatus: 200, corpo: { events_received: 1 } }).status).toBe(
      "api_accepted",
    );
  });

  it("corpo 2xx com objeto error nunca é aceitação", () => {
    const r = interpretarRespostaMeta({
      httpStatus: 200,
      corpo: { events_received: 1, error: { code: 100, error_subcode: 2, is_transient: true } },
    });
    expect(r.status).toBe("rejected");
    expect(r.diagnostico).toContain(DIAGNOSTICO_ERRO_EM_2XX);
    expect(r.diagnostico).toContain("code=100");
  });

  it("5xx fica por confirmar e 4xx é recusa", () => {
    expect(interpretarRespostaMeta({ httpStatus: 503, corpo: null }).status).toBe("uncertain");
    expect(interpretarRespostaMeta({ httpStatus: 400, corpo: null }).status).toBe("rejected");
  });

  it("corpo vazio, incoerente ou redirecionado fica por confirmar", () => {
    expect(interpretarRespostaMeta({ httpStatus: 200, corpo: {} }).status).toBe("uncertain");
    expect(interpretarRespostaMeta({ httpStatus: 200, corpo: null }).status).toBe("uncertain");
    expect(interpretarRespostaMeta({ httpStatus: 200, corpo: { events_received: 2 } }).status).toBe(
      "uncertain",
    );
    expect(
      interpretarRespostaMeta({
        httpStatus: 200,
        corpo: { events_received: 1 },
        redirecionado: true,
      }).status,
    ).toBe("uncertain");
  });

  it("aceita o fbtrace_id também dentro de error e recusa formatos inválidos", () => {
    expect(
      interpretarRespostaMeta({ httpStatus: 400, corpo: { error: { fbtrace_id: "Xy1" } } }).fbtraceId,
    ).toBe("Xy1");
    expect(
      interpretarRespostaMeta({ httpStatus: 400, corpo: { fbtrace_id: "com espaço" } }).fbtraceId,
    ).toBeNull();
  });
});

describe("autorização", () => {
  it("aceita o administrador da organização com integração e vínculo", async () => {
    const { ctx } = contexto();
    await expect(autorizarMetaCapi(ctx, { lerBinding: async () => LOCATION })).resolves.toMatchObject(
      { ok: true, orgId: ORG },
    );
  });

  it("recusa sem sessão, sem papel, sem integração, com outra location ou sem vínculo", async () => {
    const casos: [Cenario, string | null][] = [
      [{ uid: null }, LOCATION],
      [{ uid: "outro-utilizador" }, LOCATION],
      [{ admin: false }, LOCATION],
      [{ org: null }, LOCATION],
      [{ integracao: null }, LOCATION],
      [{ integracao: { id: "int-1", ghl_location_id: "outra" } }, LOCATION],
      [{}, null],
      [{}, "outra-location"],
    ];
    for (const [cenario, binding] of casos) {
      const { ctx } = contexto(cenario);
      const r = await autorizarMetaCapi(ctx, { lerBinding: async () => binding });
      expect(r.ok, JSON.stringify(cenario)).toBe(false);
    }
  });

  it("a quem não está autorizado não revela nada sobre a credencial", async () => {
    const { ctx } = contexto({ admin: false });
    const estado = await lerEstadoMetaCapi(ctx, {
      lerBinding: async () => LOCATION,
      lerToken: () => TOKEN,
    });
    expect(estado.autorizado).toBe(false);
    expect(estado.credencial).toBeNull();
    expect(estado.leituraOk).toBe(false);
  });

  it("um não administrador não chega à reserva nem à Meta", async () => {
    const d = deps();
    const { ctx, rpc } = contexto({ admin: false });
    const r = await testarMetaCapi(ctx, { confirm: true, testEventCode: CODIGO }, d);
    expect(r.ok).toBe(false);
    expect(d.enviar).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalledWith("meta_capi_test_reserve", expect.anything());
  });
});

describe("leitura de estado", () => {
  it("erro de leitura marca estado indisponível sem inventar ausência de tentativas", async () => {
    const { ctx } = contexto({ tentativas: { data: null, error: { message: "erro" } } });
    const estado = await lerEstadoMetaCapi(ctx, {
      lerBinding: async () => LOCATION,
      lerToken: () => TOKEN,
    });
    expect(estado.autorizado).toBe(true);
    expect(estado.leituraOk).toBe(false);
    expect(estado.ultimaTentativa).toBeNull();
    expect(estado.codigosUsados).toEqual([]);
  });

  it("devolve a última tentativa, o identificador do evento e os códigos já usados", async () => {
    const { ctx } = contexto({
      tentativas: {
        data: [
          {
            created_at: "2026-09-18T10:00:00Z",
            updated_at: "2026-09-18T10:00:01Z",
            status: "api_accepted",
            test_event_code: CODIGO,
            event_id: `jornada-capi-teste-${PEDIDO}`,
            events_received: 1,
            fbtrace_id: "Abc123",
            diagnostic: "http=200",
          },
        ],
        error: null,
      },
    });
    const estado = await lerEstadoMetaCapi(ctx, {
      lerBinding: async () => LOCATION,
      lerToken: () => TOKEN,
    });
    expect(estado.leituraOk).toBe(true);
    expect(estado.ultimaTentativa?.eventId).toBe(`jornada-capi-teste-${PEDIDO}`);
    expect(estado.codigosUsados).toEqual([CODIGO]);
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
  it("regista aceitação com um único pedido e devolve o identificador do evento", async () => {
    const d = deps();
    const { ctx } = contexto();
    const r = await testarMetaCapi(ctx, { confirm: true, testEventCode: CODIGO }, d);
    expect(r.ok).toBe(true);
    expect(r.estado).toBe("api_accepted");
    expect(r.eventId).toBe(`jornada-capi-teste-${PEDIDO}`);
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
      const { ctx, rpc } = contexto();
      const r = await testarMetaCapi(ctx, entrada, d);
      expect(r.ok).toBe(false);
      expect(r.estado).toBe("nao_iniciado");
      expect(d.enviar).not.toHaveBeenCalled();
      expect(rpc).not.toHaveBeenCalledWith("meta_capi_test_reserve", expect.anything());
    }
  });

  it("reserva recusada não chama a Meta", async () => {
    const d = deps();
    const { ctx } = contexto({ reserva: { data: null, error: { message: "permission denied" } } });
    const r = await testarMetaCapi(ctx, { confirm: true, testEventCode: CODIGO }, d);
    expect(r.ok).toBe(false);
    expect(d.enviar).not.toHaveBeenCalled();
  });

  it("tempo limite ou falha de rede fica incerto, com diagnóstico estático", async () => {
    const enviar = vi.fn(async () => {
      throw new Error(`ligação falhou com ${TOKEN}`);
    });
    const finalizar = vi.fn(async (e: { attemptId: string; status: string; eventsReceived: number | null; diagnostic: string }) => ({
      persisted: true,
      attempt_id: e.attemptId,
      status: e.status,
      events_received: e.eventsReceived,
    }));
    const d = deps({ enviar, finalizar: finalizar as unknown as NonNullable<DepsTesteMeta["finalizar"]> });
    const { ctx } = contexto();
    const r = await testarMetaCapi(ctx, { confirm: true, testEventCode: CODIGO }, d);
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(r.estado).toBe("uncertain");
    const gravado = finalizar.mock.calls[0]?.[0];
    expect(gravado?.diagnostic).toBe(DIAGNOSTICO_REDE);
    expect(JSON.stringify(gravado)).not.toContain(TOKEN);
  });

  it("corpo malformado nunca é sucesso", async () => {
    const d = deps({
      enviar: vi.fn(async () => ({ httpStatus: 200, corpo: {}, redirecionado: false })),
    });
    const { ctx } = contexto();
    const r = await testarMetaCapi(ctx, { confirm: true, testEventCode: CODIGO }, d);
    expect(r.ok).toBe(false);
    expect(r.estado).toBe("uncertain");
  });

  it("recibo ausente, incoerente ou exceção na gravação dão incerto sem mandar repetir", async () => {
    const recibos: NonNullable<DepsTesteMeta["finalizar"]>[] = [
      async () => null,
      async () => ({ persisted: false, attempt_id: ATTEMPT, status: "api_accepted", events_received: 1 }),
      async () => ({ persisted: true, attempt_id: "outro", status: "api_accepted", events_received: 1 }),
      async () => ({ persisted: true, attempt_id: ATTEMPT, status: "rejected", events_received: 1 }),
      async () => ({ persisted: true, attempt_id: ATTEMPT, status: "api_accepted", events_received: 2 }),
      async () => {
        throw new Error("falha de gravação");
      },
    ];
    for (const finalizar of recibos) {
      const { ctx } = contexto();
      const r = await testarMetaCapi(ctx, { confirm: true, testEventCode: CODIGO }, deps({ finalizar }));
      expect(r.ok).toBe(false);
      expect(r.estado).toBe("uncertain");
      expect(r.message).toContain("Não repita");
      expect(r.eventId).toBe(`jornada-capi-teste-${PEDIDO}`);
    }
  });
});
