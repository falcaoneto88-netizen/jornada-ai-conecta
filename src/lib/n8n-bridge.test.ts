import { describe, expect, it, vi } from "vitest";

import {
  CONFIG_PADRAO,
  processarBridge,
  type ConfigBridge,
  type DepsBridge,
} from "./n8n-bridge.core";
import { dataHoraLisboa, montarMensagem } from "./n8n-bridge.templates";

const TOKEN = "t".repeat(20) + "Z9x8Y7w6V5u4T3s2R1q0";
const LOC = "ok2UHC2QMZsd8UHsAgEa";
const ORG = "f07ab3be-7419-4779-a901-ef71c5fc27f0";
const CAL = "nPXR1Fyp0r3CpaMMGSki";
const AGORA = Date.parse("2026-10-01T09:00:00Z");
const INICIO = "2026-10-02T10:00:00.000Z";

const PRONTO: ConfigBridge = {
  bridgeEnabled: true,
  liveSendEnabled: true,
  simulation: false,
  calendarId: CAL,
  channel: "whatsapp_zaptos",
  clinicAddress: "Rua Exemplo 1, Lisboa",
  fallbackUserId: null,
  zaptosProviderId: "zaptosProv01",
  channelVerified: true,
};

function contactoRaw(extra: Record<string, unknown> = {}) {
  return {
    total: 1,
    contacts: [
      {
        id: "contact01",
        locationId: LOC,
        firstName: "Ana",
        phone: "+351910000000",
        assignedTo: "seller001",
        dnd: false,
        dndSettings: { SMS: { status: "inactive" }, WhatsApp: { status: "inactive" } },
        notes: "NOTA CLINICA",
        ...extra,
      },
    ],
  };
}
function eventoRaw(extra: Record<string, unknown> = {}) {
  return {
    appointment: {
      id: "appt0001",
      locationId: LOC,
      calendarId: CAL,
      contactId: "contact01",
      startTime: INICIO,
      endTime: "2026-10-02T11:00:00.000Z",
      appointmentStatus: "confirmed",
      notes: "livre",
      ...extra,
    },
  };
}

function deps(
  o: Partial<DepsBridge> & { cfg?: ConfigBridge } = {},
): DepsBridge & { enviar: ReturnType<typeof vi.fn> } {
  const enviar = vi.fn(async () => ({ ok: true as const, messageId: "msg-1" }));
  return {
    token: TOKEN,
    now: () => AGORA,
    resolver: async () => ({
      orgId: ORG,
      locationId: LOC,
      writeEnabled: true,
      integracaoConectada: true,
    }),
    lerConfig: async () => ({ ok: true, cfg: o.cfg ?? PRONTO }),
    hit: async () => true,
    contacto: async () => ({ ok: true, data: contactoRaw() }),
    consulta: async () => ({ ok: true, data: eventoRaw() }),
    utilizadorNaLocation: async () => true,
    claim: async () => ({ reserved: true, id: "res-1" }),
    finish: async () => true,
    enviar,
    ...o,
  } as DepsBridge & { enviar: ReturnType<typeof vi.fn> };
}

function req(body: unknown, auth: string | null = `Bearer ${TOKEN}`) {
  const h: Record<string, string> = { "content-type": "application/json" };
  if (auth) h["authorization"] = auth;
  return new Request("http://x/api/public/n8n/bridge", {
    method: "POST",
    headers: h,
    body: JSON.stringify(body),
  });
}
const envio = {
  op: "message.send",
  appointmentId: "appt0001",
  contactId: "contact01",
  expectedStartTime: INICIO,
  kind: "req24",
};

async function run(body: unknown, d = deps(), auth?: string | null) {
  const r = await processarBridge(req(body, auth === undefined ? `Bearer ${TOKEN}` : auth), d);
  return { status: r.status, json: (await r.json()) as Record<string, unknown> };
}

describe("autenticação de máquina", () => {
  it("fail-closed sem token configurado", async () => {
    expect((await run({ op: "health" }, deps({ token: undefined }))).status).toBe(503);
    expect((await run({ op: "health" }, deps({ token: "curto" }))).status).toBe(503);
  });
  it("recusa ausente/inválida sem ecoar valores", async () => {
    expect((await run({ op: "health" }, deps(), null)).status).toBe(401);
    const r = await run({ op: "health" }, deps(), "Bearer errado-errado-errado-errado-errado");
    expect(r.status).toBe(401);
    expect(JSON.stringify(r.json)).not.toContain("errado");
    expect((await run({ op: "health" }, deps(), `Basic ${TOKEN}`)).status).toBe(401);
  });
  it("health não expõe segredo", async () => {
    const r = await run({ op: "health" }, deps({ cfg: CONFIG_PADRAO }));
    expect(r.status).toBe(200);
    expect(r.json["bridgeEnabled"]).toBe(false);
    expect(JSON.stringify(r.json)).not.toContain(TOKEN);
  });
});

describe("união estrita", () => {
  it("rejeita escopo/url/texto do cliente", async () => {
    for (const extra of [
      { locationId: LOC },
      { url: "https://x" },
      { message: "oi" },
      { orgId: ORG },
      { channel: "sms" },
    ]) {
      expect((await run({ ...envio, ...extra })).status).toBe(400);
    }
    expect((await run({ op: "proxy", path: "/contacts" })).status).toBe(400);
    expect((await run({ ...envio, kind: "outro" })).status).toBe(400);
  });
  it("corpo grande 413 e content-type 415", async () => {
    const r = await processarBridge(
      new Request("http://x", {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: "x".repeat(3000),
      }),
      deps(),
    );
    expect(r.status).toBe(413);
    const r2 = await processarBridge(
      new Request("http://x", {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "text/plain" },
        body: "{}",
      }),
      deps(),
    );
    expect(r2.status).toBe(415);
  });
  it("ponte desligada por padrão", async () => {
    expect(
      (await run({ op: "contact.get", contactId: "contact01" }, deps({ cfg: CONFIG_PADRAO }))).json[
        "error"
      ],
    ).toBe("bridge_disabled");
  });
  it("sem binding/schema bloqueia; rate limit", async () => {
    expect((await run({ op: "health" }, deps({ resolver: async () => null }))).status).toBe(503);
    expect(
      (await run({ op: "health" }, deps({ lerConfig: async () => ({ ok: false }) }))).json["error"],
    ).toBe("bridge_schema_unavailable");
    expect((await run({ op: "health" }, deps({ hit: async () => false }))).status).toBe(429);
  });
});

describe("leituras minimizadas e isolamento", () => {
  it("contact.get devolve só campos permitidos", async () => {
    const r = await run({ op: "contact.get", contactId: "contact01" });
    expect(Object.keys(r.json["contact"] as object).sort()).toEqual([
      "assignedTo",
      "dnd",
      "dndSettings",
      "firstName",
      "id",
      "locationId",
      "phone",
    ]);
    expect(JSON.stringify(r.json)).not.toContain("NOTA");
  });
  it("contacto de outra location ou id divergente é recusado", async () => {
    expect(
      (
        await run(
          { op: "contact.get", contactId: "contact01" },
          deps({
            contacto: async () => ({ ok: true, data: contactoRaw({ locationId: "outraLoc01" }) }),
          }),
        )
      ).status,
    ).toBe(409);
    expect((await run({ op: "contact.get", contactId: "contact02" })).status).toBe(409);
  });
  it("appointment.get minimizado; outra agenda recusada", async () => {
    const r = await run({ op: "appointment.get", appointmentId: "appt0001" });
    expect(Object.keys(r.json["event"] as object)).not.toContain("notes");
    expect(
      (
        await run(
          { op: "appointment.get", appointmentId: "appt0001" },
          deps({
            consulta: async () => ({ ok: true, data: eventoRaw({ calendarId: "outraCal01" }) }),
          }),
        )
      ).json["error"],
    ).toBe("calendar_mismatch");
  });
});

describe("message.send guards", () => {
  const casos: [
    string,
    Partial<DepsBridge> & { cfg?: ConfigBridge },
    Record<string, unknown>,
    string,
  ][] = [
    [
      "DND ausente",
      { contacto: async () => ({ ok: true, data: contactoRaw({ dndSettings: {} }) }) },
      {},
      "dnd_not_confirmed",
    ],
    [
      "DND ativo",
      {
        contacto: async () => ({
          ok: true,
          data: contactoRaw({ dndSettings: { SMS: { status: "active" } } }),
        }),
      },
      {},
      "dnd_not_confirmed",
    ],
    [
      "dnd omitido",
      { contacto: async () => ({ ok: true, data: contactoRaw({ dnd: undefined }) }) },
      {},
      "contact_not_verified",
    ],
    [
      "whatsapp sem chave WhatsApp",
      { contacto: async () => ({ ok: true, data: contactoRaw({ dndSettings: { SMS: { status: "inactive" } } }) }) },
      {},
      "dnd_not_confirmed",
    ],
    [
      "cancelada",
      { consulta: async () => ({ ok: true, data: eventoRaw({ appointmentStatus: "cancelled" }) }) },
      {},
      "appointment_not_active",
    ],
    ["remarcada", {}, { expectedStartTime: "2026-10-02T12:00:00Z" }, "appointment_rescheduled"],
    ["passada", { now: () => Date.parse("2026-10-03T00:00:00Z") }, {}, "appointment_in_past"],
    ["contacto divergente", {}, { contactId: "contact99" }, "contact_mismatch"],
    ["sms bloqueado (real)", { cfg: { ...PRONTO, channel: "sms", channelVerified: false } }, {}, "sms_route_not_configured"],
    ["sms bloqueado (simulação)", { cfg: { ...PRONTO, channel: "sms", simulation: true } }, {}, "sms_route_not_configured"],
    ["provedor em falta", { cfg: { ...PRONTO, zaptosProviderId: null } }, {}, "provider_not_configured"],
    ["canal não verificado", { cfg: { ...PRONTO, channelVerified: false } }, {}, "channel_not_verified"],
    ["canal não verificado (simulação)", { cfg: { ...PRONTO, channelVerified: false, simulation: true } }, {}, "channel_not_verified"],
    ["canal pendente", { cfg: { ...PRONTO, channel: null } }, {}, "channel_not_configured"],
    [
      "morada pendente",
      { cfg: { ...PRONTO, clinicAddress: "" } },
      { kind: "confirm" },
      "address_not_configured",
    ],
    ["agenda pendente", { cfg: { ...PRONTO, calendarId: null } }, {}, "calendar_not_configured"],
    [
      "sem vendedor",
      { contacto: async () => ({ ok: true, data: contactoRaw({ assignedTo: undefined }) }) },
      { kind: "escalation" },
      "seller_not_configured",
    ],
    [
      "vendedor fora da location",
      { utilizadorNaLocation: async () => false },
      { kind: "handoff" },
      "seller_not_in_location",
    ],
    ["live off", { cfg: { ...PRONTO, liveSendEnabled: false } }, {}, "live_send_disabled"],
    [
      "write_enabled off",
      {
        resolver: async () => ({
          orgId: ORG,
          locationId: LOC,
          writeEnabled: false,
          integracaoConectada: true,
        }),
      },
      {},
      "live_send_disabled",
    ],
  ];
  for (const [nome, o, extra, codigo] of casos) {
    it(nome, async () => {
      const d = deps(o);
      const claim = vi.fn(d.claim);
      d.claim = claim;
      const r = await run({ ...envio, ...extra }, d);
      expect(r.json["error"]).toBe(codigo);
      expect(d.enviar).not.toHaveBeenCalled();
      expect(claim).not.toHaveBeenCalled();
    });
  }

  it("simulação: sem POST, sem reserva, sem messageId falso", async () => {
    const d = deps({ cfg: { ...PRONTO, simulation: true } });
    const claim = vi.fn(d.claim);
    d.claim = claim;
    const r = await run(envio, d);
    expect(r.json).toMatchObject({ simulated: true, messageId: null, delivered: false });
    expect(r.json["status"]).not.toBe("accepted");
    expect(d.enviar).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
  });

  it("aceite com messageId persistido", async () => {
    const d = deps();
    const r = await run(envio, d);
    expect(r.json).toEqual({
      messageId: "msg-1",
      status: "accepted",
      duplicate: false,
      delivered: false,
    });
    expect(d.enviar).toHaveBeenCalledTimes(1);
    const corpo = d.enviar.mock.calls[0]![0] as Record<string, unknown>;
    expect(corpo).toMatchObject({
      type: "SMS",
      conversationProviderId: "zaptosProv01",
      appointmentId: "appt0001",
      status: "pending",
    });
    expect(String(corpo["message"])).toContain("CONFIRMO");
  });

  it("escalation é comentário interno com menção ao comercial", async () => {
    const d = deps();
    await run({ ...envio, kind: "escalation" }, d);
    const corpo = d.enviar.mock.calls[0]![0] as Record<string, unknown>;
    expect(corpo).toMatchObject({
      type: "InternalComment",
      mentions: ["seller001"],
      appointmentId: "appt0001",
      status: "pending",
    });
    expect(String(corpo["message"])).toMatch(/^@Responsável<userId>seller001<\/userId> /);
    expect(corpo).not.toHaveProperty("conversationProviderId");
  });

  it("duplicado aceite devolve messageId persistido sem POST", async () => {
    const d = deps({
      claim: async () => ({ reserved: false, id: "r", state: "accepted", messageId: "msg-old" }),
    });
    const r = await run(envio, d);
    expect(r.json).toEqual({
      messageId: "msg-old",
      status: "accepted",
      duplicate: true,
      delivered: false,
    });
    expect(d.enviar).not.toHaveBeenCalled();
  });
  it("duplicado unknown não reenvia nem aceita", async () => {
    const d = deps({
      claim: async () => ({ reserved: false, id: "r", state: "unknown", messageId: null }),
    });
    const r = await run(envio, d);
    expect(r.status).toBe(409);
    expect(d.enviar).not.toHaveBeenCalled();
  });
  it("timeout/5xx -> unknown, uma tentativa", async () => {
    const finish = vi.fn(async () => true);
    const d = deps({
      finish,
      enviar: vi.fn(async () => ({
        ok: false as const,
        definitivo: false,
        code: "outcome_unknown",
      })),
    });
    const r = await run(envio, d);
    expect(r.json["error"]).toBe("outcome_unknown");
    expect(d.enviar).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledWith(ORG, "res-1", "unknown", null, "outcome_unknown");
  });
  it("2xx sem messageId -> unknown", async () => {
    const finish = vi.fn(async () => true);
    const d = deps({ finish, enviar: vi.fn(async () => ({ ok: true as const, messageId: null })) });
    expect((await run(envio, d)).json["error"]).toBe("outcome_unknown");
    expect(finish).toHaveBeenCalledWith(ORG, "res-1", "unknown", null, "missing_message_id");
  });
  it("persistência falha após POST -> unknown, nunca accepted", async () => {
    const finish = vi.fn(async (_o: string, _i: string, s: string) => s !== "accepted");
    const r = await run(envio, deps({ finish }));
    expect(r.status).toBe(502);
    expect(r.json["error"]).toBe("outcome_unknown");
    expect(finish).toHaveBeenLastCalledWith(ORG, "res-1", "unknown", null, "persist_failed");
  });
  it("reserva indisponível bloqueia antes do POST", async () => {
    const d = deps({ claim: async () => null });
    expect((await run(envio, d)).status).toBe(503);
    expect(d.enviar).not.toHaveBeenCalled();
  });
});

describe("templates", () => {
  it("Europe/Lisbon DD/MM/YYYY", () => {
    expect(dataHoraLisboa("2026-10-02T10:00:00Z")).toEqual({ data: "02/10/2026", hora: "11:00" });
    expect(dataHoraLisboa("2026-12-02T10:00:00Z").hora).toBe("10:00");
  });
  it("confirm inclui morada; nome saneado", () => {
    const m = montarMensagem("confirm", {
      firstName: "Ana<script>",
      startTime: INICIO,
      morada: "Rua X",
    });
    expect(m).toContain("Morada: Rua X");
    expect(m).not.toContain("<");
  });
});
