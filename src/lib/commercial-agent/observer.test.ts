import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentError, type Event, type Settings } from "./core";
import { GHL_ORIGIN, GHL_VERSION, type GhlConfig } from "../ghl.server";
import type { Store } from "./service.server";
import { discoverContactEvents } from "./discovery.server";

const production = vi.hoisted(() => ({ command: vi.fn(), receive: vi.fn(), runtime: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
vi.mock("./runtime.server", () => ({
  createStore: () => ({ command: production.command }),
  runtime: production.runtime,
}));
import { createObserver, observerContact, observerPilot } from "./observer.server";

const org = "11111111-1111-4111-8111-111111111111";
const foreignOrg = "22222222-2222-4222-8222-222222222222";
const locationId = "loc-test";
const contactId = "contact-test";
const since = "2026-10-06T12:00:00Z";
const now = Date.parse("2026-10-06T13:00:00Z");
const config: GhlConfig = {
  baseUrl: GHL_ORIGIN,
  version: GHL_VERSION,
  token: "fake-ghl-token",
  locationId,
};
const settings: Settings = {
  organization_id: org,
  location_id: locationId,
  mode: "supervised",
  allowed_contacts: [contactId],
  allowed_channels: ["SMS"],
};
const event: Event = {
  type: "InboundMessage",
  locationId,
  contactId,
  conversationId: "conversation-test",
  messageId: "message-test",
};
const counters = (status: string) => ({
  status,
  discovered: 0,
  accepted: 0,
  duplicates: 0,
  ownMessages: 0,
});

function fixture(changes: Partial<Settings> = {}) {
  const env: Record<string, string | undefined> = {
    COMMERCIAL_AGENT_ENABLED: "true",
    COMMERCIAL_AGENT_DISCOVERY_ENABLED: "true",
    COMMERCIAL_AGENT_PILOT_SINCE: since,
  };
  const command = vi.fn().mockResolvedValue({ ...settings, ...changes });
  const receive = vi.fn().mockResolvedValue({ status: "accepted", id: "private-row-id" });
  const receiver = vi.fn(() => ({ receive }));
  const discover = vi.fn().mockResolvedValue([event]);
  const discoverLocation = vi.fn().mockResolvedValue([]);
  const call = vi.fn();
  const deps = {
    env,
    store: { command } as Store,
    config: { ...config },
    receiver,
    discover,
    discoverLocation,
    call,
    now: () => now,
  };
  return {
    deps,
    env,
    command,
    receive,
    receiver,
    discover,
    discoverLocation,
    call,
    observer: createObserver(deps),
  };
}

function canonicalReads() {
  const scope = { id: event.conversationId, locationId, contactId };
  const row = {
    ...event,
    id: event.messageId,
    dateAdded: "2026-10-06T12:01:00Z",
    messageType: "TYPE_SMS",
    direction: "inbound",
    body: "texto privado fictício que não deve entrar no ingress",
  };
  const call = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { contact: { id: contactId, locationId } },
    })
    .mockResolvedValueOnce({ ok: true, status: 200, data: { conversations: [scope], total: 1 } })
    .mockResolvedValueOnce({ ok: true, status: 200, data: scope });
  return { call, row };
}

beforeEach(() => {
  vi.clearAllMocks();
  production.runtime.mockReturnValue({ receive: production.receive });
});

describe("recebimento geral separado do envio", () => {
  const broad = { receive_all_contacts: true, receive_since: since, receive_cursor_until: null };
  const newEvent = { ...event, contactId: "new-contact" };
  const observedAt = "2026-10-06T12:55:00Z";

  it("recebe contatos novos com data canônica, sem ampliar a lista de envio", async () => {
    const f = fixture(broad);
    f.discoverLocation.mockResolvedValue([{ event: newEvent, observedAt }]);
    expect(await f.observer.observerPilot(org, locationId)).toMatchObject({ accepted: 1 });
    expect(f.discover).not.toHaveBeenCalled();
    expect(f.receive).toHaveBeenCalledWith(org, newEvent, observedAt);
    expect(f.command).toHaveBeenLastCalledWith("receive_advance", org, {
      until: new Date(now).toISOString(),
    });
    expect(settings.allowed_contacts).toEqual([contactId]);
    expect(f.command.mock.calls.every(([op]) => ["settings", "receive_advance"].includes(op))).toBe(
      true,
    );
  });

  it("callback de contato novo usa filtro canônico e não avança o cursor global", async () => {
    const f = fixture(broad);
    f.discoverLocation.mockResolvedValue([{ event: newEvent, observedAt }]);
    await f.observer.observerContact(org, locationId, newEvent.contactId);
    expect(f.discoverLocation.mock.calls[0]?.[0]).toEqual({
      locationId,
      contactId: newEvent.contactId,
      since: new Date(since).toISOString(),
      until: new Date(now).toISOString(),
    });
    expect(f.command).toHaveBeenCalledTimes(1);
  });

  it("varredura usa sobreposição sem voltar antes da ativação e avança mesmo sem mensagens", async () => {
    const f = fixture({ ...broad, receive_cursor_until: "2026-10-06T12:58:00Z" });
    expect(await f.observer.observerPilot(org, locationId)).toMatchObject({ status: "idle" });
    expect(f.discoverLocation.mock.calls[0]?.[0].since).toBe("2026-10-06T12:48:00.000Z");
    expect(f.command).toHaveBeenLastCalledWith("receive_advance", org, {
      until: new Date(now).toISOString(),
    });
    expect(f.receiver).not.toHaveBeenCalled();
  });

  it.each([
    { ...newEvent, locationId: "foreign-location" },
    { ...newEvent, contactId: "other-contact" },
  ])("todo o lote deve pertencer ao callback antes do primeiro ingresso", async (badEvent) => {
    const f = fixture(broad);
    f.discoverLocation.mockResolvedValue([
      { event: newEvent, observedAt },
      { event: badEvent, observedAt },
    ]);
    await expect(f.observer.observerContact(org, locationId, newEvent.contactId)).rejects.toThrow(
      "scope_mismatch",
    );
    expect(f.receive).not.toHaveBeenCalled();
  });

  it.each(["2026-10-06T11:59:59Z", "2026-10-06T13:00:01Z"])(
    "data canônica %s fora da janela não é persistida",
    async (badDate) => {
      const f = fixture(broad);
      f.discoverLocation.mockResolvedValue([{ event: newEvent, observedAt: badDate }]);
      await expect(f.observer.observerPilot(org, locationId)).rejects.toThrow("scope_mismatch");
      expect(f.receive).not.toHaveBeenCalled();
      expect(f.command).toHaveBeenCalledTimes(1);
    },
  );

  it("falha parcial não confirma cursor; nova tentativa pode usar deduplicação durável", async () => {
    const f = fixture(broad);
    f.discoverLocation.mockResolvedValue([
      { event: newEvent, observedAt },
      { event: { ...newEvent, messageId: "later" }, observedAt: "2026-10-06T12:56:00Z" },
    ]);
    f.receive
      .mockResolvedValueOnce({ status: "accepted" })
      .mockRejectedValueOnce(new AgentError("storage_unavailable"));
    await expect(f.observer.observerPilot(org, locationId)).rejects.toThrow("storage_unavailable");
    expect(f.command).toHaveBeenCalledTimes(1);
    f.receive
      .mockResolvedValueOnce({ status: "duplicate" })
      .mockResolvedValueOnce({ status: "accepted" });
    expect(await f.observer.observerPilot(org, locationId)).toMatchObject({
      accepted: 1,
      duplicates: 1,
    });
    expect(f.command).toHaveBeenLastCalledWith("receive_advance", org, {
      until: new Date(now).toISOString(),
    });
  });

  it("desativação durante ingresso não confirma cursor nem continua", async () => {
    const f = fixture(broad);
    f.discoverLocation.mockResolvedValue([{ event: newEvent, observedAt }]);
    f.receive.mockResolvedValue({ status: "disabled" });
    expect(await f.observer.observerPilot(org, locationId)).toMatchObject({ status: "disabled" });
    expect(f.command).toHaveBeenCalledTimes(1);
  });

  it.each([null, "invalid", "2026-10-06T14:00:00Z"])(
    "ativação inválida %j bloqueia descoberta",
    async (receive_since) => {
      const f = fixture({ ...broad, receive_since });
      await expect(f.observer.observerPilot(org, locationId)).rejects.toThrow(
        "discovery_since_invalid",
      );
      expect(f.discoverLocation).not.toHaveBeenCalled();
    },
  );

  it.each(["invalid", "2026-10-06T14:00:00Z", "2026-10-06T11:00:00Z"])(
    "cursor inválido %s bloqueia descoberta",
    async (receive_cursor_until) => {
      const f = fixture({ ...broad, receive_cursor_until });
      await expect(f.observer.observerPilot(org, locationId)).rejects.toThrow(
        "discovery_cursor_invalid",
      );
      expect(f.discoverLocation).not.toHaveBeenCalled();
    },
  );
});
afterEach(() => vi.unstubAllEnvs());

describe("observer supervisionado", () => {
  it.each([
    ["COMMERCIAL_AGENT_ENABLED", undefined],
    ["COMMERCIAL_AGENT_ENABLED", "false"],
    ["COMMERCIAL_AGENT_DISCOVERY_ENABLED", undefined],
    ["COMMERCIAL_AGENT_DISCOVERY_ENABLED", "false"],
    ["COMMERCIAL_AGENT_DISCOVERY_ENABLED", "TRUE"],
  ])("%s=%s desativa antes de banco, credenciais e rede", async (key, value) => {
    const f = fixture();
    f.env[key!] = value;
    delete f.env["COMMERCIAL_AGENT_PILOT_SINCE"];
    f.receiver.mockImplementation(() => {
      throw new Error("encryption unavailable");
    });
    expect(await f.observer.observerContact(org, locationId, contactId)).toEqual(
      counters("disabled"),
    );
    expect(await f.observer.observerPilot(org, locationId)).toEqual(counters("disabled"));
    expect(f.command).not.toHaveBeenCalled();
    expect(f.discover).not.toHaveBeenCalled();
    expect(f.call).not.toHaveBeenCalled();
    expect(f.receiver).not.toHaveBeenCalled();
  });

  it("settings off é noop e não exige marco inicial nem instancia runtime", async () => {
    const f = fixture({ mode: "off", allowed_contacts: [] });
    delete f.env["COMMERCIAL_AGENT_PILOT_SINCE"];
    expect(await f.observer.observerPilot(org, locationId)).toEqual(counters("disabled"));
    expect(f.command).toHaveBeenCalledWith("settings", org);
    expect(f.discover).not.toHaveBeenCalled();
    expect(f.receiver).not.toHaveBeenCalled();
  });

  it.each([{ organization_id: foreignOrg }, { location_id: "foreign-location" }])(
    "settings com escopo diferente recusam antes da rede (%j)",
    async (change) => {
      const f = fixture(change);
      await expect(f.observer.observerContact(org, locationId, contactId)).rejects.toThrow(
        "scope_mismatch",
      );
      expect(f.discover).not.toHaveBeenCalled();
      expect(f.call).not.toHaveBeenCalled();
      expect(f.receiver).not.toHaveBeenCalled();
    },
  );

  it.each([
    [org, "foreign-location", contactId],
    ["invalid-org", locationId, contactId],
    [org, locationId, "../foreign-contact"],
  ])(
    "entrada fora do escopo recusa sem consultar banco ou rede",
    async (orgId, location, contact) => {
      const f = fixture();
      await expect(f.observer.observerContact(orgId!, location!, contact!)).rejects.toThrow(
        "scope_mismatch",
      );
      expect(f.command).not.toHaveBeenCalled();
      expect(f.discover).not.toHaveBeenCalled();
      expect(f.receive).not.toHaveBeenCalled();
    },
  );

  it("contato fora da allowlist é recusado antes de qualquer GET", async () => {
    const f = fixture();
    await expect(f.observer.observerContact(org, locationId, "foreign-contact")).rejects.toThrow(
      "contact_not_allowed",
    );
    expect(f.discover).not.toHaveBeenCalled();
    expect(f.call).not.toHaveBeenCalled();
    expect(f.receiver).not.toHaveBeenCalled();
  });

  it.each(["observerPilot", "observerContact"] as const)(
    "%s recusa allowlist de mais de um contato",
    async (method) => {
      const f = fixture({ allowed_contacts: [contactId, "second-contact"] });
      await expect(f.observer[method](org, locationId, contactId)).rejects.toThrow(
        "discovery_contact_limit",
      );
      expect(f.discover).not.toHaveBeenCalled();
      expect(f.call).not.toHaveBeenCalled();
      expect(f.receive).not.toHaveBeenCalled();
    },
  );

  it("piloto vazio retorna ignored sem GET; callback vazio recusa contato", async () => {
    const f = fixture({ allowed_contacts: [] });
    delete f.env["COMMERCIAL_AGENT_PILOT_SINCE"];
    expect(await f.observer.observerPilot(org, locationId)).toEqual(counters("ignored"));
    await expect(f.observer.observerContact(org, locationId, contactId)).rejects.toThrow(
      "contact_not_allowed",
    );
    expect(f.discover).not.toHaveBeenCalled();
    expect(f.call).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    "",
    " ",
    "not-a-date",
    "2026-10-06",
    "2026-10-06T12:00:00",
    "2026-10-06T14:00:00Z",
  ])("marco inicial inválido %j recusa antes de GET ou runtime", async (value) => {
    const f = fixture();
    f.env["COMMERCIAL_AGENT_PILOT_SINCE"] = value;
    await expect(f.observer.observerPilot(org, locationId)).rejects.toThrow(
      "discovery_since_invalid",
    );
    expect(f.discover).not.toHaveBeenCalled();
    expect(f.call).not.toHaveBeenCalled();
    expect(f.receiver).not.toHaveBeenCalled();
  });

  it("aceita timezone explícito e um único contato repetido sem fazer múltiplas descobertas", async () => {
    const f = fixture({ allowed_contacts: [contactId, contactId] });
    f.env["COMMERCIAL_AGENT_PILOT_SINCE"] = "2026-10-06T09:00:00-03:00";
    await f.observer.observerPilot(org, locationId);
    expect(f.discover).toHaveBeenCalledTimes(1);
    expect(f.discover.mock.calls[0]?.[0]).toEqual({
      locationId,
      contactId,
      since: "2026-10-06T09:00:00-03:00",
    });
    expect(f.command.mock.invocationCallOrder[0]).toBeLessThan(
      f.discover.mock.invocationCallOrder[0]!,
    );
    expect(f.discover.mock.invocationCallOrder[0]).toBeLessThan(
      f.receiver.mock.invocationCallOrder[0]!,
    );
  });

  it("valida todos os eventos antes de qualquer ingress, inclusive os últimos", async () => {
    const f = fixture();
    f.discover.mockResolvedValue([event, { ...event, contactId: "foreign-contact" }]);
    await expect(f.observer.observerPilot(org, locationId)).rejects.toThrow("scope_mismatch");
    expect(f.receive).not.toHaveBeenCalled();
    expect(f.receiver).not.toHaveBeenCalled();
    f.discover.mockResolvedValue([event, { ...event, messageId: "../invalid" }]);
    await expect(f.observer.observerPilot(org, locationId)).rejects.toThrow(
      "discovery_history_invalid",
    );
    expect(f.receive).not.toHaveBeenCalled();
  });

  it("falha na última página de descoberta real não persiste os eventos da primeira", async () => {
    const f = fixture();
    const { call, row } = canonicalReads();
    call.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { messages: { messages: [row], nextPage: true, lastMessageId: row.id } },
    });
    call.mockResolvedValueOnce({
      ok: false,
      status: 503,
      code: "server_error",
      message: "payload privado não propagado",
    });
    const observer = createObserver({ ...f.deps, discover: discoverContactEvents, call });
    await expect(observer.observerPilot(org, locationId)).rejects.toThrow("ghl_read_failed");
    expect(call).toHaveBeenCalledTimes(5);
    expect(f.receiver).not.toHaveBeenCalled();
    expect(f.receive).not.toHaveBeenCalled();
  });

  it("descoberta canônica usa só GET, ingress cronológico e retorna só contadores", async () => {
    const f = fixture();
    const { call, row } = canonicalReads();
    const earlier = { ...row, id: "message-earlier", dateAdded: since, direction: "outbound" };
    call.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { messages: { messages: [row, earlier], nextPage: false } },
    });
    f.receive
      .mockResolvedValueOnce({ status: "own_message", id: "private-row" })
      .mockResolvedValueOnce({ status: "accepted", id: "private-row-2" });
    const result = await createObserver({
      ...f.deps,
      discover: discoverContactEvents,
      call,
    }).observerPilot(org, locationId);
    expect(result).toEqual({
      status: "observed",
      discovered: 2,
      accepted: 1,
      duplicates: 0,
      ownMessages: 1,
    });
    expect(
      call.mock.calls.every((entry) => entry[2]?.method === "GET" && entry[2]?.body === undefined),
    ).toBe(true);
    expect(call.mock.calls.every((entry) => entry[0].baseUrl === GHL_ORIGIN)).toBe(true);
    expect(f.receive.mock.calls).toEqual([
      [org, { ...event, type: "OutboundMessage", messageId: earlier.id }],
      [org, event],
    ]);
    expect(JSON.stringify(result)).not.toContain("private");
    expect(JSON.stringify(f.receive.mock.calls)).not.toContain("texto privado");
  });

  it("redescoberta usa ingress novamente para a deduplicação durável", async () => {
    const f = fixture();
    f.receive
      .mockResolvedValueOnce({ status: "accepted" })
      .mockResolvedValueOnce({ status: "duplicate", id: "private-id" });
    await f.observer.observerPilot(org, locationId);
    expect(await f.observer.observerPilot(org, locationId)).toEqual({
      status: "observed",
      discovered: 1,
      accepted: 0,
      duplicates: 1,
      ownMessages: 0,
    });
    expect(f.receive).toHaveBeenCalledTimes(2);
    expect(f.receive).toHaveBeenNthCalledWith(2, org, event);
  });

  it("settings/storage inválidos não disparam descoberta", async () => {
    const f = fixture();
    f.command.mockResolvedValue({ ...settings, allowed_contacts: "all" });
    await expect(f.observer.observerPilot(org, locationId)).rejects.toThrow(
      "discovery_settings_invalid",
    );
    f.command.mockRejectedValue(new AgentError("storage_unavailable"));
    await expect(f.observer.observerPilot(org, locationId)).rejects.toThrow("storage_unavailable");
    expect(f.discover).not.toHaveBeenCalled();
    expect(f.receive).not.toHaveBeenCalled();
  });

  it("configuração de domínio incorreta bloqueia antes de qualquer rede", async () => {
    const f = fixture();
    f.deps.config.baseUrl = "https://foreign.test";
    await expect(f.observer.observerPilot(org, locationId)).rejects.toThrow(
      "discovery_config_invalid",
    );
    expect(f.discover).not.toHaveBeenCalled();
    expect(f.call).not.toHaveBeenCalled();
  });

  it("sem eventos não instancia runtime; receive desativado interrompe ingress restantes", async () => {
    const f = fixture();
    f.discover.mockResolvedValue([]);
    expect(await f.observer.observerPilot(org, locationId)).toEqual(counters("idle"));
    expect(f.receiver).not.toHaveBeenCalled();
    f.discover.mockResolvedValue([event, { ...event, messageId: "later" }]);
    f.receive.mockResolvedValue({ status: "disabled" });
    expect(await f.observer.observerPilot(org, locationId)).toEqual({
      ...counters("disabled"),
      discovered: 2,
    });
    expect(f.receive).toHaveBeenCalledTimes(1);
  });

  it("exports de produção mantêm zero efeito quando desligados", async () => {
    vi.stubEnv("COMMERCIAL_AGENT_ENABLED", "false");
    vi.stubEnv("COMMERCIAL_AGENT_DISCOVERY_ENABLED", "true");
    expect(await observerContact(org, locationId, contactId)).toEqual(counters("disabled"));
    expect(await observerPilot(org, locationId)).toEqual(counters("disabled"));
    expect(production.command).not.toHaveBeenCalled();
    expect(production.runtime).not.toHaveBeenCalled();
    expect(production.receive).not.toHaveBeenCalled();
  });
});
