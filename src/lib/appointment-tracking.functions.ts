import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  consultaEvidencias,
  guardarEvidenciaSchema,
  leituraAcompanhamento,
} from "./appointment-tracking.core";
import type { resolverAcesso } from "./ghl.functions";
type Ctx = Parameters<typeof resolverAcesso>[0];
async function seguro<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Error && e.name === "ZodError")
      throw new Error("Formato de evidência inesperado. Confira o registro no GHL.");
    throw e;
  }
}
export const getAppointmentTracking = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(leituraAcompanhamento)
  .handler(async ({ data, context }) => {
    const { lerAcompanhamento } = await import("./appointment-tracking.server");
    return seguro(() => lerAcompanhamento(context as unknown as Ctx, data));
  });
export const getAppointmentEvidence = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(consultaEvidencias)
  .handler(async ({ data, context }) => {
    const { buscarEvidencias } = await import("./appointment-tracking.server");
    return seguro(() => buscarEvidencias(context as unknown as Ctx, data));
  });
export const recordAppointmentEvidence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(guardarEvidenciaSchema)
  .handler(async ({ data, context }) => {
    const { gravarAcompanhamento } = await import("./appointment-tracking.server");
    return seguro(() => gravarAcompanhamento(context as unknown as Ctx, data));
  });
