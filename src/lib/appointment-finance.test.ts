import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  appointmentFinanceReadSchema,
  appointmentFinanceSaveSchema,
  type AppointmentFinanceSaveInput,
} from "./appointment-finance.core";
import {
  AppointmentFinanceService,
  authenticatedAppointmentFinance,
} from "./appointment-finance.server";

const auth = vi.hoisted(() => ({ resolve: vi.fn(), rpc: vi.fn() }));
vi.mock("./ghl.functions", () => ({ resolverAcesso: auth.resolve }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { rpc: auth.rpc } }));

const ORG = "11111111-1111-4111-8111-111111111111";
const ACTOR = "22222222-2222-4222-8222-222222222222";
const APPOINTMENT = "33333333-3333-4333-8333-333333333333";
const FOREIGN = "44444444-4444-4444-8444-444444444444";
const scope = { organizationId: ORG, actorId: ACTOR };
const input: AppointmentFinanceSaveInput = {
  appointmentId: APPOINTMENT,
  totalCents: 50000,
  depositCents: 10000,
  expectedRevision: 0,
  requestId: "55555555-5555-4555-8555-555555555555",
};
const entry = {
  appointmentId: APPOINTMENT,
  totalCents: input.totalCents,
  depositCents: input.depositCents,
  currency: "EUR" as const,
  revision: 1,
  updatedAt: "2026-11-13T12:00:00+00:00",
  updatedBy: ACTOR,
};
const rpc = vi.fn();
const service = () => new AppointmentFinanceService({ rpc });
beforeEach(() => vi.resetAllMocks());

describe("administrative figures contract", () => {
  it.each([
    { totalCents: -1 },
    { totalCents: 0.1 },
    { totalCents: 100000001 },
    { totalCents: Number.NaN },
    { totalCents: Number.POSITIVE_INFINITY },
    { depositCents: -1 },
    { depositCents: 50001 },
    { depositCents: 1.5 },
    { expectedRevision: -1 },
    { expectedRevision: 1.5 },
    { organizationId: ORG },
    { locationId: "from-client" },
    { appointmentId: "not-a-uuid" },
    { requestId: "bad" },
  ])("rejects invalid or client-supplied scope %j", (patch) => {
    expect(appointmentFinanceSaveSchema.safeParse({ ...input, ...patch }).success).toBe(false);
  });
  it("accepts zero and integer upper boundary without coercing currency or numeric strings", () => {
    expect(
      appointmentFinanceSaveSchema.safeParse({ ...input, totalCents: 0, depositCents: 0 }).success,
    ).toBe(true);
    expect(
      appointmentFinanceSaveSchema.safeParse({
        ...input,
        totalCents: 100000000,
        depositCents: 100000000,
      }).success,
    ).toBe(true);
    expect(appointmentFinanceSaveSchema.safeParse({ ...input, totalCents: "50000" }).success).toBe(
      false,
    );
    expect(appointmentFinanceSaveSchema.safeParse({ ...input, currency: "USD" }).success).toBe(
      false,
    );
  });
  it("bounds reads to 200 UUIDs with no organization from the client", () => {
    expect(appointmentFinanceReadSchema.safeParse({ appointmentIds: [] }).success).toBe(true);
    expect(
      appointmentFinanceReadSchema.safeParse({ appointmentIds: Array(200).fill(APPOINTMENT) })
        .success,
    ).toBe(true);
    expect(
      appointmentFinanceReadSchema.safeParse({ appointmentIds: Array(201).fill(APPOINTMENT) })
        .success,
    ).toBe(false);
    expect(
      appointmentFinanceReadSchema.safeParse({ appointmentIds: [APPOINTMENT], organizationId: ORG })
        .success,
    ).toBe(false);
  });
});

describe("local finance service", () => {
  it("reads only requested entries and never invents a zero amount for an absent record", async () => {
    rpc.mockResolvedValue({ data: { available: true, canEdit: true, entries: [] }, error: null });
    expect(await service().read(scope, { appointmentIds: [APPOINTMENT] })).toEqual({
      available: true,
      canEdit: true,
      entries: [],
    });
    expect(rpc).toHaveBeenCalledWith("appointment_finance_command", {
      _op: "read",
      _org: ORG,
      _actor: ACTOR,
      _data: { appointmentIds: [APPOINTMENT] },
    });
  });
  it.each(["PGRST202", "42P01", "42883", "42703"])(
    "reports missing migration %s without leaking database text",
    async (code) => {
      rpc.mockResolvedValue({ data: null, error: { code, message: "sensitive SQL" } });
      const read = await service().read(scope, { appointmentIds: [APPOINTMENT] });
      expect(read).toMatchObject({
        available: false,
        entries: [],
        canEdit: false,
        code: "migration_required",
      });
      expect(JSON.stringify(read)).not.toContain("sensitive");
      expect(await service().save(scope, input)).toMatchObject({
        ok: false,
        code: "migration_required",
      });
    },
  );
  it.each(["forbidden", "conflict", "request_mismatch", "appointment_not_found"])(
    "returns safe persisted-command error %s",
    async (error) => {
      rpc.mockResolvedValue({ data: { error }, error: null });
      expect(await service().save(scope, input)).toMatchObject({ ok: false, code: error });
    },
  );
  it("rejects unexpected or duplicate entries instead of passing data outside the requested set", async () => {
    for (const entries of [[{ ...entry, appointmentId: FOREIGN }], [entry, entry]]) {
      rpc.mockResolvedValue({ data: { available: true, canEdit: true, entries }, error: null });
      expect(await service().read(scope, { appointmentIds: [APPOINTMENT] })).toMatchObject({
        available: false,
        code: "unavailable",
      });
    }
  });
  it("preserves the full idempotency contract and validates the saved snapshot", async () => {
    rpc.mockResolvedValue({ data: { entry }, error: null });
    expect(await service().save(scope, input)).toEqual({ ok: true, entry });
    expect(rpc).toHaveBeenLastCalledWith("appointment_finance_command", {
      _op: "save",
      _org: ORG,
      _actor: ACTOR,
      _data: input,
    });
    expect(await service().save(scope, input)).toEqual({ ok: true, entry });
    for (const patch of [
      { revision: 9 },
      { updatedBy: FOREIGN },
      { depositCents: 0 },
      { appointmentId: FOREIGN },
    ]) {
      rpc.mockResolvedValue({ data: { entry: { ...entry, ...patch } }, error: null });
      expect(await service().save(scope, input)).toMatchObject({ ok: false, code: "unavailable" });
    }
  });
  it("does not invoke persistence for invalid input and handles unavailable RPC safely", async () => {
    expect(await service().save(scope, { ...input, depositCents: -1 })).toMatchObject({
      ok: false,
      code: "invalid_input",
    });
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockRejectedValue(new Error("private detail"));
    expect(await service().save(scope, input)).toMatchObject({ ok: false, code: "unavailable" });
  });
});

describe("authenticated server scope", () => {
  const context = { userId: ACTOR, supabase: {} as SupabaseClient };
  it("derives organization from the server resolver and excludes visualizador", async () => {
    auth.resolve.mockResolvedValue({ ok: true, acesso: { orgId: ORG } });
    const access = await authenticatedAppointmentFinance(context);
    expect(auth.resolve).toHaveBeenCalledWith(context, ["administrador", "gestor", "comercial"]);
    expect(access).toMatchObject({ scope });
  });
  it("does not expose database access when the session/location binding is refused", async () => {
    auth.resolve.mockResolvedValue({ ok: false, code: "forbidden", message: "internal detail" });
    expect(await authenticatedAppointmentFinance(context)).toEqual({ failure: "forbidden" });
    expect(auth.rpc).not.toHaveBeenCalled();
  });
});
