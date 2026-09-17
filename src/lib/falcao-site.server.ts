import type { SupabaseClient } from "@supabase/supabase-js";

import {
  FALCAO_LOCATION,
  FALCAO_PIPELINE,
  FALCAO_SITE_URL,
  FALCAO_SLUG,
  FALCAO_STAGE_GHL,
  FALCAO_STAGE_LOCAL,
  segredoFalcao,
} from "./falcao-lead.server";
import { FALCAO_ACOLHIMENTO_TEXTO } from "./falcao-welcome.core";
import { FALCAO_SOURCE } from "./falcao-lead.core";
import { GHL_ORIGIN, GHL_VERSION, ghlFetch, readGhlSecrets } from "./ghl.server";

/**
 * Canal do acolhimento: usa a ligação de mensagens já existente do GoHighLevel
 * (tipo SMS), cuja rota na location autorizada é o provedor predefinido
 * ZaptosWPP V2. Não há credencial nova nem assinatura adicional.
 */
export const CANAL_ACOLHIMENTO_NOTA =
  "Acolhimento pelo canal de mensagens já existente da conta: a mensagem segue como SMS na API oficial e é encaminhada pelo provedor predefinido da location (ZaptosWPP V2 — WhatsApp like SMS). Sem credencial nova.";

export const LIMITACAO_ACOLHIMENTO =
  "Limitação: o encaminhamento por esse provedor só está comprovado pela seleção manual na conta; a API não devolve prova do canal. Faça um teste controlado antes de usar com pessoas reais.";

export const BLOQUEIO_ACOLHIMENTO =
  "Acolhimento desligado: o canal só envia depois de o administrador o ativar, com escrita no GoHighLevel ativa. Aceitação da API não é entrega — só há entrega com recibo do provedor.";

export type ContagemLeads = { total: number | null; emRevisao: number | null; erro: boolean };

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
  canalAcolhimento: "pendente" | "configurado" | "bloqueado";
  acolhimento: string;
  pendencias: string[];
  leads: ContagemLeads;
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
  const perfil = await client
    .from("profiles")
    .select("organization_id")
    .eq("id", uid)
    .maybeSingle();
  const org = perfil.data?.["organization_id"];
  return typeof org === "string" ? org : null;
}

/** Contagens exatas; um erro de leitura nunca é apresentado como zero. */
async function contarLeads(client: Cliente): Promise<ContagemLeads> {
  const total = await client
    .from("site_lead_submissions")
    .select("id", { count: "exact", head: true });
  const revisao = await client
    .from("site_lead_submissions")
    .select("id", { count: "exact", head: true })
    .eq("status", "em_revisao");
  if (total.error || revisao.error || total.count == null || revisao.count == null) {
    return { total: null, emRevisao: null, erro: true };
  }
  return { total: total.count, emRevisao: revisao.count, erro: false };
}

export async function lerEstadoIntegracaoSite(client: Cliente): Promise<EstadoIntegracaoSite> {
  const admin = await ehAdministrador(client);
  const segredoPresente = segredoFalcao() !== null;

  const { data: integracao } = await client
    .from("site_integrations")
    .select("enabled,remote_write_state,welcome_channel_state,local_stage_key")
    .eq("slug", FALCAO_SLUG)
    .maybeSingle();

  const leads = await contarLeads(client);
  const escrita = (integracao?.["remote_write_state"] ?? "pendente") as
    "pendente" | "habilitado" | "bloqueado";

  const pendencias = [
    ...(segredoPresente
      ? []
      : ["Falta o segredo FALCAO_SITE_SIGNING_SECRET nos Secrets do servidor."]),
    ...(integracao ? [] : ["Integração por configurar."]),
    ...(integracao?.["enabled"] ? [] : ["Recebimento desligado."]),
    ...(escrita === "habilitado"
      ? []
      : ["Escrita no GoHighLevel (contacto e oportunidade) ainda não habilitada."]),
    CANAL_ACOLHIMENTO_NOTA,
    LIMITACAO_ACOLHIMENTO,
    ...(canal === "configurado" ? [] : [BLOQUEIO_ACOLHIMENTO]),
    ...(leads.erro ? ["Não foi possível ler as contagens dos pedidos recebidos."] : []),
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
    canalAcolhimento: canal,
    acolhimento: FALCAO_ACOLHIMENTO_TEXTO,
    pendencias,
    leads,
  };
}

type Pipelines = { pipelines?: { id?: string; stages?: { id?: string }[] }[] };

/**
 * Confirma na API oficial (versão 2021-07-28) que o funil e a etapa fixos
 * existem na location autorizada. Não lê contactos nem conversas.
 */
export async function validarDestinoGhl(
  buscar: typeof ghlFetch = ghlFetch,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { token, locationId } = readGhlSecrets();
  if (!token || locationId !== FALCAO_LOCATION) {
    return { ok: false, message: "Credenciais do GoHighLevel indisponíveis para esta conta." };
  }
  const res = await buscar<Pipelines>(
    { baseUrl: GHL_ORIGIN, version: GHL_VERSION, token, locationId },
    "opportunities/pipelines",
    { query: { locationId } },
  );
  if (!res.ok) {
    return { ok: false, message: "Não foi possível confirmar o funil no GoHighLevel." };
  }
  const funil = (res.data.pipelines ?? []).find((p) => p.id === FALCAO_PIPELINE);
  if (!funil) return { ok: false, message: "O funil fixo não existe nesta conta do GoHighLevel." };
  if (!(funil.stages ?? []).some((s) => s.id === FALCAO_STAGE_GHL)) {
    return { ok: false, message: "A etapa fixa não existe no funil desta conta." };
  }
  return { ok: true };
}

/** Só um administrador autenticado da organização pode configurar ou ligar. */
export async function configurarIntegracaoSite(
  client: Cliente,
  entrada: { confirm: boolean; enabled: boolean },
  deps: { validarDestino?: typeof validarDestinoGhl } = {},
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

    const destino = await (deps.validarDestino ?? validarDestinoGhl)();
    if (!destino.ok) return { ok: false, message: destino.message };

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
