import { expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { lerBiblioteca, lerContextoModelo, salvarBiblioteca } from "./message-library.server";
import { modelosIniciais } from "./message-library.starters";
const org = "10000000-0000-4000-8000-000000000001",
  other = "10000000-0000-4000-8000-000000000002";
function mock(results: Record<string, unknown>) {
  const calls: unknown[][] = [];
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "order", "limit", "single", "maybeSingle"])
      chain[method] = (...args: unknown[]) => {
        calls.push([table, method, ...args]);
        return chain;
      };
    chain["then"] = (resolve: (x: unknown) => void) =>
      Promise.resolve(results[table] ?? { data: [], error: null }).then(resolve);
    return chain;
  });
  const rpc = vi.fn().mockResolvedValue({ data: { id: other, revision: 1 }, error: null });
  return {
    ctx: { supabase: { from, rpc } as unknown as SupabaseClient, userId: "user-a" },
    from,
    rpc,
    calls,
  };
}
const profile = { data: { organization_id: org }, error: null };
const { starter_key: _key, ...draft } = modelosIniciais[0];
const input = { organizationId: org, id: other, expectedRevision: null, draft };
it("recusa organização alterada antes de consultar biblioteca", async () => {
  const m = mock({ profiles: profile });
  await expect(lerBiblioteca(m.ctx, { organizationId: other })).rejects.toThrow("Organização");
  expect(m.from.mock.calls.map((x) => x[0])).toEqual(["profiles"]);
});
it("visualizador não chama RPC de escrita", async () => {
  const m = mock({ profiles: profile, user_roles: { data: [{ role: "visualizador" }] } });
  await expect(salvarBiblioteca(m.ctx, input)).rejects.toThrow("Somente");
  expect(m.rpc).not.toHaveBeenCalled();
});
it("gestor salva pelo cliente autenticado e passa a revisão", async () => {
  const m = mock({ profiles: profile, user_roles: { data: [{ role: "gestor" }] } });
  await salvarBiblioteca(m.ctx, { ...input, expectedRevision: 4 });
  expect(m.rpc).toHaveBeenCalledWith(
    "save_message_template_draft",
    expect.objectContaining({ _org: org, _id: other, _expected_revision: 4 }),
  );
});
it("conflito não é tratado como sucesso", async () => {
  const m = mock({ profiles: profile, user_roles: { data: [{ role: "administrador" }] } });
  m.rpc.mockResolvedValue({ error: { code: "40001" }, data: null });
  await expect(salvarBiblioteca(m.ctx, input)).rejects.toThrow("outra sessão");
});
it("consulta sem contato mostra nome pendente sem consultar id nulo", async () => {
  const m = mock({
    profiles: profile,
    appointments: {
      data: {
        contact_id: null,
        title: "Teste",
        start_at: "2026-09-15T13:00:00Z",
        assigned_user_name: null,
        status: "agendada",
        updated_at: "2026-09-14T00:00:00Z",
      },
    },
    organizations: { data: { name: "Clínica", timezone: "Europe/Lisbon" } },
  });
  const r = await lerContextoModelo(m.ctx, { organizationId: org, appointmentId: other });
  expect(r.values["contact.name"]).toBeNull();
  expect(r.values["appointment.only_start_time"]).toBe("14:00");
  expect(m.from).not.toHaveBeenCalledWith("contacts");
});
it("consulta e contato são restringidos à organização e sem demo", async () => {
  const m = mock({
    profiles: profile,
    appointments: {
      data: {
        contact_id: "c",
        title: "Teste",
        start_at: "2026-09-15T13:00:00Z",
        assigned_user_name: null,
      },
    },
    contacts: { data: null },
    organizations: { data: { name: "Clínica", timezone: "Europe/Lisbon" } },
  });
  await lerContextoModelo(m.ctx, { organizationId: org, appointmentId: other });
  for (const t of ["appointments", "contacts"]) {
    expect(m.calls).toContainEqual([t, "eq", "organization_id", org]);
    expect(m.calls).toContainEqual([t, "eq", "is_demo", false]);
  }
});
it("falha da biblioteca não se transforma em lista vazia", async () => {
  const m = mock({
    profiles: profile,
    message_templates: { data: null, error: { message: "offline" } },
  });
  await expect(lerBiblioteca(m.ctx, { organizationId: org })).rejects.toThrow("Não foi possível");
});
