import type { GhlResult } from "./ghl.server";

/** A transação remota não pode ser atómica com o log local: guardar a intenção primeiro. */
export async function executarEscritaAuditada<T>(deps: {
  registar: (fase: "tentativa" | "resultado", resultado?: GhlResult<T>) => Promise<boolean>;
  executar: () => Promise<GhlResult<T>>;
}): Promise<GhlResult<T> & { warning?: string }> {
  const registar = async (fase: "tentativa" | "resultado", resultado?: GhlResult<T>) => {
    try {
      return await deps.registar(fase, resultado);
    } catch {
      return false;
    }
  };
  if (!(await registar("tentativa")))
    return {
      ok: false,
      status: 0,
      code: "server_error",
      message: "Não foi possível registar a tentativa. A operação não foi enviada ao GoHighLevel.",
    };
  let resultado: GhlResult<T>;
  try {
    resultado = await deps.executar();
  } catch {
    resultado = {
      ok: false,
      status: 0,
      code: "outcome_unknown",
      message: "Resultado não confirmado. Verifique no GoHighLevel antes de repetir.",
    };
  }
  if (await registar("resultado", resultado)) return resultado;
  // Não converter um envio confirmado em erro que convide a reenviar.
  return {
    ...resultado,
    warning:
      "O resultado não foi registado na auditoria. A tentativa está registada; verifique no GoHighLevel antes de repetir.",
  };
}
