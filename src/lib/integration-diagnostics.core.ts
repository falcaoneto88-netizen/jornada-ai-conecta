/**
 * Categorias fechadas de falha do diagnóstico do catálogo MCP. Módulo
 * client-safe: só tipos e texto, sem transporte nem credenciais.
 */
export type MotivoCatalogo =
  | "ok"
  | "sem_sessao"
  | "sem_permissao"
  | "oauth_client_required"
  | "unauthorized"
  | "http_error"
  | "resposta_invalida"
  | "indisponivel";

export type ResultadoCatalogo = {
  ok: boolean;
  status: number;
  reason: MotivoCatalogo;
  tools: string[];
};
