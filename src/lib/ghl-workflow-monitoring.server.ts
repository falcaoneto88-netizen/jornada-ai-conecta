import { resolverAcesso, type Acesso, type Recusa } from "./ghl.functions";
import {
  ghlFetch,
  readGhlSecrets,
  GHL_ORIGIN,
  GHL_VERSION,
  urlOficial,
  type GhlConfig,
  type GhlResult,
} from "./ghl.server";
import { idGhl, normalizarWorkflows } from "./ghl-observation.core";
import {
  WORKFLOW_MONITORING_MESSAGES,
  workflowMonitoringInputSchema,
  workflowMonitoringPeriod,
  workflowLogsUrl,
  normalizeWorkflowLogs,
  normalizeWorkflowStatistics,
  type WorkflowMonitoringFailureState,
  type WorkflowMonitoringResult,
  type WorkflowMonitoringStatistics,
} from "./ghl-workflow-monitoring.core";

type Context = Parameters<typeof resolverAcesso>[0];
type ProviderResult =
  { ok: true; data: unknown } | { ok: false; state: WorkflowMonitoringFailureState };
type V3Request = {
  token: string;
  locationId: string;
  workflowId: string;
  operation: "logs" | "statistics";
  query: Record<string, string>;
};
const READ_ROLES = ["administrador", "gestor"] as const;
const MAX_RESPONSE_BYTES = 2_000_000;

function providerError(status: number, body: unknown): WorkflowMonitoringFailureState {
  const item = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const nested =
    item["error"] && typeof item["error"] === "object"
      ? (item["error"] as Record<string, unknown>)
      : {};
  const beta = [item["code"], item["error"], item["message"], nested["code"]].some(
    (value) => value === "WORKFLOW_API_NOT_ENABLED_FOR_LOCATION",
  );
  if (status === 403 && beta) return "beta_unavailable";
  if (status === 403) return "forbidden";
  if (status === 401) return "unauthorized";
  if (status === 429 || status >= 500) return "temporary_error";
  return "contract_error";
}

async function boundedJson(response: Response) {
  if (Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES)
    throw new Error("Response too large");
  if (!response.body) throw new Error("Missing body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("Response too large");
      }
      text += decoder.decode(item.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } finally {
    reader.releaseLock();
  }
}

/** Dedicated v3 reader: no arbitrary method/path, no redirect and no legacy version change. */
export async function readWorkflowV3(
  request: V3Request,
  requestFetch: typeof fetch = fetch,
): Promise<ProviderResult> {
  const workflowId = idGhl.parse(request.workflowId);
  const locationId = idGhl.parse(request.locationId);
  const suffix = request.operation === "logs" ? "logs" : "logs/aggregate";
  // Query is constructed inside the service, but location is still imposed last.
  const url = urlOficial(`workflows/${workflowId}/${suffix}`, { ...request.query, locationId });
  let response: Response;
  try {
    response = await requestFetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${request.token}`,
        Version: "v3",
        Accept: "application/json",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    return { ok: false, state: "temporary_error" };
  }
  if (response.status >= 300 && response.status < 400)
    return { ok: false, state: "contract_error" };
  let body: unknown;
  try {
    body = await boundedJson(response);
  } catch {
    // A malformed error page is never exposed as HTML, provider message or a secret.
    return {
      ok: false,
      state: response.ok ? "contract_error" : providerError(response.status, null),
    };
  }
  return response.ok
    ? { ok: true, data: body }
    : { ok: false, state: providerError(response.status, body) };
}

type Dependencies = {
  access: (context: Context) => Promise<{ ok: true; acesso: Acesso } | Recusa>;
  token: () => string | null;
  catalog: (
    config: GhlConfig,
    path: string,
    init: { query: Record<string, string> },
  ) => Promise<GhlResult<unknown>>;
  read: (request: V3Request) => Promise<ProviderResult>;
  now: () => Date;
};
const defaultDependencies: Dependencies = {
  access: (context) => resolverAcesso(context, READ_ROLES),
  token: () => readGhlSecrets().token,
  catalog: ghlFetch,
  read: readWorkflowV3,
  now: () => new Date(),
};

/** Read-only monitoring is independent from write-enabled and never updates DB/CRM. */
export async function monitorWorkflowGhl(
  context: Context,
  input: unknown,
  deps: Dependencies = defaultDependencies,
): Promise<WorkflowMonitoringResult> {
  const data = workflowMonitoringInputSchema.parse(input);
  const access = await deps.access(context);
  if (!access.ok) throw new Error(access.message);
  const { orgId, locationId, papeis } = access.acesso;
  if (!READ_ROLES.some((role) => papeis.includes(role)))
    throw new Error("Não tem permissão para consultar diagnósticos de workflows.");
  if (orgId !== data.organizationId)
    throw new Error("A organização da sessão mudou. Atualize a página.");
  const now = deps.now();
  const period = workflowMonitoringPeriod(data, now);
  const checkedAt = now.toISOString();
  const failure = (state: WorkflowMonitoringFailureState): WorkflowMonitoringResult => ({
    state,
    checkedAt,
    workflowId: data.workflowId,
    message: WORKFLOW_MONITORING_MESSAGES[state],
  });
  const token = deps.token();
  if (!token) return failure("missing_secrets");
  // Legacy catalog already validates every location. Do not trust a workflow ID from the client.
  try {
    const catalog = await deps.catalog(
      { baseUrl: GHL_ORIGIN, version: GHL_VERSION, token, locationId },
      "workflows/",
      { query: { locationId } },
    );
    if (!catalog.ok) {
      return failure(
        catalog.code === "unauthorized"
          ? "unauthorized"
          : catalog.code === "forbidden"
            ? "forbidden"
            : "temporary_error",
      );
    }
    const workflows = normalizarWorkflows(catalog.data, locationId);
    if (!workflows.some((workflow) => workflow.id === data.workflowId))
      return failure("contract_error");
  } catch {
    return failure("contract_error");
  }
  const query: Record<string, string> = {
    startDate: period.startDate,
    endDate: period.endDate,
    limit: "50",
    action: data.cursor ? "next" : "first",
  };
  if (data.cursor) {
    query["referenceId"] = data.cursor.referenceId;
    query["referenceCreatedAt"] = data.cursor.referenceCreatedAt;
  }
  let logsResult: ProviderResult;
  try {
    logsResult = await deps.read({
      token,
      locationId,
      workflowId: data.workflowId,
      operation: "logs",
      query,
    });
  } catch {
    return failure("temporary_error");
  }
  if (!logsResult.ok) return failure(logsResult.state);
  let normalized: ReturnType<typeof normalizeWorkflowLogs>;
  try {
    normalized = normalizeWorkflowLogs(logsResult.data, {
      locationId,
      workflowId: data.workflowId,
      period,
      ...(data.cursor ? { cursor: data.cursor } : {}),
    });
  } catch {
    return failure("contract_error");
  }

  let statistics: WorkflowMonitoringStatistics | null = null;
  if (!data.cursor) {
    try {
      const aggregate = await deps.read({
        token,
        locationId,
        workflowId: data.workflowId,
        operation: "statistics",
        query: {
          startDate: period.startDate,
          endDate: period.endDate,
          groupBy: "status",
          limit: "1000",
        },
      });
      statistics = aggregate.ok
        ? normalizeWorkflowStatistics(aggregate.data)
        : { state: "unavailable", message: WORKFLOW_MONITORING_MESSAGES[aggregate.state] };
    } catch {
      statistics = {
        state: "unavailable",
        message:
          "As contagens do período não puderam ser verificadas. Os registros abaixo continuam disponíveis.",
      };
    }
  }
  return {
    state: "available",
    organizationId: orgId,
    locationId,
    workflowId: data.workflowId,
    checkedAt,
    period,
    ...normalized,
    statistics,
    workflowUrl: workflowLogsUrl(locationId, data.workflowId),
  };
}
