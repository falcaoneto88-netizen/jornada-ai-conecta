import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ access: vi.fn(), get: vi.fn(), secrets: vi.fn(), rpc: vi.fn() }));
vi.mock("./ghl.functions", () => ({ resolverAcesso: m.access }));
vi.mock("./ghl.server", () => ({
  ghlFetch: m.get,
  readGhlSecrets: m.secrets,
  GHL_ORIGIN: "https://services.leadconnectorhq.com",
  GHL_VERSION: "2021-07-28",
}));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { rpc: m.rpc } }));
import {
  gravarAcompanhamento,
  buscarEvidencias,
  lerAcompanhamento,
} from "./appointment-tracking.server";
const org = "11111111-1111-4111-8111-111111111111",
  actor = "22222222-2222-4222-8222-222222222222";
const request = {
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
const start = "2026-09-15T13:00:00Z",
  end = "2026-09-15T13:30:00Z";
const app = {
  id: org,
  organization_id: org,
  contact_id: org,
  ghl_contact_id: "contactA",
  ghl_appointment_id: "apptA",
  ghl_calendar_id: "calA",
  start_at: start,
  end_at: end,
  status: "confirmada",
};
function ctx(receipt: unknown = null) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    range: vi.fn(),
    maybeSingle: vi.fn(),
    single: vi.fn(),
  };
  for (const key of ["select", "eq", "in", "order", "limit"] as const)
    query[key].mockReturnValue(query);
  query.single.mockResolvedValue({ data: app });
  query.maybeSingle.mockResolvedValueOnce({ data: receipt }).mockResolvedValue({ data: null });
  query.range.mockResolvedValue({ data: [], error: { code: "denied" } });
  return { userId: actor, supabase: { from: vi.fn(() => query) } as never, query };
}
beforeEach(() => {
  vi.resetAllMocks();
  m.access.mockResolvedValue({ ok: true, acesso: { orgId: org, locationId: "locA" } });
  m.secrets.mockReturnValue({ token: "synthetic" });
  m.get
    .mockResolvedValueOnce({
      ok: true,
      data: { id: "convA", contactId: "contactA", locationId: "locA" },
    })
    .mockResolvedValueOnce({
      ok: true,
      data: {
        event: {
          id: "apptA",
          contactId: "contactA",
          calendarId: "calA",
          startTime: start,
          endTime: end,
          appointmentStatus: "confirmed",
        },
      },
    })
    .mockResolvedValueOnce({
      ok: true,
      data: {
        id: "msgA",
        contactId: "contactA",
        conversationId: "convA",
        locationId: "locA",
        body: "Confirma sua consulta?",
        dateAdded: new Date(Date.now() - 1000).toISOString(),
        direction: "outbound",
        status: "delivered",
        messageType: "SMS",
      },
    });
  m.rpc.mockResolvedValue({ data: org, error: null });
});
it("nega outra organização antes de consultar credenciais ou mensagens", async () => {
  await expect(gravarAcompanhamento(ctx(), { ...request, organizationId: actor })).rejects.toThrow(
    "organização",
  );
  expect(m.secrets).not.toHaveBeenCalled();
  expect(m.get).not.toHaveBeenCalled();
  expect(m.rpc).not.toHaveBeenCalled();
});
it("recusa visualizador antes de tocar no GHL", async () => {
  m.access.mockResolvedValue({ ok: false, message: "Sem permissão" });
  await expect(
    buscarEvidencias(ctx(), { organizationId: org, appointmentId: org }),
  ).rejects.toThrow("permissão");
  expect(m.access.mock.calls[0]![1]).not.toContain("visualizador");
  expect(m.secrets).not.toHaveBeenCalled();
});
it("consulta fontes oficiais via GET antes de gravar ator e evento canônico", async () => {
  const result = await gravarAcompanhamento(ctx(), request);
  expect(result).toEqual({ id: org, ghlAlterado: false });
  expect(m.access).toHaveBeenCalledBefore(m.secrets);
  expect(m.get.mock.calls.map((c) => c[1])).toEqual([
    "conversations/convA",
    "calendars/events/appointments/apptA",
    "conversations/messages/msgA",
  ]);
  expect(m.get.mock.calls.every((c) => !c[2].method && !c[2].body)).toBe(true);
  expect(m.rpc).toHaveBeenCalledWith(
    "record_appointment_followup",
    expect.objectContaining({
      _actor: actor,
      _org: org,
      _event: expect.objectContaining({
        message_text: "Confirma sua consulta?",
        ghl_contact_id: "contactA",
      }),
    }),
  );
});
it("recusa conversa de outro contato antes de ler sua mensagem", async () => {
  m.get.mockReset().mockResolvedValue({
    ok: true,
    data: { id: "convA", contactId: "contactB", locationId: "locA" },
  });
  await expect(gravarAcompanhamento(ctx(), request)).rejects.toThrow("contato");
  expect(m.get).toHaveBeenCalledTimes(1);
  expect(m.rpc).not.toHaveBeenCalled();
});
it("retorna mesmo recibo após repetição exata sem novo acesso GHL", async () => {
  const receipt = {
    id: org,
    appointment_id: org,
    actor_id: actor,
    message_id: "msgA",
    conversation_id: "convA",
    state: "aguardando_resposta",
    previous_id: null,
    message_at: "2026-09-14T12:00:00Z",
    deadline_at: "2026-09-15T12:00:00Z",
  };
  expect(await gravarAcompanhamento(ctx(receipt), request)).toEqual({
    id: org,
    ghlAlterado: false,
  });
  expect(m.rpc).not.toHaveBeenCalled();
  expect(m.get).not.toHaveBeenCalled();
  await expect(
    gravarAcompanhamento(ctx(receipt), { ...request, messageId: "outra" }),
  ).rejects.toThrow("diferentes");
});
it("falha de gravação não é reportada como sucesso", async () => {
  m.rpc.mockResolvedValue({ error: { code: "40001" } });
  await expect(gravarAcompanhamento(ctx(), request)).rejects.toThrow("mudou");
});
