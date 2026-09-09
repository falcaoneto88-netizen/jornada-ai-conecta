/**
 * Agenda do GoHighLevel — apenas leitura.
 * Resolve utilizador -> organização -> papel -> vínculo de location antes de
 * tocar nas credenciais do backend.
 */
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolverAcesso } from "./ghl.functions";
import {
  sincronizarAgenda,
  type ContactoNovoAgenda,
  type EventoGhl,
  type LinhaMarcacao,
  type LojaAgenda,
} from "./ghl-agenda.core";

type Ctx = { supabase: SupabaseClient; userId: string };

export type CalendarioGhl = { id: string; name: string; ativo: boolean };

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

type Cfg = { baseUrl: string; version: string; token: string; locationId: string };

/** Lista as agendas reais da location autorizada. */
async function lerCalendarios(
  cfg: Cfg,
): Promise<{ ok: true; calendarios: CalendarioGhl[] } | { ok: false; code: string; message: string }> {
  const { ghlFetch } = await import("./ghl.server");
  const res = await ghlFetch<{ calendars?: unknown[] }>(cfg, "calendars/", {
    query: { locationId: cfg.locationId },
  });
  if (!res.ok) return { ok: false, code: res.code, message: res.message };
  const calendarios: CalendarioGhl[] = (res.data?.calendars ?? [])
    .map((c) => c as Record<string, unknown>)
    .filter((c) => typeof c["id"] === "string")
    .map((c) => ({
      id: String(c["id"]),
      name: limparTexto(c["name"] as string) || "Agenda sem nome",
      ativo: c["isActive"] !== false,
    }));
  return { ok: true, calendarios };
}

export const listarCalendariosGhl = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const base = await ctxGhl(context as unknown as Ctx, ["administrador"]);
    if (!base.ok) return { ok: false as const, code: base.code, message: base.message, calendarios: [] };
    const res = await lerCalendarios(base.cfg);
    if (!res.ok) return { ok: false as const, code: res.code, message: res.message, calendarios: [] };
    return {
      ok: true as const,
      calendarios: res.calendarios,
      selecionado: (base.acesso.conn?.["calendar_id"] as string | null) ?? null,
    };
  });

/** Liga uma agenda real à organização, depois de a confirmar na conta. */
export const configurarCalendarioGhl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { calendarId: string }) => input)
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const base = await ctxGhl(ctx, ["administrador"]);
    if (!base.ok) return { ok: false as const, code: base.code, message: base.message };

    const res = await lerCalendarios(base.cfg);
    if (!res.ok) return { ok: false as const, code: res.code, message: res.message };
    const calendario = res.calendarios.find((c) => c.id === data.calendarId);
    if (!calendario) {
      return {
        ok: false as const,
        code: "not_found" as const,
        message: "Essa agenda não existe na localização autorizada desta conta.",
      };
    }

    const { error } = await ctx.supabase
      .from("ghl_connections")
      .update({ calendar_id: calendario.id })
      .eq("organization_id", base.acesso.orgId);
    if (error) return { ok: false as const, code: "server_error" as const, message: error.message };

    await ctx.supabase.from("audit_logs").insert({
      organization_id: base.acesso.orgId,
      actor_id: ctx.userId,
      actor_name: base.acesso.nome,
      action: "ghl.calendario_configurado",
      entity: "ghl_connections",
      metadata: { calendar_id: calendario.id, calendario: calendario.name },
    });

    return { ok: true as const, calendario: { id: calendario.id, name: calendario.name } };
  });

/** Adaptador Supabase do motor da agenda. */
export function criarLojaAgenda(supabase: SupabaseClient, orgId: string): LojaAgenda {
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
    async marcacoesPorGhlId(ids) {
      const mapa = new Map<string, { id: string; contactId: string | null }>();
      for (let i = 0; i < ids.length; i += 100) {
        const { data, error } = await supabase
          .from("appointments")
          .select("id, ghl_appointment_id, contact_id")
          .eq("organization_id", orgId)
          .in("ghl_appointment_id", ids.slice(i, i + 100));
        if (error) throw new Error(error.message);
        for (const l of data ?? [])
          if (l.ghl_appointment_id) mapa.set(l.ghl_appointment_id, { id: l.id, contactId: l.contact_id ?? null });
      }
      return mapa;
    },
    async inserirMarcacao(linha: LinhaMarcacao) {
      const { error } = await supabase.from("appointments").insert(linha);
      if (!error) return "inserida";
      // Corrida com outra sincronização: o índice único parcial resolve o empate.
      const { data: existente } = await supabase
        .from("appointments")
        .select("id")
        .eq("organization_id", orgId)
        .eq("ghl_appointment_id", linha.ghl_appointment_id)
        .maybeSingle();
      if (!existente) throw new Error(error.message);
      const { error: erroUpdate } = await supabase.from("appointments").update(linha).eq("id", existente.id);
      if (erroUpdate) throw new Error(erroUpdate.message);
      return "atualizada";
    },
    async atualizarMarcacao(id, linha) {
      const { error } = await supabase.from("appointments").update(linha).eq("id", id);
      if (error) throw new Error(error.message);
    },
  };
}

const DIAS_PASSADO = 90;
const DIAS_FUTURO = 90;

/** Importa em leitura as marcações da agenda configurada. */
export const sincronizarAgendaGhl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as Ctx;
    const base = await ctxGhl(ctx, ["administrador", "gestor"]);
    if (!base.ok) return { ok: false as const, code: base.code, message: base.message };
    const { orgId, nome, locationId, conn } = base.acesso;

    if (conn?.["status"] !== "conectada") {
      return { ok: false as const, code: "forbidden" as const, message: "Teste a ligação antes de sincronizar." };
    }
    const calendarId = (conn?.["calendar_id"] as string | null) ?? null;
    if (!calendarId) {
      return {
        ok: false as const,
        code: "bad_request" as const,
        message: "Escolha primeiro a agenda em Integrações › Mapeamento.",
      };
    }

    // A agenda configurada tem de continuar a existir na conta autorizada.
    const oficiais = await lerCalendarios(base.cfg);
    if (!oficiais.ok) return { ok: false as const, code: oficiais.code, message: oficiais.message };
    const calendario = oficiais.calendarios.find((c) => c.id === calendarId);
    if (!calendario) {
      return {
        ok: false as const,
        code: "not_found" as const,
        message: "A agenda configurada já não existe na conta ligada. Volte a escolhê-la em Mapeamento.",
      };
    }

    const agora = Date.now();
    const inicioMs = agora - DIAS_PASSADO * 86_400_000;
    const fimMs = agora + DIAS_FUTURO * 86_400_000;
    const inicio = new Date(inicioMs).toISOString();
    const fim = new Date(fimMs).toISOString();

    const { ghlFetch } = await import("./ghl.server");
    const res = await ghlFetch<{ events?: EventoGhl[] }>(base.cfg, "calendars/events", {
      query: {
        locationId,
        calendarId,
        startTime: String(inicioMs),
        endTime: String(fimMs),
      },
    });
    if (!res.ok) return { ok: false as const, code: res.code, message: res.message };
    const eventos = Array.isArray(res.data?.events) ? res.data.events : [];

    const { data: primeira } = await ctx.supabase
      .from("journey_stages")
      .select("key")
      .eq("organization_id", orgId)
      .order("position")
      .limit(1)
      .maybeSingle();
    const etapaInicialContacto = primeira?.key ?? "novo_lead";

    let resultado;
    try {
      resultado = await sincronizarAgenda({
        orgId,
        locationId,
        calendarId,
        inicio,
        fim,
        eventos,
        etapaInicialContacto,
        loja: criarLojaAgenda(ctx.supabase, orgId),
        buscarContacto: async (ghlContactId) => {
          const r = await ghlFetch<{ contact?: Record<string, unknown> }>(
            base.cfg,
            `contacts/${encodeURIComponent(ghlContactId)}`,
          );
          if (!r.ok) return { ok: false as const, message: r.message };
          const c = r.data?.contact;
          if (!c || c["id"] !== ghlContactId) return { ok: false as const, message: "contacto não encontrado" };
          if (c["locationId"] !== locationId) {
            return { ok: false as const, message: "contacto de outra localização" };
          }
          const telefone = typeof c["phone"] === "string" ? c["phone"] : null;
          const contacto: ContactoNovoAgenda = {
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
    } catch (erro) {
      return {
        ok: false as const,
        code: "server_error" as const,
        message: erro instanceof Error ? erro.message : "Falha ao gravar as marcações.",
      };
    }

    await ctx.supabase.from("audit_logs").insert({
      organization_id: orgId,
      actor_id: ctx.userId,
      actor_name: nome,
      action: "ghl.sync.agenda",
      entity: "appointments",
      metadata: {
        calendar_id: calendarId,
        calendario: calendario.name,
        lidos: resultado.lidos,
        inseridas: resultado.inseridas,
        atualizadas: resultado.atualizadas,
        adiadas: resultado.adiadas,
        ignoradas: resultado.ignoradas,
        completo: resultado.completo,
        conflitos: resultado.conflitos.slice(0, 20),
      },
    });

    return { ok: true as const, resultado, calendario: { id: calendario.id, name: calendario.name } };
  });
