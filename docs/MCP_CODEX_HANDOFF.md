# Jornada AI — integração e handoff Codex

## 20/11/2026 — Continuidade da Izabel: diagnóstico e correção preparada

Este complemento prevalece sobre os estados históricos abaixo. Estado desta revisão: **implementado e testado localmente; aplicação, publicação e revalidação da nova política ainda pendentes de conferência**.

- Base remota conferida: `f42cb0f27aaeac31d85a9d0f84e7f40b1c39ce21`. Publicação anterior identificada: `4628fdad3fc5f621f725291ef7f1b87d2c667cf3`, 18/11/2026 00:27 UTC. `/api/version` é marcador estático com `release: null`, não prova o SHA do deploy.
- Leituras autenticadas no projeto original, organização e location já documentadas: automação habilitada, canais SMS/IG/FB, política V03 anterior consistente e observer avançando. Não se confirmou indisponibilidade geral de GHL ou do motor.
- A continuidade podia parar em dois pontos: guarda automática financeira classificava até a orientação neutra de orçamento em consulta como conflito; pausa persistente após encaminhamento/intervenção mantém novos eventos ignorados até retomada explícita. O código também usava `human_paused` para toda entrada numa sessão já pausada; esse código não comprova um clique humano.
- A fila escondia um encaminhamento pendente em Histórico quando nova entrada invalidava o rascunho. Migração aditiva `0031_commercial_agent_pending_handoffs.sql` / espelho Supabase `20261120180000_commercial_agent_pending_handoffs.sql` corrige só a projeção de leitura: encaminhamento sinalizado mais recente permanece em Com a equipe. Não revalida rascunhos, não retoma sessões, não reprocessa eventos, não altera acesso/RLS e preserva o limite de conteúdo de sete dias. Aplicar uma única variante.
- Provider automático passa a aceitar exclusivamente a orientação canônica de orçamento em consulta em PT/FR/EN, com fonte privada elegível `PRECO_INICIAL` ou `QUANTIDADE`. Preço de consulta, ofertas, pagamento, crédito, desconto, dose/diagnóstico e demais flags continuam exigindo equipe. Política supervisionada permanece intacta. A política automática muda de hash e exige revalidação pelo controle autenticado existente.
- Controle global inclui revalidação da nova versão, sem ampliar os canais previamente autorizados. Preserva compare-and-swap, papéis, verificação da biblioteca, pausas e corte para novas entradas; não recupera retroativamente clientes em espera.
- Loader privado conferido por leitura no Lovable: V03 íntegro, armazenamento privado, 30 registros, 25 elegíveis para texto automático; PRECO_INICIAL e QUANTIDADE presentes, approved_owner/commercial/guards vazios. Nenhum segredo nem texto privado foi incluído no patch.
- Foto operacional de 20/11 às 18:01 UTC: 625 sessões, 621 pausadas; **não equivale a 621 clientes esperando**. Pelo histórico local recebido, 49 tinham última entrada posterior à última saída, 350 última saída posterior/igual, 52 só entrada, 170 só saída. Não é reconciliação completa do CRM. Não houve retomada em massa.
- Na conversa indicada pelo usuário, uma resposta contextual foi enviada manualmente pelo Meu Chat às 18:03:51 UTC; leitura independente do GHL confirmou `delivered`, Instagram e mesma conversa. Não foi reenviada depois do timeout visual. Isso valida esse envio humano, não um novo turno automático da correção.
- Falha isolada `history_invalid` de 18/11 permanece separada desta causa: o log não registra o campo inválido; nenhuma alteração especulativa foi aplicada.

Validação local desta correção: 1026 testes de agente/Izabel/interface aprovados em 25 arquivos, build de produção aprovado; 28 testes SQL em PostgreSQL isolado aprovados (escopo, categoria, retenção e ausência de replay). Contagens sobrepostas não foram somadas. A revisão adicional encontrou e corrigiu preservação de canais na revalidação e guarda numérica fora do contexto financeiro; verificação final: 324 testes focados de provider/política aprovados, 44 de controle/interface aprovados, TypeScript sem erros e ESLint dos arquivos alterados aprovado.

Configurações existentes preservadas, sem valores: credenciais GHL, flags de escrita/automação, configuração do provider e armazenamento privado V03. Nenhum contato, oportunidade, calendário ou workflow GHL foi reconstruído. Próximo passo operacional: aplicar a migração de leitura, publicar o patch, revalidar versão para canais já autorizados, retomar apenas a conversa conferida e comprovar o próximo turno automático quando chegar nova mensagem legítima.

## RESUMO ATUAL — 17/11/2026 22:38 UTC: Izabel global PUBLICADA com automação DESLIGADA

- Publicação feita pelo Codex pela interface no projeto original; a revisão conferida antes do clique foi 2c7569fd654280245c4f966126141fbc6abc53cd. O Lovable confirmou "Seu site foi atualizado".
- GET público /api/version às 2026-11-17T22:38:43.215Z: build jornada-izabel-global-20261117.1; izabelGlobalAutomation=1; supervisionQueueRead=2; knowledgeVersion=V03; automaticScope=approved_owner_text_subset; automaticActivation=organization_opt_in_new_inbound_only; release=null (o endpoint não prova o SHA publicado).
- UI autenticada verificada após publicar em /agente-supervisionado e /caixa-de-entrada: Izabel automática desligada, botão "Ativar em todo o Meu Chat", supervisão com Histórico 230 e Ligação GHL validada. Ninguém clicou em ativar e não houve envio.
- O Codex reproduziu a revisão final 2c7569f num checkout isolado: tsc, build e 19/19 testes (inbox-review.test.ts e inbox-route.test.ts) passaram. Duas revisões técnicas independentes não encontraram bloqueio para publicar com a automação OFF. As contagens anteriores ficam como estão, sem somar suítes sobrepostas.
- Revisão final: types.ts regenerado pela plataforma (dispatch_origin: string) + validação estrita fail-closed em inbox-review.server.ts.
- Migrações 0029 e 0030 aplicadas uma única vez cada, variante Drizzle. O espelho Supabase da 0030 mantém begin/commit; a variante aplicada usa a transação da ferramenta. Não são iguais byte a byte.
- Estado: implementado ✔ · testado local e prévia ✔ · publicado com UI autenticada ✔ · E2E com paciente (envio, recibo, segunda resposta, intervenção e pausa) ✘.
- Cron não verificável pelo papel disponível; o cursor do observer foi visto a avançar. Emissores externos ainda precisam de conferência operacional. A identidade Zaptos final7009 continua pendente, com cadastros separados.
- Histórico anterior preservado abaixo.


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


## Adendo 08/10/2026 19:37 UTC — teste controlado: CONFIRMO, confirmação e agradecimento bloqueado

- **Resposta inbound** `ZNwzQKx7bvdufAyMemam` com texto `CONFIRMO` em `2026-10-08T19:09:59.664Z`; contacto `fCzYtbsUvclTHKGeHIrR`; consulta `ofHr3ecQ1EDs4YQkvwgB`, início `2026-10-09T10:00Z` (11h Lisboa).
- **Confirmação:** SQL `n8n_bridge_confirmations` `state=confirmed`, `finished_at=2026-10-08T19:18:34.043998Z`; GET GHL autenticado da consulta devolve `confirmed`. Os dois concordam.
- **Agradecimento (ACK):** nenhuma linha `confirm` reservada ou aceita até 19:36 UTC. Causa técnica correlacionada, comprovada em leitura: card de atividade GHL `1gd26SA1etNjw7eGN5o7` (`TYPE_ACTIVITY_APPOINTMENT`/31, `appointment_updated`, `activity.data.id` = consulta, timestamp = início) às `19:18:34.961Z` fez `validarAgradecimento` devolver `reply_superseded`.
- **Correção** restrita ao ACK integrada (ver `docs/n8n-acknowledgement-activity-2026-10-08.md`); **ainda não publicada**.
- **Estado:** flags backend OFF (`simulation=true`, `live_send_enabled=false`, `channel_verified=false`); grant revogado `2026-10-08T19:20:48.324613Z`.
- **Não verificados** (navegador indisponível): limpeza do rascunho n8n da fase manual reply e ID da execução n8n.
- **Não se afirma** E2E concluído nem envio do agradecimento.

## Adendo 08/10/2026 ~19:55 UTC — agradecimento: capacidade 1 ainda recusava; candidata 2 (não publicada)

- Capacidade 1 (revisão `0f056b9`) publicada no deployment `2ac2a1f4-7593-45f8-b871-8a390dd9ecf8`; GET público `/api/version` às 19:41:40.096Z mostrou `n8nAcknowledgementActivity: 1`. Mesmo assim, a leitura real de `validarAgradecimento` (somente leitura, mutações substituídas por throw) devolveu `reply_superseded` (409).
- Causa: a atividade `1gd26SA1etNjw7eGN5o7` traz em `activity.data` a chave `members` com valor objeto vazio `{}`, omitida pela primeira inspeção; a allowlist estrita da capacidade 1 recusava a chave. `members` não contém autor, participantes, status nem horário.
- Candidata 2 (patch SHA-256 `1c1525f5f238705db440c149419fd9629fd6ea01bc88cc96e5fac0d875631d62`, 4 arquivos, base `0f056b9`): aceita `members` só se for objeto simples estritamente vazio; qualquer outro tipo ou propriedade continua bloqueando. Marcador `n8nAcknowledgementActivity: 2`. Nenhuma outra guarda alargada.
- Resultado somente leitura com a candidata 2 (código executado no ambiente Lovable, não no publicado): `{ ok: true }`. Histórico completo 106 mensagens em 2 páginas; após o CONFIRMO só a atividade correlacionada (1); nenhuma mensagem nova bloqueante. Confirmação SQL `confirmed` concluída 19:18:34.043998Z; GET da consulta `confirmed`, início 10:00Z; req24 `XxdD584xGtbGTQ7HaIAd` `delivered`, escopo e fornecedor conferem. Nenhum PUT/POST/reserva/conclusão/envio.
- Testes: local (root) 544/13 suítes, tsc, lint, build. Remoto (Lovable): 541 passaram, 23 ignorados; 2 suítes de banco (`n8n-bridge-confirmation.db`, `n8n-bridge-pilot.db`) não executaram por falta de PostgreSQL — não contadas como aprovadas; tsgo 0 erros, ESLint 0 erros, build OK.
- Estado: grant desativado; `simulation=true`, `live_send_enabled=false`, `channel_verified=false`; ledger ACK 0. Capacidade 2 aguarda publicação pelo root após verificação do diff. Navegador inacessível; limpeza do rascunho manual reply no n8n pendente; nenhuma nova execução. Isto não é ACK entregue nem E2E concluído.

## Adendo 08/10/2026 19:55 UTC — capacidade 2 publicada e validada em leitura; ACK ainda não entregue

Registro factual do marco final desta etapa. Nada aqui autoriza novo envio, SQL, flag, grant, execução n8n ou publicação.

- **Publicação comprovada da capacidade 2.** Revisão de código `90824ef880cd4fea4de7ffad831431fd547baf03` implantada pelo deploy `b7f05038-13be-4970-a2c0-0223f8fcea91`. `GET` público a `https://jornada-ai-conecta.lovable.app/api/version` em `2026-10-08T19:55:20.384Z` retornou HTTP 200 com `build=jornada-n8n-confirmation-20261006.1`, `api.n8n-bridge=3`, `pilotAuthorization=1`, `n8nMessageEvidence=2`, `n8nAcknowledgementActivity=2`, `release=null`. O marcador publicado está comprovado; a rota não expõe o SHA.
- **Verificação prévia do delta.** Os quatro arquivos do delta foram conferidos exatamente, por leitura de ficheiro, contra a base local `876a55b8aa66473f8024947bafe689184935986a` antes de publicar.
- **Validação real em leitura, no candidato aprovado.** `validarAgradecimento` devolveu `{ ok: true }`. Histórico completo 106 mensagens em 2 páginas; depois do `CONFIRMO` apenas a atividade correlacionada; nenhuma mensagem nova bloqueante. **Isto não é envio nem ponta a ponta.**
- **Releitura SQL após a publicação:** `simulation=true`, `live_send_enabled=false`, `channel_verified=false`, `pilot_enabled=false`, contagem de ACK no ledger `0`.
- **Grant permanece revogado**, sem nova concessão.
- **Consulta** `ofHr3ecQ1EDs4YQkvwgB`, 09/10/2026 11h Lisboa, permanece `confirmed`. Não reenviar `booking` nem `req24`, nem novo `PUT`.
- **n8n:** navegador continua inacessível. O rascunho com `manual_pilot_enabled=true` e fase `reply` precisa de ser restaurado depois da inspeção; o ID da execução das 19:18 continua desconhecido.
- **Candidato n8n preparado SOMENTE LOCAL** (ack-only): 79 nós, nove blocos de `jsCode`, 264 testes mais revisão independente, hash `438a709198ec0670eccefd1b00816333ad5d539bf1084b4420a79bcb693ce2a4`. **Não** foi importado, aplicado nem publicado.
- **Próximo passo, só após recuperar o navegador:** ler execução, estado e histórico; repor o modo manual; comparar os `jsCode`; aplicar a retomada apenas se as pré-condições validarem. Grant futuro **apenas** `confirm`, na mesma tupla, SQL **sem** `claim`; executar uma vez, verificar aceitação e entrega, e desligar os controlos.
- **Pendentes:** agradecimento, limpeza do rascunho n8n, webhook, timers e concorrência geral.


## Adendo 10/10/2026 — áudio e imagens na Caixa de Entrada IA

### Escopo e contrato

- Projeto original `36345211-2616-42f7-bb9e-e78a9d00ca22`; base conferida `8ed6dfbf84c51a1392243037f380fdfac1cb06a6`. Implementação em branch isolada `codex/inbox-media-20261010`, sem substituir os checkouts existentes.
- A Caixa de Entrada real usava somente texto. Agora prepara **um anexo por mensagem até 5 MiB**, imagem JPEG/PNG/GIF ou áudio MP3/WAV/OGG/M4A/AAC, com texto opcional, prévia/reprodução/remoção e clique humano final. Gravações limitadas a dois minutos; MP4/WebM gravados são convertidos localmente em WAV mono 16kHz. Não se promete voice note nativa do WhatsApp.
- Caminho: Jornada → API GHL existente (`attachments: string[]`) → fornecedor SMS personalizado comprovado no servidor, incluindo o Zaptos configurado. Anexos não são habilitados para SMS nativo, IG, FB ou WhatsApp nativo nesta revisão. O envio textual existente continua.
- O backend deriva a clínica e valida ator, organização/location, contato/conversa, DND, janela, revisão do histórico e rota/default provider. Mantém reserva durável por requestId, envio único e bloqueio de resultado incerto. A mídia entra no hash do conteúdo e na verificação do recibo.
- Selecionar/gravar/ouvir não transmite o arquivo. Apenas o clique final envia os bytes ao backend autenticado. Não há uploads GHL públicos permanentes, nova credencial ou bucket. Os bytes reutilizam o payload AES-GCM do dispatch manual.
- O fornecedor recebe uma URL HMAC de dez minutos, vinculada a organização/pedido/despacho/índice/hash/expiração, no domínio original. GET/HEAD e ranges validam token, estado, vínculo da location e bytes antes de retornar. Nenhum URL arbitrário é recebido do cliente. Respostas usam no-store, nosniff, no-referrer e erro sanitizado.
- A URL temporária é uma credencial de leitura: quem a possuir pode ler dentro do prazo; GHL/Zaptos podem conservar sua cópia. **Dez minutos não é prazo de apagamento.** A retenção cifrada segue o ledger existente: purge de registros antigos depende do worker e não remove `sending/unknown`; não se afirma retenção máxima de sete dias. Access logs da hospedagem não foram auditados.
- POST de server functions limitado a 8 MiB antes do parse; webhooks e outras rotas não são interceptados. Validação de arquivo verifica tamanho, MIME e estrutura mínima, não substitui antivírus ou decodificação integral.
- Configurações reutilizadas, sem valores: `GHL_PRIVATE_TOKEN`, `GHL_LOCATION_ID`, `COMMERCIAL_AGENT_ENCRYPTION_KEY`, configurações existentes de envio manual e `n8n_bridge_settings.zaptos_provider_id`. Sem migração SQL, alterações de permissões, ativação de IA ou mudanças no n8n.

### Evidência atual e limites

- Inspeção Lovable somente leitura `umsg_01m4jyz39gepnrhbnb0mqc5ehk`, 10/10/2026: código base confirmado; GHL autenticado comprovou vínculo da organização/location, contato/conversa de teste e ZaptosWPP V2 como default e último fornecedor. Histórico continha seis anexos (MP3/JPG), recebidos e enviados. Isso não comprova entrega de mídia pela nova implementação.
- Banco consultado: `channel=whatsapp_zaptos`, `simulation=true`, `live_send_enabled=false`; nenhuma flag alterada. A conversa de teste estava fora da janela de 24h; bloqueio preservado. Nenhuma mensagem/upload/execução de automação foi feita nesta tarefa.
- `/api/version` anterior retornava `jornada-n8n-confirmation-20261006.1` e release nulo. Marcador estático antigo, sozinho, não identifica o SHA publicado nem prova ausência do código da inbox. A candidata acrescenta `inboxManualMedia:1` e build `jornada-inbox-media-20261010.1` para verificação posterior.
- UI de Chrome não pôde ser inspecionada: leituras de DOM e captura falharam. Testes de componentes não devem ser apresentados como homologação visual do navegador real.
- O histórico no app continua exibindo a contagem de anexos e o acesso pelo GHL; a prévia implementada é a do arquivo a enviar. A reprodução de anexos antigos dentro da Jornada é uma melhoria separada.
- Pendência de ponta a ponta: envio autorizado de uma imagem e um áudio sintéticos para contato próprio dentro da janela; comprovar download do link pelo Zaptos, recebimento, mídia reproduzível e status de entrega. Reconciliação exige URL exata e bloqueia se o fornecedor reescrever/re-hospedar o anexo. Limites efetivos do proxy de produção ainda precisam ser observados no teste controlado.

### Fontes de contrato consultadas

- [GHL send message](https://marketplace.gohighlevel.com/docs/2021-04-15/ghl/conversations/send-a-new-message/)
- [GHL upload](https://marketplace.gohighlevel.com/docs/2021-04-15/ghl/conversations/upload-file-attachments/) — opção segura descrita como exclusiva de email na data da consulta; não foi usada.
- [ProviderOutboundMessage](https://marketplace.gohighlevel.com/docs/webhook/ProviderOutboundMessage/)
- [Zaptos oficial](https://zaptoscompany.com/zaptoswpp/) — anuncia mídia, sem contrato público preciso de codecs/PTT encontrado.

Estado nesta revisão: **implementado localmente; gates e integração em andamento; publicação e entrega real ainda não verificadas**. Os resultados finais são registrados abaixo após a execução.

### Evidências da integração na prévia (10/10/2026, Lovable)

- Base conferida: HEAD `8ed6dfb` (= 8ed6dfbf84c51a1392243037f380fdfac1cb06a6), sem alterações locais. Pacote SHA256 `9ec9ffcc…886887` conferido.
- Manifesto: 21/21 hashes `before` coincidiram (11 novos ausentes); bytes de `files/` copiados sem adaptação; 21/21 hashes `after` coincidiram. Este parágrafo é a única alteração posterior (só neste documento).
- Nenhuma migração, SQL, credencial, flag, n8n, contato/DND, upload GHL ou mensagem real.
- Gates locais (exit codes reais): `tsgo --noEmit` 0; ESLint dos ficheiros do pacote 0 erros (2 avisos de fast refresh); build automático da prévia OK.
- Testes sem banco (8 ficheiros: inbox-media UI/servidor, media-http, server-function-body, ghl-inbox, manual-provider, inbox-send, inbox-route): 0 — 230 passaram.
- Testes de banco em PostgreSQL efémero local (nunca produção): manual-inbox.db + manual.db: 0 — 62 passaram (23 + 39).
- QA visual: harness Vite temporário isolado (fora da app, já removido) renderizando o `GhlInbox` real com respostas sintéticas; envio simulado nunca chamado (0 chamadas). Chromium headless, 1280 px e 390 px: sem rolagem lateral; anexar imagem → prévia → remover; gravar (microfone falso) → Parar/Cancelar visíveis → prévia de áudio; microfone recusado → aviso "Não foi possível acessar o microfone…".
- Não verificado: suíte completa, publicação, entrega real de mídia pelo Zaptos/GHL, E2E.

## Verificação pós-publicação — 10/10/2026 13:36 UTC (somente leitura)

- Revisão de código publicada: `06a70fc` (integração áudio/imagem; 20 ficheiros de código/testes byte-exatos ao manifest conforme coordenador; apenas docs divergem pela evidência).
- Deployment: `0385e5b1-1546-4555-a77a-6a3213f79370` (publicado pelo coordenador; não republicado).
- Prova de publicação limitada ao marcador público atual: `GET /api/version` → 200, `checked_at` 2026-10-10T13:36:05.478Z, `build` `jornada-inbox-media-20261010.1`, capabilities `pilotAuthorization:1`, `n8nMessageEvidence:2`, `n8nAcknowledgementActivity:2`, `inboxManualMedia:1`, `release` null. O marcador não comprova SHA.
- `GET /api/public/commercial-agent-media/00000000-0000-4000-8000-000000000000.png?index=0&token=invalid` (fixture inválida) → 404, corpo vazio.
- Acesso via ambiente Lovable normal, sem bypass de proteções; nenhum header/cookie registado.
- Resultados locais do coordenador: 1726 testes / 76 suítes passaram; 11 suítes (169 testes) não executadas (psql ENOENT: 9; embedded-postgres ausente: 2); lint global 3042 erros apenas em ficheiros não modificados; tsc/build/diff check passaram. Testes focados, DB efémero e QA visual conforme secção anterior.
- Pendente: recebimento real GHL/Zaptos de mídia. Nenhum envio real, server function, SQL, flag, contacto ou n8n alterado.


## 2026-10-12 — Experiência da Visão Geral e Caixa de Entrada IA

- Autorização: implementação da primeira etapa da revisão de experiência, no projeto original `36345211-2616-42f7-bb9e-e78a9d00ca22`. Base conferida `7af723df42b8d854e612fc5250e7c7177588e16b`, branch local isolada `codex/inbox-ux-20261012`.
- Visão Geral: agenda Hoje/Amanhã no fuso da clínica, até cinco marcações ativas por dia; estado local identificado. Confirmação em quantidade, sem atribuir resposta SIM. Indicadores explicitam importações/sincronizações, etapas vazias ficam recolhidas, metodologia expansível. Consultas existentes mantêm o escopo da organização e exclusão de demonstração.
- Caixa de Entrada: área limitada à altura da janela com rolagem independente, lista/conversa no celular, rascunho textual temporário por sessão/organização/contacto/conversa, filtros nas conversas já carregadas e assistência IA concentrada. Texto não é salvo em localStorage nem no banco; anexos não são preservados ao trocar de conversa.
- Invariantes: nenhuma mudança de backend de envio, credenciais, canais habilitados, DND, RLS, workflows ou automações. O ledger de envio incerto permanece separado dos rascunhos. O envio continua exigindo ação humana e revisão válida.
- Marcador candidato: `jornada-inbox-ux-20261012.1`, capacidades novas `inboxWorkspace:1` e `overviewAgenda:1`; capacidades anteriores preservadas.
- Testado localmente: 265 testes únicos em 12 suítes (52 inbox, 4 rascunhos/scroll, 24 media UI; 20 dashboard/queries/rotas; 135 inbox-send/inbox-route/manual-provider; 30 media backend/HTTP/body). TypeScript e build passaram; ESLint dos arquivos alterados sem erros, duas advertências preexistentes. Nenhuma suíte de banco exigida nesta mudança de interface; isso não revalida a migração ou o provedor externo.
- QA sintético em componentes reais via harness local separado: desktop 1415×1024, mobile 390×844 e 360×740; sem rolagem lateral, rodapé acessível com IA/detalhes abertos. Abertura no fim, texto preservado na alternância, filtro sem resultados mantém paginação, chegada de nova mensagem preserva leitura e invalida sugestão antiga. Revisão independente corrigiu corrida da correção textual após confirmação tardia e retorno móvel quando a conversa some/falha. Nenhum envio real ou chamada de IA real foi disparado.
- Implementado e testado localmente; integração/publicação ainda pendentes nesta revisão.
- Fora desta entrega: reprodução segura de anexos recebidos, atribuição/SLA/resolução de atendimentos, contagem global por filtro e ligação direta da agenda a uma conversa. Os contratos atuais não comprovam esses estados; nenhum indicador fictício foi introduzido.

## Integração UX inbox/visão geral — 12/10/2026 20:17 UTC

- Pacote revisão `438f6cf`, base `7af723d`. HEAD local `155ccc9` (descendente; só difere em `src/integrations/supabase/types.ts`, fora do pacote).
- Implementado: 13/13 `before_sha256` conferidos (2 novos ausentes) e 13/13 `after_sha256` conferidos após cópia exata. Este registo altera depois o hash deste documento.
- Testado: `tsgo --noEmit` 0; `vite build` 0; `git diff --check` 0; 12 suítes pedidas — 265 testes passaram (exit 0). Sem banco, IA real, envios ou harness na app.
- Publicação: pendente (coordenador).

## Verificação pós-publicação UX — 12/10/2026 20:19 UTC (somente leitura)

- Revisão local do pacote: `438f6cf89c4a664d2f1a7e6e4c6e5fee894308fa`; integrada em `7b9ef8a`. Deployment `7ab1bfe5-5e25-43ff-88a3-595d28c17c37` (coordenador; não republicado).
- Implementado: 13 ficheiros do manifest (12 código/teste coincidentes com origin/main conforme coordenador; docs só com appends). `types.ts` PostgrestVersion 14.5→14.17 preservado, fora do pacote.
- Testado: tsgo/build/diff-check 0; 12 suítes, 265 testes passaram.
- Publicado (marcador, 1.ª tentativa): `GET /api/version` → 200, `build` `jornada-inbox-ux-20261012.1`, capabilities `pilotAuthorization:1`, `n8nMessageEvidence:2`, `n8nAcknowledgementActivity:2`, `inboxManualMedia:1`, `inboxWorkspace:1`, `overviewAgenda:1`, `release` null, `checked_at` 2026-10-12T20:19:46.649Z. Com release null, o SHA publicado não é comprovado pelo marcador.
- Interface: abertura da inbox no navegador do coordenador é evidência separada; /api/version lá deu ERR_BLOCKED_BY_CLIENT.
- Emissão de mensagens: nenhuma mensagem real nem IA real disparada.

## Atendimento: contexto e rascunhos — 13/10/2026 (local)

Registro histórico: a pendência de fila/Meu dia e a lista de duas migrações desta seção foram superadas no código local pelo adendo “Meu dia e recuperação durável” abaixo. A evidência publicada continua separada.

- Base revalidada por fetch: `62736be971573df7c01f1554ffc3e37e67e9c343`; branch `codex/attendance-workspace-20261013`. Projeto original preservado. Revisão final do código: commit desta entrega; consultar histórico da branch.
- Implementado: contexto no desktop/painel móvel; responsável interno; retorno com prazo/conclusão/CAS e fuso revisado; rascunho privado cifrado e revisão por atendente; conflitos/recuperação/desfazer; remoção da data de retorno usada como consulta.
- Testado localmente: 122 testes integrados; 9 PostgreSQL de contexto com todas as migrações reais; 11 PostgreSQL de rascunhos; tsc/build/diff-check; lint sem erros (dois avisos antigos na inbox); QA sintético em 1440/390/360.
- URLs conferidas nesta etapa: prévia isolada `http://127.0.0.1:4184/caixa-de-entrada`; não representa o backend real. Repositório atualizado via fetch. Nenhuma verificação publicada nova foi feita nesta etapa; o registro publicado de 12/10 acima continua histórico.
- Configurações: reutiliza `COMMERCIAL_AGENT_ENCRYPTION_KEY` e autenticação/configuração Supabase/GHL existentes. Valores não lidos nem expostos nesta entrega; presença publicada não foi revalidada.
- MCP/catálogo, conexões Ad Navigator/BioReport, GHL externo e automações: não alterados nesta etapa.
- Migrações novas preparadas: `20261013100000_attendance_context.sql` e `20261013110000_attendance_drafts.sql`; aplicadas apenas nos testes locais efêmeros, não em produção.
- Publicado: NÃO. Verificado de ponta a ponta no ambiente publicado: NÃO. Nenhum envio real, ativação, alteração CRM ou publicação.
- Detalhes e pendências: `docs/ATTENDANCE_WORKSPACE_V1_2026-10-13.md`. Fila/Meu dia e indicador de atendimento simultâneo permanecem pendentes. Validade lógica de rascunho não equivale a expurgo físico agendado.

## Decisão de layout e lógica operacional — 13/10/2026

Registro histórico: a limitação de correlação de limpeza somente no navegador foi corrigida no incremento local descrito abaixo; este registro não é comprovação de implantação da correção.

- Base local analisada: `f13f8a7`, branch `codex/attendance-workspace-20261013`. Incremento de código: commit que contém este adendo, com quatro arquivos de inbox/controlador/testes; não houve push.
- Decisão: Meu dia pessoal → fila com motivo verificável → conversa dominante → próximo passo/contexto/assistência no mesmo espaço. Estado de atendimento, etapa comercial e consulta permanecem independentes. Modelo, fontes oficiais e sequência de implantação em `docs/JORNADA_AI_OPERATING_MODEL_2026-10-13.md`.
- Protótipo isolado em `../.attendance-concept-20261013/`, acessível durante a sessão em `http://127.0.0.1:4185/`. Dados fictícios em memória, nenhum backend/IA/envio. Navegação, filtros, retorno, responsável, rascunho e revisão observados em 1440/390/360; sem rolagem lateral em 1440/360; capturas no mesmo diretório. Não integrado ao app público.
- Corrigido localmente: envio confirmado + falha na limpeza do rascunho agora mantém pendência separada por usuário/org/contato/conversa/revisão; recuperação explícita faz leitura fresca e CAS sem reenviar. Revisões posteriores preservadas. Metadados do navegador só IDs/instante, sem texto ou hash.
- Limitação restante: a obrigação de limpeza ainda não é persistida no servidor; outro dispositivo ou limpeza do armazenamento local pode perder a correlação. Após reload o texto pode reaparecer com aviso e bloqueio de envio. Consolidar essa obrigação no servidor antes de disponibilizar rascunhos persistentes à equipe.
- Testado localmente: 134 testes em seis arquivos, TypeScript, build, diff-check; ESLint dos quatro arquivos sem erros, dois avisos antigos. Sem mudanças SQL nesta revisão; suites PostgreSQL anteriores não repetidas. Protótipo: sintaxe e 24 verificações sintéticas, mais verificação direcionada de contagens pessoais após ajuste.
- Revalidação publicada disponível de 13/10, 14:19 UTC: `https://jornada-ai-conecta.lovable.app/api/version` → build `jornada-inbox-ux-20261012.1`, `release:null`; SHA publicado não comprovado. Leitura do projeto original no Lovable indicou revisão editorial `62736be` e banco ativo; consulta por presença confirmou ausência dos campos/tabela/RPCs das novas migrações de atendimento. Código local não deve ser apresentado como publicado.
- Configurações: reutilizadas, sem leitura/exposição de valores ou alterações, `COMMERCIAL_AGENT_ENCRYPTION_KEY`, Supabase e GHL existentes. MCP/catálogo, credenciais, GHL, n8n, Ad Navigator e BioReport não alterados por esta entrega.
- Publicado: NÃO. Verificado de ponta a ponta em produção: NÃO. Nenhuma mensagem real, nova automação ou migração remota.

## Meu dia e recuperação durável — 13/10/2026 (implementação local)

### Revisão e implantação

- Projeto original preservado: `36345211-2616-42f7-bb9e-e78a9d00ca22`. Branch `codex/attendance-workspace-20261013`, base local do incremento `9e7f740`. O coordenador registrará o SHA final e os gates combinados depois do congelamento.
- Revisão editorial remota observada após a pré-verificação: `161c8998773a04e76edec4b5b64c04766c21fcef`, acrescentando registro em `.lovable/plan.md` sobre a base `62736be`. Preservar essa alteração na integração. Não equivale à integração do código local nem à prova de revisão publicada.
- **Implementado:** Meu dia/fila de retornos e consultas, abertura por IDs exatos, contexto administrativo e rascunho privado com recuperação de limpeza pelo ledger de envio. **Testado localmente:** suites dirigidas e banco efêmero; gates combinados finais a registrar pelo coordenador. **Publicado:** ainda não. **Verificado de ponta a ponta no publicado:** ainda não.
- Build candidato `jornada-attendance-workspace-20261013.1`, capacidades `attendanceContext:1`, `attendanceDrafts:1`, `attendanceDraftRecovery:1`, `attendanceDay:1`; capacidades anteriores mantidas. A verificação pública registrada às 14:19 UTC ainda mostrou `jornada-inbox-ux-20261012.1`, `release:null`. O candidato deve ser conferido depois da publicação; marcador sem SHA não identifica univocamente o commit.

### Contrato local de Meu dia e fila

- `src/lib/attendance-workspace.{core,server,functions}.ts` exporta `readAttendanceWorkspace` e `resolveAttendanceConversations`. A primeira deriva a organização do perfil da sessão e usa a RPC `attendance_workspace_read`, somente leitura e executável apenas por `service_role`, com revalidação de ator/organização/papel. Papéis de leitura existentes e filtros meus/todos/sem responsável são preservados, sem conceder escrita ao visualizador.
- Reutiliza `contacts.attendance_owner_id`, `next_action`, `next_action_at` e `appointments`; não cria tarefas paralelas nem muda GHL. Contagens são completas para o escopo local elegível e calculadas no mesmo snapshot da página de 25/50 itens. Contatos demonstrativos ou sem vínculo GHL válido ficam fora da cobertura declarada; nenhuma busca por nome substitui o vínculo.
- Critérios explícitos: retorno vencido = prazo anterior ao instante consultado; retornos de hoje = prazos dentro do dia civil da organização; consultas de hoje = agenda local vinculada, dentro desse dia e com estado ativo admitido. Retornos de hoje e vencidos podem se sobrepor; não somar os cartões. Horário passado de consulta não prova falta.
- `awaitingResponse:null` e `message_coverage_unavailable` representam a ausência de cobertura global de mensagens. Não se publica zero fictício, nem se converte não lido em resposta pendente. Responsável local não significa presença, exclusividade ou trava entre dois atendentes.
- `checkedAt` representa leitura do banco local; `lastContactSyncAt` representa sincronização de contatos. Consultas GHL são cache identificado como tal, sem alegar leitura de agenda ao vivo. Paginação mantém ordem definida por motivo/prazo/ID, mas dados podem mudar entre pedidos.
- A resolução de conversa, executada apenas após seleção, confirma contato/location por GET GHL autenticado e busca por `contactId` exato; limita-se a quatro páginas de 25 metadados. Só cobertura completa com total conferido permite concluir unicidade. Zero, múltiplas ou cobertura incompleta ficam explícitas; não cria conversa nem envia mensagem.

### Vínculo durável de rascunho e segurança de repetição

- `attendance_draft_bind_dispatch` vincula o texto privado à linha preparada do ledger manual antes do POST externo. Exige mesmo autor, organização, location, contato, conversa, requestId, revisão e hash calculado no servidor. Não há recibo informado pelo navegador como prova de envio.
- `attendance_draft_load_reconciled` usa `sent` com aprovação e `messageId` para limpar somente a revisão vinculada; uma nova revisão, mesmo com texto idêntico, é preservada. Recuperação funciona sem depender da correlação do dispositivo anterior. `sending`, `unknown`, rejeição ou recibo ausente não autorizam limpeza nem reenvio.
- `draft_binding_*` **não é tratado como certeza de não envio**: em concorrência outro pedido pode já ter avançado o mesmo dispatch. A intenção/requestId original é mantida para consulta do estado; não gerar nova chave nem repetir POST automaticamente. O bloqueio conservador também vale para falha da RPC/migração do vínculo.
- Retenção: validade lógica de sete dias, limpeza no acesso e função de expurgo existente. **Nenhum cron foi criado ou ativado**; rascunhos inativos podem reter ciphertext depois da validade sem manutenção. Não prometer eliminação física em sete dias. O vínculo no ledger não contém texto livre; anexos continuam fora da persistência de rascunho.

### Quatro migrações necessárias

Aplicar em ordem antes de disponibilizar o novo código; até esta anotação foram aplicadas somente em testes PostgreSQL efêmeros:

1. `20261013100000_attendance_context.sql` — responsável, versão, retorno e auditoria.
2. `20261013110000_attendance_drafts.sql` — rascunho privado cifrado, CAS e validade.
3. `20261013130000_attendance_draft_dispatch_recovery.sql` — vínculo ao dispatch e limpeza comprovada.
4. `20261013140000_attendance_workspace.sql` — RPC de leitura e índice da fila, sem tabela de tarefas.

Ausência de estrutura resulta em indisponibilidade explícita. Não há migração remota comprovada por testes locais.

### Pré-verificação publicada e configurações (sem valores)

Evidência de **13/10/2026 fornecida pelo coordenador**, obtida no projeto original; separada dos testes locais desta implementação:

| Verificação | Evidência | Limite |
|---|---|---|
| Configurações do servidor | Presença de `COMMERCIAL_AGENT_ENCRYPTION_KEY`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GHL_PRIVATE_TOKEN` e `GHL_LOCATION_ID`; chave de cifra validada como 32 bytes | Nenhum valor registrado; presença não comprova persistência nova ou entrega |
| Location GHL | GET autenticado retornou HTTP 200 e o ID esperado `ok2UHC2QMZsd8UHsAgEa`, conferido no contexto da organização `f07ab3be-7419-4779-a901-ef71c5fc27f0` | IDs servem à conferência; escopo operacional continua derivado da sessão e binding no servidor |
| Pipelines GHL | GET autenticado retornou HTTP 200 com seis pipelines | Comprova leitura, não escrita, mensagens ou execução de automações |
| Migrações de atendimento | Pré-verificação publicada anterior encontrou ausentes as estruturas locais novas | Aplicação remota e verificação posterior permanecem pendentes |

URLs/pontos de conferência: projeto original em `https://lovable.dev/projects/36345211-2616-42f7-bb9e-e78a9d00ca22`, revisão pública em `https://jornada-ai-conecta.lovable.app/api/version`, Meu dia em `https://jornada-ai-conecta.lovable.app/` e inbox em `https://jornada-ai-conecta.lovable.app/caixa-de-entrada`. Os dois últimos são destinos para validação após implantação, **não prova de que o incremento já está publicado**. Leituras GHL verificadas correspondem a `GET /locations/:locationId` e `GET /opportunities/pipelines` na API conectada, sem mutações.

### Testes e pendências

- Workspace/resolução: **19 testes locais dirigidos**, 11 de contrato e oito de PostgreSQL. Banco efêmero com a cadeia real de migrações, dados fictícios, mais de mil contatos, escopo, paginação, dias de 23/25 horas e leitura concorrente à conclusão de retorno. Não somar essas contagens aos gates combinados sem verificar sobreposição.
- Revisão independente somente leitura do vínculo/recuperação não encontrou defeito concreto de acesso entre usuários/tenants/locations, apagamento de revisão nova, duplicação de POST ou deadlock introduzido. Resultados de execução das suites de rascunho/ledger e gates finais serão registrados pelo coordenador.
- Pendente: integrar preservando a revisão remota, aplicar as quatro migrações, publicar, conferir marcador, autenticação real, contagens/fuso/escopo e persistência/recuperação entre dispositivos no ambiente publicado. Definir manutenção de expurgo físico; medir latência das leituras GHL de escopo.
- MCP/ferramentas, Ad Navigator, BioReport, n8n e configurações GHL não foram alterados; nenhum novo catálogo MCP foi exposto por estas server functions. Nenhuma mensagem real ou IA real, ativação, edição de workflow/CRM ou migração remota foi realizada por esta etapa local.

Detalhes da release local: `docs/ATTENDANCE_WORKSPACE_V1_2026-10-13.md`. Fila global de respostas, presença de atendentes e exclusividade continuam fora desta etapa.


Gates locais finais da candidata: 176 testes combinados; subconjunto inbox/contexto 82 revalidado após wireup; três testes do painel persistente (inclusive SSR/hidratação). PostgreSQL efêmero: 44 rascunhos/ledger, oito workspace e dez contexto. Contagens de subconjuntos se sobrepõem. `booked` alinhado, revisão privada transmitida no pedido, erros concorrentes preservam requestId, Meu dia invalidado após salvar contexto e atualizado a cada minuto. UI conferida em 360/390 e 1280/1440 com dados fictícios. Build/TypeScript passaram; lint dirigido sem erros após formatação, dois avisos Fast Refresh preexistentes. Publicação, revisão editorial e verificação autenticada serão registradas após implantação.

## Implantação atendimento (Meu dia/contexto/rascunhos) — publicada 13/10/2026

- Revisões: pacote `6c6343a`; editorial integrada `6d7874e` (44/44 `afterSha256` exatos conforme coordenador; extras só `.lovable/plan.md`, drizzle 0018–0021/meta/_journal e tipos gerados). Deployment `b26d373e-3322-49a3-91c8-94e2439759f1`.
- Migrações nativas efetivamente aplicadas no backend: `0018_attendance_context`, `0019_attendance_drafts`, `0020_attendance_draft_dispatch_recovery`, `0021_attendance_workspace` (SQL equivalente aos ficheiros `supabase/migrations/20261013{10,11,13,14}0000_*`, sem comentários/wrappers `begin`/`commit`). Ausência conferida antes; aplicadas uma vez.
- Segurança (read-only): 6 RPCs `security definer` só `service_role`; guard sem execução anon/auth; `attendance_drafts` RLS+FORCE, SELECT anon/auth=false. Binding GHL preservado; donos locais atribuídos 0.
- Marcador público: `GET /api/version` 200 (coordenador 19:57:37.255Z; reconferido 20:00:44.274Z), build `jornada-attendance-workspace-20261013.1`, `attendanceContext:1`, `attendanceDrafts:1`, `attendanceDraftRecovery:1`, `attendanceDay:1`, capacidades anteriores preservadas, `release:null` — não prova SHA.
- Evidência UI publicada (coordenador): Meu dia em Europe/Lisbon, "Meus" 0 itens, filtro "Sem responsável" com 1 consulta; abertura por ID exato do contacto de teste mostrou contexto real. Rascunho: texto administrativo fictício salvo como 1 payload cifrado v1 com TTL 7d, recuperado idêntico após reload, esvaziado → 0 payloads, 1 tombstone (payload/hash/expiry NULL). Guard de envio bloqueou janela >24h.
- Testes: execução Lovable 179 unitários/10 suítes passaram; 4 suítes DB (39) não executadas (PG_TEST_BINDIR ausente). Evidência DB local do coordenador: 62 testes, incluindo 23 regressões manual-inbox. Contagens sobrepostas não somadas.
- Não comprovado em produção: envio/entrega, recuperação pós-envio entre dispositivos (só local), expurgo agendado (nenhum cron). Nenhuma mensagem, mídia, IA, escrita GHL, dono/retorno real, workflow ou ativação.

## Workflows GHL v3 — preparação de monitoramento — 28/10/2026

- Base remota conferida: `4a437b4fd8e57d84c83babd13444fc6080c53121`, projeto original `36345211-2616-42f7-bb9e-e78a9d00ca22`; desenvolvimento isolado na branch `codex/workflow-monitor-20261028`. Checkouts anteriores preservados.
- **Implementado:** botão Consultar execuções na aba GHL de `/automacoes`, restrito a administrador/gestor; períodos 7/30 dias, janela UTC congelada na paginação, datas no fuso da clínica, link por execução, contagens por estado sem taxa indevida, falha distinta de ausência e de leitura parcial. Nenhum botão para editar/publicar/excluir/inscrever ou enviar mensagens.
- Backend dedicado v3, origem oficial fixa, somente GET, timeout 12s, limite de corpo 2 MB, sem redirect/retry automático; escopo sessão → organização → papel → binding → location/token; ID do workflow validado no catálogo legado antes dos logs. Projeção não devolve meta, definições, nomes/emails de contatos ou mensagens brutas de erro. Sem migração nem persistência de logs.
- **Testado localmente:** 76 testes em cinco arquivos passaram na execução final combinada (29 backend novos, 14 UI novos, 33 regressões de observação/acesso/autorização). `tsc --noEmit`, ESLint dirigido, `git diff --check` e `npm run build` passaram. Suíte global/DB não rodada nesta alteração sem SQL; não atribuir validação de banco ou entrega real a esses testes. Revisão independente de contrato/isolamento concluída e link por execução acrescentado conforme achado.
- **Leitura remota verificada:** em 29/10/2026 00:36:44Z (28/10 America/Bahia), busca v3 retornou 403 `WORKFLOW_API_NOT_ENABLED_FOR_LOCATION`; binding único conferido. Em 00:38:06Z, catálogo legado retornou 200/25 workflows (7 published, 18 draft) com location correta; logs v3 para um ID desse catálogo retornaram 401, sem código específico. A tela autenticada antiga também exibiu os 25 workflows. Não inferir scope ausente ou token global inválido a partir desses resultados.
- Configurações reutilizadas, sem expor valores: `GHL_PRIVATE_TOKEN`, `GHL_LOCATION_ID`; binding `ghl_location_bindings`. Permissões a conferir após liberação: `workflows.readonly`, `workflows.logs`.
- **MCP:** as ferramentas LeadConnector de workflows não estão disponíveis nesta sessão; MCP Jornada `list_automations` permanece local. Não foi instalada nem concedida nova conexão MCP.
- **Publicado:** confirmado abaixo; build `jornada-workflow-monitor-20261028.1`, capability `ghlWorkflowMonitoring:1`. Capabilities anteriores preservadas; o marcador não comprova beta habilitado.
- **Verificado de ponta a ponta:** sucesso de logs/paginação/agregação **pendente de liberação/autenticação no GHL**. Não ativar workflow para testar. Comparar registros existentes por ID depois da liberação.
- Referências, contratos, limitações e ação indispensável do suporte: `docs/GHL_WORKFLOW_MONITORING_2026-10-28.md`.

### Publicação e conferência autenticada — 29/10/2026 UTC (28/10 America/Bahia)

- Pacote local: `411fc80bb669eefe86ec2e502e601a6ca655d78e`. Revisão integrada/publicada: `ccaa75316a32c63af3c052956e47ebf8912a6e28`. 11/11 arquivos do manifesto conferidos por SHA-256 também pelo coordenador após `git fetch`; sem divergências.
- O GitHub recusou push da conta conectada (403); integração feita pelo Lovable original, sem alterar credenciais GitHub ou reescrever histórico. A branch local permanece preservada.
- O início da sessão Lovable gerou alterações automáticas adicionais em `package.json`, `bun.lock` (`@lovable.dev/vite-tanstack-config` 2.25.3 → 2.26.5) e `src/integrations/supabase/previewAuthStorage.ts`. Esses três arquivos não pertencem ao pacote de 11 arquivos. Foram comparados/revisados separadamente: permanecem os gates de hostname de preview, UUID, iframe e origem do editor; no domínio publicado a função continua retornando localStorage antes de configurar o broker. Não foi feita auditoria interna do pacote transitivo. As mudanças não devem ser omitidas da descrição da integração.
- Gates no Lovable sobre a revisão integrada: **76/76 testes**, TypeScript, ESLint dirigido e build aprovados. Mesmos testes do local, não somar como 152 casos distintos.
- Deployment: `e57dad0c-5287-404b-afe3-22fef8c198bb`. `GET https://jornada-ai-conecta.lovable.app/api/version` retornou HTTP 200, build `jornada-workflow-monitor-20261028.1`, capability `ghlWorkflowMonitoring:1`, às `2026-10-29T00:46:00.792Z`; capacidades antigas preservadas. `release:null` permanece: o marcador sozinho não prova SHA, a revisão acima é a selecionada no projeto antes do deploy.
- **Publicado e verificado na sessão autenticada:** `/automacoes` continua mostrando 25 workflows e ligação GHL validada; botão Consultar execuções disponível. Consulta ao workflow existente `4e94283f-c2dc-463c-a52d-8513ace3c1cc` abriu o painel com 7 dias, Europe/Lisbon, link correto e diagnóstico **Autenticação não aceita pela nova API**, coerente com a leitura v3 401. A interface não mostrou zero falso, não removeu o catálogo nem iniciou execução. Conferência visual desktop realizada; mobile não foi validado ao vivo nesta etapa.
- **Pendente externo:** habilitação do beta pelo GHL (`WORKFLOW_API_NOT_ENABLED_FOR_LOCATION` na busca), seguida de conferência de autenticação e scopes `workflows.readonly`/`workflows.logs`. Sucesso real de logs, paginação e agregação ainda não foi verificado. Nenhum fluxo foi ativado, pausado, editado ou testado com envio.

## Ponte n8n — produção delimitada e diagnóstico de contacto — 16/11/2026

- **Autorização vigente:** utilizador escolheu manter o canal atual do GHL, Zaptos/WhatsApp, e pediu operação real. Não há pedido para trocar credenciais ou provedor. Implementação no projeto original `36345211-2616-42f7-bb9e-e78a9d00ca22`, branch local `codex/n8n-production-ghl-2026-11-16`, base remota `206e6517ab0611abc22e43ae5061c76bdf95afad`; preserva a correção de recarga do router existente.
- **Implementado localmente:** política por organização `off/pilot/production`, CAS, auditoria transacional, revalidação de binding/configuração/política antes e depois da reserva. Produção permite somente `booking`, `req24` e `req12`. Confirmação/agradecimento após SIM permanecem no piloto: a exceção temporal de atividade técnica não foi homologada para concorrência. Nada altera `concurrency_verified` no n8n.
- **Correções comprovadas de código:** contacto/DND/telefone e compromisso do booking são relidos após reserva; alterações bloqueiam POST. Resolver separa identidade inválida de preferências DND malformadas. `contact_not_verified` informado para execução 1542 não tem causa/contato comprovados: ainda falta o `contactId` dessa execução. Mudar simulação não resolve uma falha que ocorre antes das flags de envio.
- **Banco:** candidata `0027_n8n_bridge_runtime_policy.sql`, sem semeadura/ativação. ACL revisada com revogação explícita de escrita direta inclusive para service_role; mudança somente por RPC administrativa. Semântica CAS/auditoria/revogação e isolamento exercitados em PostgreSQL temporário real. Aplicação no Lovable ainda não comprovada nesta anotação.
- **Gates locais:** 688 testes unitários/contrato/UI; 53 testes PostgreSQL em três suítes (runtime, confirmação, piloto). Subconjuntos dos agentes se sobrepõem e não devem ser somados. TypeScript, ESLint dirigido, build e diff-check passaram. A tentativa conjunta inicial encontrou restrição de socket e ausência de `initdb`/`psql`; as três suítes de runtime PostgreSQL foram reexecutadas com permissão de loopback e passaram. As duas suítes legadas `n8n-bridge.db.test.ts` e `n8n-bridge.credentials.db.test.ts` não foram executadas por ausência do cliente `psql`; suas migrações não foram alteradas. Não houve teste no banco real.
- **Publicado antes da entrega:** Lovable verificou `https://jornada-ai-conecta.lovable.app/api/version` às 12:40 UTC: `jornada-agenda-workspace-20261113.1`, `release:null`, n8n-bridge 3. Candidata nova `jornada-n8n-production-20261116.1`, `n8nRuntimePolicy:1`; não confundir marcador candidato com publicação. Leitura autenticada de `/integracoes` confirmou bridge ligada, simulação ligada, envio real desligado e canal não verificado, piloto inativo.
- **GHL verificado por leitura autenticada:** location `ok2UHC2QMZsd8UHsAgEa`, binding da org `f07ab3be-7419-4779-a901-ef71c5fc27f0`; SMS padrão aponta ao ZaptosWPP V2, provedor `6770181745a2e55f83cab3eb`. Workflow agenda `4e94283f-c2dc-463c-a52d-8513ace3c1cc` e resposta `0729fb26-e1b9-4ca6-b9de-0c3736c430b8` publicados, corpos mínimos conferidos na UI, sem alterações. Resposta de webhook HTTP 200/“Workflow was started” não prova conclusão do n8n ou entrega. Logs API retornaram `WORKFLOW_API_NOT_ENABLED_FOR_LOCATION`; não atribuir a token/scopes sem outra evidência.
- **Acessos:** conector GitHub autenticado como `falcaoneto318` recusou criar branch (403 Resource not accessible by integration). Push simulado via Git recusado para `Felpsmarcel` (403). Lovable MCP retornou erro interno, mas editor original acessível; integração será feita ali. Aba Chrome n8n consta no inventário, mas controle falha; nenhuma edição/publicação/retentativa de execução realizada nesta etapa.
- **Configurações, nomes sem valores:** `GHL_PRIVATE_TOKEN`, `GHL_LOCATION_ID`, `JORNADA_AI_ORGANIZATION_ID`, `N8N_JORNADA_BRIDGE_TOKEN` ou `n8n_bridge_credentials` existentes. Nenhuma chave criada/copiada. MCP/ferramentas, Ad Navigator, BioReport, contatos e DND não alterados.
- **Estados nesta anotação:** implementado e testado localmente; publicação e migração remota pendentes; ponta a ponta não verificada; nenhum envio real. Mesmo depois de publicar o controlo, ativação deve aguardar revalidação do workflow n8n e de sua leitura de `health.runtime` — não falsear o piloto/concorrência. Confirmação automática integral continua pendente de homologação específica.

Contrato, URLs e plano de retomada: `docs/n8n-runtime-policy-2026-11-16.md`. Registar abaixo a integração/publicação efetivamente observada, sem substituir estes resultados históricos.

### Complemento de revisão DND — 16/11/2026

- A leitura autenticada de um contacto de teste existente retornou preferências `sms`, `call` e `email` em minúsculas. A guarda antiga só examinava `SMS`/`WhatsApp`, um defeito concreto que podia ignorar `active/permanent` sob alias minúsculo. A publicação foi retida para corrigir esse caso.
- `dndPermite` agora avalia todos os aliases relevantes sem distinção de caixa, sem mesclar/sobrescrever campos: qualquer bloqueio prevalece em qualquer ordem. Ausência continua sem significar opt-in; identidade e preferências malformadas continuam recusadas. Testes incluem caixa mista, aliases contraditórios, bloqueio antes e depois da reserva e canais não relacionados.
- Gates finais do complemento: **727 testes/17 suítes** unitários/contrato/UI; build repetido e aprovado. Os 53 testes PostgreSQL anteriores continuam válidos pois SQL não mudou. TypeScript e lint do complemento passaram. Contagens substituem as 688 anteriores, não se somam.
- Integração intermediária `1426bf3b064547031c4583c9b5013f6e211b9b5c`: 25 arquivos de aplicação/documentação conferidos por SHA-256 contra candidata local `29ef177c49e10a8fe5eb9c235c756e7d31a6ec39`, sem extras; arquivos 0027/metadados ainda não presentes nessa revisão Git. O Lovable informou migração aplicada; ainda se aguarda conferência dos artefatos/ACLs e integração final do complemento. Nenhuma publicação ou ativação inferida do título automático do commit.

## Integração Lovable — política de runtime n8n + complemento DND (16/11/2026)

- Base no projeto original: `206e6517`; pacote principal (28 arquivos) + complemento DND (5 arquivos).
- Hashes: 27/29 caminhos únicos idênticos ao `after_sha256` (inclui `0027_n8n_bridge_runtime_policy.sql`, `06c88c15…`, e `n8n-bridge.core.ts`, `7d10d5fc…`).
  Diferenças oficiais da plataforma, semanticamente equivalentes: `_journal.json` idx 27 com `when=1794833741237` (real gravado pela ferramenta; candidato 1794834000000 não usado para evitar reexecução) e `0027_snapshot.json` com `id` 386c4836… (candidato 392896da…), restante igual.
- Arquivos adicionais alterados pela plataforma: `src/integrations/supabase/types.ts` (regenerado), `roadmap.md`. Commit automático intermediário `1426bf3` (mensagem "Corrigiu JWT validation flow") contém apenas arquivos do pacote.
- 0027 aplicada uma única vez pela ferramenta oficial (SQL igual ao do pacote, apenas a newline final retirada pela ferramenta e restaurada no repositório). Histórico `drizzle.__drizzle_migrations` não legível pelo papel de leitura (permission denied); aplicação não repetida.
- `n8n_bridge_runtime_policies`: RLS ativa, 0 políticas, 0 linhas; ACL `postgres=arwdDxtm`, `service_role=r`, `sandbox_exec=ar` (privilégio administrativo da plataforma observado); anon/authenticated sem privilégio.
- `n8n_bridge_set_runtime_policy`: SECURITY DEFINER, EXECUTE apenas postgres/service_role.
- Flags preservadas (org f07ab3be…): bridge_enabled=true, simulation=true, live_send_enabled=false, channel_verified=false; calendar nPXR1Fyp0r3CpaMMGSki, whatsapp_zaptos, provider 6770181745a2e55f83cab3eb. Produção não ativada.
- Gates no Lovable: 727/727 (17 suítes), tsc, ESLint dirigido, diff-check e build OK. Suítes PostgreSQL não executadas aqui (runtime ausente).
- Nenhum envio, reexecução de evento, edição GHL/n8n/contatos/DND.
- Publicado a partir de `6643bade`: GET https://jornada-ai-conecta.lovable.app/api/version em 2026-11-16T13:01:10Z → build `jornada-n8n-production-20261116.1`, `n8nRuntimePolicy:1`, `release:null` (ID de deployment não exposto). Flags relidas após publicação: simulation=true, live_send_enabled=false, channel_verified=false.

## Reply eligibility antes do DND — 16/11/2026 (build jornada-n8n-production-20261116.2)

- Pacote JORNADA_N8N_REPLY_ELIGIBILITY_2026-11-16 (base 7e038036): 3/3 arquivos com before_sha256 e after_sha256 conferidos (n8n-bridge-reply-resolve.ts e100c4ca…, .test.ts ff42e6cf…, api/version.ts f27ada39…). Recuperação de senha (7e03803) preservada sem alterações.
- Revisão integrada e publicada: 7c114be03f875ca2620777fe09ea0121830a3891.
- Gates no Lovable: vitest n8n 732/732 em 17 suítes; tsc, ESLint dos 3 arquivos, diff-check e vite build OK. Provas PG não executadas (runtime ausente).
- GET /api/version 2026-11-16T16:12:04Z: build jornada-n8n-production-20261116.2, n8nRuntimePolicy:1, n8n-bridge:3, release null.
- Flags relidas após publicar: simulation=true, live_send_enabled=false, channel_verified=false. 0027 não reaplicada; nenhuma migração nova.
- Nenhum workflow/envio executado; contas, organizações, credenciais e contatos inalterados. Jornada ainda NÃO declarada operacional (aguarda adaptação do workflow n8n).

## Confirmação estrita em produção — 16/11/2026 (build jornada-n8n-production-20261116.3)

- Pacote JORNADA_N8N_STRICT_CONFIRMATION_2026-11-16 (base 49b7b6c7): 17/17 before_sha256 conferidos; 14 arquivos de código/docs gravados com after_sha256 exato. 0028.sql com after_sha256 exato (a7a533b9…, newline final restaurada após a ferramenta).
- 0028 aplicada UMA vez via ferramenta oficial (journal idx 28, when 1794846035259 real; candidato 1794844800000 não usado). Snapshot 0028 id 203d62c4-21a4-47c7-a3fc-5f98f29fc449 (candidato d2dfc2d6…), prevId 386c4836-6fa6-4b13-9957-5d8fb2ff72fa igual ao pacote. 0027 (when 1794833741237, snapshot 386c4836) intocada.
- Pré-aplicação: n8n_bridge_runtime_policies_check só admitia booking/req24/req12; 0 linhas. Pós: substituída por n8n_bridge_runtime_production_check (+appointment.confirm, confirm); demais checks iguais; RLS ativa, 0 políticas, 0 linhas; ACL postgres=arwdDxtm/sandbox_exec=ar/service_role=r (sandbox_exec = privilégio administrativo da plataforma observado); função SECURITY DEFINER, EXECUTE só postgres/service_role. Histórico __drizzle_migrations não legível pelo papel de leitura.
- Gates no Lovable: vitest n8n 743/743 em 17 suítes; tsc OK; ESLint dos 13 TS/TSX alterados OK; diff-check OK; vite build OK. NÃO executados aqui: 41 provas PG (n8n-bridge-runtime.db.test.ts e confirmação DB; sem runtime PG).
- Revisões: código 0f41297, registos da migração 08e11081 (publicada). GET /api/version 2026-11-16T16:23:55Z: build jornada-n8n-production-20261116.3, n8nRuntimePolicy:1.
- Flags relidas após publicar: bridge_enabled=true, simulation=true, live_send_enabled=false, channel_verified=false; calendar nPXR1Fyp0r3CpaMMGSki, canal whatsapp_zaptos, provider 6770181745a2e55f83cab3eb inalterados. Nenhum workflow/envio executado; jornada ainda não operacional.

## Ativação de produção n8n — 16/11/2026 (registo documental; sem mudança de código/configuração)

Histórico anterior preservado: até 16:23:55Z (build .3) a produção estava DESLIGADA (simulation=true, live_send_enabled=false, channel_verified=false, 0 políticas).

Informado pelo Dr. João Falcão (não verificado por mim no n8n):
- Workflow ORIGINAL WrDn82MwKBcuM73G, versão 069eae82-daae-4f39-8f44-8c5bc9507b02, "Produção GHL — Jornada 2026-11-16"; 108 nós, 1 webhook, 1 manual; credenciais/webhookId preservados; IDs/posições regenerados, batchSize=1 default normalizado, ramo vazio removido (sem diferença semântica). SHA256 export adb3d0457c016b5c48390233704ea54dae69fae4a910e964d5af5674ec7d48b8.
- Teste sintético n8n 1615 às 16:27:05Z: succeeded, 23/23 cenários test_passed=true, sem efeito externo; 54 testes locais do candidato.
- Ativação em /integracoes após conferência GHL pelo servidor; UI relida mostra Modo Real / Envio Ligado.

Leitura do banco (SELECT, org f07ab3be-7419-4779-a901-ef71c5fc27f0), confirmada:
- n8n_bridge_runtime_policies (1 linha no total): mode=production, revision=1, allowed_kinds=[booking,req24,req12,appointment.confirm,confirm], location ok2UHC2QMZsd8UHsAgEa, calendar nPXR1Fyp0r3CpaMMGSki, canal whatsapp_zaptos, provider 6770181745a2e55f83cab3eb, verified_at 2026-11-16T16:29:06.768Z, updated_at 16:29:06.958498Z.
- n8n_bridge_settings: bridge_enabled=true, simulation=false, live_send_enabled=true, channel_verified=true, updated_at 16:29:06.958498Z.
- audit_logs: 1 evento n8n.runtime.policy.changed, 16:29:06.891222Z, verified=true, pilot→production, revision 0→1, live_send_enabled=true, simulation=false, mesmos kinds/location/calendar/canal/provider.

Estado: implementado ✔ · testado local ✔ · publicado ✔ (build .3) · produção configurada ✔ · **NÃO verificado ponta a ponta**: o teste real depende de uma consulta futura do contato autorizado; ainda não há comprovante de entrega nem de SIM após esta ativação.

Limites operacionais:
- Mudança de revisão da política invalida esperas/timers antigos (não retomam efeitos).
- ACK ambíguo vira pendência humana, sem efeito automático.
- Callbacks duplicados podem manter timers ativos no n8n, mas o ledger (claims únicos/idempotência) impede duplicação de efeito.
- Nenhuma execução antiga foi repetida; nenhuma mensagem enviada nem consulta criada por esta verificação.

## Izabel V03 — integração na prévia (17/11/2026, ~14:50 UTC)

- Base `738829628973348ed1f9b9db8b482d091dc277e4`; 26/26 arquivos conferidos (before_sha256 e after_sha256) e gravados exatos; recuperação de senha em `__root.tsx`/`reset-password.tsx` preservada (não faz parte do pacote). Sem migrações. Build preparado `jornada-izabel-v03-20261117.1` — **não publicado**.
- Configuração: `IZABEL_KNOWLEDGE_BUCKET=izabel-knowledge` gravada como segredo do servidor (sem credenciais novas).
- Storage: bucket `izabel-knowledge` privado (public=false) no mesmo backend do cliente administrativo; objeto `organizations/f07ab3be-…/locations/ok2UHC2QMZsd8UHsAgEa/izabel/V03/text-only-v1.json`, 21503 bytes. Vínculo persistido org f07ab3be ↔ location ok2UHC2QMZsd8UHsAgEa conferido (desde 08/09/2026).
- Loader real (prévia/sandbox): download privado OK, SHA256 3a376149… conferido, 30 registos elegíveis aceites pelo esquema. Biblioteca fora de src/public/commits/bundle (só path e hash no bundle do servidor).
- Gates: 743/743 (Izabel, izabel-reply, commercial-agent incl. providers-v03/lovable-provider/runtime-scope/observer/http/policy-staleness, painel e rota) + 748/748 regressões n8n/identidade; tsc, ESLint dirigido (0 erros, 1 aviso fast-refresh), diff-check e build OK. Suítes `*.db.test.ts` (incl. service.db) e PG **não executadas** (sem runtime).
- Respostas sintéticas Meu Chat (google/gemini-2.5-flash, sem paciente, sem envio, sem fila): FR dúvida sem fonte OK (sem inventar, alerta de confirmação); PT opt-out OK (handover, sem abordagem comercial); EN clínica individual OK numa execução. **Bloqueio:** PT consulta comercial e EN adiamento falharam (`erro_ia`) — `finish_reason=length`: ~957 de 1000 `max_tokens` consumidos por raciocínio, JSON truncado. Requer ajuste no pacote (ex.: limite maior ou raciocínio desligado) antes de publicar.
- Fila supervisionada (openai/gpt-5.4-mini, reasoning none): coberta só por testes unitários; sem geração real.
- Estado: local ✔ / prévia ✔ parcial (bloqueio acima) / publicado ✘. Autonomia não ativada.

### Izabel V03 — complemento de conclusão (17/11/2026 ~14:56 UTC, prévia, NÃO publicado)
- Pacote JORNADA_IZABEL_V03_COMPLETION_FIX: 3 arquivos (izabel-reply.server.ts, izabel-reply.core.ts, izabel-reply.test.ts) sobre base cb007b9; before/after sha256 conferidos e gravados exatos. Sem migração, GHL, n8n, flags ou autonomia. Recuperação de senha intacta.
- Mudança: max_tokens 1000→4096 (Meu Chat); finish_reason=length → erro_ia e qualquer outro ≠ stop → invalid_response, antes do parse, sem reparo/retry; unsafeReply só bloqueia `appointment|contact|location.` seguido de identificador (fim de frase inglesa deixa de ser falso positivo). Schema, timeout 30s, limites e guardas inalterados.
- Histórico preservado: na execução anterior PT consulta comercial e EN adiamento falharam com finish_reason=length (~957/1000 tokens em raciocínio).
- Gates: 334/334 testes (izabel-reply, knowledge-v03, providers, providers-v03, lovable-provider, runtime-scope, observer, http, policy-staleness); tsc, ESLint (3 arquivos), diff-check OK. Não executados: *.db.test.ts e provas PG (sem runtime PG).
- Casos sintéticos reais (snapshot sintético, loader privado real com escopo f07ab3be/ok2UHC2QMZsd8UHsAgEa; sem worker/eventos/persistência/envio). Meu Chat pediu google/gemini-2.5-flash; o gateway reportou google/gemini-3.8-flash. Fila: openai/gpt-5.4-mini (reportado gpt-5.4-mini).
  | Caso | Meu Chat | Fila |
  |---|---|---|
  | PT consulta comercial | ok, 200, stop, 7573/1172 (raciocínio 1058), 11,7s | ok, 200, completed, 6157/84, 1,3s |
  | FR dúvida sem fonte | ok, 200, stop, 7576/975 (869), 9,1s | ok, 200, completed, 6159/74, 1,6s, missing_policy |
  | EN adiamento | ok, 200, stop, 7572/1792 (1680), 16,1s, handover | ok, 200, completed, 6157/71, 1,2s, handoff |
  | PT opt-out | ok, 200, stop, 7572/471 (380), 4,7s, handover | ok, 200, completed, 6155/62, 1,4s, optOut+handoff |
  | EN clínica individual | ok, 200, stop, 7580/472 (349), 5,4s, handover, sem recomendação de tratamento | ok, 200, completed, 6165/85, 1,3s, clinical+urgent+handoff |
- Estado: implementado ✔ · testado local ✔ · prévia ✔ (10/10) · publicado ✘ (aguarda revisão independente).

### Izabel V03 — publicação (relato do Dr. João, 17/11/2026; registo documental)
- Verificação independente (relatada): origin/main dec898f7474c7a49dd9621416e8f8a2397166ae0 contém os 3 arquivos exatos do complemento; authfix 7388296 intacto. Build, tsc, ESLint e diff-check locais passaram; 156 testes do complemento.
- Publicação feita e conferida pelo Dr. João pela interface. GET público /api/version em 2026-11-17T14:58:31.539Z: build jornada-izabel-v03-20261117.1, izabel.knowledgeVersion=V03, scope=supervised_text_subset, fullProtocol=false, media=false, release=null. Como release=null, o SHA publicado NÃO é afirmado por este endpoint.
- Sessão autenticada em /agente-supervisionado: "Treinamento V03 · núcleo textual", revisão humana obrigatória e histórico de 230 itens preservado.
- Meu Chat, contato de teste autorizado: "Preparar resposta" continua desativado — a última mensagem recebida elegível é uma mensagem antiga do Instagram, com a janela encerrada. Nenhum rascunho novo foi preparado em produção e nada foi enviado.
- Os 10 testes sintéticos reais (5 Meu Chat + 5 fila) foram feitos na prévia e NÃO são E2E com paciente.
- Problema conhecido: o roteamento Zaptos continua à espera do fornecedor; os cadastros ficam separados, por decisão do utilizador.
- Configuração referida apenas pelo nome: IZABEL_KNOWLEDGE_BUCKET, LOVABLE_API_KEY (sem valores; nenhuma credencial nova).
- Estado: implementado ✔ · testado local/prévia ✔ · publicado ✔ (build jornada-izabel-v03-20261117.1) · **E2E com paciente PENDENTE**.

## 17/11/2026 — Ativação global da Izabel no Meu Chat (implementação local)

Pedido desta etapa: uma ativação para todo o chat, sem ligar a Izabel contato por contato. Foram preparados controle global autenticado, intervenção humana individual, política automática V03 separada, despacho e auditoria persistidos e fila compatível. O padrão permanece desligado. Não houve publicação, aplicação de migração remota, ativação, envio, alteração GHL/n8n/Zaptos ou mesclagem de contatos.

- Projeto original: `36345211-2616-42f7-bb9e-e78a9d00ca22`.
- Origem do incremento local: `fb19952b9a42d21ff30b3fa93220b99b51637944`. Candidata isolada para implantação baseada exatamente em `6dfb88e1728c88149e2d1ed9799b763118a9f4e8` (`origin/main`, conferido em 17/11). Os três arquivos `izabel-reply.*` já eram idênticos ao remoto e foram omitidos do pacote; recuperação de senha, roadmap e seções remotas deste handoff foram preservados.
- Esta candidata é um diff ainda não aplicado ao remoto. Se `main` avançar antes da aplicação, conferir novamente os hashes anteriores de todos os arquivos do pacote. O SHA da base não comprova o SHA publicado.
- Build preparado: `jornada-izabel-global-20261117.1`. Revisão publicada desta capacidade: **não verificada/não publicada por esta etapa**.
- URLs locais verificadas: `http://127.0.0.1:4203/` (componentes reais, APIs em memória e dados fictícios), ativação, pausa geral, assumir atendimento, Escape e retorno do foco; viewport 1280×720 sem rolagem horizontal. Verificação visual móvel não realizada.
- URLs de destino, não revalidadas como publicação deste incremento: `https://jornada-ai-conecta.lovable.app/caixa-de-entrada`, `/agente-supervisionado`, `/api/version`; editor original `https://lovable.dev/projects/36345211-2616-42f7-bb9e-e78a9d00ca22`.
- MCP/catálogo: não alterado; este recurso reutiliza funções autenticadas internas e o worker existente. Não cria ferramenta MCP de envio.

### Causa e correção

O recebimento geral já existia, mas o envio era exclusivamente supervisionado. Um simples botão visual não criaria autorização persistente nem evitaria duplicações. O novo controle grava versão, instante de início, política, canais e responsável no servidor; o worker revalida tudo antes de despachar. Aprovação humana não é falsificada: registros automáticos têm origem e autorização próprias e `approved_by` nulo.

O controle vale para novas mensagens elegíveis de toda a organização da sessão. Não reprocessa histórico, não retoma contatos assumidos/pausados e não ignora DND/recusa. Só textos comerciais `approved_owner` da biblioteca V03 entram na geração automática. Biblioteca local: 25 registros aptos a esta seleção e cinco apenas supervisionados. Não é autonomia clínica nem o motor completo V03.

A revisão também corrigiu: projeção que ocultava bloqueios automáticos no Histórico; tentativa de aprovar proposta automática como humana; reconciliação sem rota fixada; ausência do par de números no histórico WhatsApp nativo; eco de saída que chegava antes de gravar o recibo e pausava indevidamente a sessão. A observação desse eco aguarda brevemente a persistência e repete a leitura canônica, sem repetir o envio nem avançar o cursor antes da conclusão.

### Persistência, configuração e aplicação

Aplicar SQL `20261117160000_commercial_agent_global_automation.sql` antes de `20261117170000_commercial_agent_automation_queue.sql`, depois publicar o código. Drizzle 0029/0030 são espelhos: não executar em duplicidade. Migrações aditivas, RLS e RPC anterior preservados, automação desligada. Nenhuma configuração de produção foi alterada.

Nomes reutilizados, sem valores: `COMMERCIAL_AGENT_ENABLED`, `COMMERCIAL_AGENT_SEND_ENABLED`, `COMMERCIAL_AGENT_DISCOVERY_ENABLED`, `COMMERCIAL_AGENT_ENCRYPTION_KEY`, `COMMERCIAL_AGENT_WORKER_SECRET`, `COMMERCIAL_AGENT_AI_PROVIDER`, `COMMERCIAL_AGENT_MODEL`, `IZABEL_KNOWLEDGE_BUCKET`, `GHL_PRIVATE_TOKEN`, `GHL_LOCATION_ID`, `LOVABLE_API_KEY` ou `OPENAI_API_KEY`. Não foi criada chave. Estado do cron/cursor, segredo, canal, biblioteca e vínculos atuais deve ser confirmado no projeto original antes de ligar.

### Validação e pendências

Implementado: **sim, localmente**. Testado localmente: **sim**, testes com provedores falsos e PostgreSQL temporário isolado. Publicado: **não nesta etapa**. Verificado de ponta a ponta com pacientes/provedor/modelo real: **não**.

Regressão final: **1.148/1.148 testes em 36 arquivos aprovados**, com PostgreSQL nativo temporário e provedores falsos; `tsc --noEmit` aprovado. ESLint de 41 arquivos alterados: zero erros, três avisos Fast Refresh. O formato do arquivo gerado Supabase foi preservado; a regra Prettier acusa divergências e as demais regras passaram separadamente, sem declarar lint global verde. Build cliente/servidor aprovado; bibliotecas privadas não encontradas nos 44 arquivos públicos examinados por comparação de 14 trechos longos. Impeccable aplicado; detector dos sete arquivos UI retornou `[]`. As verificações numéricas finais constam no documento da entrega.

A operação externa ainda exige validação do worker e do canal, inventário de emissores concorrentes GHL/n8n/Zaptos e teste inequívoco de envio/recibo/segunda resposta/pausa. A decisão de não mesclar os cadastros final 7009 permanece; o teste Felipe Santos continua dependente do roteamento Zaptos já apontado. A publicação deste código não resolve por si só essa identidade externa.

Detalhes, limites, testes e aplicação: `docs/IZABEL_GLOBAL_AUTOMATION_2026-11-17.md`. Nenhuma chave, conteúdo privado da biblioteca ou registro de paciente foi incluído nos documentos.

## 17/11/2026 ~22:30 UTC — Izabel global (46 arquivos) integrada na prévia, NÃO publicada

Base 6dfb88e, hashes 46/46 OK. Migrações 0029 (when 1794954385800) e 0030 (when 1794954505405) aplicadas uma vez cada pela ferramenta oficial; 0027/0028 intocadas. Automação global OFF (version 0). Gates: tsc, build, ESLint dirigido, diff-check, vitest 1725/1725; PG *.db não executado no Lovable (9 arquivos / 234 testes; initdb indisponível). Correção: os 1148 testes locais em 36 arquivos incluem unitários/UI/PG, não são 1148 testes de banco. 5/5 sintéticos automáticos OK com handoff/opt-out. Detalhes em docs/IZABEL_GLOBAL_AUTOMATION_2026-11-17.md. Publicação pendente (Dr. João). E2E com paciente pendente; roteamento Zaptos pendente; sem mescla final7009.
- 17/11 ~22:38 UTC: 2 sintéticos positivos (saudação e localização) elegíveis no gerador, flags vazias, fontes approved_owner; cursor do observer 22:33 UTC. Não publicado.
- 17/11 ~22:45 UTC: a plataforma regenerou types.ts (dispatch_origin: string), quebrando o tsc; corrigido em inbox-review.server.ts com validação fail-closed dos dois valores permitidos (sem afrouxar guardas). tsc OK, 19/19 testes. Não publicado.

## 17/11/2026 Bahia / 18/11/2026 UTC — recebimento social da Izabel publicado; E2E pendente

Este complemento registra o estado posterior às etapas acima sem apagar seus limites históricos. Registro documental posterior à publicação de código, sem nova alteração de lógica, configuração ou efeito externo.

### Causas confirmadas e correção aplicada

- Organização conferida `f07ab3be-7419-4779-a901-ef71c5fc27f0`, location `ok2UHC2QMZsd8UHsAgEa`, projeto original `36345211-2616-42f7-bb9e-e78a9d00ca22`. Escopo continua derivado no servidor.
- Automação global versão 3 com SMS/IG/FB foi ativada em `2026-11-17T23:57:34Z`. Isso não comprovava ingresso social: o observador estava atualizado, mas a fila não recebia a mensagem do teste.
- O histórico canônico da conversa indicada explicitamente pelo usuário continha uma entrada Instagram às `2026-11-18T00:09:34.686Z`; a exportação escopada com janela não a continha. Sem datas, a exportação retornava somente registros antigos; retirar o canal não recuperou a entrada nova. A causa interna da divergência do GHL não foi determinada.
- Callback com `requestedContact` agora reutiliza a descoberta canônica de contato/conversa/histórico completo, com janela fixa `receive_since..now` e `observedAt` derivado do timestamp da mensagem. API antiga preservada. Cursor global nunca é avançado por callback de contato. O polling geral por exportação permanece inalterado; o relé é necessário para este caminho corrigido.
- Workflow GHL existente `28842f38-999d-44f2-a25d-c5460051045f` só despertava o backend com `Customer Replied`, canal SMS e tag `jornada-piloto-v02`. Foram acrescentados dois gatilhos `Customer Replied`, Instagram DM e Facebook Messenger, sem tag. Original SMS+tag preservado; três conexões para a mesma ação `bd1146da-f60f-49b6-b2a3-97aea080b736` POST `/api/public/commercial-agent-notification`. Header existente preservado sem divulgar valor; reentrada ON já existia. Salvar, recarregar e publicação ON foram conferidos. Nenhuma ação de envio foi adicionada ao workflow.

### Revisões, publicação e URLs

- Base local `82444c6e419ab42e23addb258947b5c09c3efb2b`; revisão remota integrada `4628fdad3fc5f621f725291ef7f1b87d2c667cf3`, exatamente quatro arquivos: `discovery.server.ts`, `observer.server.ts` e seus dois testes em `src/lib/commercial-agent/`. Equivalência remota conferida por Git blob SHA-1 idêntico ao conteúdo local dos quatro arquivos; patch SHA-256 `700b2d9b059189bc404069724aa5e493396d041a66908dd550e1bcadaea7520d`.
- Publicação confirmada pela interface “Seu site foi atualizado”, `published_at=2026-11-18T00:27:18Z` e `has_unpublished_changes=false` naquele instante; captura `outputs/IZABEL_SOCIAL_CHANNELS_VALIDATION_2026-11-17/lovable-callback-publicado.png` no workspace. `/api/version` ainda fornece o marcador estático `jornada-izabel-global-20261117.1` e `release:null`; esse endpoint não atesta o SHA executado. Posteriormente o Lovable editou o roadmap; a indicação de novas alterações não publicadas corresponde à documentação observada após o deploy.
- URLs conferidas pela tarefa coordenadora: editor original `https://lovable.dev/projects/36345211-2616-42f7-bb9e-e78a9d00ca22`, `https://jornada-ai-conecta.lovable.app/api/version`, tela autenticada `/agente-supervisionado`, workflow `https://app.gohighlevel.com/v2/location/ok2UHC2QMZsd8UHsAgEa/automation/workflow/28842f38-999d-44f2-a25d-c5460051045f` e a conversa própria fornecida pelo usuário. Após recarregar, os três gatilhos e suas três conexões foram conferidos; filtros reabertos individualmente: “DM do Instagram”, “Facebook Messenger” e SMS+tag do piloto. Capturas GHL: `ghl-tres-gatilhos-publicados.png`, `ghl-instagram-filtro-publicado.png`, `ghl-messenger-filtro-publicado.png` na mesma pasta de evidências.
- Evidência de identidade do teste, apenas do próprio usuário: contato `81nlEHjA6GFbx1u6GeLd`, conversa `mEESQVZLG30YCndZY9Jk`, mensagem `CcWkRDHBpkIah0Rq2ROt`. Não foram abertas conversas gerais para contornar a falta de identidade; a leitura só prosseguiu após o link exato.

### Testes e limites

- Local: **335/335 testes dirigidos**, sendo 246 de descoberta/observação e 89 de integração PostgreSQL/HTTP/escopo. TypeScript, ESLint dos quatro arquivos e build aprovados. PostgreSQL temporário isolado, HTTP simulado, sem envio real.
- Lovable: **246/246 testes de descoberta/observação aprovados**. Não afirmar que as provas PostgreSQL foram executadas remotamente nem somar essa contagem à local.
- A suíte completa local, sem preparar os runtimes PostgreSQL, **não ficou verde**: 29 arquivos falharam; 110 passaram e dois foram pulados; 2.665 testes passaram, um falhou por timeout e 541 foram pulados. Das 28 suítes que falharam na inicialização, 27 dependiam do caminho/runtime PostgreSQL e uma do mock `createMiddleware` ausente.
- Comparação isolada com a base exata e mesmas dependências confirmou o mock de `src/routes/-agente-supervisionado.test.tsx:20` já defeituoso. `src/components/ghl-inbox.test.tsx` passou 82/82 tanto na base quanto na candidata; timeout de imagem não reproduzido isoladamente, causa não estabelecida. Nenhum desses arquivos foi alterado pelo patch.
- Casos cobertos pelo patch: exportação vazia com histórico novo, IG/FB, escopo, duplicação, conflitos, corte temporal, ordem, futuro, paginação, recibo pendente e cursor global. Pausa humana, DND, opt-out, janela social, canais permitidos e recibos continuam sendo revalidados. Não há retomada automática de sessão pausada.

Nomes preservados, sem valores secretos: `COMMERCIAL_AGENT_ENABLED`, `COMMERCIAL_AGENT_SEND_ENABLED`, `COMMERCIAL_AGENT_DISCOVERY_ENABLED`, `COMMERCIAL_AGENT_WORKER_SECRET`, `COMMERCIAL_AGENT_ENCRYPTION_KEY`, `COMMERCIAL_AGENT_AI_PROVIDER`, `COMMERCIAL_AGENT_MODEL`, `IZABEL_KNOWLEDGE_BUCKET`, `GHL_PRIVATE_TOKEN`, `GHL_LOCATION_ID`, `GHL_WEBHOOK_SECRET`; campos persistidos `allowed_channels`, `automation_channels`, `automation_enabled`, `automation_version`, `receive_since`. Nenhuma credencial foi criada, copiada ou substituída. Catálogo MCP inalterado, sem ferramenta nova de envio; SMS/Zaptos e rotas nativas IG/FB preservados.

**Estado:** implementado ✔ · testado localmente ✔ · publicado pela interface ✔ · **verificado de ponta a ponta ✘, aguardando teste novo do usuário**, solicitado às 21:30 da Bahia. Na última leitura, a entrada própria mais recente continuava sendo a de `00:09:34Z`, anterior à publicação. Não houve replay de evento antigo, envio manual, alteração de cadastro/mesclagem, remoção de tag ou relaxamento de RLS nesta correção. Confirmar entrada nova, execução do relé, proposta, envio e recibo/entrega individualmente no Instagram e no Messenger antes de declarar os dois canais operacionais.

Relatório completo local: `outputs/IZABEL_SOCIAL_CHANNELS_VALIDATION_2026-11-17/CORRECAO_RECEBIMENTO_SOCIAL.md` no workspace, com hashes, comandos, capturas e limites. Este complemento e o relatório são documentação posterior à publicação de quatro arquivos; não fazem parte do commit de código remoto acima.

## 18/11/2026 00:45 UTC — Instagram validado com resposta automática entregue; Messenger pendente

Complemento exclusivamente documental posterior às etapas anteriores. Nenhuma alteração de código, banco, configuração, variável de ambiente ou envio; nenhuma nova publicação nesta etapa.

### Fatos conferidos neste teste

- Teste próprio do usuário, identidade fornecida explicitamente: contato `81nlEHjA6GFbx1u6GeLd`, conversa `mEESQVZLG30YCndZY9Jk`, location `ok2UHC2QMZsd8UHsAgEa`, organização `f07ab3be-7419-4779-a901-ef71c5fc27f0`.
- Entrada Instagram `4pNdi11ajgptmLfcsG0E` recebida em `2026-11-18T00:41:30.027Z`, depois do corte da automação versão 3.
- Relé GHL executado às `00:41:35Z` com HTTP 202: `status=observed`, `discovered=2`, `accepted=2`, `duplicates=0`.
- Fila `dcdde8f4-c853-41e5-8ce8-1c937612459d` processada; rascunho `b18725c7-6f59-412e-b9b5-c830f7cb4af4` em `sent`, origem automática, sem flags de bloqueio.
- Despacho `8f7c642f-6480-489a-b287-965731530335`; mensagem de resultado `bbmHHB1MUrQYduVFfXTh` gravada às `00:42:06.320Z`.
- `GET` autenticado da mensagem, feito pelo coordenador, confirmou `status=delivered`, `TYPE_INSTAGRAM`, mesmo contato, conversa e location. A diferença entre entrada e resposta foi de `36,293s`; esse número **não** é medida de leitura no aparelho do usuário.
- Referência de política persistida `374e230aa879c3a24d6259f9ca80e652cd5ecaef6c44ebcbfa72714b7a6db22a`, igual à das configurações da organização e à política automática V03 publicada. `automation_version=3` é só a terceira ativação da automação e não comprova sozinho a versão do treinamento.
- Exatamente um rascunho e um despacho para este evento; nenhum envio manual, nenhuma pausa, nenhum opt-out.
- `state=ready` com `lease_until` residual na fila é estado final normal segundo o SQL do worker, não tarefa pendente: não reprocessar nem reinjetar o evento.

### Estado validado e limites

- Instagram: fluxo de ponta a ponta de uma saudação **entregue** validado neste teste, com aceite do GHL e `delivered` confirmado por leitura autenticada.
- Confirmação humana de recebimento no aparelho foi solicitada e ainda não devolvida. Continuidade de conversa e agendamento completo não foram testados.
- Messenger continua pendente: exige nova mensagem própria e conversa identificada.
- Ambiguidade visual registrada, sem correção nesta etapa: a interface da Jornada ainda mostra um aviso genérico de revisão manual junto do histórico já enviado, o que pode sugerir pendência onde não há.
- Nenhum dado clínico, segredo, valor de credencial ou texto privado de biblioteca foi copiado para este documento.

Relatório local: `outputs/IZABEL_SOCIAL_CHANNELS_VALIDATION_2026-11-17/INSTAGRAM_E2E_ENTREGUE_2026-11-17.md` no workspace.
