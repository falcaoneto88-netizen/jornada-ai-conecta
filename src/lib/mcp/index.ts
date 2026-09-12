import { auth, defineMcp } from "@lovable.dev/mcp-js";

import listAutomationsTool from "./tools/list-automations";
import listContactsTool from "./tools/list-contacts";
import listStagesTool from "./tools/list-stages";
import listTemplatesTool from "./tools/list-templates";
import moveContactStageTool from "./tools/move-contact-stage";
import recentActivityTool from "./tools/recent-activity";
import listBioreportEventsTool from "./tools/list-bioreport-events";

const projectRef = import.meta.env["VITE_SUPABASE_PROJECT_ID"] ?? "project-ref-unset";

export default defineMcp({
  name: "jornada-ai",
  title: "Jornada AI",
  version: "0.2.0",
  instructions:
    "Ferramentas da Jornada AI (Dr. João Falcão) para consultar clientes, etapas da jornada, modelos de mensagem, automações e auditoria, e para mover um cliente de etapa. `list_bioreport_events` consulta os eventos assinados recebidos do BioReport, sem confundir recebimento com execução de workflow ou envio de mensagem. Não forneça diagnósticos clínicos; em temas clínicos recomende revisão humana.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [
    listStagesTool,
    listContactsTool,
    moveContactStageTool,
    listTemplatesTool,
    listAutomationsTool,
    recentActivityTool,
    listBioreportEventsTool,
  ],
});
