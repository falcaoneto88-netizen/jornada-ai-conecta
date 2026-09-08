/**
 * Camada de dados: em modo demonstração devolve os dados fictícios locais;
 * com conta iniciada, lê e escreve na base de dados da organização (RLS ativa).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import {
  automationRuns as demoRuns,
  automations as demoAutomations,
  contacts as demoContacts,
  conversations as demoConversations,
  journeyStages as demoStages,
  labelPasso,
  messageTemplates as demoTemplates,
  resumoPasso,
  type Automation,
  type AutomationRun,
  type AutomationStatus,
  type AutomationStep,
  type Canal,
  type Contact,
  type Conversation,
  type JourneyStage,
  type MessageTemplate,
  type StageId,
} from "@/lib/demo-data";
import { useSessao } from "@/lib/session";

function gerarId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function parsePassos(steps: unknown): AutomationStep[] {
  if (!Array.isArray(steps)) return [];
  return steps.map((s) => {
    if (typeof s === "string") return { tipo: "texto", id: gerarId(), texto: s };
    if (s && typeof s === "object") {
      const obj = s as Record<string, unknown>;
      const id = typeof obj["id"] === "string" ? obj["id"] : gerarId();
      const tipo = obj["tipo"];
      if (tipo === "condicao") return { ...(obj as object), id } as AutomationStep;
      if (tipo === "acao") return { ...(obj as object), id } as AutomationStep;
      if (tipo === "espera") return { ...(obj as object), id } as AutomationStep;
      if (tipo === "texto") return { ...(obj as object), id } as AutomationStep;
    }
    return { tipo: "texto", id: gerarId(), texto: String(s) };
  });
}

export function useModoDados() {
  const { modo, carregando, user } = useSessao();
  return { demo: modo !== "conta", carregando, user, modo };
}

function dataPt(valor: string | null | undefined) {
  if (!valor) return "—";
  return new Date(valor).toLocaleDateString("pt-PT");
}

function dataHoraPt(valor: string | null | undefined) {
  if (!valor) return "—";
  return new Date(valor).toLocaleString("pt-PT", { dateStyle: "short", timeStyle: "short" });
}

async function orgIdAtual(): Promise<string> {
  const { data, error } = await supabase.from("profiles").select("organization_id").maybeSingle();
  if (error || !data) throw new Error("Não foi possível identificar a organização.");
  return data.organization_id;
}

export async function registarAuditoria(action: string, entity: string, metadata: Record<string, unknown> = {}) {
  try {
    const organization_id = await orgIdAtual();
    const { data: userData } = await supabase.auth.getUser();
    await supabase.from("audit_logs").insert({
      organization_id,
      actor_id: userData.user?.id ?? null,
      actor_name: userData.user?.email ?? null,
      action,
      entity,
      metadata: metadata as never,
    });
  } catch {
    /* auditoria nunca deve quebrar a interface */
  }
}

/* ---------------- Etapas ---------------- */

export function useEtapas() {
  const { demo } = useModoDados();
  return useQuery<JourneyStage[]>({
    queryKey: ["etapas", demo],
    queryFn: async () => {
      if (demo) return demoStages;
      const { data, error } = await supabase
        .from("journey_stages")
        .select("key,name,ghl_pipeline_id,ghl_stage_id,position")
        .order("position");
      if (error) throw error;
      return (data ?? []).map((s) => ({
        id: s.key as StageId,
        nome: s.name,
        ghlPipelineId: s.ghl_pipeline_id,
        ghlStageId: s.ghl_stage_id,
      }));
    },
  });
}

export function useGuardarMapeamentoEtapa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { key: string; pipelineId: string | null; stageId: string | null }) => {
      const { error } = await supabase
        .from("journey_stages")
        .update({ ghl_pipeline_id: input.pipelineId, ghl_stage_id: input.stageId })
        .eq("key", input.key);
      if (error) throw error;
      await registarAuditoria("etapa.mapeamento_atualizado", "journey_stages", { key: input.key });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["etapas"] }),
  });
}

/* ---------------- Contactos ---------------- */

export function useContactos() {
  const { demo } = useModoDados();
  return useQuery<Contact[]>({
    queryKey: ["contactos", demo],
    queryFn: async () => {
      if (demo) return demoContacts;
      const { data, error } = await supabase
        .from("contacts")
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((c) => ({
        id: c.id,
        nome: c.full_name,
        telefone: c.phone ?? "—",
        email: c.email ?? "—",
        etapa: (c.stage_key ?? "novo_lead") as StageId,
        tags: c.tags ?? [],
        origem: c.source ?? "—",
        canal: "whatsapp" as Canal,
        responsavel: c.owner_name ?? "—",
        proximaAcao: c.next_action ?? "—",
        ultimaInteracao: dataPt(c.last_interaction_at ?? c.updated_at),
        agendamento: c.next_action_at ? dataHoraPt(c.next_action_at) : null,
        timeline: [
          { data: dataPt(c.created_at), titulo: "Registo criado", detalhe: c.source ?? "Origem não indicada" },
          ...(c.notes ? [{ data: dataPt(c.updated_at), titulo: "Nota", detalhe: c.notes }] : []),
        ],
      }));
    },
  });
}

export function useMoverContacto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; etapa: StageId; nome: string }) => {
      const { error } = await supabase
        .from("contacts")
        .update({ stage_key: input.etapa, last_interaction_at: new Date().toISOString() })
        .eq("id", input.id);
      if (error) throw error;
      await registarAuditoria("contacto.etapa_alterada", "contacts", { id: input.id, etapa: input.etapa });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["contactos"] }),
  });
}

/* ---------------- Modelos de mensagem ---------------- */

const canaisValidos: Canal[] = ["whatsapp", "instagram", "facebook", "email"];

export function useModelos() {
  const { demo } = useModoDados();
  return useQuery<MessageTemplate[]>({
    queryKey: ["modelos", demo],
    queryFn: async () => {
      if (demo) return demoTemplates;
      const { data, error } = await supabase.from("message_templates").select("*").order("created_at");
      if (error) throw error;
      return (data ?? []).map((t) => ({
        id: t.id,
        nome: t.name,
        etapa: (t.stage_key ?? "novo_lead") as StageId,
        canal: (canaisValidos.includes(t.channel as Canal) ? t.channel : "whatsapp") as Canal,
        idioma: t.language as MessageTemplate["idioma"],
        corpo: t.body,
      }));
    },
  });
}

export function useGuardarModelo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<MessageTemplate> & { id?: string }) => {
      const organization_id = await orgIdAtual();
      const linha = {
        organization_id,
        name: input.nome ?? "Novo modelo",
        stage_key: input.etapa ?? "novo_lead",
        channel: input.canal ?? "whatsapp",
        language: input.idioma ?? "PT-PT",
        body: input.corpo ?? "",
      };
      if (input.id) {
        const { error } = await supabase.from("message_templates").update(linha).eq("id", input.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("message_templates").insert(linha);
        if (error) throw error;
      }
      await registarAuditoria("modelo.guardado", "message_templates", { nome: linha.name });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["modelos"] }),
  });
}

export function useApagarModelo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("message_templates").delete().eq("id", id);
      if (error) throw error;
      await registarAuditoria("modelo.apagado", "message_templates", { id });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["modelos"] }),
  });
}

/* ---------------- Automações ---------------- */

export function useAutomacoes() {
  const { demo } = useModoDados();
  return useQuery<Automation[]>({
    queryKey: ["automacoes", demo],
    queryFn: async () => {
      if (demo) return demoAutomations;
      const { data, error } = await supabase.from("automations").select("*").order("created_at");
      if (error) throw error;
      return (data ?? []).map((a) => ({
        id: a.id,
        nome: a.name,
        descricao: a.description ?? "",
        status: a.status as AutomationStatus,
        versao: a.current_version,
        gatilho: a.trigger_type,
        passos: parsePassos(a.steps),
        ultimaExecucao: dataHoraPt(a.last_run_at),
        taxaSucesso: a.runs_total > 0 ? Math.round((a.runs_success / a.runs_total) * 100) : 0,
        erros: a.runs_error,
      }));
    },
  });
}

export function useGuardarAutomacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id?: string;
      nome: string;
      descricao?: string;
      gatilho: string;
      passos: AutomationStep[];
      status: AutomationStatus;
    }) => {
      const organization_id = await orgIdAtual();
      const definicao = {
        nome: input.nome,
        descricao: input.descricao,
        gatilho: input.gatilho,
        passos: input.passos,
      };

      if (input.id) {
        const { data: atual, error: erroLeitura } = await supabase
          .from("automations")
          .select("current_version")
          .eq("id", input.id)
          .maybeSingle();
        if (erroLeitura) throw erroLeitura;

        const proximaVersao = (atual?.current_version ?? 0) + 1;
        const { error } = await supabase
          .from("automations")
          .update({
            name: input.nome,
            description: input.descricao ?? null,
            trigger_type: input.gatilho,
            steps: input.passos,
            status: input.status,
            current_version: proximaVersao,
          })
          .eq("id", input.id);
        if (error) throw error;

        await supabase.from("automation_versions").insert({
          organization_id,
          automation_id: input.id,
          version: proximaVersao,
          definition: definicao,
        });
        await registarAuditoria("automacao.versao_criada", "automation_versions", {
          automacao_id: input.id,
          versao: proximaVersao,
        });
      } else {
        const { data, error } = await supabase
          .from("automations")
          .insert({
            organization_id,
            name: input.nome,
            description: input.descricao ?? null,
            trigger_type: input.gatilho,
            steps: input.passos,
            status: input.status,
            current_version: 1,
          })
          .select("id")
          .single();
        if (error) throw error;
        await supabase.from("automation_versions").insert({
          organization_id,
          automation_id: data.id,
          version: 1,
          definition: definicao,
        });
      }
      await registarAuditoria("automacao.guardada", "automations", { nome: input.nome, status: input.status });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["automacoes"] }),
  });
}

export function useAlterarEstadoAutomacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; status: AutomationStatus }) => {
      const { error } = await supabase.from("automations").update({ status: input.status }).eq("id", input.id);
      if (error) throw error;
      await registarAuditoria("automacao.estado_alterado", "automations", input);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["automacoes"] }),
  });
}

/** Executa a automação em modo simulação e regista o resultado. */
export function useTestarAutomacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { automacao: Automation; contactoId?: string | null; contactoNome: string }) => {
      const organization_id = await orgIdAtual();
      const log = input.automacao.passos.map((p) => ({
        passo: labelPasso(p),
        detalhe: resumoPasso(p),
        resultado: "simulado",
      }));
      const { error } = await supabase.from("automation_runs").insert({
        organization_id,
        automation_id: input.automacao.id,
        contact_id: input.contactoId ?? null,
        mode: "simulacao",
        status: "sucesso",
        log,
        finished_at: new Date().toISOString(),
      });
      if (error) throw error;
      await supabase
        .from("automations")
        .update({ last_run_at: new Date().toISOString() })
        .eq("id", input.automacao.id);
      await registarAuditoria("automacao.simulada", "automation_runs", {
        automacao: input.automacao.nome,
        cliente: input.contactoNome,
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["execucoes"] }),
  });
}

export function useExecucoes() {
  const { demo } = useModoDados();
  return useQuery<AutomationRun[]>({
    queryKey: ["execucoes", demo],
    queryFn: async () => {
      if (demo) return demoRuns;
      const { data, error } = await supabase
        .from("automation_runs")
        .select("*, automations(name), contacts(full_name)")
        .order("started_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        id: r.id,
        automacao: r.automations?.name ?? "—",
        cliente: r.contacts?.full_name ?? "—",
        quando: dataHoraPt(r.started_at),
        estado: (r.mode === "simulacao" ? "simulado" : r.status) as AutomationRun["estado"],
        detalhe: r.error_message ?? (r.mode === "simulacao" ? "Execução em simulação — nada foi enviado." : "Execução real."),
      }));
    },
  });
}

/* ---------------- Ligação GHL ---------------- */

export function useLigacaoGhl() {
  const { demo } = useModoDados();
  return useQuery({
    queryKey: ["ligacao-ghl", demo],
    queryFn: async () => {
      if (demo) return null;
      const { data, error } = await supabase.from("ghl_connections").select("*").maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useGuardarLigacaoGhl() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      api_base_url: string;
      api_version: string;
      default_pipeline_id: string | null;
      calendar_id: string | null;
      write_enabled?: boolean;
    }) => {
      const { error } = await supabase
        .from("ghl_connections")
        .update(input)
        .eq("organization_id", await orgIdAtual());
      if (error) throw error;
      await registarAuditoria("ghl.configuracao_atualizada", "ghl_connections", { url: input.api_base_url });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ligacao-ghl"] }),
  });
}

/* ---------------- Auditoria e webhooks ---------------- */

export function useAuditoria(limite = 30) {
  const { demo } = useModoDados();
  return useQuery({
    queryKey: ["auditoria", demo, limite],
    queryFn: async () => {
      if (demo) return [];
      const { data, error } = await supabase
        .from("audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limite);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useWebhooks(limite = 20) {
  const { demo } = useModoDados();
  return useQuery({
    queryKey: ["webhooks", demo, limite],
    queryFn: async () => {
      if (demo) return [];
      const { data, error } = await supabase
        .from("webhooks_inbox")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limite);
      if (error) throw error;
      return data ?? [];
    },
  });
}

/* ---------------- Dados DEMO na conta real ---------------- */

export function useCarregarDadosDemo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const organization_id = await orgIdAtual();
      const { count } = await supabase
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .eq("is_demo", true);
      if ((count ?? 0) > 0) return "ja_carregado" as const;
      const { error: erroContactos } = await supabase.from("contacts").insert(
        demoContacts.map((c) => ({
          organization_id,
          full_name: `${c.nome} (DEMO)`,
          phone: c.telefone,
          phone_normalized: c.telefone.replace(/\D/g, ""),
          email: c.email,
          stage_key: c.etapa,
          tags: c.tags,
          source: c.origem,
          owner_name: c.responsavel,
          next_action: c.proximaAcao,
          is_demo: true,
        })),
      );

      if (erroContactos) throw erroContactos;

      const { error: erroModelos } = await supabase.from("message_templates").insert(
        demoTemplates.map((t) => ({
          organization_id,
          name: `${t.nome} (DEMO)`,
          stage_key: t.etapa,
          channel: t.canal,
          language: t.idioma,
          body: t.corpo,
          is_demo: true,
        })),
      );
      if (erroModelos) throw erroModelos;

      const { error: erroAutos } = await supabase.from("automations").insert(
        demoAutomations.map((a) => ({
          organization_id,
          name: `${a.nome} (DEMO)`,
          description: a.descricao ?? null,
          status: "rascunho" as const,
          trigger_type: a.gatilho,
          steps: a.passos,
          current_version: a.versao,
          is_demo: true,
        })),
      );
      if (erroAutos) throw erroAutos;

      await registarAuditoria("dados_demo.carregados", "organizations", {});
      return "carregado" as const;
    },
    onSuccess: () => qc.invalidateQueries(),
  });
}

/* ---------------- Conversas ---------------- */

export function useConversas() {
  const { demo } = useModoDados();
  return useQuery<Conversation[]>({
    queryKey: ["conversas", demo],
    queryFn: async () => {
      if (demo) return demoConversations;
      const { data, error } = await supabase
        .from("conversations")
        .select("*, contacts(full_name), messages(body, direction, sent_at, author_name)")
        .order("last_message_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      type Linha = {
        id: string;
        contact_id: string | null;
        channel: Canal;
        summary: string | null;
        intent: string | null;
        sentiment: string | null;
        priority: string | null;
        unread: boolean;
        last_message_at: string | null;
        messages: { body: string; direction: string; sent_at: string; author_name: string | null }[] | null;
      };
      return (data as unknown as Linha[]).map((c) => {
        const mensagens = [...(c.messages ?? [])].sort((a, b) => a.sent_at.localeCompare(b.sent_at));
        return {
          id: c.id,
          contactId: c.contact_id ?? "",
          canal: c.channel,
          ultimaMensagem: mensagens.at(-1)?.body ?? "",
          quando: dataHoraPt(c.last_message_at),
          naoLidas: c.unread ? 1 : 0,
          resumo: c.summary ?? "Sem resumo gerado.",
          intencao: (c.intent ?? "informacao") as Conversation["intencao"],
          sentimento: (c.sentiment ?? "neutro") as Conversation["sentimento"],
          prioridade: (c.priority ?? "media") as Conversation["prioridade"],
          sugestoes: [],
          mensagens: mensagens.map((m) => ({
            autor: (m.direction === "entrada" ? "cliente" : "clinica") as "cliente" | "clinica",
            texto: m.body,
            hora: dataHoraPt(m.sent_at),
          })),
        };
      });
    },
  });
}
