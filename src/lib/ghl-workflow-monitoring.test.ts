import { describe, expect, it, vi } from "vitest";
import {
  normalizeWorkflowLogs,
  normalizeWorkflowStatistics,
  workflowMonitoringInputSchema,
  workflowMonitoringPeriod,
} from "./ghl-workflow-monitoring.core";
import { monitorWorkflowGhl, readWorkflowV3 } from "./ghl-workflow-monitoring.server";

const organizationId = "11111111-1111-4111-8111-111111111111";
const input = { organizationId, workflowId: "workflow_A", days: 7 as const };
const now = new Date("2026-10-28T12:00:00.000Z");
const period = {
  startDate: "2026-10-21T12:00:00.000Z",
  endDate: now.toISOString(),
  days: 7 as const,
};
const log = {
  id: "log_A",
  locationId: "location_A",
  workflowId: "workflow_A",
  contactId: "contact_A",
  workflowStatusId: "execution_A",
  stepId: "step_A",
  stepName: "Etapa sintética",
  status: "success",
  type: "sms",
  createdAt: "2026-10-27T11:00:00.000Z",
  contactName: "PRIVATE_NAME",
  contactEmail: "private@example.invalid",
  meta: { error: "RAW_SECRET" },
};
const ctx = { userId: "user_A", supabase: {} as never };
const scope = { locationId: "location_A", workflowId: "workflow_A", period };
const logs = { count: 1, logs: [log], nextCursor: null };
const aggregate = {
  count: 2,
  statistics: [
    { status: "success", count: 42 },
    { status: "failed", count: 3 },
  ],
};
function dependencies() {
  return {
    access: vi.fn(async () => ({
      ok: true as const,
      acesso: {
        orgId: organizationId,
        locationId: "location_A",
        nome: null,
        papeis: ["gestor" as const],
        conn: { write_enabled: false },
      },
    })),
    token: vi.fn(() => "FAKE_TEST_TOKEN" as string | null),
    catalog: vi.fn(async () => ({
      ok: true as const,
      status: 200,
      data: {
        workflows: [
          { id: "workflow_A", name: "Sintético", locationId: "location_A", status: "published" },
        ],
      } as unknown,
    })),
    read: vi.fn(
      async (request: { operation: "logs" | "statistics" }) =>
        ({ ok: true as const, data: request.operation === "logs" ? logs : aggregate }) as
          | { ok: true; data: unknown }
          | { ok: false; state: "beta_unavailable" | "temporary_error" | "forbidden" },
    ),
    now: () => now,
  };
}

describe("contrato de monitoramento GHL", () => {
  it("não aceita location, método, URL, datas arbitrárias nem períodos fora da allowlist", () => {
    for (const extra of [
      { locationId: "other" },
      { method: "POST" },
      { url: "https://elsewhere.invalid" },
      { startDate: now.toISOString() },
      { days: 90 },
    ]) {
      expect(workflowMonitoringInputSchema.safeParse({ ...input, ...extra }).success).toBe(false);
    }
    for (const workflowId of [
      "../secret",
      "https://elsewhere.invalid",
      "x?locationId=other",
      "x%2Flogs",
    ]) {
      expect(workflowMonitoringInputSchema.safeParse({ ...input, workflowId }).success).toBe(false);
    }
  });
  it("recusa cursor incompleto, datas inválidas e fora da retenção antes da leitura", () => {
    expect(
      workflowMonitoringInputSchema.safeParse({ ...input, cursor: { referenceId: "x" } }).success,
    ).toBe(false);
    expect(
      workflowMonitoringInputSchema.safeParse({
        ...input,
        cursor: {
          referenceId: "x",
          referenceCreatedAt: "2026-02-30T00:00:00Z",
          dateWindowEnd: now.toISOString(),
        },
      }).success,
    ).toBe(false);
    expect(() =>
      workflowMonitoringPeriod(
        {
          ...input,
          cursor: {
            referenceId: "x",
            referenceCreatedAt: "2026-08-01T00:00:00Z",
            dateWindowEnd: "2026-08-02T00:00:00Z",
          },
        },
        now,
      ),
    ).toThrow();
    expect(() =>
      workflowMonitoringPeriod(
        {
          ...input,
          cursor: {
            referenceId: "x",
            referenceCreatedAt: "2027-01-01T00:00:00Z",
            dateWindowEnd: "2027-01-01T00:00:00Z",
          },
        },
        now,
      ),
    ).toThrow();
  });
  it("projeta campos administrativos, preserva skipped/waiting e não retorna meta ou dados de contato", () => {
    const result = normalizeWorkflowLogs(
      {
        count: 2,
        logs: [
          { ...log, status: "skipped" },
          { ...log, id: "log_B", status: "waiting" },
        ],
        nextCursor: null,
      },
      scope,
    );
    expect(result.logs.map((entry) => entry.status)).toEqual(["skipped", "waiting"]);
    expect(result.logs[0]?.url).toContain("contactId=contact_A&executionId=execution_A");
    expect(JSON.stringify(result)).not.toMatch(/RAW_SECRET|PRIVATE_NAME|private@example/);
    expect(result.logs[0]).not.toHaveProperty("meta");
  });
  it.each(["locationId", "workflowId"])("rejeita %s de outro escopo", (key) => {
    expect(() =>
      normalizeWorkflowLogs({ ...logs, logs: [{ ...log, [key]: "other" }] }, scope),
    ).toThrow();
  });
  it("rejeita log fora da janela, duplicação, contagem ou envelope inválidos", () => {
    expect(() =>
      normalizeWorkflowLogs(
        { ...logs, logs: [{ ...log, createdAt: "2026-10-01T00:00:00.000Z" }] },
        scope,
      ),
    ).toThrow();
    expect(() => normalizeWorkflowLogs({ ...logs, count: 2, logs: [log, log] }, scope)).toThrow();
    expect(() => normalizeWorkflowLogs({ ...logs, count: 2 }, scope)).toThrow();
    expect(() => normalizeWorkflowLogs({ error: "not authorized" }, scope)).toThrow();
  });
  it("mantém a janela original no cursor e recusa cursor repetido ou sem registros", () => {
    const raw = { referenceId: "older", referenceCreatedAt: "2026-10-26T11:00:00.000Z" };
    const result = normalizeWorkflowLogs({ ...logs, nextCursor: raw }, scope);
    expect(result.pagination.nextCursor).toEqual({ ...raw, dateWindowEnd: period.endDate });
    expect(() =>
      normalizeWorkflowLogs(
        { ...logs, nextCursor: raw },
        { ...scope, cursor: { ...raw, dateWindowEnd: period.endDate } },
      ),
    ).toThrow();
    expect(() => normalizeWorkflowLogs({ count: 0, logs: [], nextCursor: raw }, scope)).toThrow();
  });
  it("trata novos valores como desconhecidos e soma registros, não o número de grupos", () => {
    const result = normalizeWorkflowStatistics(aggregate);
    expect(result).toEqual({
      state: "available",
      records: 45,
      byStatus: [
        { status: "success", count: 42 },
        { status: "failed", count: 3 },
      ],
    });
    expect(
      normalizeWorkflowLogs(
        { ...logs, logs: [{ ...log, status: "new_status", type: "new_type" }] },
        scope,
      ).logs[0],
    ).toMatchObject({ status: "unknown", type: "unknown" });
    expect(
      normalizeWorkflowStatistics({
        count: 2,
        statistics: [
          { status: "new_a", count: 2 },
          { status: "new_b", count: 3 },
        ],
      }),
    ).toEqual({ state: "available", records: 5, byStatus: [{ status: "unknown", count: 5 }] });
    expect(() => normalizeWorkflowStatistics({ ...aggregate, count: 45 })).toThrow();
    expect(() =>
      normalizeWorkflowStatistics({
        count: 2,
        statistics: [
          { status: "success", count: 2 },
          { status: "success", count: 2 },
        ],
      }),
    ).toThrow();
  });
});

describe("acesso e serviço read-only", () => {
  it("autoriza sessão, valida organização e catálogo antes de consultar v3, sem depender de escrita", async () => {
    const deps = dependencies();
    const result = await monitorWorkflowGhl(ctx, input, deps);
    expect(deps.access).toHaveBeenCalledBefore(deps.token);
    expect(deps.token).toHaveBeenCalledBefore(deps.catalog);
    expect(deps.catalog).toHaveBeenCalledBefore(deps.read);
    expect(deps.catalog).toHaveBeenCalledWith(
      expect.objectContaining({ locationId: "location_A" }),
      "workflows/",
      { query: { locationId: "location_A" } },
    );
    expect(deps.read).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        operation: "logs",
        query: {
          startDate: period.startDate,
          endDate: period.endDate,
          limit: "50",
          action: "first",
        },
      }),
    );
    expect(result).toMatchObject({
      state: "available",
      statistics: { state: "available", records: 45 },
    });
    expect(JSON.stringify(result)).not.toMatch(/FAKE_TEST_TOKEN|RAW_SECRET|PRIVATE_NAME/);
  });
  it("recusa organização trocada sem tocar credencial ou rede", async () => {
    const deps = dependencies();
    await expect(
      monitorWorkflowGhl(
        ctx,
        { ...input, organizationId: "22222222-2222-4222-8222-222222222222" },
        deps,
      ),
    ).rejects.toThrow("organização");
    expect(deps.token).not.toHaveBeenCalled();
    expect(deps.catalog).not.toHaveBeenCalled();
  });
  it("recusa ausência de binding/papel antes de ler token", async () => {
    const deps = {
      ...dependencies(),
      access: vi.fn(async () => ({
        ok: false as const,
        code: "forbidden" as const,
        message: "Sem permissão",
      })),
    };
    await expect(monitorWorkflowGhl(ctx, input, deps)).rejects.toThrow("Sem permissão");
    expect(deps.token).not.toHaveBeenCalled();
  });
  it("comercial e visualizador não obtêm diagnósticos mesmo se uma dependência omitir a restrição", async () => {
    const original = dependencies();
    const deps = {
      ...original,
      access: vi.fn(async () => ({
        ok: true as const,
        acesso: { ...(await original.access()).acesso, papeis: ["comercial" as const] },
      })),
    };
    await expect(monitorWorkflowGhl(ctx, input, deps)).rejects.toThrow("permissão");
    expect(deps.token).not.toHaveBeenCalled();
  });
  it("informa segredo ausente sem pedir catálogo", async () => {
    const deps = dependencies();
    deps.token.mockReturnValue(null);
    expect(await monitorWorkflowGhl(ctx, input, deps)).toMatchObject({ state: "missing_secrets" });
    expect(deps.catalog).not.toHaveBeenCalled();
  });
  it("não consulta workflow inventado ou fora da subconta", async () => {
    const deps = dependencies();
    expect(await monitorWorkflowGhl(ctx, { ...input, workflowId: "invented" }, deps)).toMatchObject(
      { state: "contract_error" },
    );
    expect(deps.read).not.toHaveBeenCalled();
    deps.catalog.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {
        workflows: [{ id: "workflow_A", name: "Other", locationId: "other", status: "published" }],
      },
    });
    expect(await monitorWorkflowGhl(ctx, input, deps)).toMatchObject({ state: "contract_error" });
    expect(deps.read).not.toHaveBeenCalled();
  });
  it("beta indisponível nunca vira lista vazia nem dispara aggregate", async () => {
    const deps = dependencies();
    deps.read.mockResolvedValueOnce({ ok: false, state: "beta_unavailable" });
    expect(await monitorWorkflowGhl(ctx, input, deps)).toMatchObject({ state: "beta_unavailable" });
    expect(deps.read).toHaveBeenCalledTimes(1);
  });
  it("falha de aggregate preserva logs e torna contagens explicitamente indisponíveis", async () => {
    const deps = dependencies();
    deps.read
      .mockResolvedValueOnce({ ok: true, data: logs })
      .mockResolvedValueOnce({ ok: false, state: "temporary_error" });
    expect(await monitorWorkflowGhl(ctx, input, deps)).toMatchObject({
      state: "available",
      logs: [expect.objectContaining({ id: "log_A" })],
      statistics: { state: "unavailable" },
    });
  });
  it("pagina com o período congelado e não repete aggregate", async () => {
    const deps = dependencies();
    const cursor = {
      referenceId: "next",
      referenceCreatedAt: "2026-10-27T12:00:00.000Z",
      dateWindowEnd: "2026-10-28T11:00:00.000Z",
    };
    expect(await monitorWorkflowGhl(ctx, { ...input, cursor }, deps)).toMatchObject({
      state: "available",
      statistics: null,
      period: { startDate: "2026-10-21T11:00:00.000Z", endDate: cursor.dateWindowEnd },
    });
    expect(deps.read).toHaveBeenCalledTimes(1);
    expect(deps.read).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          action: "next",
          referenceId: "next",
          referenceCreatedAt: cursor.referenceCreatedAt,
        }),
      }),
    );
  });
  it("não vaza Zod/payload bruto quando o provedor devolve dados inválidos", async () => {
    const deps = dependencies();
    deps.read.mockResolvedValueOnce({ ok: true, data: { secret: "RAW_SECRET" } });
    const result = await monitorWorkflowGhl(ctx, input, deps);
    expect(result).toMatchObject({ state: "contract_error" });
    expect(JSON.stringify(result)).not.toContain("RAW_SECRET");
  });
});

describe("transporte GHL v3 isolado", () => {
  const request = {
    token: "FAKE_TOKEN",
    locationId: "location_A",
    workflowId: "workflow_A",
    operation: "logs" as const,
    query: { startDate: period.startDate, endDate: period.endDate },
  };
  it("fixa origem, GET, versão v3 e location; impede redirecionamento e não envia corpo", async () => {
    const fetcher = vi.fn(async () => Response.json(logs));
    await readWorkflowV3({ ...request, query: { ...request.query, locationId: "other" } }, fetcher);
    const [url, options] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.origin).toBe("https://services.leadconnectorhq.com");
    expect(url.pathname).toBe("/workflows/workflow_A/logs");
    expect(url.searchParams.get("locationId")).toBe("location_A");
    expect(options).toMatchObject({
      method: "GET",
      redirect: "manual",
      headers: { Authorization: "Bearer FAKE_TOKEN", Version: "v3" },
    });
    expect(options.body).toBeUndefined();
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });
  it.each([
    [403, { code: "WORKFLOW_API_NOT_ENABLED_FOR_LOCATION" }, "beta_unavailable"],
    [403, { error: { code: "WORKFLOW_API_NOT_ENABLED_FOR_LOCATION" } }, "beta_unavailable"],
    [403, { message: "RAW_SECRET" }, "forbidden"],
    [401, { code: "WORKFLOW_API_NOT_ENABLED_FOR_LOCATION" }, "unauthorized"],
    [429, {}, "temporary_error"],
    [500, {}, "temporary_error"],
    [422, {}, "contract_error"],
    [404, {}, "contract_error"],
  ])("classifica HTTP %s sem expor o corpo de erro", async (status, body, state) => {
    const result = await readWorkflowV3(
      request,
      vi.fn(async () => Response.json(body, { status })),
    );
    expect(result).toEqual({ ok: false, state });
    expect(JSON.stringify(result)).not.toContain("RAW_SECRET");
  });
  it("bloqueia redirect sem seguir; rejeita resposta malformada ou grande", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(null, { status: 302, headers: { location: "https://elsewhere.invalid" } }),
    );
    expect(await readWorkflowV3(request, fetcher)).toEqual({ ok: false, state: "contract_error" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(
      await readWorkflowV3(
        request,
        vi.fn(async () => new Response("<html>RAW_SECRET</html>")),
      ),
    ).toEqual({ ok: false, state: "contract_error" });
    expect(
      await readWorkflowV3(
        request,
        vi.fn(async () => new Response("{}", { headers: { "content-length": "2000001" } })),
      ),
    ).toEqual({ ok: false, state: "contract_error" });
  });
  it("não repete leitura automática quando a conexão falha", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("RAW_SECRET");
    });
    expect(await readWorkflowV3(request, fetcher)).toEqual({ ok: false, state: "temporary_error" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
