/** Textos PT-PT fixos no servidor. Quem chama nunca envia texto livre. */
export const N8N_KINDS = ["booking", "req24", "req12", "confirm", "escalation", "handoff"] as const;
export type KindN8n = (typeof N8N_KINDS)[number];
export const KINDS_INTERNOS: readonly KindN8n[] = ["escalation", "handoff"];
export const FUSO_CLINICA = "Europe/Lisbon";

export function dataHoraLisboa(iso: string): { data: string; hora: string } {
  const d = new Date(iso);
  const partes = new Intl.DateTimeFormat("pt-PT", {
    timeZone: FUSO_CLINICA,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const v = (t: string) => partes.find((p) => p.type === t)?.value ?? "";
  return { data: `${v("day")}/${v("month")}/${v("year")}`, hora: `${v("hour")}:${v("minute")}` };
}

/** Só letras, espaço, hífen e apóstrofo; máximo 40 caracteres. */
export function nomeSeguro(nome: string | null | undefined): string | null {
  if (typeof nome !== "string") return null;
  const limpo = nome
    .normalize("NFC")
    .replace(/[^\p{L}\s'-]/gu, "")
    .trim()
    .slice(0, 40);
  return limpo || null;
}

export function montarMensagem(
  kind: KindN8n,
  p: { firstName: string | null; startTime: string; morada: string },
): string {
  const { data, hora } = dataHoraLisboa(p.startTime);
  const nome = nomeSeguro(p.firstName);
  const ola = nome ? `Olá ${nome},` : "Olá,";
  switch (kind) {
    case "booking":
      return `${ola} a sua consulta com o Dr. João Falcão está agendada para ${data} às ${hora}. Até breve.`;
    case "req24":
      return `${ola} relembramos a sua consulta de ${data} às ${hora}. Responda CONFIRMO para confirmar ou REMARCAR para escolher outro horário.`;
    case "req12":
      return `${ola} ainda não recebemos a confirmação da sua consulta de ${data} às ${hora}. Responda CONFIRMO ou REMARCAR, por favor.`;
    case "confirm":
      return `Obrigado${nome ? `, ${nome}` : ""}. A sua consulta de ${data} às ${hora} está confirmada. Morada: ${p.morada}.`;
    case "escalation":
      return `Atenção comercial: este contacto precisa de acompanhamento humano sobre a consulta de ${data} às ${hora}.`;
    case "handoff":
      return `Passagem para atendimento humano: por favor assuma a conversa sobre a consulta de ${data} às ${hora}.`;
  }
}
