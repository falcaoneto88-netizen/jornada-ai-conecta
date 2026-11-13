import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  appointmentFinanceFailure,
  appointmentFinanceReadFailure,
  appointmentFinanceReadSchema,
  appointmentFinanceSaveSchema,
} from "./appointment-finance.core";

export const getAppointmentFinance = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(appointmentFinanceReadSchema)
  .handler(async ({ data, context }) => {
    const { authenticatedAppointmentFinance } = await import("./appointment-finance.server");
    const access = await authenticatedAppointmentFinance(context);
    return "failure" in access
      ? appointmentFinanceReadFailure(access.failure)
      : access.service.read(access.scope, data);
  });

export const saveAppointmentFinance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(appointmentFinanceSaveSchema)
  .handler(async ({ data, context }) => {
    const { authenticatedAppointmentFinance } = await import("./appointment-finance.server");
    const access = await authenticatedAppointmentFinance(context);
    return "failure" in access
      ? appointmentFinanceFailure(access.failure)
      : access.service.save(access.scope, data);
  });
