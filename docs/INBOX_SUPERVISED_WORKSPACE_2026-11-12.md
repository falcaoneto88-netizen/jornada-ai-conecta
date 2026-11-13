# Caixa de Entrada — atendimento supervisionado concentrado

> Registro histórico da preparação local. Os ensaios Izabel, artefatos e comandos que dependem do pacote privado não acompanham esta entrega pública. Consulte `PUBLICATION_INBOX_SUPERVISED_2026-11-12.md` e o manifesto final para o escopo e os gates desta cópia.

Handoff da versão local de 12/11/2026. Base de código: `a75951e2c7b84bea3b4396b6385a5f49892eeed4`. As alterações desta entrega não estão commitadas; esse SHA identifica a base, não a revisão publicada.

**Estado:** implementado e testado localmente. Não publicado. Nenhuma migração aplicada ao banco real e nenhuma mensagem enviada a contatos nesta entrega. A equipe ainda não executou a validação de usabilidade.

## Fluxo implementado

1. A Caixa de Entrada reúne conversa, sugestão supervisionada e campo de resposta. O contexto comercial permanece no painel lateral no computador.
2. “Ajustar e revisar resposta” confere novamente a sugestão e a conversa antes de preencher o editor. Se já houver rascunho, a substituição exige confirmação. Esse passo não envia mensagens.
3. O atendente edita o texto. A referência da sugestão original acompanha o rascunho; o conteúdo original não é sobrescrito. A persistência existente usa conteúdo cifrado, incluindo a origem, com escopo de sessão/usuário, organização, contato e conversa.
4. “Revisar e aprovar” abre a prévia do texto final e destinatário. “Aprovar e enviar” vale somente para aquela versão e contexto. Mudança de texto, origem ou conversa invalida a aprovação. O backend mantém verificação de fonte, política, histórico, consentimento/DND, janela, permissões e estado de envio.
5. O envio usa o registro auditável existente e chave de idempotência. Um resultado incerto continua bloqueado para conferência; não gera reenvio automático. Falha comprovada antes da reserva do envio pode permitir nova aprovação explícita, somente com a evidência exigida pelo servidor. A sugestão original não é reativada e a sessão permanece com atendimento humano.
6. “Próximo atendimento” abre a próxima conversa da lista carregada. Não arquiva, não marca como lida e não envia mensagem. Rascunhos continuam separados por atendimento.

Modelos e tradução continuam sendo apoios ao campo de resposta; não criam um segundo caminho de envio automático. Anexos ficam indisponíveis enquanto o rascunho estiver vinculado à revisão de uma sugestão de texto.

## Contexto e triagem

- O resumo mostra responsável, próximo passo, retorno com data/hora e fuso, etapa e próxima consulta quando esses campos existem. Não foram inventados interesse, objetivo clínico ou outros dados ausentes.
- O formulário de responsável/retorno começa recolhido e permanece montado ao abrir/fechar. Gravação pendente, falhas e confirmação continuam visíveis. Permissões, versão esperada, conflitos e mudança de fuso preservam os bloqueios existentes.
- Cadastro, etapa e consulta exibidos no contexto têm como fonte o cadastro/agenda do Jornada AI, com indicação de consulta/atualização. **Não são uma leitura ao vivo do GHL.** Retorno interno não é mensagem programada.
- A fila geral de supervisão permanece para triagem e auditoria. “Ajustar no Atendimento” ou “Abrir no Atendimento” liga o registro ao contato e à conversa exatos na Caixa de Entrada, com parâmetros codificados. O link interno exige organização/location compatíveis e não aparece para dados de demonstração. Ações existentes de triagem e conferência foram preservadas.

## Computador e celular

No computador, conversa e contexto ficam lado a lado, com opção de recolher o painel lateral. No celular, lista, conversa/revisão e painel de contexto são apresentados por área; “Voltar à conversa” fecha o painel e restaura foco. O painel mantém sua única instância e preserva edição/estado pendente ao fechar, reabrir ou mudar de largura. Ações têm alvos adequados para toque e a interface respeita movimento reduzido.

## Principais arquivos

| Área                                       | Arquivos                                                                                                                                  |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Caixa de Entrada, editor e aprovação       | `src/components/ghl-inbox.tsx`, `src/components/inbox-agent-panel.tsx`                                                                    |
| Rascunho, origem e sincronização           | `src/components/inbox-workspace.ts`, `src/components/attendance-draft-sync.ts`, implementação existente em `src/lib/attendance-draft*`    |
| Contexto e painel responsivo               | `src/components/attendance-context-panel.tsx`, `src/components/inbox-context-dock.tsx`                                                    |
| Direção visual                             | `src/components/inbox-art-direction.css`, direção local de supervisão reutilizada                                                         |
| Triagem e acesso ao atendimento            | `src/components/commercial-agent-queue.tsx`                                                                                               |
| Contratos, autorização e registro do envio | `src/lib/commercial-agent/core.ts`, `src/lib/commercial-agent/service.server.ts`, funções de servidor correspondentes                     |
| Dependências de banco                      | `supabase/migrations/20261112153000_commercial_agent_queue_read.sql`, `supabase/migrations/20261113120000_inbox_reviewed_suggestions.sql` |

## Evidências locais

Resultados consolidados da execução desta entrega, sem confundir testes simulados com operação publicada:

| Validação        | Resultado                                                                                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI — 7 suítes    | **201 testes únicos aprovados**: inbox 76, painel de sugestões 31, contexto 20, sincronização de rascunho 25, workspace 4, fila 41 e dock 4. Foram 198 na rodada inicial, mais 1 teste do dock e 2 do inbox após ajustes. |
| Backend          | **317 testes aprovados**: 135 de banco isolado e 182 unitários.                                                                                                                                                           |
| TypeScript       | Aprovado (`tsc --noEmit`).                                                                                                                                                                                                |
| Build            | Aprovado.                                                                                                                                                                                                                 |
| ESLint           | Zero erros; três avisos Fast Refresh.                                                                                                                                                                                     |
| Prévia           | `http://127.0.0.1:4187/caixa-de-entrada` — serviços/dados simulados, sem transporte de mensagens reais.                                                                                                                   |
| Evidência visual | `outputs/inbox-workspace-2026-11-12/` — capturas e registros da QA local.                                                                                                                                                 |

A revisão local inclui isolamento de rascunhos, substituição explícita, aprovação inválida após mudança, preservação de origem, conflitos, recuperação segura antes do envio e manutenção do bloqueio após estado incerto. Os números acima não comprovam integração de produção nem redução de tempo da equipe.

## Antes do rollout

1. Revisar o diff final e identificar a revisão exata que será implantada, preservando alterações anteriores do projeto.
2. Aplicar no ambiente autorizado as duas migrações listadas **antes** de disponibilizar o novo código. Nesta entrega elas foram preparadas/testadas localmente; não foram aplicadas ao banco real. A migração de fila é uma dependência acumulada do worktree.
3. Verificar no ambiente publicado a versão, autenticação, escopo, leitura e persistência. Confirmar separadamente cada integração; não inferir sucesso real pela prévia ou pelo build.
4. Executar o protocolo em `docs/INBOX_TEAM_VALIDATION_2026-11-12.md`: sugestão quase correta, próximo contato, retorno com responsável, preservação de trabalho e volta no celular. Comparar tempo, mudanças de página, rolagem e erros antes/depois. Nenhum resultado com a equipe foi medido ainda.

Publicação, migrações no banco real e testes com envio real permanecem fora do que foi executado nesta entrega.
