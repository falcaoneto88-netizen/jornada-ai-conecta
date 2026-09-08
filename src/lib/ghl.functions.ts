import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { DefinicaoOperacao, PapelApp } from "./ghl.server";

type Ctx = { supabase: SupabaseClient; userId: string };

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

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

export const SEM_INTEGRACAO = "Integração não configurada para esta organização.";
export const SEM_PERMISSAO = "Não tem permissão para esta ação.";

export type Acesso = {
  orgId: string;
  nome: string | null;
  papeis: PapelApp[];
  locationId: string;
  conn: Record<string, unknown> | null;
};

export type Recusa = { ok: false; code: "forbidden" | "not_found" | "missing_secrets"; message: string };

/** Decide se um papel pode executar a operação pedida (função pura, testável). */
export function autorizarOperacao(input: {
  papeis: readonly PapelApp[];
  op: Pick<DefinicaoOperacao, "escrita" | "papeis">;
  writeEnabled: boolean;
}): { ok: true } | { ok: false; message: string } {
  const permitido = input.op.papeis.some((p) => input.papeis.includes(p));
  if (!permitido) return { ok: false, message: SEM_PERMISSAO };
  if (input.op.escrita && !input.writeEnabled) {
    return {
      ok: false,
      message: "Operações de escrita estão bloqueadas. Ative a escrita em Integrações após validar a ligação.",
    };
  }
  return { ok: true };
}

/**
 * Resolve utilizador -> organização -> papéis -> vínculo de location.
 * Só depois disto é legítimo tocar em credenciais do GoHighLevel.
 */
export async function resolverAcesso(
  context: Ctx,
  papeisNecessarios: readonly PapelApp[],
): Promise<{ ok: true; acesso: Acesso } | Recusa> {
  const { data: perfil } = await context.supabase
    .from("profiles")
    .select("organization_id, full_name")
    .eq("id", context.userId)
    .maybeSingle();
  if (!perfil) return { ok: false, code: "not_found", message: "Perfil não encontrado." };

  const orgId = perfil.organization_id as string;

  const { data: linhasPapeis } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId)
    .eq("organization_id", orgId);
  const papeis = (linhasPapeis ?? []).map((l) => l.role as PapelApp);

  if (papeisNecessarios.length > 0 && !papeisNecessarios.some((p) => papeis.includes(p))) {
    return { ok: false, code: "forbidden", message: SEM_PERMISSAO };
  }

  // Vínculo de confiança: server-only, o cliente nunca o pode alterar.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: binding } = await supabaseAdmin
    .from("ghl_location_bindings")
    .select("location_id")
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!binding?.location_id) return { ok: false, code: "not_found", message: SEM_INTEGRACAO };

  const { data: conn } = await context.supabase
    .from("ghl_connections")
    .select("*")
    .eq("organization_id", orgId)
    .maybeSingle();

  return {
    ok: true,
    acesso: {
      orgId,
      nome: (perfil.full_name as string | null) ?? null,
      papeis,
      locationId: binding.location_id as string,
      conn: (conn as Record<string, unknown> | null) ?? null,
    },
  };
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
  .handler(async ({ context }) => {
    const ctx = context as unknown as Ctx;
    const acesso = await resolverAcesso(ctx, []);
    if (!acesso.ok) {
      return { configurada: false, token: false, locationId: false, webhookSecret: false, ia: false };
    }
    return {
      configurada: true,
      token: Boolean(process.env["GHL_PRIVATE_TOKEN"]),
      locationId: Boolean(process.env["GHL_LOCATION_ID"]),
      webhookSecret: Boolean(process.env["GHL_WEBHOOK_SECRET"]),
      ia: Boolean(process.env["LOVABLE_API_KEY"]),
    };
  });

/** Teste real de ligação ao GoHighLevel (apenas administrador). */
export const testGhlConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { ghlFetch, readGhlSecrets, mensagemErro, GHL_ORIGIN, GHL_VERSION } = await import("./ghl.server");
    const ctx = context as unknown as Ctx;
    const acesso = await resolverAcesso(ctx, ["administrador"]);
    if (!acesso.ok) return { ok: false as const, code: acesso.code, message: acesso.message };
    const { orgId, nome, locationId } = acesso.acesso;

    const { token } = readGhlSecrets();
    if (!token) {
      const message = mensagemErro("missing_secrets");
      await ctx.supabase
        .from("ghl_connections")
        .update({ status: "sem_credenciais", last_test_at: new Date().toISOString(), last_test_message: message })
        .eq("organization_id", orgId);
      return { ok: false as const, code: "missing_secrets" as const, message };
    }

    const cfg = { baseUrl: GHL_ORIGIN, version: GHL_VERSION, token, locationId };
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
        last_test_at: agora,
        last_test_message: `Ligação validada com ${nomeLocation}.`,
      })
      .eq("organization_id", orgId);
    await auditar(ctx, orgId, nome, "ghl.test_connection.sucesso", { location: nomeLocation });

    return { ok: true as const, locationName: nomeLocation, testedAt: agora };
  });

/** Proxy com allowlist de operações, papéis e verificação de propriedade. */
export const ghlProxy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      operacao: string;
      query?: Record<string, string>;
      body?: unknown;
      contactoId?: string | null;
    }) => input,
  )
  .handler(async ({ data, context }) => {
    const {
      ghlFetch,
      readGhlSecrets,
      mensagemErro,
      isOperacaoValida,
      OPERACOES,
      filtrarQuery,
      filtrarBody,
      contactoPertenceALocation,
      GHL_ORIGIN,
      GHL_VERSION,
    } = await import("./ghl.server");
    const ctx = context as unknown as Ctx;

    if (!isOperacaoValida(data.operacao)) {
      return { ok: false as const, code: "bad_request" as const, message: "Operação não permitida." };
    }
    const op = OPERACOES[data.operacao] as DefinicaoOperacao;

    const acesso = await resolverAcesso(ctx, []);
    if (!acesso.ok) return { ok: false as const, code: acesso.code, message: acesso.message };
    const { orgId, nome, papeis, locationId, conn } = acesso.acesso;

    const autorizacao = autorizarOperacao({
      papeis,
      op,
      writeEnabled: conn?.["write_enabled"] === true,
    });
    if (!autorizacao.ok) {
      return { ok: false as const, code: "forbidden" as const, message: autorizacao.message };
    }

    const query = filtrarQuery(op, data.query);
    if (!query.ok) return { ok: false as const, code: "bad_request" as const, message: query.motivo };
    const body = filtrarBody(op, data.body);
    if (!body.ok) return { ok: false as const, code: "bad_request" as const, message: body.motivo };

    const { token } = readGhlSecrets();
    if (!token) {
      return { ok: false as const, code: "missing_secrets" as const, message: mensagemErro("missing_secrets") };
    }

    let ghlContactId: string | null = null;
    if (op.exigeContacto) {
      if (!data.contactoId) {
        return { ok: false as const, code: "bad_request" as const, message: "Indique o cliente desta ação." };
      }
      const { data: contacto } = await ctx.supabase
        .from("contacts")
        .select("ghl_contact_id")
        .eq("id", data.contactoId)
        .eq("organization_id", orgId)
        .maybeSingle();
      if (!contacto?.ghl_contact_id) {
        return {
          ok: false as const,
          code: "not_found" as const,
          message: "Este cliente ainda não está associado ao GoHighLevel.",
        };
      }
      ghlContactId = contacto.ghl_contact_id as string;
      const propriedade = await contactoPertenceALocation(token, locationId, ghlContactId);
      if (!propriedade.ok) {
        return { ok: false as const, code: "forbidden" as const, message: propriedade.message };
      }
    }

    const cfg = { baseUrl: GHL_ORIGIN, version: GHL_VERSION, token, locationId };
    const res = await ghlFetch(cfg, op.path({ locationId, ghlContactId }), {
      method: op.method,
      query: { locationId, ...query.valor },
      ...(op.method === "POST"
        ? { body: { ...body.valor, ...(ghlContactId ? { contactId: ghlContactId } : {}) } }
        : {}),
    });

    if (op.escrita) {
      await auditar(ctx, orgId, nome, `ghl.${data.operacao}`, { ok: res.ok });
    }
    return res.ok
      ? { ok: true as const, data: (res.data ?? null) as Json }
      : { ok: false as const, code: res.code, message: res.message };
  });

/** Sincronização em modo leitura: importa contactos do GHL para a base local. */
export const syncGhl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { ghlFetch, readGhlSecrets, mensagemErro, GHL_ORIGIN, GHL_VERSION } = await import("./ghl.server");
    const ctx = context as unknown as Ctx;
    const acesso = await resolverAcesso(ctx, ["administrador"]);
    if (!acesso.ok) return { ok: false as const, code: acesso.code, message: acesso.message };
    const { orgId, nome, locationId, conn } = acesso.acesso;

    const { token } = readGhlSecrets();
    if (!token) {
      return { ok: false as const, code: "missing_secrets" as const, message: mensagemErro("missing_secrets") };
    }
    if (conn?.["status"] !== "conectada") {
      return {
        ok: false as const,
        code: "forbidden" as const,
        message: "Teste a ligação antes de sincronizar.",
      };
    }

    const cfg = { baseUrl: GHL_ORIGIN, version: GHL_VERSION, token, locationId };

    const res = await ghlFetch<{ contacts?: GhlContact[] }>(cfg, "contacts/", { query: { locationId, limit: "100" } });
    if (!res.ok) {
      return { ok: false as const, code: res.code, message: res.message };
    }

    const contactos = res.data?.contacts ?? [];
    const limpar = (v?: string | null) =>
      (v ?? "").replace(/\bundefined\b|\bnull\b/gi, "").replace(/\s+/g, " ").trim();

    const linhas = contactos.map((c) => ({
      organization_id: orgId,
      ghl_contact_id: String(c.id),
      full_name:
        limpar([c.firstName, c.lastName].filter(Boolean).join(" ")) ||
        limpar(c.contactName) ||
        limpar(c.email) ||
        "Sem nome",
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
      // Os índices únicos são parciais, por isso não é possível usar `upsert`/ON CONFLICT.
      // Lemos os contactos já existentes e decidimos inserir ou atualizar cada um.
      const ids = linhas.map((l) => l.ghl_contact_id);
      const { data: existentes, error: erroLeitura } = await ctx.supabase
        .from("contacts")
        .select("id, ghl_contact_id")
        .eq("organization_id", orgId)
        .in("ghl_contact_id", ids);
      if (erroLeitura) {
        return {
          ok: false as const,
          code: "server_error" as const,
          message: `Falha ao ler contactos: ${erroLeitura.message}`,
        };
      }

      const mapa = new Map<string, string>();
      for (const e of existentes ?? []) {
        if (e.ghl_contact_id) mapa.set(e.ghl_contact_id, e.id);
      }

      const novos = linhas.filter((l) => !mapa.has(l.ghl_contact_id));
      if (novos.length > 0) {
        const { error } = await ctx.supabase.from("contacts").insert(novos);
        if (error) {
          return {
            ok: false as const,
            code: "server_error" as const,
            message: `Falha ao gravar contactos: ${error.message}`,
          };
        }
      }

      for (const linha of linhas) {
        const idExistente = mapa.get(linha.ghl_contact_id);
        if (!idExistente) continue;
        const { organization_id: _org, ghl_contact_id: _ghl, ...campos } = linha;
        const { error } = await ctx.supabase.from("contacts").update(campos).eq("id", idExistente);
        if (error) {
          return {
            ok: false as const,
            code: "server_error" as const,
            message: `Falha ao atualizar contactos: ${error.message}`,
          };
        }
      }

      importados = linhas.length;
    }

    const agora = new Date().toISOString();
    await ctx.supabase.from("ghl_connections").update({ last_sync_at: agora }).eq("organization_id", orgId);
    await auditar(ctx, orgId, nome, "ghl.sync.leitura", { importados });

    return { ok: true as const, importados, syncedAt: agora };
  });
