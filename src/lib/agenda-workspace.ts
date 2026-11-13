import type { Marcacao } from "./repo";
import { formatarDataHora } from "./clinic-time";

export type AgendaValues = {
  appointmentId: string;
  totalCents: number;
  depositCents: number;
};

export function euros(cents: number) {
  return new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(cents / 100);
}

/** Local 'confirmada' also includes booked/new upstream; never a patient's SIM. */
export function estadoAdministrativo(estado: string) {
  const labels: Record<string, string> = {
    confirmada: "Agendada",
    realizada: "Realizada",
    cancelada: "Cancelada",
    faltou: "Não compareceu",
  };
  return labels[estado] ?? estado;
}

export function filtrarAgenda(
  marcacoes: Marcacao[],
  busca: string,
  estado: string,
  responsavel: string,
) {
  const normalizar = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  const termo = normalizar(busca.trim());
  return marcacoes.filter(
    (m) =>
      (responsavel === "todos" ||
        (responsavel === "sem-responsavel" ? !m.responsavel : m.responsavel === responsavel)) &&
      (estado === "todos" || m.estado === estado) &&
      (!termo || normalizar(`${m.cliente} ${m.titulo} ${m.responsavel ?? ""}`).includes(termo)),
  );
}

export function resumoValores(marcacoes: Marcacao[], entries: AgendaValues[]) {
  const elegiveis = marcacoes.filter((m) => m.estado !== "cancelada");
  const ids = new Set(elegiveis.map((m) => m.id));
  const conhecidos = new Map(
    entries.filter((e) => ids.has(e.appointmentId)).map((e) => [e.appointmentId, e]),
  );
  let totalCents = 0;
  let depositCents = 0;
  for (const entry of conhecidos.values()) {
    totalCents += entry.totalCents;
    depositCents += entry.depositCents;
  }
  return {
    totalCents,
    depositCents,
    remainingCents: totalCents - depositCents,
    known: conhecidos.size,
    eligible: elegiveis.length,
  };
}

/** Pure preview: never writes a sent flag, appointment state or message. */
export function previaConfirmacao(m: Marcacao, fuso: string, values?: AgendaValues | null) {
  const financeiro = values
    ? `\nValores registados pela equipa: total ${euros(values.totalCents)}, sinal informado ${euros(values.depositCents)} e saldo ${euros(values.totalCents - values.depositCents)}. Se houver alguma diferença, fale connosco.`
    : "";
  return `Olá, ${m.cliente}! Podemos confirmar a sua consulta de ${m.titulo} em ${formatarDataHora(m.inicioIso, fuso)} (horário ${fuso})?${financeiro}\nResponda SIM para confirmar ou REMARCAR para solicitar outra data.`;
}

export function agendaGhlUrl(locationId?: string | null, calendarId?: string | null) {
  if (!locationId || !calendarId || !/^[\w-]+$/.test(locationId) || !/^[\w-]+$/.test(calendarId))
    return null;
  return `https://app.gohighlevel.com/v2/location/${encodeURIComponent(locationId)}/calendars/view?calendar_ids=${encodeURIComponent(calendarId)}`;
}
