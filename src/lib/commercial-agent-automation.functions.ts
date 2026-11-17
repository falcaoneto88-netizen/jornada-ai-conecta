import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { automationInput } from "./commercial-agent/automation";

export const getIzabelAutomation = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(automationInput.pick({ organizationId: true }))
  .handler(async ({ data, context }) => {
    const { safe } = await import("./commercial-agent/runtime.server");
    return safe(async () => {
      const { automationControl } = await import("./commercial-agent/automation-context.server");
      const { readAutomation } = await import("./commercial-agent/automation-control.server");
      return readAutomation(await automationControl(context, data.organizationId));
    });
  });
export const setIzabelAutomation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(automationInput)
  .handler(async ({ data, context }) => {
    const { safe } = await import("./commercial-agent/runtime.server");
    return safe(async () => {
      const { automationControl } = await import("./commercial-agent/automation-context.server");
      const { changeAutomation } = await import("./commercial-agent/automation-control.server");
      return changeAutomation(await automationControl(context, data.organizationId), data);
    });
  });
