/**
 * Operação administrativa do sistema: liga o funil autorizado e importa as
 * oportunidades em leitura, sem impersonar nenhum utilizador.
 *
 * Executa apenas com o vínculo fixo já validado (organização <-> location)
 * e regista a auditoria como operação do sistema.
 *
 *   bun scripts/importar-funil-sistema.ts <pipelineId>
 */
import { createClient } from "@supabase/supabase-js";

import { GHL_ORIGIN, GHL_VERSION } from "../src/lib/ghl.server";
import {
  executarConfiguracaoPipeline,
  executarSincronizacaoOportunidades,
} from "../src/lib/ghl-pipelines.functions";

const ORG_ID = "f07ab3be-7419-4779-a901-ef71c5fc27f0";
const LOCATION_ID = "ok2UHC2QMZsd8UHsAgEa";
const ATOR = { id: null, nome: "Sistema (operação administrativa)" };

async function main() {
  const pipelineId = process.argv[2];
  if (!pipelineId) throw new Error("Indique o pipelineId.");

  const token = process.env["GHL_PRIVATE_TOKEN"];
  const locationSecret = process.env["GHL_LOCATION_ID"];
  const url = process.env["SUPABASE_URL"];
  const chave = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!token || !locationSecret || !url || !chave) throw new Error("Credenciais do backend em falta.");
  if (locationSecret !== LOCATION_ID) throw new Error("A location dos secrets não é a autorizada.");

  const supabase = createClient(url, chave, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: conn, error } = await supabase
    .from("ghl_connections")
    .select("organization_id, location_id, status")
    .eq("organization_id", ORG_ID)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!conn || conn.location_id !== LOCATION_ID) throw new Error("Vínculo organização/location não confirmado.");
  if (conn.status !== "conectada") throw new Error("Ligação por validar.");

  const cfg = { baseUrl: GHL_ORIGIN, version: GHL_VERSION, token, locationId: LOCATION_ID };

  const config = await executarConfiguracaoPipeline({ supabase, orgId: ORG_ID, cfg, pipelineId, ator: ATOR });
  console.log("configuração:", JSON.stringify(config, null, 2));
  if (!config.ok) return;

  const sync = await executarSincronizacaoOportunidades({
    supabase,
    orgId: ORG_ID,
    locationId: LOCATION_ID,
    cfg,
    pipelineId,
    ator: ATOR,
  });
  console.log("importação:", JSON.stringify(sync, null, 2));
}

void main().catch((e) => {
  console.error("falhou:", (e as Error).message);
  process.exitCode = 1;
});
