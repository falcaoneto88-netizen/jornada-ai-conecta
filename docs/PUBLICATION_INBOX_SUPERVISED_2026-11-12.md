# Entrega de publicação: atendimento supervisionado

Revisão-base: `a75951e2c7b84bea3b4396b6385a5f49892eeed4`.
Identificador da entrega: `jornada-inbox-supervised-20261112.1`.
Projeto original Lovable: `36345211-2616-42f7-bb9e-e78a9d00ca22`.

Este pacote reúne conversa, sugestão editável com aprovação, contexto comercial e próximo atendimento na Caixa de Entrada. Mantém a fila geral para triagem e auditoria e a política operacional V02. Não ativa automações, canais, contatos nem a candidata Izabel.

## Conteúdo privado preservado fora da publicação

A bancada de homologação Izabel e sua biblioteca permanecem na cópia local de revisão. Esta entrega não contém a biblioteca, instruções, fotos, importadores ou endpoint de simulação. A interface apresenta somente seu estado de homologação local. Os modelos existentes do Jornada continuam disponíveis.

Não copiar `private/`, `outputs/`, `.env`, credenciais ou o patch integral da homologação para o repositório público. O pacote de publicação possui apenas arquivos novos/alterados explicitamente listados em seu manifesto. `node_modules` e artefatos de build não são distribuídos. A cópia original foi preservada.

## Aplicação coordenada

1. Conferir a revisão-base e o manifesto SHA-256; reconciliar mudanças remotas mais recentes antes de substituir arquivos. Não reescrever o histórico Git.
2. Conferir organização e location derivados da sessão autorizada. Não usar IDs do documento para substituir autorização no servidor.
3. Aplicar primeiro as duas migrações, uma única vez, com o mecanismo oficial do projeto:
   - `supabase/migrations/20261112153000_commercial_agent_queue_read.sql`.
   - `supabase/migrations/20261113120000_inbox_reviewed_suggestions.sql`.
4. Os SQLs no pacote preservam exatamente os bytes da revisão testada. Se a ferramenta de migração já abrir transação, retirar somente as linhas externas `begin;` e `commit;` da primeira migração ao executá-la; não alterar seu corpo. Registrar a correspondência com os nomes oficiais do ambiente. Não reaplicar após uma interrupção sem verificar o catálogo.
5. Conferir as funções, colunas, constraint, índices e permissões após a aplicação. A leitura da fila e o comando manual continuam restritos a `service_role`, com validação de ator/organização/location no servidor e nas funções. Não ampliar RLS.
6. Integrar os arquivos do pacote e publicar no projeto original. Não substituir segredos ou configurações do ambiente e não criar outro aplicativo.
7. Conferir `/api/version`: `build` deve ser `jornada-inbox-supervised-20261112.1`, com `inboxSupervisedReview: 1` e `supervisionQueueRead: 1`. As capacidades anteriores permanecem.
8. Verificar autenticação, leitura da fila, conversa e contexto na conta autorizada. Verificar persistência de rascunho em um contato de teste sem enviar mensagem. Publicação não equivale a entrega de mensagem ou aprovação de dados clínicos.

## Comportamentos preservados

- Editar ou inserir sugestão não envia. O envio revisado depende de aprovação explícita do texto e destinatário atuais.
- Origem e versão da sugestão acompanham o rascunho cifrado. Mudança de contexto invalida a aprovação.
- Resultado incerto permanece bloqueado para conferência; não há reenvio automático.
- Retorno é lembrete interno, não mensagem programada. Contexto de cadastro/agenda vem do cache Jornada e identifica o fuso.
- Próximo atendimento muda a conversa carregada, preservando rascunhos; não arquiva nem marca a conversa como lida no GHL.
- O teste de usabilidade com a equipe permanece pendente. Consulte `INBOX_TEAM_VALIDATION_2026-11-12.md`.

## Evidência e limites

O manifesto de entrega registra os testes executados nesta cópia sem biblioteca privada. Logs locais não são distribuídos com o código. Nenhuma evidência local comprova por si só publicação, migração remota ou envio real. A homologação privada da Izabel não integra os gates desta entrega pública.

Em caso de regressão, reverter o código ao estado anterior preservando o histórico. As migrações são aditivas em dados; não apagar registros, colunas ou objetos automaticamente durante rollback. Avaliar separadamente compatibilidade da função manual e novos rascunhos vinculados antes de retornar a uma versão anterior.

## Integração no projeto original (13/11/2026, UTC)

Pacote `JORNADA_IA_PUBLICATION_2026-11-12.zip` SHA-256 `baa035b2ad073fe77115752494e5fe7e12b6b45e4232fbc7fedcdefd70b0d75d` (214894 bytes), base `a75951e2c7b84bea3b4396b6385a5f49892eeed4`. 57/57 arquivos conferidos (pacote, `baseSha256` antes e `sha256` depois); sem remoções; `.env`/configurações intocados.

Pré-catálogo: `commercial_agent_manual_command` md5(prosrc) `86a765e3923c4d1f3eca77584f95890c`; colunas source, constraint, índice e fila ausentes; `uq_contacts_ghl` e `commercial_agent_inbox.observed_at` presentes; último journal 0022 (banco id 23).

| SQL original (SHA-256) | Migração oficial | Arquivo oficial (SHA-256) | Diferença |
|---|---|---|---|
| `20261112153000_commercial_agent_queue_read.sql` `6041872b…0d6aabf0d` | `0023_commercial_agent_queue_read` | `7674be36…77456d09` | só `begin;` inicial, `commit;` final e newline terminal |
| `20261113120000_inbox_reviewed_suggestions.sql` `bf330343…ad0a0c89` | `0024_inbox_reviewed_suggestions` | `d4fd7987…c653ade0` | só newline terminal; BEGINs internos preservados |

Pós-catálogo: fila md5 `80d21458f06b8ff1bd7821cfd3c61d87`, STABLE; manual md5 `f3a91a6950bcd1b02153b958f6d9c338`; ambas SECURITY DEFINER, `search_path=""`, ACL `{postgres=X,service_role=X}`. Colunas `source_agent_draft_id uuid`, `source_agent_version integer`, `source_agent_reply_hash text`, opcionais; CHECK `commercial_agent_manual_source_complete` validado; índices `commercial_agent_queue_order`, `commercial_agent_inbox_queue_order`, `commercial_agent_manual_source_idx`. RLS ativo nas três tabelas, inalterado.

Extras da ferramenta: `drizzle/migrations/0023|0024_*.sql`, `meta/0023|0024_snapshot.json`, `meta/_journal.json`, `src/integrations/supabase/types.ts`.

Gates no Lovable: TSC OK, build OK, `git diff --check` OK; vitest 90 arquivos/1957 testes aprovados, 382 ignorados; 20 suítes `*.db.test.ts` não executaram (sem `PG_TEST_BINDIR`) e `src/routes/-real-data.test.tsx` (fora do pacote) falhou por mock sem `createMiddleware`. ESLint nos arquivos do pacote: 0 erros/3 avisos (regra prettier desligada; repositório inteiro tem erros prettier preexistentes). Nenhum teste de migração contra produção, nenhum envio, nenhuma alteração em flags/V02/GHL/DND/workflows. Publicação ainda não acionada.

### Correção da simulação do teste de rota (13/11/2026)

ZIP `JORNADA_IA_REAL_DATA_TEST_FIX.zip` SHA-256 `4d608c07…af41cc52`. Único arquivo: `src/routes/-real-data.test.tsx`, antes `28c1d10e…5cf4e` (igual ao `baseSha256`), depois `a425263f…0558b7`. A falha `createMiddleware` era preexistente na base `a75951e`; a simulação passou a cobrir a fronteira `readAttendanceWorkspace`, `useModoDados` e `useQuery` por chave, mantendo o componente real Meu dia. Nenhum código de produção alterado.

Resultados no Lovable: `-real-data.test.tsx` + `attendance-my-day.test.tsx` 17/17 aprovados (2 arquivos); TSC global OK. Lint: com ESLint original (Prettier ativo) nos TS/TSX do overlay + `api/version.ts` + teste corrigido, 0 erros/3 avisos. A contagem anterior de erros de formatação refere-se ao repositório inteiro (escopo diferente, formatação antiga fora do pacote), não ao gate desta entrega.
