import type { SupabaseClient } from "@supabase/supabase-js";

import {
  FALCAO_ACOLHIMENTO_RASCUNHO,
  FALCAO_LOCATION,
  FALCAO_PIPELINE,
  FALCAO_SITE_URL,
  FALCAO_SLUG,
  FALCAO_STAGE_GHL,
  FALCAO_STAGE_LOCAL,
  segredoFalcao,
} from "./falcao-lead.server";
import { FALCAO_SOURCE } from "./falcao-lead.core";

export type EstadoIntegracaoSite = {
  admin: boolean;
  segredoPresente: boolean;
  site: string;
  source: string;
  etapaLocal: string;
  destino: { location: string; pipeline: string; stage: string };
  configurada: boolean;
  ativa: boolean;
  escritaGhl: "pendente" | "habilitado" | "bloqueado";
  acolhimento: string;
  pendencias: string[];
  leads: { total: number; emRevisao: number };
};

type Cliente = Pick<SupabaseClient, "rpc" | "from" | "auth">;

async function ehAdministrador(client: Cliente): Promise<boolean> {
  const { data, error } = await client.rpc("tem_papel", { _papeis: ["administrador"] });
  return !error && data === true;
}

async function organizacao(client: Cliente): Promise<string | null> {
  const { data } = await client.auth.getUser();
  const uid = data.user?.id;
  if (!uid) return null;
  const perfil = await client.from("profiles").select("organization_id").eq("id", uid).maybeSingle();
  const org = perfil.data?.["organization_id"];
  return typeof org === "string" ? org : null;
}

export async function lerEstadoIntegracaoSite(client: Cliente): Promise<EstadoIntegracaoSite> {
  const admin = await ehAdministrador(client);
  const segredoPresente = segredoFalcao() !== null;

  const { data: integracao } = await client
    .from("site_integrations")
    .select("enabled,remote_write_state,welcome_channel_state,local_stage_key")
    .eq("slug", FALCAO_SLUG)
    .maybeSingle();

  const { data: submissoes } = await client
    .from("site_lead_submissions")
    .select("status")
    .limit(500);

  const lista = Array.isArray(submissoes) ? submissoes : [];
  const escrita = (integracao?.["remote_write_state"] ?? "pendente") as
    | "pendente"
    | "habilitado"
    | "bloqueado";

  const pendencias = [
    ...(segredoPresente ? [] : ["Falta o segredo FALCAO_SITE_SIGNING_SECRET nos Secrets do servidor."]),
    ...(integracao ? [] : ["Integração por configurar."]),
    ...(integracao?.["enabled"] ? [] : ["Recebimento desligado."]),
    "Escrita no GoHighLevel (contacto e oportunidade) por validar: mantém-se bloqueada.",
    "Canal e modelo aprovado do acolhimento por confirmar; nada é enviado.",
  ];

  return {
    admin,
    segredoPresente,
    site: FALCAO_SITE_URL,
    source: FALCAO_SOURCE,
    etapaLocal: (integracao?.["local_stage_key"] as string | undefined) ?? FALCAO_STAGE_LOCAL,
    destino: { location: FALCAO_LOCATION, pipeline: FALCAO_PIPELINE, stage: FALCAO_STAGE_GHL },
    configurada: Boolean(integracao),
    ativa: Boolean(integracao?.["enabled"]),
    escritaGhl: escrita,
    acolhimento: FALCAO_ACOLHIMENTO_RASCUNHO,
    pendencias,
    leads: {
      total: lista.length,
      emRevisao: lista.filter((l) => l["status"] === "em_revisao").length,
    },
  };
}

/** Só um administrador autenticado da organização pode configurar ou ligar. */
export async function configurarIntegracaoSite(
  client: Cliente,
  entrada: { confirm: boolean; enabled: boolean },
): Promise<{ ok: boolean; message: string }> {
  if (entrada.confirm !== true) return { ok: false, message: "Confirme a configuração." };
  try {
    if (!(await ehAdministrador(client)))
      return { ok: false, message: "Acesso restrito a administradores." };
    if (!segredoFalcao())
      return {
        ok: false,
        message:
          "Registe primeiro o segredo FALCAO_SITE_SIGNING_SECRET (64 hexadecimais) nos Secrets do projeto.",
      };
    const org = await organizacao(client);
    if (!org) return { ok: false, message: "Sessão expirada. Inicie sessão novamente." };

    const { data, error } = await client.rpc("configure_site_integration", {
      _organization_id: org,
      _slug: FALCAO_SLUG,
      _source: FALCAO_SOURCE,
      _stage_key: FALCAO_STAGE_LOCAL,
      _location_id: FALCAO_LOCATION,
      _pipeline_id: FALCAO_PIPELINE,
      _stage_id: FALCAO_STAGE_GHL,
      _enabled: entrada.enabled,
      _confirm: true,
    });
    if (error || (data as { configured?: boolean } | null)?.configured !== true)
      return {
        ok: false,
        message:
          "Configuração recusada. Confirme a ligação ao GoHighLevel desta conta e a etapa local Novo Lead.",
      };
    return {
      ok: true,
      message: entrada.enabled
        ? "Recebimento ligado. Nenhuma escrita no GoHighLevel e nenhuma mensagem foram ativadas."
        : "Recebimento desligado. A configuração ficou guardada.",
    };
  } catch {
    return { ok: false, message: "Não foi possível guardar a configuração. Tente novamente." };
  }
}
