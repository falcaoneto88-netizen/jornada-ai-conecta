# Jornada AI — integração e handoff Codex

Data: 2026-09-21. Projeto ORIGINAL: `36345211-2616-42f7-bb9e-e78a9d00ca22`.

## Revisões e limites da evidência

- Código inicial inspecionado: `16491d9db3b9cfeae11c9e142d92f952f2e488fc`.
- Atualização concorrente preservada por fast-forward: `ccc8076d58c9c4e3288a27ee33e237285c63790e` (fixação de `@lovable.dev/vite-tanstack-config` em 2.23.1).
- Correção desta revisão: commit que introduz este documento; o identificador público preparado é `jornada-integrations-20260921.1`.
- Antes da correção, `/api/version` retornou HTTP 200, `Cache-Control: no-store`, build `jornada-adnav-v1.1-20260918`, `release: null`, em 21/09/2026 14:32 UTC. Esse build não identifica univocamente o SHA: não tratar o SHA do editor como prova da revisão publicada.
- Publicação e verificação posterior: registrar no complemento ao final deste documento.
- Não foram alterados contatos, oportunidades, workflows, chaves, concessões ou vínculos GHL. Nenhuma mensagem, campanha ou automação foi ativada. Nenhuma migração de produção faz parte deste patch.

## Contexto autorizado revalidado

Consulta somente leitura no banco e leitura autenticada pelo próprio app:

- Organização: `f07ab3be-7419-4779-a901-ef71c5fc27f0`, Clínica Dr. João Falcão, não demonstrativa, fuso `Europe/Lisbon`.
- Location: `ok2UHC2QMZsd8UHsAgEa`; binding pertence à mesma organização.
- Pipeline: `2QGyurvcmwhNhRgq0jCq`.
- `ghl_connections.status=conectada`, `mode=conectado`; último teste registrado em 19/09/2026 e última sincronização completa registrada em 14/09/2026. Essas datas não equivalem a uma sincronização realizada nesta revisão.
- Em **Integrações → Mapeamento → Carregar funis**, uma sessão existente do administrador retornou seis funis reais; **Pipeline Harmonização de Glúteo**, com 11 etapas, estava ligado. A função `listarPipelinesGhl` resolve sessão → perfil → organização → papel → binding, e faz GET autenticado ao GHL. Não foi acionado “Ligar” nem “Sincronizar oportunidades”.
- Os IDs acima servem apenas à conferência da auditoria. O código não aceita organização/location fornecidas pelo cliente para ampliar acesso.

## GHL

**Causa:** não se reproduziu falha de autenticação ou leitura dos pipelines. “Conectado” sozinho seria evidência insuficiente; a leitura real agora foi observada.

**Correção:** nenhuma mudança no GHL. Preservados token, binding, pipeline, calendário e sincronizações.

**Código:** `src/lib/ghl.functions.ts` (`resolverAcesso`), `src/lib/ghl-pipelines.functions.ts` (`listarPipelinesGhl`), `src/lib/ghl.server.ts`, `src/routes/integracoes.tsx`.

**Evidência:** leitura autenticada de pipelines, banco com binding correspondente, testes de autorização e acesso. Não equivale a validação de todas as operações de CRM, nem de envio de mensagens.

**Estado:** leitura de pipelines verificada de ponta a ponta; escrita e automações fora deste teste.

## MCP — três catálogos distintos

1. **Código/manifesto:** oito ferramentas em `src/lib/mcp/index.ts` e `.lovable/mcp/manifest.json`.
2. **Servidor publicado:** a rota é `/mcp`, protegida por OAuth Supabase. Pedido sem bearer retornou HTTP 401 `unauthorized`; isso é proteção esperada, não falha de publicação. Descoberta autenticada deve ser comprovada separadamente.
3. **Esta sessão Codex:** seis ferramentas expostas. Ausentes `list_opportunities` e `list_bioreport_events`; a assinatura de `list_contacts` desta sessão também não apresenta a paginação atual. A chamada autenticada `list_journey_stages` funcionou (17 etapas locais). Etapas locais não são necessariamente idênticas às 11 etapas do funil remoto.

Ferramentas declaradas:

| Ferramenta | Manifesto/código | Sessão auditada |
|---|---|---|
| list_journey_stages | presente | presente, chamada bem-sucedida |
| list_contacts | presente | presente, esquema antigo |
| list_opportunities | presente | ausente |
| move_contact_stage | presente | presente, não executada |
| list_message_templates | presente | presente |
| list_automations | presente | presente |
| recent_activity | presente | presente |
| list_bioreport_events | presente | ausente |

**Causa delimitada:** divergência comprovada de catálogo; cache/registro do conector e versão publicada precisam de evidência distinta. Não foi presumido que republicar ou reconectar resolveria a causa.

**Correção/diagnóstico implementado:** botão **Verificar catálogo MCP** em Integrações. `src/lib/integration-diagnostics.functions.ts` exige sessão e administrador via `resolverAcesso`; `src/lib/integration-diagnostics.server.ts` consulta apenas o destino público fixo `/mcp`, com o bearer da própria sessão, sem redirecionamentos. Retorna apenas nomes, HTTP e data. Não devolve token, payload bruto ou exceção, nem chama ferramentas de escrita. `src/components/mcp-diagnostics.tsx` distingue erro de catálogo vazio. Estado da interface é reiniciado quando muda o escopo.

**Configuração do Codex:** mensagem exata do erro solicitada ao usuário; não se alterou configuração local nem se inferiu erro a partir da contagem de ferramentas. Caso o servidor com autenticação mostre oito e a sessão continue com seis, atualizar a descoberta/conexão do cliente e conferir novamente os nomes/esquemas.

## Ad Navigator

**Banco revalidado:** um pareamento criado, zero consumidos, zero concessões vigentes para a organização auditada. No receptor não foram encontrados bindings com `organization_id` ou `pending_organization_id` da organização auditada. Isso não identifica um tenant receptor ainda sem pareamento.

**Causa:** ativação não concluída. Além disso, defeito comprovado na interface: o cartão considerava qualquer concessão não revogada como “Ligado”, ignorando validade, leitura e persistência no receptor.

**Correção implementada:**

- `src/lib/ad-navigator-status.ts`: revogado, expirado, troca concluída sem leitura, leitura registrada e aguardando receptor/ativação são estados distintos. Nenhum deles inventa persistência no Ad Navigator.
- `src/components/ad-navigator-card.tsx`: geração só depois de o operador indicar que o receptor está aberto e autenticado; código fica apenas na memória do componente, desaparece da apresentação após expiração/consumo/revogação; consulta periódica de estado e cache por escopo. Recriação do componente na troca de escopo impede reapresentar código de outra sessão/organização.
- Mantidos os contratos v1, o prazo de dez minutos, SHA-256, uso único, revogação, permissões e travas transacionais existentes. Nenhum código foi gerado nesta revisão.

**Contrato e código:** `docs/ad-navigator-bridge-v1.md`, `src/routes/api/ad-navigator/v1/{exchange,summary}.ts`, `src/lib/ad-navigator.{core,server,functions}.ts`, migrações 0009 e 0010. `summary` deriva a organização da concessão e recusa parâmetros de escopo no URL. Agregação permanece somente comercial, sem conteúdo clínico, contatos ou receita inventada.

**Receptor inspecionado, sem alteração:** projeto `be9ee9fc-4c73-49b5-a40b-4fb1a790f79e`, identificado como Ad Navigator. Referência observada `19252b387cba8081af403cbbfc6e02b018383e55`; havia trabalho em andamento, portanto não é uma revisão congelada do receptor. `src/lib/domain/providers/jornada.ts` usa os mesmos caminhos, campos da troca, scope e schema 1; valida identidade, campos fechados e somatórios. `src/components/jornada-summary.tsx` apresenta cobertura local e não mistura os agregados com CPL/CAC/ROAS. O transporte do receptor usa `redirect: error`; compatibilidade com seu runtime publicado ainda precisa ser exercitada, não presumida.

**Evidência:** `/exchange` vazio → 400 `pedido_invalido`; `/summary` sem bearer → 401 `credencial_invalida`; 26 testes em Postgres descartável cobriram consumo único, expiração, replay, isolamento, revogação, concorrência e agregação. RLS habilitada e INSERT negado ao papel authenticated nas tabelas privadas da ponte.

**Estado:** implementado e testado localmente; **aguardando receptor/ativação**. Conclusão requer troca real, leitura autenticada e snapshot persistido no tenant autorizado do receptor. Código somente pelo formulário autenticado; nunca pelo chat, arquivos ou logs.

## BioReport Studio

**Causa delimitada:** zero eventos não prova chave ausente. Consulta atual encontrou uma chave habilitada e em formato válido em `bioreport_private.signing_keys` para a organização auditada. Zero eventos persistidos. A anotação “chave pendente” de 12/09 é histórica.

**Configuração:** nomes esperados `BIOREPORT_JORNADA_SIGNING_SECRET`, `BIOREPORT_JORNADA_KEY_ID`, `JORNADA_AI_ORGANIZATION_ID`, `GHL_LOCATION_ID`. Diagnóstico executado no Lovable em 21/09 às 14:38 UTC relatou presença/formato válidos desses quatro nomes no ambiente Jornada, mas explicitamente **não comparou os valores com o banco**. Este relatório não eleva aquele relato a prova de correspondência criptográfica entre os apps. Nenhum valor ou fingerprint de segredo foi exportado.

**Código preservado:** `src/routes/api/public/bioreport-event.ts`, `src/lib/bioreport-events.server.ts`, `src/lib/bioreport-setup.server.ts`, `src/lib/mcp/tools/list-bioreport-events.ts`, migrações `20260912160000_bioreport_events.sql` e `20260912180000_bioreport_admin_setup.sql`.

**Emissor inspecionado:** BioReport Studio `26a42c4a-b53d-4fa2-b737-3b14bf0e0665`, `src/lib/jornada-events/client.server.ts`: HMAC-SHA256 sobre corpo exato, segredo hexadecimal usado como UTF-8, destino fixo, redirecionamentos recusados, recibo fechado `received|duplicate` com `messages_sent=0`. Contrato compatível com o receptor existente; nenhuma alteração de contrato necessária demonstrada.

**Evidência:** rota publicada sem assinatura → 401; banco mantém RLS, nenhuma leitura anon da chave e nenhuma inserção direta authenticated em eventos. **43 verificações PostgreSQL isoladas passaram**, incluindo HMAC, prazo, rejeição de conteúdo clínico extra, identidade, vínculo, duplicação, concorrência, rollback da auditoria e revogação. Isso não representa um evento real entre os dois apps publicados.

**Correção:** não girar nem recadastrar a chave existente para tentar resolver uma falha não comprovada. Preservado o receptor.

**Estado:** receptor implementado e publicado; segurança e persistência testadas localmente; **aguardando receptor/ativação** para a prova de ponta a ponta. Falta comparar privadamente a configuração do emissor e do receptor e executar um evento no fluxo autorizado, com consulta/registro/contato de teste identificados. Não foi escolhido paciente real nem enviado evento por inferência.

## URLs verificadas

| URL | Evidência desta revisão |
|---|---|
| https://lovable.dev/projects/36345211-2616-42f7-bb9e-e78a9d00ca22 | ID/nome/revisão/base habilitada conferidos pelo conector |
| https://jornada-ai-conecta.lovable.app/integracoes | sessão autenticada, leitura GHL de pipelines |
| https://jornada-ai-conecta.lovable.app/api/version | 200 e build público anterior, no-store |
| https://jornada-ai-conecta.lovable.app/mcp | 401 sem bearer; teste autenticado do catálogo a registrar após publicação |
| https://jornada-ai-conecta.lovable.app/api/ad-navigator/v1/exchange | 400 para JSON vazio |
| https://jornada-ai-conecta.lovable.app/api/ad-navigator/v1/summary | 401 sem bearer |
| https://jornada-ai-conecta.lovable.app/api/public/bioreport-event | 401 sem assinatura |

Uma tentativa via Python urllib recebeu bloqueio 403/1010 do proxy antes da aplicação. As mesmas rotas foram verificadas com curl, com as respostas da aplicação acima. Não foi alterada proteção do hosting para contornar o bloqueio.

## Validação local

- Node 24.19.0; dependências instaladas sem alterar o lockfile. A atualização de pacote já existente no remoto foi preservada.
- Vitest dirigido: **11 arquivos / 72 testes aprovados**, incluindo cartão, estados, diagnóstico MCP, ferramentas MCP, BioReport e autorização GHL.
- `ad-navigator.db.test.ts`: **26/26 aprovados**, Postgres 18.4 descartável. Como não há psql instalado, foi usado um adaptador temporário via `pg` limitado a sockets locais `jornada-rls-*`, executando o SQL original da suíte; não usa URL ou credenciais de produção.
- `npm run test:bioreport:db`: **43 verificações aprovadas**, Postgres descartável.
- `npx tsc --noEmit`: aprovado.
- `npm run build`: aprovado, inclusive regeneração oficial do MCP pelo plugin. Nenhum arquivo MCP gerado foi editado manualmente.
- ESLint dos arquivos alterados: aprovado.
- `npm run lint` global: **2336 erros e 10 avisos** em arquivos preexistentes; não corrigidos em massa para preservar o escopo. O lint global não é um gate verde.
- Bateria completa sequencial: resultado final a registrar no complemento. O adaptador local foi ajustado para manter a representação textual PostgreSQL de JSON/booleanos após quatro falsos negativos de formatação; nenhuma expectativa de teste do produto foi relaxada.

## Pendências indispensáveis

1. Completar a descoberta autenticada do servidor publicado e comparar com as seis ferramentas da sessão Codex; obter a mensagem exata do erro do cliente, sem credenciais.
2. No Ad Navigator autenticado e no tenant correto, concluir a troca no formulário e conferir a persistência. Não preparar código antecipadamente.
3. No BioReport, conferir correspondência de assinatura dentro do backend e identificar o registro de teste autorizado para um evento ponta a ponta. Não enviar conteúdo clínico para publicidade.
4. Correção da nota anterior: a sessão de navegador foi recuperada após o timeout de transporte e **a consulta pela interface autenticada foi realmente feita** (botão “Verificar catálogo MCP”). A limitação registada antes já não se aplica.

## Complemento de revisão e regressão — 21/09/2026

- Correção de código: `6d0c749`; integração com o remoto: `50b0cd42be500295fd7482db27d87bef38f43150`.
- Preservada também a revisão concorrente `aea303c`, que restaurou a faixa anterior do pacote de build. Nenhuma dessas alterações de dependências foi criada ou revertida por esta correção; o runtime local resolvido permaneceu 2.23.1, compatível com a faixa restaurada.
- Bateria sequencial: 44 arquivos, 551 testes. A primeira execução registrou 537 aprovados, quatro falsos negativos por serialização JSON do adaptador local e dez testes não iniciados porque o adaptador recusava o segundo prefixo de socket de teste. Após corrigir **somente o adaptador temporário**, as duas suítes afetadas passaram: **51/51**. Assim, todos os 551 casos foram exercitados com sucesso entre a execução completa e a repetição dirigida; não se afirma uma execução única integralmente verde.
- Os testes e expectativas do repositório foram preservados. Nada foi executado contra banco de produção. Build, TypeScript e lint dos arquivos alterados aprovados; lint global continua pendente por problemas preexistentes.

## Nota sobre referências de commit — 21/09/2026

- Os identificadores `6d0c749`, `50b0cd4` e `a53afb0` são referências **LOCAIS** do ambiente de revisão. O `push` para o Git remoto foi **recusado**: a conta usada não tem permissão de escrita no repositório.
- Portanto, esses SHAs não correspondem a nenhuma revisão publicada nem a qualquer histórico remoto verificável. Não os tratar como prova de estado do projeto.
- A revisão efetivamente gerada pelo Lovable ao aplicar este patch deve ser registrada aqui assim que estiver disponível, e é ela — não os SHAs locais — a referência válida.
- **Publicação e verificação ponta a ponta (e2e) continuam pendentes.** Nada foi publicado nesta aplicação do patch.

## Verificação final publicada — 21/09/2026

Este complemento prevalece sobre as pendências históricas de publicação acima.

- Código aplicado no projeto ORIGINAL: `0f8f3088d0ad8d1b4ef87e017d6994a2d3681419`; correção final do diagnóstico: `b245b186e67a49c825be43164a0bf95f21e99e8d`.
- Deploy inicial `b9ad76d1-bc7e-453f-abfd-191b68d293a0`; deploy final `6f98d7e2-5bd0-47ab-ad01-b50113bd5875`. `/api/version` confirmou `jornada-integrations-20260921.2` em `2026-09-21T15:56:01.516Z`, `release:null`. A revisão b245b18 foi a submetida; o endpoint identifica o build, não devolve SHA de runtime.
- A aplicação pelo Lovable incluiu pin automático de `@lovable.dev/vite-tanstack-config` em 2.23.1 no commit `91b4f28`, com lock correspondente, apesar do pedido de preservar dependências. Essa é a mesma versão resolvida e testada localmente. Não afirmar que o lock permaneceu inalterado nesta etapa.
- Lovable relatou 18 testes novos aprovados no primeiro patch e **19 testes nos três arquivos** após a correção final; tipos, build e lint alterados aprovados. Não são 19 testes apenas no arquivo do diagnóstico. O diff remoto foi conferido; autenticação MCP e rotas geradas preservadas.
- **MCP:** na UI administrativa publicada, o primeiro probe retornou 401 às 15:50:25.128Z. Na versão final, às `15:56:31.245Z`, retornou a categoria `oauth_client_required`: o desafio real declarou `OAuth client claim is required`. O SDK 2.0.2 exige `client_id`/`azp` por padrão; o JWT de sessão do app não substitui o token emitido pelo fluxo OAuth MCP. Nenhuma proteção foi relaxada. A interface devolve apenas categoria fechada, HTTP, nomes em caso de sucesso e data; não cabeçalhos nem credenciais. Código/manifesto têm oito ferramentas, esta sessão expõe seis. `list_journey_stages` voltou a funcionar nesta sessão (17 etapas). **Catálogo completo publicado ainda não verificado com token OAuth adequado**; a divergência não foi atribuída a cache. Falta o texto exato do erro Codex e descoberta pela conexão OAuth do cliente.
- **GHL:** leitura autenticada repetida depois da primeira publicação, retornando seis pipelines; Harmonização de Glúteo com 11 etapas e vínculo mantido. Não houve alterações de contatos, oportunidades ou workflows nesta revisão.
- **Ad Navigator:** cartão publicado mostra `Aguardando receptor/ativação`, sem concessões, geração desabilitada até confirmação de receptor pronto. O receptor `https://falcao-adsagent.lovable.app/integracoes` mostrou `Não configurada` e exigência de modo Real com sessão verificada e papel owner. Não foi gerado nem transferido código por esta revisão. Na última observação o cartão passou a indicar código pendente, evidência de atividade concorrente; não se atribui sua criação a este trabalho nem se consome por inferência. Troca, leitura e persistência no receptor continuam pendentes.
- **BioReport:** uma chave habilitada e zero eventos no instante da consulta. Presença/formato não comprovam igualdade dos segredos entre apps. Correspondência privada de configuração e evento autorizado ponta a ponta continuam pendentes; estado `aguardando receptor/ativação`. Não houve rotação nem evento enviado.
- Navegador recuperado: interface publicada e resultados acima observados. Não há bloqueio permanente de navegador nesta conclusão.

**Estados finais:** implementado e publicado: cartão e diagnóstico; testado localmente: contratos, isolamento, replay, concorrência e persistência em bancos descartáveis; verificado de ponta a ponta: leitura GHL; ainda não verificados de ponta a ponta: pareamento Ad Navigator, evento BioReport e descoberta completa do catálogo OAuth MCP.

## Jornada de agendamento GHL → n8n → Jornada — 05/10/2026

Este complemento registra a revisão atual da automação. As verificações históricas acima permanecem preservadas; não comprovam a publicação do novo backend descrito abaixo.

### Revisões e limites da publicação

- Projeto original: `36345211-2616-42f7-bb9e-e78a9d00ca22` (Jornada AI).
- Base de código conferida: `9e35e0ca281e1adcc333af16e9f9f3cd8bdfde10`; revisão preparada na branch local `codex/n8n-journey-20261005`. Sem push ou publicação deste backend. O SHA da revisão local é consultável no histórico dessa branch.
- **Novo backend: implementado e testado localmente; NÃO publicado.** Nenhum SHA publicado correspondente a este patch foi identificado. A revisão de origem e `/api/version` não devem ser tratados como prova de execução deste código novo.
- **Migração 0014: tentativa BLOQUEADA ANTES DA EXECUÇÃO pela revisão automática de aprovação**, que apontou a proibição inicial do usuário de alterar o banco. A autorização específica assíncrona para `drizzle/migrations/0014_n8n_bridge_confirmations.sql` estava pendente no momento deste registro. **O banco conectado permaneceu inalterado por essa tentativa.** Não confundir os testes SQL em banco descartável com aplicação na produção.
- No n8n, cinco correções de código foram publicadas **em simulação**, na versão `639c068c-aeb8-4f95-8d64-895d5646609f`, identificada no link de histórico da execução 35. Isso não publica o backend Jornada nem conclui o tratamento de respostas.

### Correções implementadas no backend local

- `src/lib/n8n-bridge.core.ts`: `message.send` consulta o compromisso no GHL e bloqueia `req24`/`req12` se já estiver confirmado, antes da reserva/envio. O agradecimento `kind=confirm` exige status GHL confirmado e evidência durável de confirmação para a mesma organização, consulta e horário. `appointment.get` preserva `dateUpdated` válido da fonte, sem inventar esse horário.
- `src/lib/n8n-bridge-confirmation.ts` e `src/lib/n8n-bridge.server.ts`: operação adicional `appointment.confirm` pela rota/auth existentes. O servidor deriva o escopo; reconsulta contato, compromisso, mensagem recebida e solicitação enviada. Exige SIM/CONFIRMO inequívoco, uma única consulta candidata e histórico completo da conversa, recusando resposta superada ou intervenção intermediária. Repete as verificações perto do PUT, usa `toNotify:false` e só informa confirmação após releitura do GHL e persistência. A operação não envia mensagem.
- `drizzle/migrations/0014_n8n_bridge_confirmations.sql`: vínculo de contato nas novas reservas de envio, busca de solicitações por organização/contato e reserva durável única por resposta e por consulta/horário. Mantém RLS e acesso exclusivo de serviço. A assinatura anterior de reserva continua disponível; envios antigos sem vínculo não se tornam evidência por inferência.
- Timeout/resultado incerto permanece `unknown`, sem repetição automática da escrita. DND, autenticação, vínculos de location e configuração do canal não foram relaxados.
- Contrato e limites: `docs/n8n-confirmation-v1.md`. Mensagens originadas nos workflows nativos do GHL não possuem, por si, registro na bridge e não autorizam a nova confirmação. O GHL não oferece comparação e troca por versão neste contrato; uma alteração externa após a última leitura continua sendo risco residual, mesmo com releitura posterior.

### Evidências de testes

| Verificação | Resultado e alcance |
|---|---|
| Revisão independente local — `n8n-bridge.test.ts`, `n8n-bridge-confirmation.test.ts`, `n8n-bridge-confirmation.adapter.test.ts` | **124/124** aprovados após a guarda adicional do agradecimento, com Vitest **5.0.0** e dependências do checkout atual. Inclui guardas de confirmação, vínculo/ambiguidade, SIM superado, intervenção humana, paginação, timeout, duplicação e preservação dos tipos de mensagem elegíveis. |
| PostgreSQL temporário — `n8n-bridge-confirmation.db.test.ts` | **9/9** aprovados, incluindo 12 claims concorrentes, isolamento, unicidade, resposta reutilizada e escopo por contato. Execução local autorizada para loopback; nenhuma URL/credencial de produção utilizada. |
| Gates locais finais | **136 testes focados em cinco arquivos** aprovados em uma execução após a guarda adicional, com dependências instaladas pelo `bun.lock` congelado. TypeScript (`tsc --noEmit --pretty false`) e `npm run build` aprovados. Na execução anterior da suíte completa, **612 testes passaram**; **146 não executados** em nove suítes antigas pela ausência de `initdb` no PATH. A alteração posterior recebeu a regressão focada acima. Isso não invalida os nove testes PostgreSQL dirigidos, executados com binário temporário e banco isolado. |
| Higiene do patch | `git diff --check` e lint dos arquivos alterados aprovados. Lint global apresenta **2834 erros e 10 avisos em 82 arquivos preexistentes**, sem interseção com os arquivos alterados. O gate global permanece com essa falha registrada. |
| Encadeamento n8n local | **70/70 testes** em `outputs/n8n-confirmation-wiring-2026-10-05/wiring.test.cjs`, na raiz desta tarefa. Sete campos JS, uma consulta e dois nós adicionais preparados; ainda não aplicados ao n8n. Simulação e resultados incertos não produzem confirmação persistida. O reuso histórico exige novas leituras autenticadas e jamais repete reserva/PUT. |
| Regressões no n8n publicado — execução **33** | **23 cenários remotos** aprovados em simulação, conforme observação da execução principal. Não comprovam envio real, resposta real ou aplicação do backend novo. |
| Snapshot autenticado no n8n — execução **35** | Sucesso em **4,799 s**; decisão `recovered_missing_booking`; resultados `[simulated]`. Evento `SIM:workflow-snapshot:35:Xa9VzcQsqi45xmasvzFG`, linha **14**, persistido em `2026-10-05T18:05:44.132Z`. Comprova recuperação/persistência simulada, sem comprovar entrega. |

### Estado conectado observado e configuração sem segredos

- Organização esperada conferida: `f07ab3be-7419-4779-a901-ef71c5fc27f0`; location GHL `ok2UHC2QMZsd8UHsAgEa`; calendário `nPXR1Fyp0r3CpaMMGSki`. Esses IDs servem à conferência; o escopo do servidor continua derivado dos vínculos autenticados.
- Bridge conectada: `simulation=true`, `live_send_enabled=false`, `channel_verified=false`, `fallback_user_id` ausente. Nenhuma dessas barreiras foi alterada para produzir um teste verde. Configuração/autenticação por `N8N_JORNADA_BRIDGE_TOKEN` ou credencial de organização, `GHL_PRIVATE_TOKEN` e `GHL_LOCATION_ID`; nenhum valor de segredo é registrado aqui.
- Workflow GHL original `c36e62f5-e92b-4724-bc7c-1b9ae292b9ff`: observado em **rascunho**, switch de publicação **0**. É uma leitura atual, não uma afirmação de que esta revisão o desativou.
- Encaminhador GHL `4e94283f-c2dc-463c-a52d-8513ace3c1cc`: observado **publicado**, switch **1**, com gatilho de compromisso. **Ainda não encaminha respostas recebidas** por esse gatilho.
- O novo encadeamento no n8n para `appointment.confirm` → persistência confirmada → agradecimento está **preparado e testado localmente**, em `outputs/n8n-confirmation-wiring-2026-10-05/` na raiz da tarefa. Manifesto, diff e instruções identificam sete campos JS, uma consulta e dois nós adicionais que devem ser aplicados juntos. Não foi aplicado remotamente e não conclui o recebimento das respostas. Não declarar concluída a jornada SIM → confirmação no GHL → agradecimento antes de validar esse encadeamento publicado.
- As notas de operação do canvas foram atualizadas e a interface voltou a mostrar **Published**, na publicação denominada `Estado verificado e pendencias de ativacao 2026-10-05` (prefixo de revisão `35c15f15`). Essa atualização posterior apenas documenta o estado; a execução 35 comprova a versão de código `639c068c-aeb8-4f95-8d64-895d5646609f`, não um novo teste ponta a ponta.
- O seletor de variáveis do webhook GHL ofereceu `Message Body`, `Message Subject` e `Message Attachments`, sem ID de mensagem nesse grupo. Não foi presumida uma variável de ID nem publicado encaminhamento de resposta sem comprovação. A coleta do ID real continua dependência.
- A revisão independente final encontrou e fechou dois defeitos adicionais **no patch local**: histórico antigo podia restaurar `confirmed` local após remarcação; agradecimento podia continuar após nova resposta NÃO/REMARCAR. O wiring agora exige releitura fresca antes de reutilizar confirmação, e a guarda do servidor revalida mensagem/histórico ligados ao registro confirmado antes da reserva e novamente antes do POST do agradecimento, sem repetir o PUT de confirmação. Isso não elimina a janela residual sem CAS nem substitui validação publicada.
- A homologação precisa caracterizar eventual atividade automática que o próprio PUT registre no histórico: a guarda de resposta mais recente a bloqueia conservadoramente até essa evidência ser entendida. Não remover a guarda apenas para tornar o teste verde.
- O workflow de diagnóstico foi restaurado e conferido com a URL da bridge Jornada, operação `health` e referência Bearer salva. As execuções citadas não fornecem `messageId` nem prova de envio real.

### URLs e pontos de conferência

| URL | Evidência/limite registrado |
|---|---|
| https://lovable.dev/projects/36345211-2616-42f7-bb9e-e78a9d00ca22 | Projeto original e revisão de origem conferidos; novo patch ainda local. |
| https://jornada-ai-conecta.lovable.app/api/version | Endpoint de revisão; não identifica publicação deste patch local. |
| https://jornada-ai-conecta.lovable.app/api/public/n8n/bridge | Rota existente reutilizada. O contrato novo não foi validado publicado. |
| https://jfalcaoneto.app.n8n.cloud/workflow/WrDn82MwKBcuM73G | Workflow Falcão — Agenda e Confirmação V2; cinco correções publicadas em simulação. |
| https://jfalcaoneto.app.n8n.cloud/workflow/WrDn82MwKBcuM73G/history/639c068c-aeb8-4f95-8d64-895d5646609f | Revisão publicada identificada pela execução 35. |
| https://jfalcaoneto.app.n8n.cloud/workflow/WrDn82MwKBcuM73G/executions/33 | Regressão remota de 23 cenários em simulação. |
| https://jfalcaoneto.app.n8n.cloud/workflow/WrDn82MwKBcuM73G/executions/35 | Snapshot autenticado com recuperação e persistência simuladas. |
| https://jfalcaoneto.app.n8n.cloud/webhook/falcao-agenda-v2-eventos | Destino POST do encaminhador; autenticação preservada. Não chamar como teste irrestrito de escrita. |
| https://jfalcaoneto.app.n8n.cloud/workflow/AmW70D885JzG1TC9 | Diagnóstico restaurado para `health` da bridge com referência Bearer salva. |
| https://app.gohighlevel.com/v2/location/ok2UHC2QMZsd8UHsAgEa/automation/workflow/c36e62f5-e92b-4724-bc7c-1b9ae292b9ff | Workflow original observado em rascunho. |
| https://app.gohighlevel.com/v2/location/ok2UHC2QMZsd8UHsAgEa/automation/workflow/4e94283f-c2dc-463c-a52d-8513ace3c1cc/advanced-canvas | Encaminhador publicado, somente gatilho de compromisso. |

### Cobertura da jornada e ativação

| Etapa | Comprovação atual | O que ainda impede conclusão operacional |
|---|---|---|
| Agendamento → entrada no n8n | Webhook autenticado e leitura GHL; execução 35 recuperou e persistiu a consulta em simulação. | Não comprova envio da primeira mensagem. |
| Pedido de confirmação e lembretes | Regras sintéticas e guarda contra solicitação após confirmação. | Canal/preferências e envio real ainda bloqueados; relógio/esperas não validados em execução real completa. |
| Resposta SIM/CONFIRMO | Contrato autenticado e persistência implementados/testados localmente. | Migração/backend, encadeamento e recebimento do ID real ainda não implantados. |
| Agradecimento | Patch exige confirmação GHL e registro durável; simulação não conta como confirmado. | Falta publicação e entrega real verificada por ID, sem resposta mais recente que supere o SIM. |
| NÃO/REMARCAR/ambígua/sem resposta | Regras encaminham para atendimento humano e testes cobrem os ramos. | Responsável padrão ausente; notificação e atendimento real não comprovados. |
| Cancelamento/remarcação e reentrega | Correções preservam geração/horário e marcadores de envio; rejeitam evento autenticado antigo. | Estado completo do workflow ainda não possui prova de concorrência/serialização. |

Ordem de implantação: aprovação específica da migração → aplicação transacional e conferência de RLS/funções → backend com revisão identificável em `/api/version` → encadeamento n8n em simulação → encaminhamento autenticado das respostas → validação de canal, responsável e concorrência → teste real restrito ao contato autorizado. Não liberar flags por inferência a partir de testes simulados. Não reativar o workflow nativo em paralelo sem conferir sobreposição de mensagens.

**Pendências para concluir:** autorização específica da migração bloqueada, aplicação da migração antes do backend, publicação verificável, encaminhamento autenticado do ID da resposta e aplicação do encadeamento n8n, comprovação do canal/preferências exigidas, tratamento da concorrência do estado do workflow, definição do responsável por atendimento humano e teste controlado de ponta a ponta. Até essas evidências existirem, o estado é **publicado parcialmente em simulação; confirmação completa ainda não verificada de ponta a ponta**.


## Integração local da revisão de confirmações — 06/10/2026

- Base atualizada do projeto original: `08be9f2c77d4539780ab7f13aa012e3d13497223` (`origin/main` no início desta revisão).
- Patch original `05ac418` aplicado por cherry-pick, sem conflitos, em `codex/n8n-release-20261006`, produzindo `d4b1c68`. Worktree: `work/n8n-release-2026-10-06`. O checkout de 05/10 e suas alterações pendentes no handoff foram preservados.
- A restauração comercial da base atual não foi substituída. O delta de implementação permanece restrito à ponte n8n, migração de confirmações, testes, marcador de versão e documentação.
- **Migração 0014 aplicada em 06/10/2026 pela tarefa principal**, após autorização explícita do usuário. Evidência de pós-aplicação informada pela tarefa principal: RLS ativo; sem concessões de acesso público/autenticado; funções executáveis por `service_role`; credencial existente preservada; flags de ativação inalteradas. Este estado supera a pendência de autorização/aplicação registrada em 05/10 acima.
- A integração deste worktree não executou SQL remoto, push, publicação, mensagens ou alterações de workflows. A versão publicada do backend continuava anterior, conforme leitura da tarefa principal. Não declarar o fluxo como verificado de ponta a ponta a partir da aplicação da migração.
- `package.json`/`bun.lock` da base nova exigem `@lovable.dev/vite-tanstack-config` 2.25.2 (antes 2.23.1); as dependências foram instaladas para o lock atual, sem reutilizar a árvore incompatível do checkout anterior.

Gates executados nesta integração, na revisão `d4b1c68` e antes de extensões posteriores:

| Verificação local | Evidência de 06/10/2026 |
|---|---|
| Suítes focadas da ponte, confirmação, adaptadores e escopo | **136 testes / 5 arquivos aprovados em uma execução** |
| Migração/concorrência em PostgreSQL descartável | **9 testes aprovados**, usando o runtime existente; nenhuma conexão com produção |
| TypeScript | `tsc --noEmit --pretty false`, **exit 0** |
| Compilação | `npm run build`, **exit 0**, com `@lovable.dev/vite-tanstack-config` 2.25.2 |
| Lint dos arquivos alterados | **exit 0**, incluindo `/api/version` |
| Revisão independente do cherry-pick | Delta restrito aos 13 arquivos esperados; arquivos de restauração comercial da base preservados; nenhum conflito ou regressão adicional identificado na leitura |
| Publicação e teste completo | **Não executados por esta integração local**; dependem da implantação e da verificação publicada coordenadas pela tarefa principal |

O checkout anterior `work/n8n-journey-2026-10-05` continua na revisão `05ac418` com sua alteração pendente em `docs/MCP_CODEX_HANDOFF.md`, preservada. Uma extensão posterior, se integrada, exige seus próprios gates e registro; os resultados acima não a validam automaticamente.


### Correção da interpretação de DND — 06/10/2026

- Causa comprovada: a ponte exigia entradas `SMS` e `WhatsApp` explicitamente `inactive`, interpretando ausência como bloqueio/ausência de permissão. A tarefa principal reabriu o contato exato Felipe Santos (`2jaCqBm8bWNTdZ6yZqtF`): UI mostrou DND global, mensagens de texto e entrada desligados. A leitura antiga da ponte, via `contacts/search`, devolveu `dnd=false` e `dndSettings={}`; **essa projeção não representa prova completa das preferências atuais**.
- Uma nova leitura individual autenticada em 06/10, `GET /contacts/2jaCqBm8bWNTdZ6yZqtF`, devolveu global `false`, SMS/Call/Email `inactive` e WhatsApp ausente (`dateUpdated=2026-10-05T16:36:36.465Z`), conforme evidência fornecida pela tarefa principal. A divergência é entre projeções de endpoints, não evidência de alteração de preferência. Nenhuma preferência foi alterada por este patch. O adapter passa a usar exclusivamente [GET Contact](https://marketplace.gohighlevel.com/docs/ghl/contacts/get-contact/index.html), preservando as verificações de ID/location e recusando dados incompletos/malformados; não recorre ao search após falha.
- A [documentação oficial do GHL](https://marketplace.gohighlevel.com/docs/2021-07-28/webhook/ContactDndUpdate/index.html), consultada nesta revisão, define global `dnd` ausente como `false` em todas as suas APIs. A interpretação de WhatsApp ausente é sustentada pela comparação UI/leitura individual do contato acima, sem transformar ausência em opt-in. Um mapa vazio continua aceito estruturalmente, mas uma projeção de busca vazia não é usada para inferir o estado completo do contato.
- Correção local: `parseContacto` aceita global omitido como `false`, mantém `{}` sem fabricar chaves, reconhece `active|inactive|permanent` e recusa estrutura/tipos desconhecidos. `dndPermite` representa somente ausência de bloqueio configurado; global `true` ou bloqueio explícito SMS/WhatsApp continua impedindo a rota Zaptos. Um bloqueio válido de outro canal não é transferido para SMS. Configuração malformada, inclusive canal malformado, permanece bloqueada.
- A correção não cria `smsConsent`, `optIn` ou outra evidência de autorização. O telefone/identidade/organização/location/calendário/horário, flags de simulação e envio, validação do provedor, reserva durável e escopo do teste autorizado continuam controles separados. Nenhum CRM, credencial, flag ou configuração real foi alterado por esse patch. O código de erro legado `dnd_not_confirmed` permanece para bloqueios explícitos, preservando compatibilidade do cliente.
- Regressão adicionada em `n8n-bridge-dnd.test.ts`: ausência de global/canal, mapa vazio, bloqueio global/active/permanent, dados malformados, isolamento e impossibilidade de transformar ausência de DND em envio real com flags desligadas.

### Descoberta de resposta e gates integrados — 06/10/2026

- Acrescentado `appointment.reply.resolve`, somente leitura, para resolver o ID real da resposta pelo contato autenticado e pelo histórico GHL. O Custom Webhook desperta a leitura, sem fornecer texto/intent/ID de mensagem como prova. Contrato, limites e recusas em `docs/n8n-reply-resolve-v1.md`.
- A operação reutiliza o ledger de pedidos aceitos e as guardas de histórico da confirmação; consultas/conversas múltiplas, paginação incompleta, resposta superada ou intervenção impedem a associação automática. Não reserva, confirma consulta nem envia mensagem. Não adiciona migração.
- Marcador de versão preparado: `jornada-n8n-confirmation-20261006.1`, `api.n8n-bridge=3`. Esse marcador no código local não comprova publicação.
- **Gate final combinado:** 241 testes em 7 arquivos aprovados em uma execução, abrangendo ponte, confirmação, adapters, escopo, 76 casos do resolver e 29 casos de DND. `tsc --noEmit --pretty false`, `npm run build` e ESLint dos 14 arquivos de código/teste da alteração terminaram com **exit 0**. Os 9 testes PostgreSQL isolados já aprovados na integração de 06/10 continuam aplicáveis à mesma migração, que não mudou nesta extensão; não são somados à execução Vitest de 241.
- Esta revisão local permanece **implementada e testada localmente**. A ligação GHL/n8n, publicação identificável, primeira solicitação real aceita no ledger, recebimento de resposta e entrega de agradecimento ainda exigem evidência publicada coordenada pela tarefa principal. Ausência de DND não comprova autorização nem entrega.

Reprodução do gate integrado, após instalar as dependências do `bun.lock`:

```sh
./node_modules/.bin/vitest run src/lib/n8n-bridge-confirmation.test.ts src/lib/n8n-bridge-confirmation.adapter.test.ts src/lib/n8n-bridge.test.ts src/lib/n8n-bridge.adapter.test.ts src/lib/n8n-bridge.escopo.test.ts src/lib/n8n-bridge-reply-resolve.test.ts src/lib/n8n-bridge-dnd.test.ts
./node_modules/.bin/tsc --noEmit --pretty false
npm run build
```

Para o teste de concorrência/PostgreSQL, usar o runtime existente indicado por `BIOREPORT_TEST_RUNTIME`, conforme `docs/n8n-confirmation-v1.md`; as dependências auxiliares `embedded-postgres`/`pg` não pertencem ao pacote padrão do app. Não substituir o teste de banco por um resultado unitário ou usar produção para reproduzi-lo.

### Guarda de lembretes e leitura individual — extensão local de 06/10/2026

- `req24`/`req12` agora exigem evidência de envios anteriores aceitos no ledger, histórico completo desde o aviso `booking` e elegibilidade atual. A checagem é repetida após a reserva: resposta, intervenção humana, DND novo, confirmação, cancelamento ou remarcação observados recusam o POST. Detalhes e limites em `docs/n8n-reminder-guards-2026-10-06.md`.
- A leitura de preferências do contato passou de `POST contacts/search` para `GET contacts/:contactId`, devido à diferença de projeção comprovada pela tarefa principal acima. Testes do adapter verificam que bloqueios retornados pelo GET são preservados, identidade/location continuam obrigatórias e falhas não usam a busca como fallback.
- **Gate integrado mais recente:** 290 testes aprovados em 8 arquivos, numa única execução após as duas correções; TypeScript, build e lint dos 16 arquivos de código/teste da alteração passaram. Substitui a contagem de 241 como gate do código final desta extensão. SQL, migração e flags permaneceram inalterados; os 9 testes isolados de banco são evidência separada da mesma migração.
- Nenhuma publicação, envio real ou mudança em CRM/workflows foi executada por esta extensão local. O pacote de transferência contém os arquivos e hashes exatos; deve recusar sobreposição com edições remotas divergentes. Sua aplicação não é um passo de execução de SQL nem de ativação.

```sh
./node_modules/.bin/vitest run src/lib/n8n-bridge-confirmation.test.ts src/lib/n8n-bridge-confirmation.adapter.test.ts src/lib/n8n-bridge.test.ts src/lib/n8n-bridge.adapter.test.ts src/lib/n8n-bridge.escopo.test.ts src/lib/n8n-bridge-reply-resolve.test.ts src/lib/n8n-bridge-dnd.test.ts src/lib/n8n-bridge-reminders.test.ts
./node_modules/.bin/tsc --noEmit --pretty false
npm run build
```

### Aplicação no projeto original (Lovable) — 06/10/2026

- Pacote `package-19d5e22` (SHA256 do tar.gz conferido igual ao informado) aplicado sobre `50e417b`. Os hashes de base dos 22 arquivos coincidiram antes da edição (sem divergência). `git apply` não é permitido no ambiente; como todas as bases coincidiam, os 22 arquivos foram copiados byte a byte de `files/` e os 22 hashes finais conferem com o manifesto. Agente comercial e restantes alterações preservados.
- Gates no sandbox do projeto (teste local, não publicado): 290 testes/8 arquivos aprovados (comando acima); `tsgo --noEmit`, lint dos arquivos de código/teste alterados e build aprovados. O teste SQL `n8n-bridge-confirmation.db.test.ts` (9 testes) não correu aqui: falta `embedded-postgres`, que não foi instalado (sem alteração de dependências).
- Migração 0014 não reaplicada; nenhuma SQL, chave, flag, dado, mensagem ou workflow alterado. Flags esperadas inalteradas (`simulation=true`, `live_send_enabled=false`, `channel_verified=false`). Não publicado; sem verificação ponta a ponta.

## Validação publicada de 08/10/2026

Esta seção substitui somente os estados antigos de importação/publicação, preservando o histórico e distinguindo teste de entrega.

- Projeto original: `36345211-2616-42f7-bb9e-e78a9d00ca22`. Revisão Lovable lida às13:37UTC: `92084a3f19c640c74388023bb614cc34b054f663`. O diff contra `ee7f3463640c992f415a67130c8cbdcfb0e100f0` contém13arquivos do agente comercial, package.json e rotas; não modifica fontes da ponte n8n. Nenhum rollback dessas alterações foi feito.
- `GET https://jornada-ai-conecta.lovable.app/api/version`,13:37:18Z: `build=jornada-n8n-confirmation-20261006.1`, `api.n8n-bridge=3`, `release=null`. Marcador público verificado; SHA exato do binário continua não identificável pelo endpoint.
- Workflow original `WrDn82MwKBcuM73G`:74nós, `Buscar Consulta(s)` com `Must Match=Any Condition` confirmado na UI. Execução42 em08/10 13:38UTC:23cenários sintéticos com `test_passed=true`, incluindo duplicação, remarcação, DND e isolamento. Cobrem regras/prévia, não todos os nós do grafo.
- Revisão74 publicada em simulação; notas antigas corrigidas para registrar migração aplicada e backend publicado. Nenhuma credencial alterada.
- Relay GHL `0729fb26-e1b9-4ca6-b9de-0c3736c430b8`: antes, gatilho `Cliente respondido/SMS` tinha corpo salvo incorreto `WorkflowAppointmentSnapshot`. Corrigido para `{"type":"CustomerReplied","contactId":"{{contact.id}}"}`, salvamento reaberto e conferido; publicado. URLpreservada: `https://jfalcaoneto.app.n8n.cloud/webhook/falcao-agenda-v2-eventos`, BasicAuth existente preservada, sem valores expostos.
- Teste GHL com Felipe chegou na execução43 do n8n: receptor → `appointment.reply.resolve` autenticado →409 `confirmation_request_missing`. Comprova transporte/autenticação e recusa sem solicitação aceita; não é confirmação real. Respostas sem pedido ativo também chegaram e foram recusadas; o tratamento atual registra esse caso esperado como erro no nó `Conferir resposta resolvida`.
- Consulta de teste criada uma única vez após indicação do usuário: Felipe Santos,09/10/2026,11h–11h30 Europe/Lisbon, calendário `nPXR1Fyp0r3CpaMMGSki`, estado `new/Não confirmado`. ID `SVDrxaQxRcIvaTdsF42z`, contato `2jaCqBm8bWNTdZ6yZqtF`. UI e leitura autenticada na execução45 conferiram horário, IDs/location/calendário.
- Execução45 recebeu automaticamente a agenda, mas falhou em `Próximo Envio`: `$input.first()` é proibido no modo `Run Once for Each Item`, mesmo em ramo não executado. Correção mínima publicada: `const r=$json`, mantendo vínculo, geração e checagem de confirmação.21testes locais com validador oficial n8n reproduziram o erro e validaram o ajuste; única ocorrência incompatível entre28nós Code.
- Revisão n8n publicada identificável: `b2e1132a-50bc-403a-a855-1906958b9eaa`, “Corrigir item corrente em Próximo Envio — simulação 2026-10-08”. Replay46 da execução45 com workflow atual: **Succeeded**,2,16s,13:54:38UTC. Validação do caminho em simulação, sem envio real.
- Configuração backend revalidada por SELECT: `bridge_enabled=true`, `simulation=true`, `live_send_enabled=false`, `channel=whatsapp_zaptos`, `channel_verified=false`, responsável de reserva ausente. Ledger:0envios e0confirmações no instante da leitura. Configuração n8n mantém `simulation=true`, `concurrency_verified=false`, `sms_channel_verified=false`, `webhook_mapping_verified=false`; não foram marcadas como verificadas por conveniência.
- Bloqueio de identidade descoberto em leitura autenticada: mesmo telefone em dois cadastros, `2jaCqBm8bWNTdZ6yZqtF`(FelipeSantos,consulta) e `fCzYtbsUvclTHKGeHIrR`(semnome,conversaWhatsApp `6Imy7is8EI1QT88TX6RG`, inboundrecente com provedor `6770181745a2e55f83cab3eb`). Igualdade de telefone não autoriza fundir identidades. Pergunta ao usuário pendente; não houve merge, alias, troca de contato ou afrouxamento de igualdade no servidor.
- Candidato de concorrência separado:85nós com UPDATE condicionado para estado existente e uma releitura/recálculo;41testes locais aprovados, incluindo correção de runtime. Ainda não aplicado nem homologado no Cloud. Criação concorrente de linha ausente permanece fora da garantia; `concurrency_verified` não pode ser declarada globalmente concluída.

Evidências locais: `outputs/n8n-runtime-fix-2026-10-08/README.md`, `runtime-fix.test.cjs` e `outputs/n8n-projection-cas-2026-10-08/README.md`. URLs verificadas: app /api/version; workflow n8n original/execuções42,43,45,46; relay GHL e contato exato na locationautorizada.

**Estado:** código backend implementado/testado/publicado; revisão n8n corrigida e publicada em simulação; transporte e leituras autenticadas comprovados. **Ainda não verificado ponta a ponta:** canal para o cadastro canônico, pedido real aceito, SIM novo vinculado, confirmação persistida e entrega do agradecimento. Próximas ações dependem de resolver identidade e concluir os controles restantes; não reutilizar SIMs antigos nem o agendamento expirado07/10.

## Adendo — respostas sem pedido ativo, 08/10/2026

- Aplicados apenas os campos JavaScript de `Conferir resposta resolvida` e `Normalizar Evento Bruto`, preservando os 74 nós, a correção de `Próximo Envio`, autenticação e flags de simulação. O caso exato HTTP 409 com corpo `{"error":"confirmation_request_missing"}` passa a registrar `ignored` e seu motivo; o normalizador encerra com zero itens antes das Data Tables e do CRM. 401/403/5xx, outros 409 e dados inválidos continuam falhando.
- 54 testes locais aprovados no pacote `outputs/n8n-reply-ignore-2026-10-08`. Revisão publicada no n8n: `99b58d73-7077-4237-a87c-4a5ddd0c6e6e`, “Resposta sem pedido: ignorar com motivo — simulação 2026-10-08”.
- Execução 88, repetição da 43 com a versão atual a partir do nó com erro, em 08/10 às 15:53:56 UTC: **Succeeded**, 1,824 s. A árvore termina em `Normalizar Evento Bruto`, com **0 itens**. É uma validação do tratamento de uma resposta sem pedido aceito, não uma confirmação nem entrega de mensagem.
- URL verificada: https://jfalcaoneto.app.n8n.cloud/workflow/WrDn82MwKBcuM73G/executions/88 .
- O servidor atual não possui allowlist por contato/consulta para a ponte n8n: habilitar o envio real é uma configuração por organização/calendário. A allowlist do agente comercial é independente e não limita a ponte. Não foi criada exceção nem declarada concorrência verificada. Permanecem pendentes identidade do contato receptor, validação do canal, controle de concorrência e teste real completo.

## Guard de autorização de piloto da ponte n8n — integrado em 08/10/2026

- Pacote `jornada-pilot-guard-f90d8ed.tar.gz` (SHA256 `f3364cc7e0b73f89df8726f26f3f5996923b93eb8ddd6aa793c9094878a22c17`; manifest `1aec2cc7551a406c8c34cfc923bab1e96565febd462edd15acdab927f7909907`; base `19d5e22`, head do pacote `f90d8ed`). HEAD revalidado antes da integração: `2925ff25a6c3af509f768b164ca289629b2d8f89`.
- `verify_and_apply.py` sem `--apply`: hashes de artefatos e de base dos 18 arquivos conferiram (nenhuma divergência); o passo `git apply --check` não pôde correr porque o ambiente Lovable bloqueia `git apply`. Como todas as bases coincidiam, os 16 arquivos de código/teste/docs foram copiados dos bytes finais do pacote e conferem 16/16 com os hashes `after` do manifest.
- Migração 0015 (`n8n_bridge_pilot_grants`) aplicada pelo caminho normal de migrações antes do código, SQL idêntico ao do pacote. `drizzle/migrations/0015_n8n_bridge_pilot_grants.sql` e `meta/_journal.json` foram gerados pela ferramenta de migração; divergem do manifest apenas em `when` do journal e na quebra de linha final do SQL (divergência justificada).
- Banco confirmado após a migração: RLS ativa, 0 policies, 0 linhas; ACL `postgres` e `service_role` totais, sem `anon`/`authenticated` (role interno do sandbox com leitura/inserção da plataforma). Sem seed, sem grant de piloto criado.
- `/api/version`: capacidades existentes preservadas (`ad-navigator=1`, `n8n-bridge=3`); acrescentado apenas `capabilities.pilotAuthorization=1`.
- Gates locais: vitest (ponte n8n, confirmação e agente comercial, sem banco) 594 aprovados, exit 0; `tsgo --noEmit` exit 0; `bun run build` exit 0; `git diff --check` limpo. ESLint sem prettier: 1 erro preexistente no arquivo autogerado `previewAuthStorage.ts`; a regra prettier reporta erros de formatação em massa nos arquivos alterados (não corrigidos, fora do escopo). Testes PostgreSQL não executados aqui (sem banco descartável).
- Estado: implementado e testado localmente; **não publicado** e **não verificado ponta a ponta**. Sem grant, toda escrita real da ponte fica bloqueada. Operação manual supervisionada em série; `concurrency_verified=false`. Flags da ponte/simulação/canal, credenciais, GHL e agente comercial não foram alterados; nenhuma mensagem enviada.
- A consulta de teste já foi corrigida no GHL (nova `ofHr3ecQ1EDs4YQkvwgB` para o contato `fCzYtbsUvclTHKGeHIrR`; antiga `SVDrxaQxRcIvaTdsF42z` cancelada), mas o grant de piloto **não** foi configurado neste passo.

## Interface administrativa do piloto n8n — integrada em 08/10/2026

- Pacote incremental `jornada-pilot-ui-3b3a75f.tar.gz` (SHA256 `357cd1709705c2f6dcb612814e523692ecc70a75f2b8e01076694d34aa0c9f73`; manifest `393f0f60208184ebaa76f10dd578c4840f7e17495942107898d62274faa4cd6a`), 6 arquivos sobre `f90d8ed`. HEAD antes: `c83d7fbf04f769dc60c452895a056eac1e460266`.
- Hashes de base dos 6 arquivos conferiram (sem divergência, sem merge). `git apply` é bloqueado no ambiente Lovable; os bytes finais foram copiados e conferem 6/6 com o manifest. Depois, apenas a frase de ACL em `docs/n8n-pilot-authorization-v1.md` foi corrigida (hash final desse arquivo diverge do manifest por essa correção).
- Correção de ACL, verificada por SQL: `postgres`, `service_role` e o papel interno da plataforma `sandbox_exec` têm BYPASSRLS; `anon` e `authenticated` não herdam nenhum deles.
- Controle "Piloto de um agendamento" no cartão n8n existente em /integracoes usa `guardarPilotoN8n` com sessão administrativa; guarda/revoga o grant exato e mostra estado, hora da leitura e bloqueios. Sem SQL nova.
- Gates locais: vitest (ponte n8n, confirmação, controle do piloto, agente comercial, sem banco) 19 arquivos / 611 testes, exit 0; `tsgo` exit 0; build exit 0; `git diff --check` limpo; ESLint (incl. prettier) 0 erros nos 5 arquivos de código alterados.
- Estado: não publicado; tabela de grants vazia; nenhum grant, flag, chave, GHL ou envio alterado; `concurrency_verified=false`; sem prova ponta a ponta nem visual da sessão publicada.

## Diagnóstico de preferências DND do piloto — integrado em 08/10/2026

- Pacote `package-938b00d.tar.gz` (SHA256 `a46c01d32c7fc40ac2a4583137016b24213d39eb0ad8266e8fcee6ae0eabc9b3`; manifest `504b026ce175bebc79fdcefd2968a338f428fd86215fdc71ea483e94adc62312`; base `3b3a75f`, head `938b00d`), aplicado sobre `2cfa8499c9f54503fb465e5159b226d97be004b6`.
- 6 arquivos de código/teste com base conferida e hash final igual ao manifest. `docs/n8n-pilot-authorization-v1.md` divergia pela correção de ACL `sandbox_exec` já feita; essa correção foi preservada e só a nova seção "Diagnóstico de preferências" foi acrescentada (texto idêntico ao pacote).
- Efeito: `guardarPilotoN8n` devolve `contact_preferences_not_verified` quando a identidade exata é comprovada mas faltam/são inválidas as preferências DND, e `contact_not_verified` para identidade não comprovada. `parseContacto` continua a rejeitar `dndSettings` ausente; nada é normalizado para `{}` nem autorizado.
- Gates locais: vitest (ponte n8n, confirmação, controle do piloto, agente comercial, sem banco) 19 arquivos / 624 testes exit 0; `tsgo` exit 0; ESLint dos 6 arquivos alterados exit 0; build exit 0; `git diff --check` limpo. Sem SQL.
- Estado: guard e UI do piloto publicados anteriormente; este diagnóstico **ainda não publicado** até implantação comprovada. Nenhuma alteração GHL de DND foi feita; contato `fCzYtbsUvclTHKGeHIrR` continua sem `dndSettings`; preferência pendente de aprovação específica. Sem grant, flags, canal, n8n ou envios alterados.

## Adendo — diagnóstico publicado e verificado na UI, 08/10/2026

Evidências verificadas por Root nesta sessão; registro factual, sem nova execução de código, SQL, flags ou contatos.

- **Publicação comprovada.** A revisão do diagnóstico `bc297d49ea796a33050434bed2feb1ba1331249f` foi publicada: deployment `22bb1d56-2295-4431-b1de-a3f504331c0e`, solicitado às 16:49 UTC.
- **Verificação na UI.** Em sessão administrativa atual, `/integracoes` às 16:51 UTC retornou efetivamente o novo erro: "O contato foi localizado na subconta correta, mas o GHL não retornou preferências de bloqueio (DND) verificáveis. A autorização não foi guardada." Nenhuma autorização ativa.
- **Status do diagnóstico:** implementado, testado (624 testes), publicado e verificado na UI. O teste de mensagem **não** é ponta a ponta.
- **Publicação anterior do guard/UI** `2cfa8499`, deployment `4b56dbc7-02fe-4cb8-84df-448860619cb4`, comprovada por `/api/version` às 16:36:40Z com capability `pilotAuthorization 1` (build anterior preservado, `release=null`); UI observada às 16:37.
- **n8n — importação/exportação:** 79 nós, com parâmetros, nomes, webhook IDs, tabelas, credenciais e conexões preservados; IDs visuais regenerados e posições alteradas. 23/23 cenários sintéticos com sucesso em 32.053s.
- **n8n — publicação observada** versão `2fbeb139-8b5b-48d1-a604-70ed3f50528e` às 16:34Z; não foi possível atribuir quem a acionou.
- **Execução 102** às 16:47:02Z: `contact_not_verified` em "Conferir resposta" resolvida; parou antes do envio; a identidade do input não foi investigada.
- **GHL:** na UI, DND geral e SMS desmarcados; a API omite as preferências.
- **Contatos e consulta:** o usuário confirmou que ambos os contatos são seus. Consulta antiga `SVDr...` cancelada, `deleted=false`; nova `ofHr3ecQ1EDs4YQkvwgB` (ID correto, sem espaço), receptor `fCzYtbsUvclTHKGeHIrR`, 09/10/2026 11h Lisboa, estado `new`.
- **NÃO houve PUT de DND:** o auto-review rejeitou por falta de autorização específica; a pergunta continua pendente.
- **Último SELECT de grants:** 0 linhas.
- **Backend:** `simulation=true`, `live_send=false`, `channel_verified=false`; webhooks n8n simulados, modo manual desativado, `concurrency=false`.

## 08/10/2026 — piloto booking/req24 e correção de evidência de mensagem

- **DND:** autorização específica do usuário; SMS e WhatsApp `inactive` no contato `fCzYtbsUvclTHKGeHIrR`, persistido 17:34:33Z (GET posterior confirmou; DND global e outros canais intactos).
- **Grant temporário:** criado 17:35:59Z, revogado 17:52:28Z.
- **Execução n8n 105:** 17:44:18Z, 15.534s, `Succeeded`. Apenas `booking` aceito e `delivered` (messageId `zABSLArXccufjcEO5gyL`). `req24` recebeu HTTP 409 `reminder_evidence_invalid` às 17:44:34Z, sem reserva nem envio.
- **Causa:** GET individual GHL envelopado em `{ message, traceId }` e `TYPE_CUSTOM_SMS` (Zaptos, `type=20`, `source=api`) fora dos tipos aceitos. Ver `docs/n8n-message-evidence-2026-10-08.md`.
- **Correção:** implementada e testada localmente; **ainda não publicada**. Verificação somente leitura com a mensagem real: parser aceita (canal `sms`) e `validarLembrete("req24")` retornou `ok` com dependências reais em leitura, sem `processarBridge`, reserva ou envio.
- **Estado restaurado (não reativar):** backend `simulation=true`, `live_send_enabled=false`, `channel_verified=false`; n8n draft `manual=false`, rules/booking restaurados.
- **Retomada:** após publicação autorizada, conferir `/api/version` `capabilities.n8nMessageEvidence: 2`; reler ledger, estado n8n, grant e consulta antes de qualquer req24; não repetir o `booking` já aceito.

## 08/10/2026 18:27UTC — req24 entregue em piloto controlado e estado revertido

Adendo factual. Registro somente do que foi comprovado por leitura; nada aqui autoriza nova execução, SQL, flag, envio ou publicação.

- **Publicação comprovada.** Commit `3351825e7de235e746fdfccdd16019d561945849` (“Aplicou correção n8n-bridge”) implantado pelo deploy `25af71a7-400b-49f8-93bb-c852f19f207e`. `GET /api/version` público às 18:15:27.993Z retornou `capabilities.n8nMessageEvidence: 2`, confirmando a correção no ar.
- **Gates da correção.** Local: 467 testes em 13 suítes aprovados. Remoto: 464 aprovados, 23 ignorados; as duas suítes de base de dados **não** executaram (faltou `embedded-postgres`). TypeScript, lint e build com exit 0.
- **n8n — patch não publicado.** Root aplicou no **rascunho** do workflow original `WrDn82MwKBcuM73G` os campos de recuperação exata do `req24`, com 79 nós preservados; candidato com 172 testes e 23 cenários n8n. Esse patch n8n **não foi publicado**.
- **Execução do piloto.** Execução 110, observada na UI às 18:21:28Z: `Succeeded`, 14.579s, autosave `fc651d6e-6983-457a-a147-28fc18e8e644`. Um único `req24`, HTTP 200 com `status="accepted"`, `duplicate=false`, `delivered=false`, mensagem `XxdD584xGtbGTQ7HaIAd`; `GET` posterior confirmou `status="delivered"`.
- **Ledger (SQL).** Reserva 18:21:39.595199Z, conclusão 18:21:42.254334Z.
- **Recibo GHL.** `GET` autenticado (leitura desta tarefa) confirmou a mensagem `XxdD584xGtbGTQ7HaIAd` como `status="delivered"`, `dateAdded` 18:21:41.654Z; escopo de contato, location, conversa e provedor confere. O `booking` anterior `zABSLArXccufjcEO5gyL` permanece preservado. (`umsg_01m4ec03dbepbbnnv2836623vg` é o ID da consulta Lovable, não uma mensagem GHL.)
- **Consulta.** `ofHr3ecQ1EDs4YQkvwgB` continua `new`, 09/10/2026 11h Lisboa. Nesta leitura não houve resposta após o `req24` e há zero confirmações.
- **Reversão pelo Root, após a leitura acima.** Grant desativado 18:23:04.236073Z; backend `simulation=true`, `live_send_enabled=false`, `channel_verified=false`, com releitura independente confirmada. `bridge_enabled=true` inalterado.
- **Configuração n8n** salva e reaberta com as chaves exatas verificadas: `manual_pilot_enabled=false`, `manual_recover_req24=false`, `test_mode="rules"`, `manual_pilot_phase="booking"`, `simulation=true`, `concurrency_verified=false`, `webhook_mapping_verified=false`. Relay GHL existente preservado.
- **DND** SMS e WhatsApp `inactive` no contato final `7009` mantido.
- **Aguardando o usuário** responder `CONFIRMO` no WhatsApp.
- **Pendente:** confirmação da consulta e agradecimento. Timers e concorrência geral **não** homologados — **não marcar E2E como concluído**.

