import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolverAcesso, SEM_PERMISSAO } from "./ghl.functions";

/** Guard partilhado: sessão real + administrador + vínculo GHL server-side. */
async function autorizar(context: { supabase: never; userId: string }) {
  const acesso = await resolverAcesso(context as never, ["administrador"]);
  return acesso.ok ? acesso : null;
}

export const estadoAdNavigator = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const acesso = await autorizar(context as never);
    if (!acesso) return { autorizado: false as const, message: SEM_PERMISSAO };
    const { lerEstadoAdNavigator } = await import("./ad-navigator.server");
    const r = await lerEstadoAdNavigator(context.supabase);
    if (!r.ok) return { autorizado: true as const, leituraOk: false as const, message: r.message };
    return { autorizado: true as const, leituraOk: true as const, estado: r.estado };
  });

/**
 * Origens da própria aplicação: a sonda nunca fala com servidores externos.
 * Inclui a origem do pedido (produção), o loopback local (preview/dev) e a URL
 * canónica publicada, por esta ordem.
 */
export function origensProprias(origemPedido: string): string[] {
  const canonica = "https://jornada-ai-conecta.lovable.app";
  const lista = [origemPedido, "http://localhost:8080", canonica].filter(Boolean);
  return [...new Set(lista)];
}

function origens() {
  return origensProprias(new URL(getRequest().url).origin);
}


/** Verificação prévia (somente leitura): estado + caminho autenticado da ponte. */
export const prontidaoAdNavigator = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const acesso = await autorizar(context as never);
    if (!acesso) return { autorizado: false as const, message: SEM_PERMISSAO };
    const { lerEstadoAdNavigator, sondarPonte } = await import("./ad-navigator.server");
    const [estado, sonda] = await Promise.all([
      lerEstadoAdNavigator(context.supabase),
      sondarPonte(origemPropria()),
    ]);
    if (!estado.ok)
      return { autorizado: true as const, leituraOk: false as const, message: estado.message };
    const { avaliarProntidao } = await import("./ad-navigator-prontidao");
    const { verificacoes, podeGerar } = avaliarProntidao(estado.estado, sonda, Date.now());
    return { autorizado: true as const, leituraOk: true as const, verificacoes, podeGerar, sonda };
  });

export const gerarCodigoAdNavigator = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ confirm: z.literal(true) }).strict())
  .handler(async ({ context }) => {
    const acesso = await autorizar(context as never);
    if (!acesso) return { ok: false as const, message: SEM_PERMISSAO };
    const { criarPareamentoAdNavigator, lerEstadoAdNavigator, sondarPonte } =
      await import("./ad-navigator.server");
    // Falha fechada: sem estado legível e sem caminho autenticado de pé, não se emite código.
    const [estado, sonda] = await Promise.all([
      lerEstadoAdNavigator(context.supabase),
      sondarPonte(origemPropria()),
    ]);
    if (!estado.ok) return { ok: false as const, message: estado.message };
    const { avaliarProntidao } = await import("./ad-navigator-prontidao");
    const prontidao = avaliarProntidao(estado.estado, sonda, Date.now());
    if (!prontidao.podeGerar) {
      const falha = prontidao.verificacoes.find((v) => !v.ok);
      return { ok: false as const, message: falha?.detalhe ?? "Verificação prévia por concluir." };
    }
    const r = await criarPareamentoAdNavigator(context.supabase);
    if (!r.ok) return { ok: false as const, message: r.message };
    // O código só é devolvido aqui, uma única vez, para colar no Ad Navigator.
    return { ok: true as const, code: r.code, detalhe: r.detalhe };
  });

export const revogarAcessoAdNavigator = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ confirm: z.literal(true) }).strict())
  .handler(async ({ context }) => {
    const acesso = await autorizar(context as never);
    if (!acesso) return { ok: false as const, message: SEM_PERMISSAO };
    const { revogarAdNavigator } = await import("./ad-navigator.server");
    const r = await revogarAdNavigator(context.supabase);
    if (!r.ok) return { ok: false as const, message: r.message };
    return { ok: true as const, detalhe: r.detalhe };
  });
