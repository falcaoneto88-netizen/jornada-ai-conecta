import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { DefinicaoOperacao, PapelApp } from "./ghl.server";

type Ctx = { supabase: SupabaseClient; userId: string };

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };




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
export type DepsAcesso = {
  lerBinding?: (orgId: string) => Promise<string | null>;
  locationDoToken?: () => string | undefined;
};

export async function resolverAcesso(
  context: Ctx,
  papeisNecessarios: readonly PapelApp[],
  deps: DepsAcesso = {},
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
  const lerBinding =
    deps.lerBinding ??
    (async (org: string) => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data } = await supabaseAdmin
        .from("ghl_location_bindings")
        .select("location_id")
        .eq("organization_id", org)
        .maybeSingle();
      return (data?.location_id as string | undefined) ?? null;
    });
  const locationBinding = await lerBinding(orgId);
  if (!locationBinding) return { ok: false, code: "not_found", message: SEM_INTEGRACAO };

  // Existe um único token global no backend: só pode ser usado pela location a
  // que esse token pertence. Qualquer outro vínculo é recusado antes do fetch.
  const locationDoToken = (deps.locationDoToken ?? (() => process.env["GHL_LOCATION_ID"]))();
  if (!locationDoToken || locationDoToken !== locationBinding) {
    return { ok: false, code: "not_found", message: SEM_INTEGRACAO };
  }


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
      locationId: locationBinding,
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
      parametrosDoServidor,
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

    if (op.escrita && conn?.["status"] !== "conectada") {
      return { ok: false as const, code: "forbidden" as const, message: "Teste a ligação antes de enviar alterações." };
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
    const executar = () => ghlFetch(cfg, op.path({ locationId, ghlContactId }), {
      method: op.method,
      query: { ...query.valor, ...parametrosDoServidor(op, { locationId, ghlContactId }) },
      ...(op.method === "POST"
        ? { body: { ...body.valor, ...(ghlContactId ? { contactId: ghlContactId } : {}) } }
        : {}),
    });
    const { executarEscritaAuditada } = await import("./ghl-write.core");
    const tentativaId = crypto.randomUUID();
    const res = op.escrita ? await executarEscritaAuditada({
      executar,
      registar: async (fase, resultado) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error } = await supabaseAdmin.from("audit_logs").insert({
          organization_id: orgId, actor_id: ctx.userId, actor_name: nome,
          action: `ghl.${data.operacao}.${fase}`, entity: "contacts", entity_id: data.contactoId ?? null,
          verified: true,
          metadata: { tentativa_id: tentativaId, ...(resultado ? {
            ok: resultado.ok, status: resultado.status, code: resultado.ok ? null : resultado.code,
          } : {}) },
        });
        return !error;
      },
    }) : { ...await executar(), warning: undefined };
    return res.ok
      ? { ok: true as const, data: (res.data ?? null) as Json, warning: res.warning }
      : { ok: false as const, code: res.code, message: res.message, warning: res.warning };
  });


/** Sincronização em modo leitura: importa contactos do GHL para a base local. */
export const syncGhl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { ghlFetch, readGhlSecrets, mensagemErro, GHL_ORIGIN, GHL_VERSION } = await import("./ghl.server");
    const ctx = context as unknown as Ctx;
    const acesso = await resolverAcesso(ctx, ["administrador"]);
    if (!acesso.ok) return { ok: false as const, code: acesso.code, message: acesso.message };
    const { orgId, locationId, conn } = acesso.acesso;

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

    const { sincronizarContactos, ErroContacto } = await import("./ghl-contacts.core");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const resultado = await sincronizarContactos({
      locationId,
      pagina: async (cursor) => {
        const res = await ghlFetch<{ contacts?: unknown; meta?: unknown }>(cfg, "contacts/", {
          query: { locationId, limit: "100", ...cursor },
        });
        if (!res.ok) throw new Error(res.message);
        return res.data;
      },
      detalhe: async (id) => {
        const res = await ghlFetch<{ contact?: unknown }>(cfg, `contacts/${encodeURIComponent(id)}`);
        if (!res.ok) throw new Error(res.message);
        return res.data?.contact;
      },
      aplicar: async (contacto) => {
        const { data, error } = await supabaseAdmin.rpc("ghl_apply_contact_snapshot", {
          _org: orgId, _location: locationId, _actor: ctx.userId, _contact: { ...contacto },
        });
        if (error) throw new Error("Falha ao gravar contacto e auditoria; o resultado deste contacto não pôde ser confirmado.");
        const estado = data && typeof data === "object" && !Array.isArray(data) ? data["estado"] : null;
        if (estado === "aplicado" || estado === "ignorado") return estado;
        if (estado === "conflito_telefone" || estado === "conflito_concorrente") {
          throw new ErroContacto(estado, "Conflito de identidade/telefone. Reveja este contacto antes de repetir.");
        }
        throw new Error("Resultado de gravação desconhecido.");
      },
    });
    if (!resultado.ok) return resultado;
    const { data: syncedAt, error } = await supabaseAdmin.rpc("ghl_finish_contact_sync", {
      _org: orgId, _location: locationId, _actor: ctx.userId,
      _importados: resultado.importados, _ignorados: resultado.ignorados,
    });
    if (error || !syncedAt) return {
      ...resultado, ok: false as const, code: "partial_sync" as const,
      message: `Contactos processados (${resultado.importados} gravados, ${resultado.ignorados} preservados), mas não foi possível confirmar o resumo da sincronização.`,
    };
    return { ...resultado, syncedAt };
  });

