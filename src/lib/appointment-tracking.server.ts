import { resolverAcesso } from "./ghl.functions";
import { ghlFetch, GHL_ORIGIN, GHL_VERSION, readGhlSecrets, type GhlConfig } from "./ghl.server";
import {
  confirmarConversa,
  idGhl,
  normalizarConversas,
  normalizarMensagens,
} from "./ghl-observation.core";
import {
  consultaEvidencias,
  estadoAcompanhamento,
  guardarEvidenciaSchema,
  leituraAcompanhamento,
  prepararEvidencia,
  validarConsultaGhl,
  type ConsultaVinculada,
  type EvidenciaConsulta,
} from "./appointment-tracking.core";

type Ctx = Parameters<typeof resolverAcesso>[0];
export async function contextoAcompanhamento(ctx: Ctx, org: string, escrita = false) {
  const r = await resolverAcesso(
    ctx,
    escrita
      ? ["administrador", "gestor", "comercial"]
      : ["administrador", "gestor", "comercial", "visualizador"],
  );
  if (!r.ok) throw new Error(r.message);
  if (r.acesso.orgId !== org) throw new Error("A organização da sessão mudou. Atualize a página.");
  return r.acesso;
}
async function consultaLocal(ctx: Ctx, org: string, id: string) {
  const r = await ctx.supabase
    .from("appointments")
    .select(
      "id,organization_id,contact_id,ghl_appointment_id,ghl_calendar_id,start_at,end_at,status",
    )
    .eq("organization_id", org)
    .eq("id", id)
    .eq("is_demo", false)
    .single();
  if (r.error || !r.data) throw new Error("Consulta indisponível nesta organização.");
  return r.data as ConsultaVinculada;
}
async function contatoGhl(ctx: Ctx, org: string, contactId: string | null) {
  if (!contactId) throw new Error("Consulta sem contato vinculado.");
  const r = await ctx.supabase
    .from("contacts")
    .select("ghl_contact_id")
    .eq("organization_id", org)
    .eq("id", contactId)
    .eq("is_demo", false)
    .single();
  if (r.error || !r.data?.ghl_contact_id) throw new Error("Contato ainda não vinculado ao GHL.");
  return idGhl.parse(r.data.ghl_contact_id);
}
function config(locationId: string): GhlConfig {
  const { token } = readGhlSecrets();
  if (!token) throw new Error("Credenciais GHL indisponíveis.");
  return { token, locationId, baseUrl: GHL_ORIGIN, version: GHL_VERSION };
}
async function get(cfg: GhlConfig, path: string, query: Record<string, string | undefined> = {}) {
  const r = await ghlFetch(cfg, path, { query });
  if (!r.ok) throw new Error(r.message);
  return r.data;
}

export async function lerAcompanhamento(ctx: Ctx, input: unknown) {
  const p = leituraAcompanhamento.parse(input);
  const acesso = await contextoAcompanhamento(ctx, p.organizationId);
  const a = await ctx.supabase
    .from("appointments")
    .select(
      "id,organization_id,contact_id,ghl_appointment_id,ghl_calendar_id,start_at,end_at,status",
    )
    .eq("organization_id", acesso.orgId)
    .in("id", p.appointmentIds)
    .eq("is_demo", false);
  if (a.error) throw new Error("Não foi possível consultar as marcações.");
  const eventos: EvidenciaConsulta[] = [];
  for (let offset = 0; ; offset += 500) {
    const r = await ctx.supabase
      .from("appointment_followup_events")
      .select(
        "id,appointment_id,state,message_id,conversation_id,message_at,message_text,message_type,message_status,deadline_at,appointment_start_at,appointment_end_at,contact_id,ghl_contact_id,ghl_appointment_id,actor_name,recorded_at,previous_id",
      )
      .eq("organization_id", acesso.orgId)
      .in("appointment_id", p.appointmentIds)
      .order("seq", { ascending: false })
      .range(offset, offset + 499);
    if (r.error) throw new Error("Não foi possível consultar as evidências de acompanhamento.");
    eventos.push(...((r.data ?? []) as EvidenciaConsulta[]));
    if ((r.data?.length ?? 0) < 500) break;
    if (offset >= 9500)
      throw new Error("Histórico muito grande. Consulte menos agendamentos por vez.");
  }
  const agora = new Date();
  return {
    consultadoEm: agora.toISOString(),
    locationId: acesso.locationId,
    consultas: (a.data as ConsultaVinculada[]).map((consulta) => {
      const historico = eventos.filter((e) => e.appointment_id === consulta.id);
      const evidencia = historico[0] ?? null;
      return {
        appointmentId: consulta.id,
        ...estadoAcompanhamento(consulta, evidencia, agora),
        evidencia,
        historico,
      };
    }),
  };
}

export async function buscarEvidencias(ctx: Ctx, input: unknown) {
  const p = consultaEvidencias.parse(input);
  const acesso = await contextoAcompanhamento(ctx, p.organizationId, true);
  const consulta = await consultaLocal(ctx, acesso.orgId, p.appointmentId);
  const contactId = await contatoGhl(ctx, acesso.orgId, consulta.contact_id);
  const cfg = config(acesso.locationId);
  if (!p.conversationId) {
    const raw = await get(cfg, "conversations/search", {
      locationId: acesso.locationId,
      contactId,
      limit: "25",
      sort: "desc",
      sortBy: "last_message_date",
    });
    const r = normalizarConversas(raw, acesso.locationId);
    if (r.conversas.some((c) => c.contactId !== contactId))
      throw new Error("Conversa de outro contato recusada.");
    return { tipo: "conversas" as const, conversas: r.conversas };
  }
  const c = confirmarConversa(
    await get(cfg, `conversations/${p.conversationId}`),
    acesso.locationId,
    p.conversationId,
  );
  if (c.contactId !== contactId)
    throw new Error("A conversa não pertence ao contato desta consulta.");
  const raw = await get(cfg, `conversations/${c.id}/messages`, {
    limit: "50",
    lastMessageId: p.cursor,
  });
  return {
    tipo: "mensagens" as const,
    ...normalizarMensagens(
      raw,
      { locationId: acesso.locationId, contactId, conversationId: c.id },
      p.cursor,
    ),
  };
}

export async function gravarAcompanhamento(ctx: Ctx, input: unknown) {
  const p = guardarEvidenciaSchema.parse(input);
  const acesso = await contextoAcompanhamento(ctx, p.organizationId, true);
  // Repetição da mesma intenção retorna o recibo persistido, mesmo após avanço do estado.
  const receipt = await ctx.supabase
    .from("appointment_followup_events")
    .select(
      "id,appointment_id,actor_id,message_id,conversation_id,state,previous_id,deadline_at,message_at",
    )
    .eq("organization_id", acesso.orgId)
    .eq("request_id", p.requestId)
    .maybeSingle();
  if (receipt.error) throw new Error("Não foi possível verificar o recibo desta tentativa.");
  if (receipt.data) {
    const r = receipt.data;
    const hours = r.deadline_at
      ? (Date.parse(r.deadline_at) - Date.parse(r.message_at)) / 3600000
      : null;
    if (
      r.appointment_id !== p.appointmentId ||
      r.actor_id !== ctx.userId ||
      r.message_id !== p.messageId ||
      r.conversation_id !== p.conversationId ||
      r.state !== p.estado ||
      r.previous_id !== p.previousId ||
      hours !== p.prazoHoras
    )
      throw new Error("Tentativa repetida com dados diferentes. Atualize o acompanhamento.");
    return { id: String(r.id), ghlAlterado: false };
  }
  const consulta = await consultaLocal(ctx, acesso.orgId, p.appointmentId);
  const contactId = await contatoGhl(ctx, acesso.orgId, consulta.contact_id);
  const cfg = config(acesso.locationId);
  if (!consulta.ghl_appointment_id || !consulta.ghl_calendar_id)
    throw new Error("Consulta sem ID de agenda no GHL.");
  const c = confirmarConversa(
    await get(cfg, `conversations/${p.conversationId}`),
    acesso.locationId,
    p.conversationId,
  );
  if (c.contactId !== contactId)
    throw new Error("A conversa não pertence ao contato desta consulta.");
  validarConsultaGhl(
    await get(cfg, `calendars/events/appointments/${idGhl.parse(consulta.ghl_appointment_id)}`),
    consulta,
    contactId,
    acesso.locationId,
  );
  const raw = await get(cfg, `conversations/messages/${p.messageId}`);
  const old = await ctx.supabase
    .from("appointment_followup_events")
    .select("*")
    .eq("organization_id", acesso.orgId)
    .eq("appointment_id", consulta.id)
    .order("seq", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (old.error) throw new Error("Não foi possível verificar o acompanhamento atual.");
  const event = prepararEvidencia(
    raw,
    p,
    consulta,
    contactId,
    acesso.locationId,
    old.data as EvidenciaConsulta | null,
    new Date(),
  );
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // RPC restrita ao backend; verifica papéis, snapshot, concorrência e auditoria na mesma transação.
  const client = supabaseAdmin as unknown as Ctx["supabase"];
  const saved = await client.rpc("record_appointment_followup", {
    _actor: ctx.userId,
    _org: acesso.orgId,
    _appointment: consulta.id,
    _request: p.requestId,
    _event: event,
  });
  if (saved.error) {
    if (saved.error.code === "23505")
      throw new Error(
        "Esta mensagem já foi associada ou a tentativa foi repetida com dados diferentes. Atualize o acompanhamento.",
      );
    if (saved.error.code === "40001")
      throw new Error(
        "A consulta ou o acompanhamento mudou durante a revisão. Atualize antes de guardar.",
      );
    throw new Error(
      "Não foi possível confirmar o registro da evidência. Atualize o acompanhamento antes de repetir.",
    );
  }
  return { id: String(saved.data), ghlAlterado: false };
}
