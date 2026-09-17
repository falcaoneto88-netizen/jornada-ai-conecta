/**
 * Acolhimento do lead pelo canal de mensagens já existente da conta.
 *
 * O envio usa o tipo SMS da API oficial, sem conversationProviderId, porque o
 * provedor predefinido da location é o ZaptosWPP V2 ("WhatsApp like SMS"). Não
 * há credencial nova nem assinatura adicional.
 *
 * Limitação registada: essa rota só é comprovável pela seleção manual do
 * provedor na conta; a API não devolve prova de que a mensagem seguiu por
 * WhatsApp. "enviado" é apenas aceitação; "entregue" exige recibo do provedor.
 */

export const FALCAO_CANAL_ACOLHIMENTO = "sms_ghl_zaptoswpp" as const;

export const FALCAO_ACOLHIMENTO_TEXTO =
  "Olá, {{nome}}! Sou da equipa do Dr. João Falcão. Recebemos o seu pedido de contacto pela Experiência Falcão. Como podemos ajudar? Se preferir não receber mensagens, diga-nos por aqui.";

export function montarAcolhimento(primeiroNome: string | null): string {
  const nome = (primeiroNome ?? "").trim();
  return FALCAO_ACOLHIMENTO_TEXTO.replace("{{nome}}", nome.length >= 2 ? nome : "tudo bem");
}

export type PedidoAcolhimento = {
  submission_id: string;
  organization_id: string;
  ghl_contact_id: string;
  first_name: string | null;
  consent_version: string;
};

export type EstadoContactoRemoto = {
  id: string;
  dnd: boolean;
  /** Canais com bloqueio específico (ex.: SMS desativado nas definições). */
  canaisBloqueados: string[];
};

export type ResultadoApi<T> = { ok: true; data: T } | { ok: false; code: string; message: string };

export type DepsAcolhimento = {
  /** Estado do contacto lido imediatamente antes do envio. */
  estadoContacto: (ghlContactId: string) => Promise<ResultadoApi<EstadoContactoRemoto>>;
  enviar: (p: {
    ghlContactId: string;
    mensagem: string;
  }) => Promise<ResultadoApi<{ messageId: string | null; status: string | null }>>;
  concluir: (p: {
    submissionId: string;
    estado: "enviado" | "bloqueado";
    motivo: string;
    messageId: string | null;
  }) => Promise<void>;
};

export type DesfechoAcolhimento = {
  submissionId: string;
  estado: "enviado" | "bloqueado";
  motivo: string;
  messageId: string | null;
  /** Nunca verdadeiro aqui: a entrega só é registada com recibo do provedor. */
  entregue: false;
};

const INCERTO = new Set(["outcome_unknown", "timeout", "network_error"]);

async function concluir(
  deps: DepsAcolhimento,
  submissionId: string,
  estado: "enviado" | "bloqueado",
  motivo: string,
  messageId: string | null,
): Promise<DesfechoAcolhimento> {
  await deps.concluir({ submissionId, estado, motivo, messageId });
  return { submissionId, estado, motivo, messageId, entregue: false };
}

/** Uma única tentativa. Qualquer dúvida bloqueia o recibo para revisão humana. */
export async function processarAcolhimento(
  pedido: PedidoAcolhimento,
  deps: DepsAcolhimento,
): Promise<DesfechoAcolhimento> {
  const estado = await deps.estadoContacto(pedido.ghl_contact_id);
  if (!estado.ok) {
    return concluir(deps, pedido.submission_id, "bloqueado", `estado_falhou:${estado.code}`, null);
  }
  if (estado.data.id !== pedido.ghl_contact_id) {
    return concluir(deps, pedido.submission_id, "bloqueado", "contacto_nao_corresponde", null);
  }
  if (estado.data.dnd || estado.data.canaisBloqueados.length > 0) {
    return concluir(deps, pedido.submission_id, "bloqueado", "dnd_ou_opt_out", null);
  }

  const envio = await deps.enviar({
    ghlContactId: pedido.ghl_contact_id,
    mensagem: montarAcolhimento(pedido.first_name),
  });
  if (!envio.ok) {
    return concluir(
      deps,
      pedido.submission_id,
      "bloqueado",
      INCERTO.has(envio.code) ? "envio_incerto" : `envio_falhou:${envio.code}`,
      null,
    );
  }
  if (!envio.data.messageId) {
    // Sem identificador não há como reconciliar nem confirmar entrega depois.
    return concluir(deps, pedido.submission_id, "bloqueado", "envio_sem_identificador", null);
  }
  return concluir(
    deps,
    pedido.submission_id,
    "enviado",
    `aceite_pela_api:${envio.data.status ?? "sem_estado"}`,
    envio.data.messageId,
  );
}
