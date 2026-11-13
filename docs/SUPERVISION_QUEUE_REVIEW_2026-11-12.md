# Supervisão Jornada AI — fila e atendimento manual

> Registro histórico da preparação local. Os ensaios Izabel, artefatos e comandos que dependem do pacote privado não acompanham esta entrega pública. Consulte `PUBLICATION_INBOX_SUPERVISED_2026-11-12.md` e o manifesto final para o escopo e os gates desta cópia.

Data: 12/11/2026. Projeto original Jornada AI, Lovable `36345211-2616-42f7-bb9e-e78a9d00ca22`.

Estado: **implementado e testado localmente; não publicado**. A migração nova foi executada somente em PostgreSQL/WASM isolado, com dados fictícios. Não foi aplicada ao Lovable Cloud. Nenhuma mensagem enviada, automação ativada ou cadastro real alterado.

Worktree: `jornada-ai-izabel-2026-11-12`, branch `codex/izabel-chat-20261112`, base `a75951e2c7b84bea3b4396b6385a5f49892eeed4`. Alterações anteriores da Izabel, tradução única, modelos e supervisão na conversa foram preservadas. A base V02 continua sendo a política operacional; Izabel v1 permanece em homologação.

## Problema confirmado na versão publicada

A inspeção de `https://jornada-ai-conecta.lovable.app/agente-supervisionado` encontrou a seção “Respostas para revisar (100)”, 76 rótulos de conteúdo expirado, 89 rótulos de desatualização e 575 opções no seletor manual, incluindo a opção inicial. 550 opções usavam identificação genérica. Em uma janela de 754 × 1024, a revisão começava aproximadamente na posição vertical 10.028 px. São observações daquela consulta, não métricas permanentes da conta.

A implementação antiga retornava os últimos 100 rascunhos sem classificar pendência/histórico antes do limite. Os nomes manuais dependiam de payloads retidos entre esses rascunhos. Eventos com código de erro apareciam como falhas mesmo quando ignorados por substituição de mensagem. Nenhuma ação real foi executada nessa inspeção.

## Correções

| Área | Mudança local | Evidência no código |
| --- | --- | --- |
| Fila completa | Categorias Revisar, Com a equipe, Envio a conferir e Histórico; busca e contagens antes de limitar resultados; 20 registros por página na tela | `src/lib/commercial-agent/queue-read.server.ts`, `queue-read.ts`, migração abaixo |
| Pendências antigas | Uma pendência não desaparece por haver mais de 100 registros recentes no histórico | `queue-read.db.test.ts` |
| Tela menor | Selecionar abre a revisão no mesmo espaço; Voltar à fila restaura foco e seleção. Lista tem altura limitada | `src/components/commercial-agent-queue.tsx` |
| Computador | Lista e revisão lado a lado; conteúdo secundário recolhido | `commercial-agent-queue.tsx` |
| Atendimento manual | Busca por nome/ID, páginas de 25 conversas, nome do cadastro canônico, identificação por ID quando o nome não existe; seleção recolhe os resultados | `src/components/commercial-agent-manual.tsx` |
| Segurança de interação | Falha de atualização bloqueia ações; resultado atrasado não troca dados de outra busca; mudança de usuário na mesma organização descarta o estado anterior | `src/routes/agente-supervisionado.tsx`, `-agente-supervisionado.test.tsx` |
| Aprovação | Mantidos confirmação explícita, escopo, expiração, versão/hash, recusa e envio único. Reforçado bloqueio visual por DND, política e versão da conversa | `commercial-agent-queue.tsx`, testes correspondentes |
| Eventos | Falhas reais separadas de eventos ignorados; envios incertos permanecem na fila mesmo expirados ou sem payload visível | `queue-read.server.ts`, migração, componente de fila |

A seleção/busca manual apenas consulta dados. Assumir, preparar, aprovar e enviar continuam ações distintas. **Aprovar uma resposta continua enviando uma mensagem**; não foi transformado em aplicação de rascunho nem contornado pelo editor genérico.

## Backend e isolamento

Nova migração: `supabase/migrations/20261112153000_commercial_agent_queue_read.sql`.

Ela acrescenta `commercial_agent_queue_read` e dois índices de consulta. A função é `STABLE`, somente leitura, com execução revogada de `public`, `anon` e `authenticated`, e concedida a `service_role`. Não altera contatos, oportunidades, workflows, rascunhos ou auditorias. A instalação cria objetos no esquema; não equivale a uma migração já aplicada à produção.

`commercial-agent-queue.functions.ts` exige autenticação; `runtime.server.ts` reutiliza `resolverAcesso`, papéis e vínculo servidor de organização/location. A RPC confere novamente ator, organização e vínculo. O reader verifica escopo, vínculo do evento, política, autenticação do ciphertext e hash da resposta. Não chama GHL, modelo ou operação mutante para listar resultados.

Nomes vêm de `contacts`, filtrados por organização e vínculo canônico GHL, excluindo demonstração. São nomes do cache existente; a consulta não prova atualização ao vivo do cadastro no GHL. Canal não disponível recebe indicação de indisponibilidade, sem inferir por telefone ou nome.

A projeção oculta payloads com mais de sete dias, exceto `sending`/`unknown`, cujas evidências são necessárias à reconciliação. Isso não apaga dados armazenados. O `purge` existente continua no worker em `http.server.ts`; sua execução publicada não foi comprovada nesta entrega.

`asOf` impede que novas entradas desloquem as páginas durante a consulta. **Não é snapshot transacional:** estado, versão, recusa e expiração continuam atuais. Uma resolução concorrente pode deslocar posições na paginação por offset. Página que ultrapassa o novo total reinicia em 1 com uma única reconsulta; Atualizar fila reinicia a âncora. Não se congelam estados de segurança para estabilizar contagens.

Sem a nova migração, a rota retorna `queue_read_unavailable`, com mensagem compreensível e ações bloqueadas. Não há fallback que apresente os antigos 100 registros como fila completa.

## Validação concluída

- **452 testes em 17 arquivos passaram**, em execução consolidada. Incluem regressões do motor Izabel, leitura específica da conversa, provedor mock, controles de envio, fila, atendimento manual e rota.
- Dentro dessa execução: **16 testes do reader** e **11 testes SQL** em PostgreSQL/WASM (PGlite temporário), sem credenciais, rede ou banco de produção.
- Testes SQL: contagens/filtros antes do limite, pendências anteriores a 120 históricos, isolamento ator/org/location, grants negados a anon/authenticated, nomes sem rascunho, retenção visível e precedência de envio incerto. Leituras não alteram linhas ou auditoria.
- Testes de UI/rota: resposta atrasada, mudança de identidade, falha e recuperação de consulta, confirmação aberta que perde permissão/versão, preservação de rascunho e foco.
- TypeScript global: aprovado. A primeira execução encontrou apenas problemas de tipagem nas novas fixtures; corrigidos antes da execução final.
- Build Vite cliente/servidor: aprovado. Permanecem avisos existentes de APIs/configuração de build; não houve publicação.
- ESLint dirigido: zero erros; um aviso em `friendlyError`, exportado junto do componente da fila, sobre Fast Refresh.
- Impeccable `detect --json` nos três arquivos de interface deste incremento: `[]`. Resultado estático, não uma certificação de acessibilidade.
- Navegador: componentes e rota reais com serviços substituídos por fixtures sintéticas. Verificados 754 px, celular 390 px, largura mínima 330 px e desktop 1440 px; sem overflow horizontal. Confirmados seleção por Enter, foco na revisão, volta ao item, busca manual por Enter, foco ao trocar conversa, filtro e segunda página. Console sem erros na leitura final.

Os testes visuais **não comprovam autenticação publicada, nomes reais, envio ou persistência no GHL**. Números e pessoas nas capturas são fictícios. A prévia não tem transporte de envio real.

Comando reproduzível da consolidação:

```sh
JORNADA_QUEUE_PGLITE_MODULE=/private/tmp/jornada-queue-db-20261112/node_modules/@electric-sql/pglite/dist/index.js ./node_modules/.bin/vitest run src/lib/commercial-agent/queue-read.test.ts src/lib/commercial-agent/queue-read.db.test.ts src/lib/commercial-agent/core.test.ts src/lib/commercial-agent/providers.test.ts src/lib/commercial-agent/manual-provider.test.ts src/lib/commercial-agent/http.test.ts src/lib/commercial-agent/inbox-review.test.ts src/lib/izabel src/components/commercial-agent-queue.test.tsx src/components/commercial-agent-manual.test.tsx src/components/izabel-workbench.test.tsx src/routes/-agente-supervisionado.test.tsx --maxWorkers=1 --testTimeout=15000
```

O módulo PGlite é uma dependência temporária separada do projeto. Sem `JORNADA_QUEUE_PGLITE_MODULE`, a suíte SQL fica ignorada; não contabilizar como aprovada. O teste não precisa de Supabase/GHL ou segredos.

## Evidências e entrega

- Prévia sintética: `http://127.0.0.1:4187/agente-supervisionado` — depende do servidor local desta sessão.
- Captura desktop: `outputs/supervision-2026-11-12/supervision-desktop.jpg`.
- Captura celular: `outputs/supervision-2026-11-12/supervision-mobile.jpg`.
- Logs e resumo: `outputs/supervision-2026-11-12/`.
- Patch acumulado da candidata Izabel e destas correções: `outputs/izabel-2026-11-12/changes.patch`.

## Próximo passo para implantação

Revisar a prévia e o patch. Na implantação autorizada, aplicar primeiro a nova migração ao ambiente de homologação; publicar o código correspondente somente após leitura autenticada comprovada com os papéis esperados. Conferir contagens, contato sem rascunho, paginação, conta sem acesso e entrada incerta com dados controlados, sem aprovar envios como parte dessa conferência. Em produção, executar a mesma sequência coordenada e revalidar a versão publicada.

Não há necessidade de trocar autenticação, criar outro app, reconstruir workflows ou ampliar os contatos/canais autorizados. A migração é aditiva e o rollback do código pode reutilizar a interface anterior, sem remover dados. Remoção futura dos objetos SQL exige avaliação própria; não foi executada.
