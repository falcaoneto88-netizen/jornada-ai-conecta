import type { SupabaseClient } from "@supabase/supabase-js";
import {
  contextoModeloSchema,
  contextoDaConsulta,
  lerBibliotecaSchema,
  salvarModeloSchema,
  type ModeloBiblioteca,
} from "./message-library.core";
import { validarFuso } from "./clinic-time";
type Ctx = { supabase: SupabaseClient; userId: string };
export async function acessoBiblioteca(ctx: Ctx, org: string, escrita = false) {
  const p = await ctx.supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", ctx.userId)
    .single();
  if (p.error || p.data?.organization_id !== org)
    throw new Error("Organização inválida para esta sessão.");
  if (escrita) {
    const r = await ctx.supabase
      .from("user_roles")
      .select("role")
      .eq("organization_id", org)
      .eq("user_id", ctx.userId);
    if (r.error || !r.data?.some((x) => ["administrador", "gestor"].includes(x.role)))
      throw new Error("Somente administrador ou gestor pode editar modelos.");
  }
}
export async function lerBiblioteca(ctx: Ctx, input: unknown) {
  const p = lerBibliotecaSchema.parse(input);
  await acessoBiblioteca(ctx, p.organizationId);
  const [m, s, a] = await Promise.all([
    ctx.supabase
      .from("message_templates")
      .select(
        "id,name,stage_key,channel,language,body,usage_note,lifecycle,revision,updated_at,starter_key",
      )
      .eq("organization_id", p.organizationId)
      .eq("is_demo", false)
      .order("created_at")
      .limit(501),
    ctx.supabase
      .from("journey_stages")
      .select("key,name")
      .eq("organization_id", p.organizationId)
      .order("position"),
    ctx.supabase
      .from("appointments")
      .select("id,title,start_at")
      .eq("organization_id", p.organizationId)
      .eq("is_demo", false)
      .order("start_at", { ascending: false })
      .limit(201),
  ]);
  if (m.error || s.error || a.error)
    throw new Error("Não foi possível carregar a biblioteca e os dados de prévia.");
  if ((m.data?.length ?? 0) > 500)
    throw new Error(
      "A biblioteca excedeu 500 modelos. É necessário ampliar a paginação antes de consultá-la.",
    );
  return {
    modelos: (m.data ?? []) as ModeloBiblioteca[],
    etapas: s.data ?? [],
    consultas: a.data?.slice(0, 200) ?? [],
    consultasLimitadas: (a.data?.length ?? 0) > 200,
  };
}
export async function lerContextoModelo(ctx: Ctx, input: unknown) {
  const p = contextoModeloSchema.parse(input);
  await acessoBiblioteca(ctx, p.organizationId);
  const [a, o] = await Promise.all([
    ctx.supabase
      .from("appointments")
      .select("contact_id,title,start_at,assigned_user_name,status,updated_at")
      .eq("id", p.appointmentId)
      .eq("organization_id", p.organizationId)
      .eq("is_demo", false)
      .single(),
    ctx.supabase.from("organizations").select("name,timezone").eq("id", p.organizationId).single(),
  ]);
  if (a.error || o.error || !a.data || !o.data)
    throw new Error("Consulta indisponível nesta organização.");
  const c = a.data.contact_id
    ? await ctx.supabase
        .from("contacts")
        .select("full_name")
        .eq("id", a.data.contact_id)
        .eq("organization_id", p.organizationId)
        .eq("is_demo", false)
        .maybeSingle()
    : { data: null, error: null };
  if (c.error) throw new Error("Não foi possível verificar o contato da consulta.");
  const timezone = validarFuso(o.data.timezone);
  return {
    values: contextoDaConsulta(a.data, c.data?.full_name ?? null, o.data.name, timezone),
    appointmentId: p.appointmentId,
    status: a.data.status,
    updatedAt: a.data.updated_at,
    consultadoEm: new Date().toISOString(),
    timezone,
    passada: Date.parse(a.data.start_at) < Date.now(),
  };
}
export async function salvarBiblioteca(ctx: Ctx, input: unknown) {
  const p = salvarModeloSchema.parse(input);
  await acessoBiblioteca(ctx, p.organizationId, true);
  const r = await ctx.supabase.rpc("save_message_template_draft", {
    _org: p.organizationId,
    _id: p.id,
    _expected_revision: p.expectedRevision,
    _draft: p.draft,
  });
  if (r.error) {
    if (r.error.code === "40001")
      throw new Error(
        "Este modelo mudou em outra sessão. Recarregue a biblioteca antes de salvar.",
      );
    throw new Error(
      "Não foi possível salvar o rascunho. Confira a etapa e atualize a biblioteca antes de repetir.",
    );
  }
  return r.data as ModeloBiblioteca;
}
