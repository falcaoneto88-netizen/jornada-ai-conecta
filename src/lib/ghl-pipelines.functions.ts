/**
 * Pipelines e oportunidades do GoHighLevel — apenas leitura.
 * Todas as funções resolvem utilizador -> organização -> papel -> vínculo de
 * location antes de tocar nas credenciais do backend.
 */
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolverAcesso } from "./ghl.functions";
import {
  linhaOportunidade as _linhaOportunidade,
  planearEtapas,
  sincronizarOportunidades,
  type ContactoNovo,
  type EtapaLocal,
  type LinhaOportunidade,
  type LojaSincronizacao,
  type OportunidadeGhl,
  type PipelineGhl,
} from "./ghl-pipelines.core";

type Ctx = { supabase: SupabaseClient; userId: string };

const LIMITE_PAGINA = 100;

function limparTexto(v?: string | null) {
  return (v ?? "").replace(/\bundefined\b|\bnull\b/gi, "").replace(/\s+/g, " ").trim();
}

async function ctxGhl(context: Ctx, papeis: readonly ("administrador" | "gestor" | "comercial" | "visualizador")[]) {
  const { readGhlSecrets, mensagemErro, GHL_ORIGIN, GHL_VERSION } = await import("./ghl.server");
  const acesso = await resolverAcesso(context, papeis);
  if (!acesso.ok) return { ok: false as const, code: acesso.code, message: acesso.message };
  const { token } = readGhlSecrets();
  if (!token) {
    return { ok: false as const, code: "missing_secrets" as const, message: mensagemErro("missing_secrets") };
  }
  return {
    ok: true as const,
    acesso: acesso.acesso,
    cfg: { baseUrl: GHL_ORIGIN, version: GHL_VERSION, token, locationId: acesso.acesso.locationId },
  };
}

async function lerPipelines(cfg: {
  baseUrl: string;
  version: string;
  token: string;
  locationId: string;
}): Promise<{ ok: true; pipelines: PipelineGhl[] } | { ok: false; code: string; message: string }> {
  const { ghlFetch } = await import("./ghl.server");
  const res = await ghlFetch<{ pipelines?: unknown[] }>(cfg, "opportunities/pipelines", {
    query: { locationId: cfg.locationId },
  });
  if (!res.ok) return { ok: false, code: res.code, message: res.message };
  const pipelines: PipelineGhl[] = (res.data?.pipelines ?? [])
    .map((p) => p as Record<string, unknown>)
    .filter((p) => typeof p["id"] === "string")
    .map((p) => ({
      id: String(p["id"]),
      name: limparTexto(p["name"] as string) || "Pipeline sem nome",
      stages: (Array.isArray(p["stages"]) ? (p["stages"] as Record<string, unknown>[]) : [])
        .filter((s) => typeof s["id"] === "string")
        .map((s, i) => ({
          id: String(s["id"]),
          name: limparTexto(s["name"] as string) || `Etapa ${i + 1}`,
          position: typeof s["position"] === "number" ? s["position"] : i,
        })),
    }));
  return { ok: true, pipelines };
}

/** Lista os pipelines reais da location autorizada (administrador). */
export const listarPipelinesGhl = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const base = await ctxGhl(context as unknown as Ctx, ["administrador"]);
    if (!base.ok) return { ok: false as const, code: base.code, message: base.message, pipelines: [] };
    const res = await lerPipelines(base.cfg);
    if (!res.ok) return { ok: false as const, code: res.code, message: res.message, pipelines: [] };
    return {
      ok: true as const,
      pipelines: res.pipelines,
      selecionado: (base.acesso.conn?.["default_pipeline_id"] as string | null) ?? null,
    };
  });

/** Liga um pipeline real a esta organização e prepara as etapas locais. */
export const configurarPipelineGhl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { pipelineId: string }) => input)
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const base = await ctxGhl(ctx, ["administrador"]);
    if (!base.ok) return { ok: false as const, code: base.code, message: base.message };
    const { orgId, nome } = base.acesso;

    const res = await lerPipelines(base.cfg);
    if (!res.ok) return { ok: false as const, code: res.code, message: res.message };

    const pipeline = res.pipelines.find((p) => p.id === data.pipelineId);
    if (!pipeline) {
      return {
        ok: false as const,
        code: "not_found" as const,
        message: "Esse pipeline não existe na localização autorizada desta conta.",
      };
    }

    const { data: locaisRaw, error: erroLocais } = await ctx.supabase
      .from("journey_stages")
      .select("key,name,position,ghl_pipeline_id,ghl_stage_id")
      .eq("organization_id", orgId)
      .order("position");
    if (erroLocais) {
      return { ok: false as const, code: "server_error" as const, message: "Não foi possível ler as etapas locais." };
    }
    const locais = (locaisRaw ?? []) as EtapaLocal[];
    const plano = planearEtapas({ pipelineId: pipeline.id, stages: pipeline.stages, locais });

    for (const a of plano.atualizar) {
      const { error } = await ctx.supabase
        .from("journey_stages")
        .update({
          ghl_pipeline_id: a.ghl_pipeline_id,
          ghl_stage_id: a.ghl_stage_id,
          ghl_stage_position: a.ghl_stage_position,
        })
        .eq("organization_id", orgId)
        .eq("key", a.key);
      if (error) return { ok: false as const, code: "server_error" as const, message: error.message };
    }
    if (plano.criar.length > 0) {
      const { error } = await ctx.supabase
        .from("journey_stages")
        .insert(plano.criar.map((c) => ({ ...c, organization_id: orgId })));
      if (error) return { ok: false as const, code: "server_error" as const, message: error.message };
    }

    const { error: erroConn } = await ctx.supabase
      .from("ghl_connections")
      .update({ default_pipeline_id: pipeline.id })
      .eq("organization_id", orgId);
    if (erroConn) return { ok: false as const, code: "server_error" as const, message: erroConn.message };

    await ctx.supabase.from("audit_logs").insert({
      organization_id: orgId,
      actor_id: ctx.userId,
      actor_name: nome,
      action: "ghl.pipeline_configurado",
      entity: "ghl_connections",
      metadata: { pipeline_id: pipeline.id, pipeline: pipeline.name, etapas: pipeline.stages.length },
    });

    return {
      ok: true as const,
      pipeline: { id: pipeline.id, name: pipeline.name },
      etapasAssociadas: plano.atualizar.length,
      etapasCriadas: plano.criar.length,
    };
  });

/** Adaptador Supabase do motor de sincronização. */
export function criarLoja(supabase: SupabaseClient, orgId: string): LojaSincronizacao {
  return {
    async contactosPorGhlId(ids) {
      const mapa = new Map<string, string>();
      for (let i = 0; i < ids.length; i += 100) {
        const { data, error } = await supabase
          .from("contacts")
          .select("id, ghl_contact_id")
          .eq("organization_id", orgId)
          .in("ghl_contact_id", ids.slice(i, i + 100));
        if (error) throw new Error(error.message);
        for (const l of data ?? []) if (l.ghl_contact_id) mapa.set(l.ghl_contact_id, l.id);
      }
      return mapa;
    },
    async inserirContacto(linha) {
      let candidato = { ...linha };
      if (candidato.phone_normalized) {
        const { data: conflito } = await supabase
          .from("contacts")
          .select("id")
          .eq("organization_id", orgId)
          .eq("phone_normalized", candidato.phone_normalized)
          .maybeSingle();
        // Nunca funde pessoas por telefone: guarda o número em bruto sem chave única.
        if (conflito) candidato = { ...candidato, phone_normalized: null };
      }
      const { data, error } = await supabase.from("contacts").insert(candidato).select("id").single();
      if (error) {
        const { data: existente } = await supabase
          .from("contacts")
          .select("id")
          .eq("organization_id", orgId)
          .eq("ghl_contact_id", candidato.ghl_contact_id)
          .maybeSingle();
        if (existente) return existente.id;
        throw new Error(error.message);
      }
      return data.id;
    },
    async oportunidadesPorGhlId(ids) {
      const mapa = new Map<string, string>();
      for (let i = 0; i < ids.length; i += 100) {
        const { data, error } = await supabase
          .from("opportunities")
          .select("id, ghl_opportunity_id")
          .eq("organization_id", orgId)
          .in("ghl_opportunity_id", ids.slice(i, i + 100));
        if (error) throw new Error(error.message);
        for (const l of data ?? []) if (l.ghl_opportunity_id) mapa.set(l.ghl_opportunity_id, l.id);
      }
      return mapa;
    },
    async inserirOportunidade(linha) {
      const { error } = await supabase.from("opportunities").insert(linha);
      if (!error) return "inserida";
      // Corrida com outra sincronização: o índice único parcial resolve o empate.
      const { data: existente } = await supabase
        .from("opportunities")
        .select("id")
        .eq("organization_id", orgId)
        .eq("ghl_opportunity_id", linha.ghl_opportunity_id)
        .maybeSingle();
      if (!existente) throw new Error(error.message);
      const { error: erroUpdate } = await supabase.from("opportunities").update(linha).eq("id", existente.id);
      if (erroUpdate) throw new Error(erroUpdate.message);
      return "atualizada";
    },
    async atualizarOportunidade(id, linha) {
      const { error } = await supabase.from("opportunities").update(linha).eq("id", id);
      if (error) throw new Error(error.message);
    },
  };
}

/** Importa em leitura todas as oportunidades do pipeline configurado. */
export const sincronizarOportunidadesGhl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as Ctx;
    const base = await ctxGhl(ctx, ["administrador"]);
    if (!base.ok) return { ok: false as const, code: base.code, message: base.message };
    const { orgId, nome, locationId, conn } = base.acesso;

    if (conn?.["status"] !== "conectada") {
      return { ok: false as const, code: "forbidden" as const, message: "Teste a ligação antes de sincronizar." };
    }
    const pipelineId = (conn?.["default_pipeline_id"] as string | null) ?? null;
    if (!pipelineId) {
      return {
        ok: false as const,
        code: "bad_request" as const,
        message: "Escolha primeiro o pipeline em Integrações › Mapeamento.",
      };
    }

    const { ghlFetch } = await import("./ghl.server");

    // Mapa etapa GHL -> etapa local, apenas do pipeline configurado.
    const { data: etapas } = await ctx.supabase
      .from("journey_stages")
      .select("key, ghl_stage_id, position")
      .eq("organization_id", orgId)
      .eq("ghl_pipeline_id", pipelineId);
    const mapaEtapas: Record<string, string> = {};
    for (const e of etapas ?? []) if (e.ghl_stage_id) mapaEtapas[e.ghl_stage_id] = e.key;
    if (Object.keys(mapaEtapas).length === 0) {
      return {
        ok: false as const,
        code: "bad_request" as const,
        message: "As etapas deste pipeline ainda não estão ligadas. Volte a guardar o pipeline em Mapeamento.",
      };
    }

    const { data: primeira } = await ctx.supabase
      .from("journey_stages")
      .select("key")
      .eq("organization_id", orgId)
      .order("position")
      .limit(1)
      .maybeSingle();
    const etapaInicialContacto = primeira?.key ?? "novo_lead";

    const resultado = await sincronizarOportunidades({
      orgId,
      locationId,
      pipelineId,
      mapaEtapas,
      etapaInicialContacto,
      loja: criarLoja(ctx.supabase, orgId),
      buscarPagina: async (cursor) => {
        const res = await ghlFetch<{ opportunities?: OportunidadeGhl[]; meta?: unknown }>(
          base.cfg,
          "opportunities/search",
          {
            query: {
              location_id: locationId,
              pipeline_id: pipelineId,
              status: "all",
              limit: String(LIMITE_PAGINA),
              ...(cursor.startAfter ? { startAfter: cursor.startAfter } : {}),
              ...(cursor.startAfterId ? { startAfterId: cursor.startAfterId } : {}),
            },
          },
        );
        if (!res.ok) return { ok: false as const, message: res.message };
        return {
          ok: true as const,
          oportunidades: Array.isArray(res.data?.opportunities) ? res.data.opportunities : [],
          meta: res.data?.meta ?? null,
        };
      },
      buscarContacto: async (ghlContactId) => {
        const res = await ghlFetch<{ contact?: Record<string, unknown> }>(
          base.cfg,
          `contacts/${encodeURIComponent(ghlContactId)}`,
        );
        if (!res.ok) return { ok: false as const, message: res.message };
        const c = res.data?.contact;
        if (!c || c["id"] !== ghlContactId) return { ok: false as const, message: "contacto não encontrado" };
        if (c["locationId"] !== locationId) {
          return { ok: false as const, message: "contacto de outra localização" };
        }
        const telefone = typeof c["phone"] === "string" ? c["phone"] : null;
        const contacto: ContactoNovo = {
          organization_id: orgId,
          ghl_contact_id: ghlContactId,
          full_name:
            limparTexto([c["firstName"], c["lastName"]].filter(Boolean).join(" ")) ||
            limparTexto(c["contactName"] as string) ||
            limparTexto(c["email"] as string) ||
            "Sem nome",
          phone: telefone,
          phone_normalized: telefone ? telefone.replace(/\D/g, "") : null,
          email: typeof c["email"] === "string" ? c["email"] : null,
          tags: Array.isArray(c["tags"]) ? (c["tags"] as string[]) : [],
          source: typeof c["source"] === "string" && c["source"] ? c["source"] : "GoHighLevel",
          stage_key: etapaInicialContacto,
          is_demo: false,
        };
        return { ok: true as const, contacto };
      },
    });

    const agora = new Date().toISOString();
    await ctx.supabase.from("ghl_connections").update({ last_sync_at: agora }).eq("organization_id", orgId);
    await ctx.supabase.from("audit_logs").insert({
      organization_id: orgId,
      actor_id: ctx.userId,
      actor_name: nome,
      action: "ghl.sync.oportunidades",
      entity: "opportunities",
      metadata: {
        pipeline_id: pipelineId,
        lidas: resultado.lidas,
        inseridas: resultado.inseridas,
        atualizadas: resultado.atualizadas,
        completo: resultado.completo,
      },
    });

    return { ok: true as const, resultado, syncedAt: agora };
  });

export type { LinhaOportunidade };
