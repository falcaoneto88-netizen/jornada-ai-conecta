/** Instants stay in UTC; display and day boundaries use the organization's IANA zone. */
export const FUSO_DEMO = "Europe/Lisbon";
const formatadoresDia = new Map<string, Intl.DateTimeFormat>();

export function validarFuso(fuso: string): string {
  try {
    new Intl.DateTimeFormat("pt-PT", { timeZone: fuso }).format(0);
    return fuso;
  } catch {
    throw new Error("O fuso horário da organização é inválido. Reveja a configuração da clínica.");
  }
}

export function chaveDia(valor: string | Date, fuso: string): string {
  let formatador = formatadoresDia.get(fuso);
  if (!formatador) {
    formatador = new Intl.DateTimeFormat("en-CA", {
      timeZone: fuso,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    formatadoresDia.set(fuso, formatador);
  }
  const partes = formatador.formatToParts(new Date(valor));
  const p = (tipo: Intl.DateTimeFormatPartTypes) =>
    partes.find((parte) => parte.type === tipo)!.value;
  return `${p("year")}-${p("month")}-${p("day")}`;
}

/** A civil calendar cell, NOT an instant to serialize or send to an API. */
export function diaCivil(valor: string | Date, fuso: string): Date {
  const [ano, mes, dia] = chaveDia(valor, fuso).split("-").map(Number);
  return new Date(ano!, mes! - 1, dia!, 12);
}

export function chaveCelula(dia: Date): string {
  return `${dia.getFullYear()}-${String(dia.getMonth() + 1).padStart(2, "0")}-${String(dia.getDate()).padStart(2, "0")}`;
}

export function deslocarDia(chave: string, dias: number): string {
  const d = new Date(`${chave}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** First instant of the local date: handles 23/25-hour days without assuming a fixed UTC offset. */
export function inicioDiaUtc(chave: string, fuso: string): string {
  const centro = Date.parse(`${chave}T00:00:00Z`);
  if (!Number.isFinite(centro)) throw new Error("Data inválida.");
  let minimo = centro - 36 * 60 * 60 * 1000;
  let maximo = centro + 36 * 60 * 60 * 1000;
  while (minimo < maximo) {
    const meio = Math.floor((minimo + maximo) / 2);
    if (chaveDia(new Date(meio), fuso) < chave) minimo = meio + 1;
    else maximo = meio;
  }
  return new Date(minimo).toISOString();
}

export function intervaloDias(dias: number, agora: Date, fuso: string) {
  const hoje = chaveDia(agora, fuso);
  const primeiroDia = deslocarDia(hoje, 1 - dias);
  return {
    primeiroDia,
    ultimoDia: hoje,
    inicio: inicioDiaUtc(primeiroDia, fuso),
    fim: inicioDiaUtc(deslocarDia(hoje, 1), fuso),
  };
}

export function formatarData(valor: string | null | undefined, fuso: string): string {
  if (!valor) return "—";
  return new Date(valor).toLocaleDateString("pt-PT", { timeZone: fuso });
}

export function formatarDataHora(valor: string | null | undefined, fuso: string): string {
  if (!valor) return "—";
  return new Date(valor).toLocaleString("pt-PT", {
    timeZone: fuso,
    dateStyle: "short",
    timeStyle: "short",
  });
}

export function formatarHora(valor: string, fuso: string): string {
  return new Date(valor).toLocaleTimeString("pt-PT", {
    timeZone: fuso,
    hour: "2-digit",
    minute: "2-digit",
  });
}
