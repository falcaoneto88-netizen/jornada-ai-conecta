import { cursorSeguinte, totalAnunciado } from "./ghl-pipelines.core";

export type ContactoSnapshot = {
  id: string;
  locationId: string;
  dateUpdated: string;
  firstName?: string | null;
  lastName?: string | null;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  tags?: string[];
  source?: string | null;
};
export type CodigoPendencia =
  | "sem_versao"
  | "dados_invalidos"
  | "identidade_divergente"
  | "leitura_falhou"
  | "gravacao_nao_confirmada"
  | "conflito_telefone"
  | "conflito_concorrente";
export type PendenciaContacto = {
  contactId: string | null;
  code: CodigoPendencia;
  message: string;
};
export class ErroContacto extends Error {
  constructor(
    public readonly code: CodigoPendencia,
    message: string,
  ) {
    super(message);
  }
}
type Cursor = { startAfter?: string; startAfterId?: string };
export type DepsSyncContactos = {
  locationId: string;
  pagina: (cursor: Cursor) => Promise<{ contacts?: unknown; meta?: unknown }>;
  detalhe: (id: string) => Promise<unknown>;
  aplicar: (contacto: ContactoSnapshot) => Promise<"aplicado" | "ignorado">;
};

/** A API de listagem não é um snapshot transacional; inconsistências são falhas explícitas. */
export async function sincronizarContactos(deps: DepsSyncContactos) {
  const pendencias: PendenciaContacto[] = [];
  let importados = 0;
  let ignorados = 0;
  const ids = new Set<string>();
  const cursores = new Set<string>();
  let cursor: Cursor = {};
  let totalEsperado: number | null = null;
  try {
    for (let pagina = 0; ; pagina++) {
      if (pagina >= 200) throw new Error("Limite de páginas atingido; sincronização incompleta.");
      const resposta = await deps.pagina(cursor);
      if (!Array.isArray(resposta.contacts)) throw new Error("Lista de contactos inválida.");
      const total = totalAnunciado(resposta.meta);
      if (totalEsperado !== null && total !== null && total !== totalEsperado) {
        throw new Error("O total de contactos mudou durante a leitura. Execute novamente.");
      }
      totalEsperado ??= total;
      for (const item of resposta.contacts) {
        const id =
          item && typeof item === "object" ? (item as Record<string, unknown>)["id"] : null;
        if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(id))
          throw new Error("Identificador de contacto inválido.");
        if (ids.has(id))
          throw new Error("Contacto repetido entre páginas; sincronização incompleta.");
        ids.add(id);
      }
      if (totalEsperado !== null && ids.size > totalEsperado)
        throw new Error("Total de contactos inconsistente.");
      // Os campos de cursor podem aparecer na última página sem existir outra página.
      if (totalEsperado !== null && ids.size === totalEsperado) break;
      const proximo = cursorSeguinte(resposta.meta);
      if (!proximo) {
        if (
          (totalEsperado !== null && ids.size < totalEsperado) ||
          resposta.contacts.length >= 100
        ) {
          throw new Error("Falta o cursor para ler todos os contactos.");
        }
        break;
      }
      if (resposta.contacts.length === 0) {
        if (totalEsperado !== null && ids.size < totalEsperado)
          throw new Error("Página vazia antes do total anunciado.");
        break;
      }
      const chave = JSON.stringify(proximo);
      if (cursores.has(chave)) throw new Error("Cursor repetido; sincronização incompleta.");
      cursores.add(chave);
      cursor = proximo;
    }

    // Só grava após completar a listagem. O detalhe confirma identidade/location e versão.
    for (const id of ids) {
      let identidadeVerificada = false;
      let fase: "leitura" | "gravacao" = "leitura";
      try {
        const raw = await deps.detalhe(id);
        if (!raw || typeof raw !== "object" || Array.isArray(raw))
          throw new ErroContacto("dados_invalidos", "Detalhe de contacto inválido.");
        const c = raw as Record<string, unknown>;
        if (c["id"] !== id || c["locationId"] !== deps.locationId) {
          throw new ErroContacto(
            "identidade_divergente",
            "Contacto divergente ou pertencente a outra localização.",
          );
        }
        identidadeVerificada = true;
        if (
          typeof c["dateUpdated"] !== "string" ||
          !Number.isFinite(Date.parse(c["dateUpdated"]))
        ) {
          throw new ErroContacto(
            "sem_versao",
            "Contacto sem data de atualização válida; não é seguro substituir a versão local.",
          );
        }
        for (const campo of ["firstName", "lastName", "contactName", "phone", "email", "source"]) {
          if (c[campo] != null && typeof c[campo] !== "string")
            throw new ErroContacto("dados_invalidos", "Campos de contacto inválidos.");
        }
        if (
          c["tags"] != null &&
          (!Array.isArray(c["tags"]) || !c["tags"].every((tag: unknown) => typeof tag === "string"))
        ) {
          throw new ErroContacto("dados_invalidos", "Tags de contacto inválidas.");
        }
        fase = "gravacao";
        const estado = await deps.aplicar(c as ContactoSnapshot);
        if (estado === "aplicado") importados++;
        else ignorados++;
      } catch (erro) {
        // Não devolver mensagens de transporte/SQL nem identificadores de outra location.
        pendencias.push({
          contactId: identidadeVerificada ? id : null,
          code:
            erro instanceof ErroContacto
              ? erro.code
              : fase === "gravacao"
                ? "gravacao_nao_confirmada"
                : "leitura_falhou",
          message:
            erro instanceof ErroContacto
              ? erro.message
              : "Não foi possível confirmar o processamento deste contacto.",
        });
      }
    }
    if (pendencias.length)
      return {
        ok: false as const,
        code: "partial_sync" as const,
        importados,
        ignorados,
        encontrados: ids.size,
        pendencias,
        message: `Sincronização parcial: ${importados} gravados, ${ignorados} preservados e ${pendencias.length} pendências.`,
      };
    return { ok: true as const, importados, ignorados, encontrados: ids.size, pendencias };
  } catch (erro) {
    const motivo = erro instanceof Error ? erro.message : "Falha inesperada.";
    return {
      ok: false as const,
      code: "partial_sync" as const,
      importados,
      ignorados,
      encontrados: ids.size,
      pendencias,
      message: `Sincronização incompleta: ${importados} gravados, ${ignorados} preservados. ${motivo}`,
    };
  }
}
