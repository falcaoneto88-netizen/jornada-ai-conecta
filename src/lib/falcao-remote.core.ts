/**
 * Processamento remoto (GoHighLevel) dos leads já recebidos pelo site.
 *
 * Regras invioláveis:
 *  - nunca move nem reabre oportunidades existentes;
 *  - identidade ambígua, DND/opt-out, permissão em falta ou resultado incerto
 *    bloqueiam o recibo para revisão humana — nunca há repetição automática;
 *  - só o funil e a etapa fixos da integração são usados.
 */

export type ResultadoRemotoApi<T> =
  { ok: true; data: T } | { ok: false; code: string; message: string };

export type ContactoRemoto = {
  id: string;
  phoneNormalized: string | null;
  email: string | null;
  dnd: boolean;
};

export type OportunidadeRemota = { id: string; pipelineId: string | null; status: string | null };

export type PedidoRemoto = {
  submission_id: string;
  organization_id: string;
  location_id: string;
  pipeline_id: string;
  stage_id: string;
  contact_id: string;
  full_name: string;
  phone: string | null;
  phone_normalized: string | null;
  email: string | null;
  ghl_contact_id: string | null;
};

export type DepsRemoto = {
  procurar: (p: {
    locationId: string;
    termo: string;
  }) => Promise<ResultadoRemotoApi<ContactoRemoto[]>>;
  criarContacto: (p: PedidoRemoto) => Promise<ResultadoRemotoApi<ContactoRemoto>>;
  oportunidades: (p: {
    locationId: string;
    ghlContactId: string;
  }) => Promise<ResultadoRemotoApi<OportunidadeRemota[]>>;
  criarOportunidade: (p: {
    locationId: string;
    pipelineId: string;
    stageId: string;
    ghlContactId: string;
    nome: string;
  }) => Promise<ResultadoRemotoApi<{ id: string }>>;
  concluir: (p: {
    submissionId: string;
    estado: "confirmado" | "bloqueado";
    motivo: string;
    ghlContactId: string | null;
    ghlOpportunityId: string | null;
  }) => Promise<void>;
};

export type DesfechoRemoto = {
  submissionId: string;
  estado: "confirmado" | "bloqueado";
  motivo: string;
  ghlContactId: string | null;
  ghlOpportunityId: string | null;
};

/** Códigos que significam "não sabemos se a operação foi aplicada". */
const INCERTO = new Set(["outcome_unknown", "timeout", "network_error"]);

function digitos(valor: string | null | undefined): string | null {
  const so = (valor ?? "").replace(/\D/g, "");
  return so.length >= 8 ? so : null;
}

/** Correspondência exata: telefone só por dígitos, e-mail só em minúsculas. */
export function corresponderExato(
  candidatos: readonly ContactoRemoto[],
  alvo: { telefone: string | null; email: string | null },
): { tipo: "nenhum" } | { tipo: "unico"; contacto: ContactoRemoto } | { tipo: "ambiguo" } {
  const telefone = digitos(alvo.telefone);
  const email = alvo.email?.trim().toLowerCase() ?? null;
  const exatos = candidatos.filter(
    (c) =>
      (telefone !== null && digitos(c.phoneNormalized) === telefone) ||
      (email !== null && (c.email ?? "").trim().toLowerCase() === email),
  );
  const unicos = new Map(exatos.map((c) => [c.id, c]));
  if (unicos.size === 0) return { tipo: "nenhum" };
  if (unicos.size > 1) return { tipo: "ambiguo" };
  return { tipo: "unico", contacto: [...unicos.values()][0]! };
}

async function bloquear(
  deps: DepsRemoto,
  pedido: PedidoRemoto,
  motivo: string,
  ghlContactId: string | null = null,
): Promise<DesfechoRemoto> {
  const desfecho: DesfechoRemoto = {
    submissionId: pedido.submission_id,
    estado: "bloqueado",
    motivo,
    ghlContactId,
    ghlOpportunityId: null,
  };
  await deps.concluir({
    submissionId: pedido.submission_id,
    estado: "bloqueado",
    motivo,
    ghlContactId,
    ghlOpportunityId: null,
  });
  return desfecho;
}

export async function processarSubmissaoRemota(
  pedido: PedidoRemoto,
  deps: DepsRemoto,
): Promise<DesfechoRemoto> {
  let ghlContactId = pedido.ghl_contact_id;

  if (!ghlContactId) {
    const termos = [pedido.phone_normalized ?? pedido.phone, pedido.email].filter(
      (t): t is string => typeof t === "string" && t.length > 0,
    );
    if (termos.length === 0) return bloquear(deps, pedido, "sem_identidade_para_procura");

    const encontrados: ContactoRemoto[] = [];
    for (const termo of termos) {
      const res = await deps.procurar({ locationId: pedido.location_id, termo });
      if (!res.ok) return bloquear(deps, pedido, `procura_falhou:${res.code}`);
      encontrados.push(...res.data);
    }
    const correspondencia = corresponderExato(encontrados, {
      telefone: pedido.phone_normalized ?? pedido.phone,
      email: pedido.email,
    });
    if (correspondencia.tipo === "ambiguo") return bloquear(deps, pedido, "identidade_ambigua");
    if (correspondencia.tipo === "unico") {
      if (correspondencia.contacto.dnd) {
        return bloquear(deps, pedido, "contacto_com_dnd", correspondencia.contacto.id);
      }
      ghlContactId = correspondencia.contacto.id;
    } else {
      const criado = await deps.criarContacto(pedido);
      if (!criado.ok) {
        return bloquear(
          deps,
          pedido,
          INCERTO.has(criado.code) ? "criacao_incerta" : `criacao_falhou:${criado.code}`,
        );
      }
      if (criado.data.dnd) return bloquear(deps, pedido, "contacto_com_dnd", criado.data.id);
      ghlContactId = criado.data.id;
    }
  }

  const existentes = await deps.oportunidades({
    locationId: pedido.location_id,
    ghlContactId,
  });
  if (!existentes.ok) {
    return bloquear(deps, pedido, `consulta_oportunidades_falhou:${existentes.code}`, ghlContactId);
  }
  const jaNoFunil = existentes.data.find((o) => o.pipelineId === pedido.pipeline_id);
  if (jaNoFunil) {
    // Nunca mover nem reabrir: o registo aponta para a oportunidade que já existe.
    await deps.concluir({
      submissionId: pedido.submission_id,
      estado: "confirmado",
      motivo: "oportunidade_existente_preservada",
      ghlContactId,
      ghlOpportunityId: jaNoFunil.id,
    });
    return {
      submissionId: pedido.submission_id,
      estado: "confirmado",
      motivo: "oportunidade_existente_preservada",
      ghlContactId,
      ghlOpportunityId: jaNoFunil.id,
    };
  }

  const nova = await deps.criarOportunidade({
    locationId: pedido.location_id,
    pipelineId: pedido.pipeline_id,
    stageId: pedido.stage_id,
    ghlContactId,
    nome: pedido.full_name,
  });
  if (!nova.ok) {
    return bloquear(
      deps,
      pedido,
      INCERTO.has(nova.code) ? "oportunidade_incerta" : `oportunidade_falhou:${nova.code}`,
      ghlContactId,
    );
  }

  await deps.concluir({
    submissionId: pedido.submission_id,
    estado: "confirmado",
    motivo: "contacto_e_oportunidade_confirmados",
    ghlContactId,
    ghlOpportunityId: nova.data.id,
  });
  return {
    submissionId: pedido.submission_id,
    estado: "confirmado",
    motivo: "contacto_e_oportunidade_confirmados",
    ghlContactId,
    ghlOpportunityId: nova.data.id,
  };
}
