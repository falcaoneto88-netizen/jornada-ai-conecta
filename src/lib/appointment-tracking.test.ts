import { describe, expect, it } from "vitest";
import {
  estadoAcompanhamento,
  prepararEvidencia,
  validarConsultaGhl,
  guardarEvidenciaSchema,
  type ConsultaVinculada,
  type EvidenciaConsulta,
  type PedidoEvidencia,
} from "./appointment-tracking.core";
const org = "11111111-1111-4111-8111-111111111111";
const appt: ConsultaVinculada = {
  id: org,
  organization_id: org,
  contact_id: org,
  ghl_appointment_id: "apptA",
  ghl_calendar_id: "calA",
  start_at: "2026-09-15T13:00:00Z",
  end_at: "2026-09-15T13:30:00Z",
  status: "confirmada",
};
const now = new Date("2026-09-14T14:00:00Z");
const request: PedidoEvidencia = {
  organizationId: org,
  appointmentId: org,
  conversationId: "convA",
  messageId: "msgA",
  estado: "aguardando_resposta",
  prazoHoras: 24,
  previousId: null,
  requestId: org,
  confirm: true,
};
const sent = {
  id: "msgA",
  contactId: "contactA",
  locationId: "locA",
  conversationId: "convA",
  dateAdded: "2026-09-14T13:00:00Z",
  body: "Confirma sua consulta amanhã às 14h?",
  messageType: "TYPE_CUSTOM_SMS",
  direction: "outbound",
  status: "delivered",
};
const evidence: EvidenciaConsulta = {
  id: org,
  appointment_id: org,
  contact_id: org,
  ghl_contact_id: "contactA",
  ghl_appointment_id: "apptA",
  state: "aguardando_resposta",
  message_id: "msgA",
  conversation_id: "convA",
  message_at: sent.dateAdded,
  message_text: sent.body,
  message_type: sent.messageType,
  message_status: "delivered",
  deadline_at: "2026-09-15T13:00:00Z",
  appointment_start_at: appt.start_at,
  appointment_end_at: appt.end_at,
  actor_name: "Operador",
  recorded_at: now.toISOString(),
  previous_id: null,
};
const reply = {
  ...sent,
  id: "reply",
  direction: "inbound",
  body: "SIM",
  dateAdded: "2026-09-14T13:05:00Z",
};
const confirmation = {
  ...request,
  messageId: "reply",
  estado: "presenca_confirmada" as const,
  prazoHoras: null,
  previousId: org,
};
const prepare = (
  m = sent,
  p: PedidoEvidencia = request,
  prev: EvidenciaConsulta | null = null,
  c = appt,
) => prepararEvidencia(m, p, c, "contactA", "locA", prev, now);
describe("estado acompanhado com evidência", () => {
  it("confirmada administrativa não significa presença confirmada", () =>
    expect(estadoAcompanhamento(appt, null, now).estado).toBe("sem_evidencia"));
  it.each([
    "aguardando_resposta",
    "presenca_confirmada",
    "remarcacao_solicitada",
    "falha",
  ] as const)("exibe %s somente com registro", (state) =>
    expect(
      estadoAcompanhamento(
        appt,
        {
          ...evidence,
          state,
          deadline_at: state === "aguardando_resposta" ? evidence.deadline_at : null,
        },
        now,
      ).estado,
    ).toBe(state),
  );
  it("prazo expirado explicita o limite da associação humana", () => {
    const e = estadoAcompanhamento(appt, { ...evidence, deadline_at: now.toISOString() }, now);
    expect(e.estado).toBe("prazo_encerrado");
    expect(e.motivo).toContain("não prova ausência de resposta no GHL");
  });
  it("não inventa prazo sem data de encerramento", () =>
    expect(estadoAcompanhamento(appt, { ...evidence, deadline_at: null }, now).estado).toBe(
      "aguardando_resposta",
    ));
  it.each([
    { start_at: "2026-09-16T13:00:00Z" },
    { end_at: null },
    { contact_id: "outro" },
    { ghl_appointment_id: "outro" },
  ])("mudança de snapshot %j pede revisão", (change) =>
    expect(estadoAcompanhamento({ ...appt, ...change }, evidence, now).estado).toBe("rever"),
  );
  it("cancelamento preserva histórico sem apresentar confirmação atual", () =>
    expect(
      estadoAcompanhamento(
        { ...appt, status: "cancelada" },
        { ...evidence, state: "presenca_confirmada" },
        now,
      ).estado,
    ).toBe("cancelada"));
});
describe("validação da mensagem consultada no GHL", () => {
  it("solicitação usa corpo, IDs, estado e data do provedor", () =>
    expect(prepare()).toMatchObject({
      message_text: sent.body,
      message_at: new Date(sent.dateAdded).toISOString(),
      deadline_at: new Date(evidence.deadline_at!).toISOString(),
      ghl_contact_id: "contactA",
      location_id: "locA",
    }));
  it.each(["id", "contactId", "locationId", "conversationId"])("bloqueia %s divergente", (key) =>
    expect(() => prepare({ ...sent, [key]: "outra" })).toThrow(),
  );
  it.each([
    { direction: "inbound" },
    { status: "pending" },
    { status: "failed" },
    { dateAdded: "inválido" },
    { dateAdded: "2026-10-01T12:00:00Z" },
    { body: " " },
    { messageType: "TYPE_ACTIVITY_APPOINTMENT" },
    { messageType: "TYPE_CALL" },
  ])("bloqueia solicitação sem prova de envio %j", (change) =>
    expect(() => prepare({ ...sent, ...change })).toThrow(),
  );
  it("não aceita texto, location ou ator fornecido pelo browser", () => {
    for (const extra of [{ message_text: "SIM" }, { location_id: "outra" }, { actor_id: org }])
      expect(guardarEvidenciaSchema.safeParse({ ...request, ...extra }).success).toBe(false);
  });
  it("exige solicitação vinculada antes da resposta", () =>
    expect(() => prepare(reply, confirmation)).toThrow());
  it.each(["presenca_confirmada", "remarcacao_solicitada"] as const)(
    "resposta recebida permite %s após revisão",
    (estado) => expect(prepare(reply, { ...confirmation, estado }, evidence).state).toBe(estado),
  );
  it("não confirma com mensagem de saída", () =>
    expect(() => prepare({ ...reply, direction: "outbound" }, confirmation, evidence)).toThrow());
  it("não confirma SIM em conversa diferente da solicitação", () =>
    expect(() =>
      prepare(
        { ...reply, conversationId: "convB" },
        { ...confirmation, conversationId: "convB" },
        evidence,
      ),
    ).toThrow());
  it("não confirma resposta anterior à solicitação", () =>
    expect(() =>
      prepare({ ...reply, dateAdded: "2026-09-14T12:59:00Z" }, confirmation, evidence),
    ).toThrow());
  it("confirmação tardia pode ser registrada com data original", () =>
    expect(
      prepare(reply, confirmation, { ...evidence, deadline_at: "2026-09-14T13:01:00Z" }).state,
    ).toBe("presenca_confirmada"));
  it("snapshot antigo não confirma nova data", () =>
    expect(() =>
      prepare(reply, confirmation, evidence, { ...appt, start_at: "2026-09-16T13:00:00Z" }),
    ).toThrow());
  it("mudança concorrente bloqueia gravação", () =>
    expect(() => prepare(reply, { ...confirmation, previousId: null }, evidence)).toThrow());
  it.each(["failed", "undelivered"])("falha requer estado real %s", (status) =>
    expect(
      prepare({ ...sent, status }, { ...request, estado: "falha", prazoHoras: null }).state,
    ).toBe("falha"),
  );
  it("não chama delivered de falha", () =>
    expect(() => prepare(sent, { ...request, estado: "falha", prazoHoras: null })).toThrow());
});
describe("consulta relida no GHL", () => {
  const event = {
    id: "apptA",
    contactId: "contactA",
    calendarId: "calA",
    locationId: "locA",
    startTime: appt.start_at,
    endTime: appt.end_at,
    appointmentStatus: "confirmed",
  };
  it("aceita mesmo instante com offset distinto", () =>
    expect(() =>
      validarConsultaGhl(
        { event: { ...event, startTime: "2026-09-15T14:00:00+01:00" } },
        appt,
        "contactA",
        "locA",
      ),
    ).not.toThrow());
  it.each([
    { contactId: "outro" },
    { calendarId: "outro" },
    { locationId: "outra" },
    { startTime: "2026-09-16T13:00:00Z" },
    { appointmentStatus: "cancelled" },
    { appointmentStatus: "showed" },
  ])("recusa vínculo ou estado alterado %j", (change) =>
    expect(() =>
      validarConsultaGhl({ event: { ...event, ...change } }, appt, "contactA", "locA"),
    ).toThrow(),
  );
});
