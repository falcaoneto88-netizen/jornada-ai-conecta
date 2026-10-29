import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { workflowMonitoringInputSchema } from "./ghl-workflow-monitoring.core";
import type { resolverAcesso } from "./ghl.functions";

export const consultarMonitoramentoWorkflowGhl = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(workflowMonitoringInputSchema)
  .handler(async ({ data, context }) => {
    const { monitorWorkflowGhl } = await import("./ghl-workflow-monitoring.server");
    return monitorWorkflowGhl(context as unknown as Parameters<typeof resolverAcesso>[0], data);
  });
