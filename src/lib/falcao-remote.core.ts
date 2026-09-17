/**
 * Processamento remoto (GoHighLevel) dos leads já recebidos pelo site.
 *
 * Regras invioláveis:
 *  - identidade só por procura exata documentada (duplicate check por telefone e
 *    por e-mail, em separado). Resposta vazia, malformada ou truncada nunca
 *    conclui "não existe" nem "existe": bloqueia;
 *  - o identificador remoto já guardado é sempre relido e revalidado (location,
 *    telefone/e-mail exatos, DND e bloqueios de canal) antes de qualquer escrita;
 *  - nunca move nem reabre oportunidades existentes;
 *  - só há sucesso quando a persistência do desfecho é confirmada.
 */

export type ResultadoRemotoApi<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string };

export type ContactoRemoto = {
  id: string;
  locationId: string;
  phone: string | null;
  email: string | null;
  dnd: boolean;
  /** Canais com bloqueio explícito (SMS/WhatsApp/Call/e-mail). */
  canaisBloqueados: string[];
};

export type OportunidadeRemota = {
  id: string;
  name: string | null;
  pipelineId: string | null;
  stageId: string | null;
  status: string | null;
  contactId: string | null;
};

export type PedidoRemoto = {
  submission_id: string;
  organization_id: string;
  location_id: string;
  pipeline_id: string;
  stage_id: string;
  contact_id: string;
  /** Identidade consentida no formulário — imutável, não é o cadastro atual. */
  full_name: string;
  phone: string | null;
  phone_normalized: string | null;
  email: string | null;
  ghl_contact_id: string | null;
};

export type EstadoDesfecho = "confirmado" | "bloqueado" | "pendente_reconciliacao";

export type DesfechoRemoto = {
  submissionId: string;
  estado: EstadoDesfecho;
  motivo: string;
  ghlContactId: string | null;
  ghlOpportunityId: string | null;
};

export type DepsRemoto = {
  /**
   * Procura exata documentada (duplicate check). `null` só quando a API
   * respondeu de forma completa e explícita que não há correspondência.
   */
  procurarExato: (p: {
    locationId: string;
    campo: "telefone" | "email";
    valor: string;
  }) => Promise<ResultadoRemotoApi<ContactoRemoto | null>>;
  lerContacto: (p: {
    locationId: string;
    ghlContactId: string;
  }) => Promise<ResultadoRemotoApi<ContactoRemoto>>;
  criarContacto: (p: PedidoRemoto) => Promise<ResultadoRemotoApi<{ id: string }>>;
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
  }) => Promise<ResultadoRemotoApi<OportunidadeRemota>>;
  /** Persistência do desfecho; `ok:false` significa que nada foi confirmado. */
  concluir: (p: {
    submissionId: string;
    estado: "confirmado" | "bloqueado";
    motivo: string;
    ghlContactId: string | null;
    oportunidade: OportunidadeRemota | null;
  }) => Promise<{ ok: boolean }>;
};

/** Códigos que significam "não sabemos se a operação foi aplicada". */
const INCERTO = new Set(["outcome_unknown", "timeout", "network_error", "malformed_response"]);

export function digitos(valor: string | null | undefined): string | null {
  const so = (valor ?? "").replace(/\D/g, "");
  return so.length >= 8 ? so : null;
}

function mesmoEmail(a: string | null, b: string | null): boolean {
  return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
}

/** O contacto remoto tem de pertencer à location e bater exatamente com o consentido. */
export function validarContacto(
  contacto: ContactoRemoto,
  pedido: PedidoRemoto,
): { ok: true } | { ok: false; motivo: string } {
  if (contacto.locationId !== pedido.location_id) {
    return { ok: false, motivo: "contacto_de_outra_location" };
  }
  const telefoneAlvo = digitos(pedido.phone_normalized ?? pedido.phone);
  const emailAlvo = pedido.email?.trim().toLowerCase() ?? null;
  const telefoneBate = telefoneAlvo !== null && digitos(contacto.phone) === telefoneAlvo;
  const emailBate = emailAlvo !== null && mesmoEmail(contacto.email, emailAlvo);
  if (!telefoneBate && !emailBate) return { ok: false, motivo: "identidade_nao_exata" };
  // Um campo presente e diferente é divergência, não "permitido".
  if (telefoneAlvo !== null && contacto.phone !== null && !telefoneBate) {
    return { ok: false, motivo: "telefone_divergente" };
  }
  if (emailAlvo !== null && contacto.email !== null && !emailBate) {
    return { ok: false, motivo: "email_divergente" };
  }
  if (contacto.dnd) return { ok: false, motivo: "contacto_com_dnd" };
  if (contacto.canaisBloqueados.length > 0) return { ok: false, motivo: "canal_bloqueado" };
  return { ok: true };
}

async function fechar(
  deps: DepsRemoto,
  pedido: PedidoRemoto,
  estado: "confirmado" | "bloqueado",
  motivo: string,
  ghlContactId: string | null,
  oportunidade: OportunidadeRemota | null,
): Promise<DesfechoRemoto> {
  let persistido = false;
  try {
    persistido = (
      await deps.concluir({
        submissionId: pedido.submission_id,
        estado,
        motivo,
        ghlContactId,
        oportunidade,
      })
    ).ok;
  } catch {
    persistido = false;
  }
  return {
    submissionId: pedido.submission_id,
    estado: persistido ? estado : "pendente_reconciliacao",
    motivo: persistido ? motivo : `persistencia_falhou:${motivo}`,
    ghlContactId,
    ghlOpportunityId: oportunidade?.id ?? null,
  };
}

const bloquear = (
  deps: DepsRemoto,
  pedido: PedidoRemoto,
  motivo: string,
  ghlContactId: string | null = null,
): Promise<DesfechoRemoto> => fechar(deps, pedido, "bloqueado", motivo, ghlContactId, null);

async function resolverContacto(
  pedido: PedidoRemoto,
  deps: DepsRemoto,
): Promise<{ ok: true; id: string } | { ok: false; motivo: string; id: string | null }> {
  if (pedido.ghl_contact_id) {
    const lido = await deps.lerContacto({
      locationId: pedido.location_id,
      ghlContactId: pedido.ghl_contact_id,
    });
    if (!lido.ok) return { ok: false, motivo: `leitura_falhou:${lido.code}`, id: null };
    const v = validarContacto(lido.data, pedido);
    return v.ok
      ? { ok: true, id: lido.data.id }
      : { ok: false, motivo: v.motivo, id: lido.data.id };
  }

  const alvos: { campo: "telefone" | "email"; valor: string }[] = [];
  if (pedido.phone) alvos.push({ campo: "telefone", valor: pedido.phone });
  if (pedido.email) alvos.push({ campo: "email", valor: pedido.email });
  if (alvos.length === 0) return { ok: false, motivo: "sem_identidade_para_procura", id: null };

  const achados = new Set<string>();
  for (const alvo of alvos) {
    const res = await deps.procurarExato({
      locationId: pedido.location_id,
      campo: alvo.campo,
      valor: alvo.valor,
    });
    if (!res.ok) return { ok: false, motivo: `procura_falhou:${res.code}`, id: null };
    if (res.data) achados.add(res.data.id);
  }
  if (achados.size > 1) return { ok: false, motivo: "identidade_ambigua", id: null };

  let id = [...achados][0] ?? null;
  if (!id) {
    const criado = await deps.criarContacto(pedido);
    if (!criado.ok) {
      return {
        ok: false,
        motivo: INCERTO.has(criado.code) ? "criacao_incerta" : `criacao_falhou:${criado.code}`,
        id: null,
      };
    }
    id = criado.data.id;
  }

  // Releitura obrigatória: o criado/encontrado tem de pertencer à location e ser exato.
  const lido = await deps.lerContacto({ locationId: pedido.location_id, ghlContactId: id });
  if (!lido.ok) return { ok: false, motivo: `releitura_falhou:${lido.code}`, id };
  if (lido.data.id !== id) return { ok: false, motivo: "contacto_nao_corresponde", id };
  const v = validarContacto(lido.data, pedido);
  return v.ok ? { ok: true, id } : { ok: false, motivo: v.motivo, id };
}

export async function processarSubmissaoRemota(
  pedido: PedidoRemoto,
  deps: DepsRemoto,
): Promise<DesfechoRemoto> {
  const contacto = await resolverContacto(pedido, deps);
  if (!contacto.ok) return bloquear(deps, pedido, contacto.motivo, contacto.id);
  const ghlContactId = contacto.id;

  const existentes = await deps.oportunidades({
    locationId: pedido.location_id,
    ghlContactId,
  });
  if (!existentes.ok) {
    return bloquear(deps, pedido, `consulta_oportunidades_falhou:${existentes.code}`, ghlContactId);
  }
  const jaNoFunil = existentes.data.find((o) => o.pipelineId === pedido.pipeline_id);
  if (jaNoFunil) {
    // Nunca mover nem reabrir: espelha-se exatamente o que o remoto devolveu.
    if (!jaNoFunil.stageId || !jaNoFunil.status) {
      return bloquear(deps, pedido, "oportunidade_existente_sem_dados_reais", ghlContactId);
    }
    return fechar(
      deps,
      pedido,
      "confirmado",
      "oportunidade_existente_preservada",
      ghlContactId,
      jaNoFunil,
    );
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
  const criada = nova.data;
  const coerente =
    criada.id.length > 0 &&
    criada.contactId === ghlContactId &&
    criada.pipelineId === pedido.pipeline_id &&
    criada.stageId === pedido.stage_id &&
    typeof criada.status === "string" &&
    criada.status.length > 0;
  if (!coerente) return bloquear(deps, pedido, "oportunidade_criada_incoerente", ghlContactId);

  return fechar(
    deps,
    pedido,
    "confirmado",
    "contacto_e_oportunidade_confirmados",
    ghlContactId,
    criada,
  );
}
