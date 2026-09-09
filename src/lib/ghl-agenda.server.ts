/**
 * Sincronização da agenda como operação de sistema (sem utilizador autenticado).
 * Usada pela atualização automática horária; continua a ser apenas leitura no
 * GoHighLevel e respeita o vínculo organização -> location gravado no backend.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { sincronizarAgenda, type ContactoNovoAgenda, type EventoGhl } from "./ghl-agenda.core";
import { criarLojaAgenda } from "./ghl-agenda.functions";
import { GHL_ORIGIN, GHL_VERSION, ghlFetch, readGhlSecrets } from "./ghl.server";

const DIAS_PASSADO = 90;
const DIAS_FUTURO = 90;

function limparTexto(v?: string | null) {
  return (v ?? "").replace(/\bundefined\b|\bnull\b/gi, "").replace(/\s+/g, " ").trim();
}

type Falha = { ok: false; code: string; message: string };

/** Corre a importação da agenda configurada para a organização vinculada à location. */
export async function sincronizarAgendaSistema(
  admin: SupabaseClient,
): Promise<Falha | { ok: true; resultado: Awaited<ReturnType<typeof sincronizarAgenda>>; calendarId: string }> {
  const { token, locationId } = readGhlSecrets();
  if (!token || !locationId) {
    return { ok: false, code: "missing_secrets", message: "Credenciais do GoHighLevel em falta." };
  }

  const { data: binding, error: erroBinding } = await admin
    .from("ghl_location_bindings")
    .select("organization_id")
    .eq("location_id", locationId)
    .maybeSingle();
  if (erroBinding) return { ok: false, code: "server_error", message: erroBinding.message };
  const orgId = binding?.organization_id as string | undefined;
  if (!orgId) return { ok: false, code: "not_found", message: "Sem organização ligada a esta localização." };

  const { data: conn } = await admin
    .from("ghl_connections")
    .select("status, calendar_id")
    .eq("organization_id", orgId)
    .maybeSingle();
  const calendarId = (conn?.calendar_id as string | null) ?? null;
  if (!calendarId) {
    return { ok: false, code: "bad_request", message: "Nenhuma agenda configurada." };
  }

  const cfg = { baseUrl: GHL_ORIGIN, version: GHL_VERSION, token, locationId };

  // A agenda tem de continuar a existir na conta autorizada.
  const listagem = await ghlFetch<{ calendars?: { id?: string }[] }>(cfg, "calendars/", {
    query: { locationId },
  });
  if (!listagem.ok) return { ok: false, code: listagem.code, message: listagem.message };
  const existe = (listagem.data?.calendars ?? []).some((c) => c?.id === calendarId);
  if (!existe) {
    return { ok: false, code: "not_found", message: "A agenda configurada já não existe na conta ligada." };
  }

  const agora = Date.now();
  const inicioMs = agora - DIAS_PASSADO * 86_400_000;
  const fimMs = agora + DIAS_FUTURO * 86_400_000;

  const res = await ghlFetch<{ events?: EventoGhl[] }>(cfg, "calendars/events", {
    query: {
      locationId,
      calendarId,
      startTime: String(inicioMs),
      endTime: String(fimMs),
    },
  });
  if (!res.ok) return { ok: false, code: res.code, message: res.message };
  const eventos = Array.isArray(res.data?.events) ? res.data.events : [];

  const { data: primeira } = await admin
    .from("journey_stages")
    .select("key")
    .eq("organization_id", orgId)
    .order("position")
    .limit(1)
    .maybeSingle();
  const etapaInicialContacto = (primeira?.key as string | undefined) ?? "novo_lead";

  const resultado = await sincronizarAgenda({
    orgId,
    locationId,
    calendarId,
    inicio: new Date(inicioMs).toISOString(),
    fim: new Date(fimMs).toISOString(),
    eventos,
    etapaInicialContacto,
    loja: criarLojaAgenda(admin, orgId),
    buscarContacto: async (ghlContactId) => {
      const r = await ghlFetch<{ contact?: Record<string, unknown> }>(
        cfg,
        `contacts/${encodeURIComponent(ghlContactId)}`,
      );
      if (!r.ok) return { ok: false as const, message: r.message };
      const c = r.data?.contact;
      if (!c || c["id"] !== ghlContactId) return { ok: false as const, message: "contacto não encontrado" };
      if (c["locationId"] !== locationId) return { ok: false as const, message: "contacto de outra localização" };
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

  await admin.from("audit_logs").insert({
    organization_id: orgId,
    actor_id: null,
    actor_name: "Sistema (sincronização automática)",
    action: "ghl.sync.agenda.automatica",
    entity: "appointments",
    metadata: {
      calendar_id: calendarId,
      lidos: resultado.lidos,
      inseridas: resultado.inseridas,
      atualizadas: resultado.atualizadas,
      adiadas: resultado.adiadas,
      ignoradas: resultado.ignoradas,
      completo: resultado.completo,
      conflitos: resultado.conflitos.slice(0, 20),
    },
  });

  return { ok: true, resultado, calendarId };
}
