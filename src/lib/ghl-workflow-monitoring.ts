import { useInfiniteQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { consultarMonitoramentoWorkflowGhl } from "./ghl-workflow-monitoring.functions";
import type { WorkflowMonitoringResult } from "./ghl-workflow-monitoring.core";
import { useOrganizacao } from "./organization";
import { usePermissoes } from "./repo";
import { useSessao } from "./session";

type MonitoringPage = Extract<WorkflowMonitoringResult, { state: "available" }>;
type MonitoringFailure = Exclude<WorkflowMonitoringResult, { state: "available" }>;
type MonitoringCursor = NonNullable<MonitoringPage["pagination"]["nextCursor"]>;

/** A failed subsequent page must remain retryable without discarding loaded evidence. */
export class WorkflowMonitoringReadError extends Error {
  constructor(public readonly state: MonitoringFailure["state"]) {
    super("Não foi possível consultar os registros do workflow.");
  }
}

/** Mounted only after the operator requests a workflow. No background polling. */
export function useWorkflowMonitoring(workflowId: string, days: 7 | 30) {
  const { user, modo } = useSessao();
  const { data } = useOrganizacao();
  const { gerirJornada } = usePermissoes();
  const organizationId = data?.organizacao.id;
  const read = useServerFn(consultarMonitoramentoWorkflowGhl);
  const allowed = Boolean(user && organizationId && modo === "conta" && gerirJornada);
  const query = useInfiniteQuery({
    queryKey: ["ghl-workflow-monitoring", user?.id, organizationId, workflowId, days],
    enabled: allowed && Boolean(workflowId),
    initialPageParam: undefined as MonitoringCursor | undefined,
    queryFn: async ({ pageParam }) => {
      const page = await read({
        data: {
          organizationId: organizationId!,
          workflowId,
          days,
          ...(pageParam ? { cursor: pageParam } : {}),
        },
      });
      if (pageParam && page.state !== "available") {
        throw new WorkflowMonitoringReadError(page.state);
      }
      return page;
    },
    getNextPageParam: (page) =>
      page.state === "available" && page.pagination.hasMore
        ? (page.pagination.nextCursor ?? undefined)
        : undefined,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
  return { ...query, allowed };
}
