import { z } from "zod";
import { formatarData, formatarDataHora, formatarHora } from "./clinic-time";
export const canaisModelo = {
  whatsapp: "WhatsApp",
  sms: "SMS",
  instagram: "Instagram",
  facebook: "Facebook",
  email: "E-mail",
} as const;
export const idiomasModelo = ["PT-PT", "PT-BR", "FR", "ES", "EN"] as const;
export const variaveisModelo = {
  "contact.first_name": "Primeiro nome",
  "contact.name": "Nome completo",
  "appointment.start_time": "Data e hora da consulta",
  "appointment.only_start_date": "Data da consulta",
  "appointment.only_start_time": "Hora da consulta",
  "appointment.timezone": "Fuso da clínica",
  "appointment.title": "Título da consulta",
  "appointment.user.name": "Responsável pela consulta",
  "location.name": "Nome da clínica",
} as const;
export const aliasesAntigos: Record<string, string> = {
  "appointment.date": "appointment.only_start_date",
  "appointment.time": "appointment.only_start_time",
  "clinic.name": "location.name",
};
export function analisarVariaveis(body: string) {
  const encontradas = Array.from(body.matchAll(/{{\s*([^{}]*?)\s*}}/g), (m) => m[1]!.trim());
  const invalidas = [...new Set(encontradas.filter((v) => !Object.hasOwn(variaveisModelo, v)))];
  const malformadas = /[{}]/.test(body.replace(/{{\s*[a-z_][a-z0-9_.]*\s*}}/g, ""));
  return { usadas: [...new Set(encontradas)], invalidas, malformadas };
}
export const draftModeloSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    body: z.string().trim().min(1).max(6000),
    channel: z.enum(["whatsapp", "sms", "instagram", "facebook", "email"]),
    language: z.enum(idiomasModelo),
    stage_key: z.string().min(1).max(100).nullable(),
    usage_note: z.string().trim().max(1000),
    lifecycle: z.enum(["draft", "archived"]),
  })
  .strict();
export type DraftModelo = z.infer<typeof draftModeloSchema>;
export type ModeloBiblioteca = DraftModelo & {
  id: string;
  revision: number;
  updated_at: string;
  starter_key: string | null;
};
export const salvarModeloSchema = z
  .object({
    organizationId: z.string().uuid(),
    id: z.string().uuid(),
    expectedRevision: z.number().int().positive().nullable(),
    draft: draftModeloSchema,
  })
  .strict()
  .superRefine((p, ctx) => {
    const v = analisarVariaveis(p.draft.body);
    if (v.invalidas.length || v.malformadas)
      ctx.addIssue({
        code: "custom",
        message: "Corrija as variáveis desconhecidas ou incompletas.",
        path: ["draft", "body"],
      });
  });
export const lerBibliotecaSchema = z.object({ organizationId: z.string().uuid() }).strict();
export const contextoModeloSchema = lerBibliotecaSchema
  .extend({ appointmentId: z.string().uuid() })
  .strict();
export function migrarVariaveisAntigas(body: string) {
  return body.replace(/{{\s*([^{}]+?)\s*}}/g, (full, v: string) =>
    aliasesAntigos[v.trim()] ? `{{${aliasesAntigos[v.trim()]}}}` : full,
  );
}
export function previsualizarModelo(
  body: string,
  values: Record<string, string | null | undefined>,
) {
  const analise = analisarVariaveis(body);
  const ausentes = analise.usadas.filter(
    (v) => Object.hasOwn(variaveisModelo, v) && !values[v]?.trim(),
  );
  const texto = body.replace(
    /{{\s*([^{}]*?)\s*}}/g,
    (_, v: string) => values[v.trim()]?.trim() || `[PENDENTE: ${v.trim()}]`,
  );
  return {
    texto,
    ...analise,
    ausentes,
    completo:
      !!body.trim() && !analise.invalidas.length && !analise.malformadas && !ausentes.length,
  };
}
export function contextoDaConsulta(
  a: { start_at: string; title: string | null; assigned_user_name: string | null },
  nome: string | null,
  clinica: string,
  fuso: string,
) {
  const partes = nome?.trim().split(/\s+/);
  const valida = Number.isFinite(Date.parse(a.start_at));
  return {
    "contact.first_name": partes?.[0] ?? null,
    "contact.name": nome?.trim() || null,
    "appointment.start_time": valida ? formatarDataHora(a.start_at, fuso) : null,
    "appointment.only_start_date": valida ? formatarData(a.start_at, fuso) : null,
    "appointment.only_start_time": valida ? formatarHora(a.start_at, fuso) : null,
    "appointment.timezone": fuso,
    "appointment.title": a.title,
    "appointment.user.name": a.assigned_user_name,
    "location.name": clinica,
  };
}
export const exemploModelo = {
  "contact.first_name": "Ana",
  "contact.name": "Ana Exemplo",
  "appointment.start_time": "15/10/2026, 14:00",
  "appointment.only_start_date": "15/10/2026",
  "appointment.only_start_time": "14:00",
  "appointment.timezone": "Europe/Lisbon",
  "appointment.title": "Consulta de avaliação",
  "appointment.user.name": "Profissional de exemplo",
  "location.name": "Clínica de exemplo",
};
export function preservarVariaveis(original: string, sugestao: string) {
  const tokens = (s: string) => Array.from(s.matchAll(/{{[^{}]*}}/g), (m) => m[0]).sort();
  return (
    JSON.stringify(tokens(original)) === JSON.stringify(tokens(sugestao)) &&
    !analisarVariaveis(sugestao).malformadas
  );
}
