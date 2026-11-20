import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  readAutomation,
  changeAutomation,
  type AutomationControlDeps,
} from "./automation-control.server";
import { automationInput, automationReason } from "./automation";
import type { Settings, Snapshot } from "./core";

const command = vi.fn(),
  verifyKnowledge = vi.fn();
const org = "11111111-1111-4111-8111-111111111111";
let settings: Settings & { canManage: boolean }, deps: AutomationControlDeps;
beforeEach(() => {
  vi.resetAllMocks();
  settings = {
    organization_id: org,
    location_id: "loc",
    mode: "supervised",
    allowed_contacts: [],
    allowed_channels: ["SMS"],
    receive_all_contacts: true,
    automation_enabled: false,
    automation_version: 0,
    canManage: true,
  };
  command.mockImplementation(async () => ({ ...settings }));
  deps = {
    store: { command },
    organizationId: org,
    locationId: "loc",
    actorId: "actor",
    policyHash: "a".repeat(64),
    writeEnabled: true,
    runtimeReady: true,
    verifyKnowledge,
  };
});
describe("controle global autenticado", () => {
  it("projeta apenas estado público sem autorizar envio ao ler", async () => {
    expect(await readAutomation(deps)).toEqual({
      enabled: false,
      version: 0,
      since: null,
      channels: ["SMS"],
      canManage: true,
      activationBlock: null,
      policyCurrent: true,
    });
    expect(command).toHaveBeenCalledWith("automation_state", org, {}, "actor");
    expect(verifyKnowledge).not.toHaveBeenCalled();
  });
  it("não aceita org/location/status de outro contexto", async () => {
    settings.organization_id = "foreign";
    await expect(readAutomation(deps)).rejects.toThrow("scope_mismatch");
  });
  it("ativação verifica biblioteca privada e envia só configuração derivada do servidor", async () => {
    await changeAutomation(deps, { enabled: true, expectedVersion: 0 });
    expect(verifyKnowledge).toHaveBeenCalledOnce();
    expect(command).toHaveBeenLastCalledWith(
      "automation_set",
      org,
      {
        enabled: true,
        expectedVersion: 0,
        policyHash: deps.policyHash,
        channels: ["SMS"],
      },
      "actor",
    );
  });
  it("ativação inicial usa os canais permitidos atuais sem herdar uma autorização antiga", async () => {
    settings.allowed_channels = ["SMS", "IG", "FB"];
    settings.automation_channels = ["SMS"];
    await changeAutomation(deps, { enabled: true, expectedVersion: 0 });
    expect(command).toHaveBeenLastCalledWith(
      "automation_set",
      org,
      expect.objectContaining({ channels: ["SMS", "IG", "FB"] }),
      "actor",
    );
  });
  it("revalida a política de SMS sem ampliar para IG e FB adicionados à configuração", async () => {
    Object.assign(settings, {
      allowed_channels: ["SMS", "IG", "FB"],
      automation_enabled: true,
      automation_version: 3,
      automation_channels: ["SMS"],
      automation_policy_hash: "b".repeat(64),
    });
    expect(await readAutomation(deps)).toMatchObject({
      channels: ["SMS"],
      policyCurrent: false,
      activationBlock: null,
    });
    await changeAutomation(deps, { enabled: true, expectedVersion: 3 });
    expect(verifyKnowledge).toHaveBeenCalledOnce();
    expect(command).toHaveBeenLastCalledWith(
      "automation_set",
      org,
      {
        enabled: true,
        expectedVersion: 3,
        policyHash: deps.policyHash,
        channels: ["SMS"],
      },
      "actor",
    );
  });
  it("preserva os três canais já autorizados ao revalidar uma política", async () => {
    Object.assign(settings, {
      allowed_channels: ["SMS", "IG", "FB", "WhatsApp"],
      automation_enabled: true,
      automation_version: 3,
      automation_channels: ["SMS", "IG", "FB"],
      automation_policy_hash: "b".repeat(64),
    });
    await changeAutomation(deps, { enabled: true, expectedVersion: 3 });
    expect(command).toHaveBeenLastCalledWith(
      "automation_set",
      org,
      expect.objectContaining({ channels: ["SMS", "IG", "FB"] }),
      "actor",
    );
  });
  it.each([
    { authorized: ["SMS", "IG", "FB"], allowed: ["SMS", "FB"] },
    { authorized: ["SMS"], allowed: ["IG", "FB"] },
    { authorized: ["SMS", "Email"], allowed: ["SMS", "Email"] },
    { authorized: ["SMS", "SMS"], allowed: ["SMS"] },
    { authorized: [], allowed: ["SMS", "IG", "FB"] },
  ])("bloqueia revalidação se os canais anteriores não são válidos: %j", async (channels) => {
    Object.assign(settings, {
      allowed_channels: channels.allowed,
      automation_enabled: true,
      automation_version: 3,
      automation_channels: channels.authorized,
      automation_policy_hash: "b".repeat(64),
    });
    expect(await readAutomation(deps)).toMatchObject({ activationBlock: "unsupported_channel" });
    await expect(changeAutomation(deps, { enabled: true, expectedVersion: 3 })).rejects.toThrow(
      "unsupported_channel",
    );
    expect(command.mock.calls.some(([op]) => op === "automation_set")).toBe(false);
    expect(verifyKnowledge).not.toHaveBeenCalled();
  });
  it("mantém a pausa disponível mesmo após um canal autorizado ser removido", async () => {
    Object.assign(settings, {
      allowed_channels: ["SMS"],
      automation_enabled: true,
      automation_version: 3,
      automation_channels: ["SMS", "IG"],
    });
    await changeAutomation(deps, { enabled: false, expectedVersion: 3 });
    expect(command).toHaveBeenLastCalledWith(
      "automation_set",
      org,
      expect.objectContaining({ enabled: false, channels: ["SMS"] }),
      "actor",
    );
    expect(verifyKnowledge).not.toHaveBeenCalled();
  });
  it.each(["role", "version", "runtime", "write", "receipt", "library"])(
    "recusa ativação inválida: %s",
    async (kind) => {
      if (kind === "role") settings.canManage = false;
      if (kind === "version") settings.automation_version = 1;
      if (kind === "runtime") deps.runtimeReady = false;
      if (kind === "write") deps.writeEnabled = false;
      if (kind === "receipt") settings.receive_all_contacts = false;
      if (kind === "library") verifyKnowledge.mockRejectedValue(new Error("knowledge_unavailable"));
      await expect(changeAutomation(deps, { enabled: true, expectedVersion: 0 })).rejects.toThrow();
      expect(command.mock.calls.some(([op]) => op === "automation_set")).toBe(false);
    },
  );
  it("desligar não exige credenciais/biblioteca/envio disponíveis", async () => {
    deps.runtimeReady = false;
    deps.writeEnabled = false;
    verifyKnowledge.mockRejectedValue(new Error("offline"));
    await changeAutomation(deps, { enabled: false, expectedVersion: 0 });
    expect(command).toHaveBeenLastCalledWith(
      "automation_set",
      org,
      expect.objectContaining({ enabled: false }),
      "actor",
    );
    expect(verifyKnowledge).not.toHaveBeenCalled();
  });
  it("cliente não escolhe policyHash, location, canais ou cutoff", () => {
    expect(
      automationInput.safeParse({
        organizationId: org,
        enabled: true,
        expectedVersion: 0,
        since: "old",
      }).success,
    ).toBe(false);
  });
});
describe("corte de novas mensagens", () => {
  const now = Date.now();
  const snapshot: Snapshot = {
    event: {
      type: "InboundMessage",
      locationId: "loc",
      contactId: "c",
      conversationId: "v",
      messageId: "m",
    },
    name: "Fictício",
    dnd: false,
    historyHash: "history",
    messages: [
      {
        id: "m",
        at: new Date(now - 1000).toISOString(),
        direction: "inbound",
        text: "Olá",
        channel: "SMS",
        attachments: 0,
        provider: null,
      },
    ],
  };
  it("não libera histórico anterior à ativação", () => {
    Object.assign(settings, {
      automation_enabled: true,
      automation_policy_hash: deps.policyHash,
      automation_channels: ["SMS"],
      automation_since: new Date(now).toISOString(),
    });
    expect(automationReason(settings, snapshot, now, deps.policyHash)).toBe(
      "before_automation_since",
    );
  });
  it("aceita só última entrada e política vigente", () => {
    Object.assign(settings, {
      automation_enabled: true,
      automation_policy_hash: deps.policyHash,
      automation_channels: ["SMS"],
      automation_since: new Date(now - 2000).toISOString(),
    });
    expect(automationReason(settings, snapshot, now, deps.policyHash)).toBeNull();
    expect(
      automationReason(
        settings,
        { ...snapshot, event: { ...snapshot.event, messageId: "old" } },
        now,
        deps.policyHash,
      ),
    ).toBe("draft_stale");
    expect(automationReason(settings, snapshot, now, "changed")).toBe("automation_policy_changed");
  });
});
