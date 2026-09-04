import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Ctx = { supabase: SupabaseClient; userId: string };

type GhlContact = {
  id?: string;
  firstName?: string;
  lastName?: string;
  contactName?: string;
  phone?: string;
  email?: string;
  tags?: string[];
  source?: string;
  dateUpdated?: string;
};

async function carregarLigacao(context: Ctx) {
  const { data: perfil } = await context.supabase
    .from("profiles")
    .select("organization_id, full_name")
    .eq("id", context.userId)
    .maybeSingle();
  if (!perfil) throw new Error("Perfil não encontrado.");

  const { data: conn } = await context.supabase
    .from("ghl_connections")
    .select("*")
    .eq("organization_id", perfil.organization_id)
    .maybeSingle();

  return { orgId: perfil.organization_id as string, nome: perfil.full_name as string | null, conn };
}

async function auditar(
  context: Ctx,
  orgId: string,
  nome: string | null,
  action: string,
  metadata: Record<string, unknown>,
) {
  await context.supabase.from("audit_logs").insert({
    organization_id: orgId,
    actor_id: context.userId,
    actor_name: nome,
    action,
    entity: "ghl",
    metadata,
  });
}

/** Verifica se os secrets estão configurados — nunca devolve valores. */
export const getGhlSecretsStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => ({
    token: Boolean(process.env["GHL_PRIVATE_TOKEN"]),
    locationId: Boolean(process.env["GHL_LOCATION_ID"]),
    webhookSecret: Boolean(process.env["GHL_WEBHOOK_SECRET"]),
    ia: Boolean(process.env["LOVABLE_API_KEY"]),
  }));

/** Teste real de ligação ao GoHighLevel. */
export const testGhlConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { ghlFetch, readGhlSecrets, mensagemErro } = await import("./ghl.server");
    const ctx = context as unknown as Ctx;
    const { orgId, nome, conn } = await carregarLigacao(ctx);
    const { token, locationId } = readGhlSecrets();

    if (!token || !locationId) {
      const message = mensagemErro("missing_secrets");
      await ctx.supabase
        .from("ghl_connections")
        .update({ status: "sem_credenciais", last_test_at: new Date().toISOString(), last_test_message: message })
        .eq("organization_id", orgId);
      return { ok: false as const, code: "missing_secrets" as const, message };
    }

    const cfg = {
      baseUrl: conn?.api_base_url ?? "https://services.leadconnectorhq.com",
      version: conn?.api_version ?? "2021-07-28",
      token,
      locationId,
    };

    const res = await ghlFetch<{ location?: { name?: string; id?: string } }>(cfg, `locations/${locationId}`);
    const agora = new Date().toISOString();

    if (!res.ok) {
      await ctx.supabase
        .from("ghl_connections")
        .update({ status: "erro", mode: "demo", last_test_at: agora, last_test_message: res.message })
        .eq("organization_id", orgId);
      await auditar(ctx, orgId, nome, "ghl.test_connection.erro", { code: res.code, status: res.status });
      return { ok: false as const, code: res.code, message: res.message };
    }

    const nomeLocation = res.data?.location?.name ?? "Localização GoHighLevel";
    await ctx.supabase
      .from("ghl_connections")
      .update({
        status: "conectada",
        mode: "conectado",
        location_id: locationId,
        last_test_at: agora,
        last_test_message: `Ligação validada com ${nomeLocation}.`,
      })
      .eq("organization_id", orgId);
    await auditar(ctx, orgId, nome, "ghl.test_connection.sucesso", { location: nomeLocation });

    return { ok: true as const, locationName: nomeLocation, testedAt: agora };
  });

/** Proxy com allowlist de operações. */
export const ghlProxy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { operacao: string; query?: Record<string, string>; body?: unknown }) => input)
  .handler(async ({ data, context }) => {
    const { ghlFetch, readGhlSecrets, mensagemErro, isOperacaoValida, OPERACOES } = await import("./ghl.server");
    const ctx = context as unknown as Ctx;

    if (!isOperacaoValida(data.operacao)) {
      return { ok: false as const, code: "bad_request" as const, message: "Operação não permitida." };
    }
    const op = OPERACOES[data.operacao];
    const { orgId, nome, conn } = await carregarLigacao(ctx);
    const { token, locationId } = readGhlSecrets();
    if (!token || !locationId) {
      return { ok: false as const, code: "missing_secrets" as const, message: mensagemErro("missing_secrets") };
    }
    if (op.escrita && !conn?.write_enabled) {
      return {
        ok: false as const,
        code: "forbidden" as const,
        message: "Operações de escrita estão bloqueadas. Ative a escrita em Integrações após validar a ligação.",
      };
    }

    const cfg = {
      baseUrl: conn?.api_base_url ?? "https://services.leadconnectorhq.com",
      version: conn?.api_version ?? "2021-07-28",
      token,
      locationId,
    };
    const res = await ghlFetch(cfg, op.path(cfg), {
      method: op.method,
      query: { locationId, ...(data.query ?? {}) },
      ...(op.method === "POST" ? { body: data.body ?? {} } : {}),
    });

    if (op.escrita) {
      await auditar(ctx, orgId, nome, `ghl.${data.operacao}`, { ok: res.ok });
    }
    return res.ok
      ? { ok: true as const, data: (res.data ?? null) as Record<string, unknown> | null }
      : { ok: false as const, code: res.code, message: res.message };
  });

/** Sincronização em modo leitura: importa contactos do GHL para a base local. */
export const syncGhl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { ghlFetch, readGhlSecrets, mensagemErro } = await import("./ghl.server");
    const ctx = context as unknown as Ctx;
    const { orgId, nome, conn } = await carregarLigacao(ctx);
    const { token, locationId } = readGhlSecrets();

    if (!token || !locationId) {
      return { ok: false as const, code: "missing_secrets" as const, message: mensagemErro("missing_secrets") };
    }
    if (conn?.status !== "conectada") {
      return {
        ok: false as const,
        code: "forbidden" as const,
        message: "Teste a ligação antes de sincronizar.",
      };
    }

    const cfg = {
      baseUrl: conn.api_base_url,
      version: conn.api_version,
      token,
      locationId,
    };

    const res = await ghlFetch<{ contacts?: GhlContact[] }>(cfg, "contacts/", { query: { locationId, limit: "100" } });
    if (!res.ok) {
      return { ok: false as const, code: res.code, message: res.message };
    }

    const contactos = res.data?.contacts ?? [];
    const linhas = contactos.map((c) => ({
      organization_id: orgId,
      ghl_contact_id: String(c.id),
      full_name: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.contactName || c.email || "Sem nome",
      phone: c.phone ?? null,
      phone_normalized: c.phone ? String(c.phone).replace(/\D/g, "") : null,
      email: c.email ?? null,
      tags: Array.isArray(c.tags) ? c.tags : [],
      source: c.source ?? "GoHighLevel",
      last_interaction_at: c.dateUpdated ?? null,
      is_demo: false,
    }));

    let importados = 0;
    if (linhas.length > 0) {
      const { error } = await ctx.supabase
        .from("contacts")
        .upsert(linhas, { onConflict: "organization_id,ghl_contact_id" });
      if (error) {
        return { ok: false as const, code: "server_error" as const, message: `Falha ao gravar contactos: ${error.message}` };
      }
      importados = linhas.length;
    }

    const agora = new Date().toISOString();
    await ctx.supabase.from("ghl_connections").update({ last_sync_at: agora }).eq("organization_id", orgId);
    await auditar(ctx, orgId, nome, "ghl.sync.leitura", { importados });

    return { ok: true as const, importados, syncedAt: agora };
  });
