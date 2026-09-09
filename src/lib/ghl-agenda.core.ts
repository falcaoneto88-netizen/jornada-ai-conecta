/**
 * Lógica pura da agenda do GoHighLevel (apenas leitura).
 * Não conhece Supabase nem rede: tudo entra por dependências injetadas,
 * o que permite testar normalização, janela temporal, associação ao cliente
 * e deduplicação a sério.
 */

export type EventoGhl = {
  id?: string;
  calendarId?: string;
  locationId?: string;
  contactId?: string;
  title?: string;
  appointmentStatus?: string;
  assignedUserId?: string;
  assignedUserName?: string;
  startTime?: string;
  endTime?: string;
  notes?: string;
};

export type ContactoNovoAgenda = {
  organization_id: string;
  ghl_contact_id: string;
  full_name: string;
  phone: string | null;
  phone_normalized: string | null;
  email: string | null;
  tags: string[];
  source: string;
  stage_key: string;
  is_demo: boolean;
};

export type LinhaMarcacao = {
  organization_id: string;
  contact_id: string;
  ghl_appointment_id: string;
  ghl_calendar_id: string;
  title: string;
  start_at: string;
  end_at: string | null;
  status: string;
  assigned_user_name: string | null;
  notes: string | null;
  is_demo: boolean;
};

export type LojaAgenda = {
  contactosPorGhlId(ids: string[]): Promise<Map<string, string>>;
  inserirContacto(linha: ContactoNovoAgenda): Promise<string>;
  marcacoesPorGhlId(ids: string[]): Promise<Map<string, { id: string; contactId: string | null }>>;
  inserirMarcacao(linha: LinhaMarcacao): Promise<"inserida" | "atualizada">;
  atualizarMarcacao(id: string, linha: LinhaMarcacao): Promise<void>;
};

export type ResultadoAgenda = {
  lidos: number;
  inseridas: number;
  atualizadas: number;
  adiadas: number;
  ignoradas: number;
  contactosNovos: number;
  completo: boolean;
  conflitos: string[];
};

const ESTADOS: Record<string, string> = {
  confirmed: "confirmada",
  booked: "confirmada",
  new: "confirmada",
  showed: "realizada",
  noshow: "faltou",
  no_show: "faltou",
  "no-show": "faltou",
  cancelled: "cancelada",
  canceled: "cancelada",
  invalid: "cancelada",
};

/** Traduz o estado do GoHighLevel para o vocabulário da aplicação. */
export function estadoMarcacao(valor: string | undefined | null): string {
  const chave = String(valor ?? "").trim().toLowerCase();
  return ESTADOS[chave] ?? (chave ? chave : "confirmada");
}

function limpar(v?: string | null) {
  return (v ?? "").replace(/\bundefined\b|\bnull\b/gi, "").replace(/\s+/g, " ").trim();
}

function dataValida(valor: string | undefined): string | null {
  if (!valor) return null;
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export type EventoNormalizado = {
  ghlId: string;
  calendarId: string;
  contactoGhlId: string | null;
  title: string;
  start_at: string;
  end_at: string | null;
  status: string;
  assigned_user_name: string | null;
  notes: string | null;
};

/** Valida e normaliza um evento; devolve o motivo exato quando não serve. */
export function normalizarEvento(
  bruto: EventoGhl,
  ctx: { calendarId: string; locationId: string; inicio: string; fim: string },
): { ok: true; evento: EventoNormalizado } | { ok: false; motivo: string } {
  const ghlId = limpar(bruto.id);
  if (!ghlId) return { ok: false, motivo: "Marcação sem identificador no GoHighLevel." };

  const calendario = limpar(bruto.calendarId);
  if (calendario && calendario !== ctx.calendarId) {
    return { ok: false, motivo: `Marcação ${ghlId} pertence a outra agenda (${calendario}).` };
  }
  const location = limpar(bruto.locationId);
  if (location && location !== ctx.locationId) {
    return { ok: false, motivo: `Marcação ${ghlId} pertence a outra localização.` };
  }

  const inicio = dataValida(bruto.startTime);
  if (!inicio) return { ok: false, motivo: `Marcação ${ghlId} sem data de início válida.` };
  if (inicio < ctx.inicio || inicio > ctx.fim) {
    return { ok: false, motivo: `Marcação ${ghlId} fora do período consultado.` };
  }
  const fim = dataValida(bruto.endTime);
  if (fim && fim < inicio) return { ok: false, motivo: `Marcação ${ghlId} termina antes de começar.` };

  return {
    ok: true,
    evento: {
      ghlId,
      calendarId: calendario || ctx.calendarId,
      contactoGhlId: limpar(bruto.contactId) || null,
      title: limpar(bruto.title) || "Marcação",
      start_at: inicio,
      end_at: fim,
      status: estadoMarcacao(bruto.appointmentStatus),
      assigned_user_name: limpar(bruto.assignedUserName) || null,
      notes: limpar(bruto.notes) || null,
    },
  };
}

/**
 * Persiste as marcações lidas.
 * Regras: nunca grava uma marcação sem cliente associado (para não apagar um
 * vínculo anterior) e nunca duplica — o identificador do GoHighLevel manda.
 */
export async function sincronizarAgenda(input: {
  orgId: string;
  locationId: string;
  calendarId: string;
  inicio: string;
  fim: string;
  eventos: EventoGhl[];
  loja: LojaAgenda;
  etapaInicialContacto: string;
  buscarContacto: (
    ghlContactId: string,
  ) => Promise<{ ok: true; contacto: ContactoNovoAgenda } | { ok: false; message: string }>;
}): Promise<ResultadoAgenda> {
  const r: ResultadoAgenda = {
    lidos: input.eventos.length,
    inseridas: 0,
    atualizadas: 0,
    adiadas: 0,
    ignoradas: 0,
    contactosNovos: 0,
    completo: true,
    conflitos: [],
  };

  const validos: EventoNormalizado[] = [];
  const vistos = new Set<string>();
  for (const bruto of input.eventos) {
    const n = normalizarEvento(bruto, {
      calendarId: input.calendarId,
      locationId: input.locationId,
      inicio: input.inicio,
      fim: input.fim,
    });
    if (!n.ok) {
      r.ignoradas += 1;
      r.completo = false;
      r.conflitos.push(n.motivo);
      continue;
    }
    if (vistos.has(n.evento.ghlId)) continue;
    vistos.add(n.evento.ghlId);
    validos.push(n.evento);
  }

  const idsContactos = [...new Set(validos.map((e) => e.contactoGhlId).filter((v): v is string => Boolean(v)))];
  const mapaContactos = idsContactos.length > 0 ? await input.loja.contactosPorGhlId(idsContactos) : new Map();
  const existentes =
    validos.length > 0 ? await input.loja.marcacoesPorGhlId(validos.map((e) => e.ghlId)) : new Map();

  for (const e of validos) {
    if (!e.contactoGhlId) {
      r.adiadas += 1;
      r.completo = false;
      r.conflitos.push(`Marcação ${e.ghlId} sem cliente no GoHighLevel: por associar.`);
      continue;
    }

    let contactId = mapaContactos.get(e.contactoGhlId) ?? null;
    if (!contactId) {
      const res = await input.buscarContacto(e.contactoGhlId);
      if (!res.ok) {
        r.adiadas += 1;
        r.completo = false;
        r.conflitos.push(`Marcação ${e.ghlId}: cliente não validado (${res.message}). Registo anterior preservado.`);
        continue;
      }
      contactId = await input.loja.inserirContacto({ ...res.contacto, stage_key: input.etapaInicialContacto });
      mapaContactos.set(e.contactoGhlId, contactId);
      r.contactosNovos += 1;
    }

    const linha: LinhaMarcacao = {
      organization_id: input.orgId,
      contact_id: contactId,
      ghl_appointment_id: e.ghlId,
      ghl_calendar_id: e.calendarId,
      title: e.title,
      start_at: e.start_at,
      end_at: e.end_at,
      status: e.status,
      assigned_user_name: e.assigned_user_name,
      notes: e.notes,
      is_demo: false,
    };

    const existente = existentes.get(e.ghlId);
    if (existente) {
      await input.loja.atualizarMarcacao(existente.id, linha);
      r.atualizadas += 1;
    } else {
      const efeito = await input.loja.inserirMarcacao(linha);
      if (efeito === "inserida") r.inseridas += 1;
      else r.atualizadas += 1;
    }
  }

  return r;
}
