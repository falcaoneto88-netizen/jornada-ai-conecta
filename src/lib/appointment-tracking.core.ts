import { z } from "zod";
import { idGhl, normalizarMensagens } from "./ghl-observation.core";

export const estadosRegistaveis = z.enum([
  "aguardando_resposta",
  "presenca_confirmada",
  "remarcacao_solicitada",
  "falha",
]);
export type EstadoRegistavel = z.infer<typeof estadosRegistaveis>;
export const rotulosAcompanhamento = {
  aguardando_resposta: "Aguardando resposta",
  presenca_confirmada: "Presença confirmada",
  remarcacao_solicitada: "Pedido de remarcação",
  prazo_encerrado: "Prazo encerrado",
  falha: "Falha",
  sem_evidencia: "Sem evidência",
  rever: "Rever acompanhamento",
  cancelada: "Consulta cancelada",
} as const;
export type EstadoAcompanhamento = keyof typeof rotulosAcompanhamento;
export const leituraAcompanhamento = z
  .object({
    organizationId: z.string().uuid(),
    appointmentIds: z.array(z.string().uuid()).min(1).max(200),
  })
  .strict();
export const consultaEvidencias = z
  .object({
    organizationId: z.string().uuid(),
    appointmentId: z.string().uuid(),
    conversationId: idGhl.optional(),
    cursor: idGhl.optional(),
  })
  .strict();
export const guardarEvidenciaSchema = z
  .object({
    organizationId: z.string().uuid(),
    appointmentId: z.string().uuid(),
    conversationId: idGhl,
    messageId: idGhl,
    estado: estadosRegistaveis,
    prazoHoras: z
      .union([z.literal(1), z.literal(3), z.literal(12), z.literal(24), z.literal(48)])
      .nullable(),
    previousId: z.string().uuid().nullable(),
    requestId: z.string().uuid(),
    confirm: z.literal(true),
  })
  .strict();
export type PedidoEvidencia = z.infer<typeof guardarEvidenciaSchema>;
export type ConsultaVinculada = {
  id: string;
  organization_id: string;
  contact_id: string | null;
  ghl_appointment_id: string | null;
  ghl_calendar_id: string | null;
  start_at: string;
  end_at: string | null;
  status: string;
};
export type EvidenciaConsulta = {
  id: string;
  appointment_id: string;
  state: EstadoRegistavel;
  message_id: string;
  conversation_id: string;
  message_at: string;
  message_text: string;
  message_type: string;
  message_status: string | null;
  deadline_at: string | null;
  appointment_start_at: string;
  appointment_end_at: string | null;
  contact_id: string;
  ghl_contact_id: string;
  ghl_appointment_id: string;
  actor_name: string;
  recorded_at: string;
  previous_id: string | null;
};
const ms = (d: string | null | undefined) => (d ? Date.parse(d) : null);
export function estadoAcompanhamento(
  consulta: ConsultaVinculada,
  evento: EvidenciaConsulta | null,
  agora: Date,
): { estado: EstadoAcompanhamento; motivo: string } {
  if (["cancelada", "cancelled", "canceled", "invalid"].includes(consulta.status))
    return {
      estado: "cancelada",
      motivo:
        "Cancelamento consta na agenda sincronizada. O histórico de evidências foi preservado.",
    };
  if (!evento)
    return {
      estado: "sem_evidencia",
      motivo:
        "Nenhuma mensagem foi associada a esta consulta. O estado administrativo Confirmada não comprova uma resposta do paciente.",
    };
  if (
    ms(consulta.start_at) !== ms(evento.appointment_start_at) ||
    ms(consulta.end_at) !== ms(evento.appointment_end_at) ||
    consulta.contact_id !== evento.contact_id ||
    consulta.ghl_appointment_id !== evento.ghl_appointment_id
  )
    return {
      estado: "rever",
      motivo:
        "A data ou o vínculo da consulta mudou desde a evidência. Confirme novamente para este agendamento; o registro anterior é histórico.",
    };
  if (
    evento.state === "aguardando_resposta" &&
    evento.deadline_at &&
    Date.parse(evento.deadline_at) <= agora.getTime()
  )
    return {
      estado: "prazo_encerrado",
      motivo:
        "O prazo registrado terminou e nenhuma resposta posterior foi vinculada no app. Confira a conversa; isso não prova ausência de resposta no GHL.",
    };
  const motivos: Record<EstadoRegistavel, string> = {
    aguardando_resposta:
      "Solicitação enviada associada pela equipe. Aguardando o registro de uma resposta vinculada a esta consulta.",
    presenca_confirmada:
      "Resposta recebida associada pela equipe como confirmação de presença desta consulta.",
    remarcacao_solicitada:
      "Resposta recebida associada pela equipe como pedido de remarcação. A agenda ainda precisa ser tratada no GHL.",
    falha:
      "A mensagem associada retornou failed ou undelivered no GHL no momento da verificação. Não representa falha de todo o workflow.",
  };
  return { estado: evento.state, motivo: motivos[evento.state] };
}

export function validarConsultaGhl(
  raw: unknown,
  consulta: ConsultaVinculada,
  contactId: string,
  locationId: string,
) {
  const { event: e } = z
    .object({
      event: z.object({
        id: idGhl,
        contactId: idGhl,
        calendarId: idGhl,
        locationId: idGhl.optional(),
        startTime: z.string().datetime({ offset: true }),
        endTime: z.string().datetime({ offset: true }).nullish(),
        appointmentStatus: z.string(),
      }),
    })
    .parse(raw);
  if (
    e.id !== consulta.ghl_appointment_id ||
    e.contactId !== contactId ||
    e.calendarId !== consulta.ghl_calendar_id ||
    (e.locationId && e.locationId !== locationId) ||
    ms(e.startTime) !== ms(consulta.start_at) ||
    ms(e.endTime) !== ms(consulta.end_at)
  )
    throw new Error(
      "O agendamento mudou ou não corresponde ao contato. Atualize a agenda antes de associar evidências.",
    );
  if (
    ["cancelled", "canceled", "invalid", "showed", "noshow", "no_show"].includes(
      e.appointmentStatus,
    )
  )
    throw new Error("Este agendamento já foi cancelado ou encerrado no GHL. Atualize a agenda.");
}

export function prepararEvidencia(
  raw: unknown,
  pedido: PedidoEvidencia,
  consulta: ConsultaVinculada,
  contactId: string,
  locationId: string,
  anterior: EvidenciaConsulta | null,
  agora: Date,
) {
  const identificada = z
    .object({ id: idGhl, contactId: idGhl, locationId: idGhl, conversationId: idGhl })
    .parse(raw);
  if (
    identificada.id !== pedido.messageId ||
    identificada.contactId !== contactId ||
    identificada.locationId !== locationId ||
    identificada.conversationId !== pedido.conversationId
  )
    throw new Error("A mensagem não pertence ao atendimento desta consulta.");
  const m = normalizarMensagens(
    { messages: { messages: [raw], nextPage: false } },
    { locationId, contactId, conversationId: pedido.conversationId },
  ).mensagens[0]!;
  if (
    !m.data ||
    Date.parse(m.data) > agora.getTime() + 60_000 ||
    !m.texto.trim() ||
    /ACTIVITY|CALL|VOICEMAIL/i.test(m.tipo)
  )
    throw new Error(
      "Escolha uma mensagem textual de atendimento com data válida, não uma atividade ou chamada.",
    );
  if ((anterior?.id ?? null) !== pedido.previousId)
    throw new Error("O acompanhamento mudou. Atualize antes de guardar.");
  if (anterior && Date.parse(m.data) < Date.parse(anterior.message_at))
    throw new Error("Uma mensagem mais antiga não pode substituir a evidência atual.");
  let deadline: string | null = null;
  if (pedido.estado === "aguardando_resposta") {
    if (
      m.direcao !== "outbound" ||
      !["sent", "delivered", "read", "opened", "clicked"].includes(m.estado ?? "") ||
      !pedido.prazoHoras
    )
      throw new Error("Selecione uma solicitação enviada e informe o prazo para resposta.");
    deadline = new Date(Date.parse(m.data) + pedido.prazoHoras * 3_600_000).toISOString();
  } else if (pedido.estado === "falha") {
    if (m.direcao !== "outbound" || !["failed", "undelivered"].includes(m.estado ?? ""))
      throw new Error("Falha exige mensagem de saída com estado failed ou undelivered no GHL.");
  } else {
    if (m.direcao !== "inbound")
      throw new Error("Confirmação e remarcação exigem uma resposta recebida.");
    if (
      !anterior ||
      anterior.state !== "aguardando_resposta" ||
      estadoAcompanhamento(consulta, anterior, agora).estado === "rever" ||
      anterior.conversation_id !== pedido.conversationId ||
      Date.parse(m.data) <= Date.parse(anterior.message_at)
    )
      throw new Error(
        "Associe primeiro a solicitação enviada desta consulta. A resposta deve ser posterior e da mesma conversa.",
      );
  }
  if (pedido.estado !== "aguardando_resposta" && pedido.prazoHoras !== null)
    throw new Error("Prazo só se aplica à solicitação de resposta.");
  return {
    state: pedido.estado,
    message_id: m.id,
    conversation_id: pedido.conversationId,
    message_at: m.data,
    message_text: m.texto.slice(0, 2000),
    message_type: m.tipo,
    message_status: m.estado,
    message_direction: m.direcao,
    deadline_at: deadline,
    appointment_start_at: consulta.start_at,
    appointment_end_at: consulta.end_at,
    ghl_appointment_id: consulta.ghl_appointment_id!,
    contact_id: consulta.contact_id!,
    ghl_contact_id: contactId,
    location_id: locationId,
    previous_id: pedido.previousId,
  };
}
