import { z } from "zod";
import { idGhl } from "./ghl-observation.core";

const utcTimestamp = z.iso.datetime({ offset: false });
export const workflowMonitoringCursorSchema = z
  .object({
    referenceId: idGhl,
    referenceCreatedAt: utcTimestamp,
    // Keep the exact original window while paging; never use a moving `now`.
    dateWindowEnd: utcTimestamp,
  })
  .strict();

export const workflowMonitoringInputSchema = z
  .object({
    organizationId: z.string().uuid(),
    workflowId: idGhl,
    days: z.union([z.literal(7), z.literal(30)]),
    cursor: workflowMonitoringCursorSchema.optional(),
  })
  .strict();

export type WorkflowMonitoringInput = z.infer<typeof workflowMonitoringInputSchema>;
export type WorkflowMonitoringCursor = z.infer<typeof workflowMonitoringCursorSchema>;
export type WorkflowMonitoringFailureState =
  | "beta_unavailable"
  | "forbidden"
  | "unauthorized"
  | "missing_secrets"
  | "contract_error"
  | "temporary_error";
export type WorkflowMonitoringPeriod = { startDate: string; endDate: string; days: 7 | 30 };
export type WorkflowMonitoringLog = {
  id: string;
  contactId: string | null;
  executionId: string | null;
  stepId: string | null;
  stepName: string | null;
  status: string;
  type: string;
  createdAt: string;
  url: string;
};
export type WorkflowMonitoringStatistics =
  | { state: "available"; records: number; byStatus: Array<{ status: string; count: number }> }
  | { state: "unavailable"; message: string };
export type WorkflowMonitoringResult =
  | {
      state: "available";
      organizationId: string;
      locationId: string;
      workflowId: string;
      checkedAt: string;
      period: WorkflowMonitoringPeriod;
      logs: WorkflowMonitoringLog[];
      // Aggregate over the complete date window, fetched on the first page only.
      statistics: WorkflowMonitoringStatistics | null;
      pagination: { nextCursor: WorkflowMonitoringCursor | null; hasMore: boolean };
      workflowUrl: string;
    }
  | {
      state: WorkflowMonitoringFailureState;
      checkedAt: string;
      workflowId: string;
      message: string;
    };

export const WORKFLOW_MONITORING_MESSAGES: Record<WorkflowMonitoringFailureState, string> = {
  beta_unavailable:
    "A API de workflows ainda não está habilitada para esta subconta. O catálogo GHL existente continua disponível.",
  forbidden: "O GHL recusou esta leitura. Confirme as permissões e a subconta autorizada.",
  unauthorized:
    "A nova API recusou a autenticação. A integração existente pode continuar a funcionar. Após a liberação do beta, confira a credencial e os escopos.",
  missing_secrets: "Credenciais GHL indisponíveis no servidor.",
  contract_error:
    "Não foi possível validar os registros devolvidos pelo GHL. Consulte a execução no GHL.",
  temporary_error: "A consulta ao GHL está indisponível neste momento. Tente novamente mais tarde.",
};

const DAY_MS = 86_400_000;
export function workflowMonitoringPeriod(
  input: WorkflowMonitoringInput,
  now: Date,
): WorkflowMonitoringPeriod {
  const end = input.cursor ? Date.parse(input.cursor.dateWindowEnd) : now.getTime();
  const start = end - input.days * DAY_MS;
  if (
    !Number.isFinite(end) ||
    !Number.isFinite(now.getTime()) ||
    end > now.getTime() ||
    start < now.getTime() - 60 * DAY_MS
  ) {
    throw new Error("Período de consulta inválido. Atualize a consulta.");
  }
  if (input.cursor) {
    const reference = Date.parse(input.cursor.referenceCreatedAt);
    if (reference < start || reference > end)
      throw new Error("Cursor fora do período de consulta.");
  }
  return {
    startDate: new Date(start).toISOString(),
    endDate: new Date(end).toISOString(),
    days: input.days,
  };
}

const knownStatuses = new Set([
  "added_to_workflow",
  "success",
  "error",
  "failed",
  "failed_retry_limit_reached",
  "retry",
  "skipped",
  "waiting",
  "wait_finished",
  "finished",
  "paused_due_to_draft_mode",
  "contact_merged",
  "drip_queued",
  "drip_resume",
  "processing",
  "winner_declared",
]);
const knownTypes = new Set([
  "email",
  "sms",
  "whatsapp",
  "wait",
  "if_else",
  "condition",
  "drip",
  "drip_queued",
  "drip_resume",
  "remove_from_workflow",
  "workflow_goal",
  "update_custom_value",
]);
const knownStatus = (value: string) => (knownStatuses.has(value) ? value : "unknown");

export function workflowLogsUrl(locationId: string, workflowId: string) {
  return `https://app.gohighlevel.com/v2/location/${idGhl.parse(locationId)}/automation/workflow/${idGhl.parse(workflowId)}/logs`;
}

const rawCursor = workflowMonitoringCursorSchema.omit({ dateWindowEnd: true }).strip();
const rawLog = z.object({
  id: idGhl,
  locationId: idGhl,
  workflowId: idGhl,
  contactId: idGhl.nullish(),
  workflowStatusId: idGhl.nullish(),
  stepId: idGhl.nullish(),
  stepName: z.string().max(1000).nullish(),
  status: z.string().min(1).max(100),
  type: z.string().min(1).max(100),
  createdAt: utcTimestamp,
});

/** Explicit projection: meta, contacts' names/emails and future provider fields never leave here. */
export function normalizeWorkflowLogs(
  raw: unknown,
  scope: {
    locationId: string;
    workflowId: string;
    period: WorkflowMonitoringPeriod;
    cursor?: WorkflowMonitoringCursor;
  },
) {
  const parsed = z
    .object({
      count: z.number().int().nonnegative().max(100),
      nextCursor: rawCursor.nullable(),
      logs: z.array(rawLog).max(100),
    })
    .parse(raw);
  if (parsed.count !== parsed.logs.length) throw new Error("Contagem de registros incompatível.");
  const start = Date.parse(scope.period.startDate);
  const end = Date.parse(scope.period.endDate);
  const ids = new Set<string>();
  const workflowUrl = workflowLogsUrl(scope.locationId, scope.workflowId);
  const logs: WorkflowMonitoringLog[] = parsed.logs.map((log) => {
    const timestamp = Date.parse(log.createdAt);
    if (
      log.locationId !== scope.locationId ||
      log.workflowId !== scope.workflowId ||
      timestamp < start ||
      timestamp > end ||
      ids.has(log.id)
    ) {
      throw new Error("Registro fora do escopo autorizado.");
    }
    ids.add(log.id);
    const url = new URL(workflowUrl);
    if (log.contactId) url.searchParams.set("contactId", log.contactId);
    if (log.workflowStatusId) url.searchParams.set("executionId", log.workflowStatusId);
    return {
      id: log.id,
      contactId: log.contactId ?? null,
      executionId: log.workflowStatusId ?? null,
      stepId: log.stepId ?? null,
      stepName: log.stepName ?? null,
      status: knownStatus(log.status),
      type: knownTypes.has(log.type) ? log.type : "unknown",
      createdAt: log.createdAt,
      url: url.toString(),
    };
  });
  let nextCursor: WorkflowMonitoringCursor | null = null;
  if (parsed.nextCursor) {
    const nextTime = Date.parse(parsed.nextCursor.referenceCreatedAt);
    if (
      !logs.length ||
      nextTime < start ||
      nextTime > end ||
      (scope.cursor &&
        (nextTime > Date.parse(scope.cursor.referenceCreatedAt) ||
          (parsed.nextCursor.referenceId === scope.cursor.referenceId &&
            parsed.nextCursor.referenceCreatedAt === scope.cursor.referenceCreatedAt)))
    ) {
      throw new Error("Cursor de paginação inválido.");
    }
    nextCursor = { ...parsed.nextCursor, dateWindowEnd: scope.period.endDate };
  }
  return { logs, pagination: { nextCursor, hasMore: nextCursor !== null } };
}

/** Provider `count` is the number of grouped rows, NOT the number of records. */
export function normalizeWorkflowStatistics(raw: unknown): WorkflowMonitoringStatistics {
  const parsed = z
    .object({
      count: z.number().int().nonnegative().max(1000),
      statistics: z
        .array(
          z.object({
            status: z.string().min(1).max(100),
            count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
          }),
        )
        .max(1000),
    })
    .parse(raw);
  if (parsed.count !== parsed.statistics.length) throw new Error("Contagem agregada incompatível.");
  const groups = new Map<string, number>();
  const rawStatuses = new Set<string>();
  let records = 0;
  for (const row of parsed.statistics) {
    if (rawStatuses.has(row.status)) throw new Error("Grupo de estatística duplicado.");
    rawStatuses.add(row.status);
    records += row.count;
    if (!Number.isSafeInteger(records)) throw new Error("Contagem agregada inválida.");
    const status = knownStatus(row.status);
    groups.set(status, (groups.get(status) ?? 0) + row.count);
  }
  return {
    state: "available",
    records,
    byStatus: Array.from(groups, ([status, count]) => ({ status, count })),
  };
}
