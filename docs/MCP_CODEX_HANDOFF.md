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
4. Sessão de navegador ficou indisponível durante a retomada (timeout de transporte); isso limita validação pela interface e não comprova indisponibilidade dos apps.

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
