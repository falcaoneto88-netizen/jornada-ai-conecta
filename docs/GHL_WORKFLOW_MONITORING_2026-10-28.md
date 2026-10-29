# Monitoramento de workflows GHL — 28/10/2026

## Decisão

Ampliar a aba existente **Automações → Workflows GHL** com consulta de execuções por workflow, preservando o catálogo legado e os executores GHL/n8n. A primeira entrega é somente leitura, sob demanda de administrador ou gestor. Nenhuma publicação, pausa, criação, edição ou exclusão de workflow faz parte desta entrega. Nenhuma mensagem é enviada.

O anúncio de 28/10 introduz API Workflows v3 e ferramentas de workflow no LeadConnector MCP, ambas dependentes da habilitação do beta privado na subconta. A API do backend, o MCP LeadConnector e o plugin Jornada AI são integrações distintas. `list_automations` do Jornada continua consultando rascunhos locais e não deve ser usado como contagem de execuções GHL.

## Evidência remota inicial

- Projeto original: `36345211-2616-42f7-bb9e-e78a9d00ca22`.
- Revisão remota de partida: `4a437b4fd8e57d84c83babd13444fc6080c53121`.
- Organização e location foram conferidas por leitura do vínculo no servidor; o aplicativo deriva seu escopo da sessão, não destes valores documentais.
- Às **2026-10-29T00:36:44Z** (28/10 no fuso America/Bahia), diagnóstico de leitura executado pelo agente Lovable no projeto original retornou **HTTP 403**, código **`WORKFLOW_API_NOT_ENABLED_FOR_LOCATION`**, para `POST /workflows/search`. Esse POST é uma busca, não uma alteração.
- Token presente: sim, valor não registrado. Vínculo esperado: uma linha, conferido. Nenhuma contagem de workflows foi devolvida nessa chamada.
- Causa comprovada: **beta não habilitado para a subconta**. Não é evidência de que os novos scopes estejam presentes ou ausentes; esse ponto deve ser revalidado após liberação.
- Às **2026-10-29T00:38:06Z**, o catálogo legado retornou **HTTP 200: 25 workflows, 7 publicados e 18 rascunhos**, sem divergência de location. A página autenticada `/automacoes` também exibiu os 25 workflows nesta revisão. Essa leitura não comprova entrega de mensagens ou execução integral dos fluxos.
- Na mesma rodada, `GET /workflows/4e94283f-c2dc-463c-a52d-8513ace3c1cc/logs` com `Version: v3`, janela de sete dias e `limit=1` retornou **HTTP 401**, sem código específico e sem registros. O ID foi conferido no catálogo legado. **São dois resultados distintos:** busca v3 bloqueada pelo beta; logs v3 recusados por autenticação. Não atribuir o 401 a expiração, escopo ou tipo de token sem evidência adicional. Não substituir credenciais que continuam funcionando no catálogo.
- Não solicitar nova credencial por princípio. Usar a credencial existente no servidor caso tenha as permissões necessárias. Nunca colar tokens em chat, commits, arquivos de entrega ou logs.

## Contrato preservado

- API legado permanece com `Version: 2021-07-28` para contatos, agenda, mensagens e catálogo. Não mudar a constante global para `v3`.
- Transporte dedicado de monitoramento usa origem oficial, `Version: v3`, timeout e recusa de redirecionamentos. Não expõe método, URL ou path arbitrário ao navegador.
- `locationId` é **query parameter** nas rotas de logs e aggregate. Deve vir do binding validado no servidor.
- Endpoints de leitura: `GET /workflows/:workflowId/logs` e `GET /workflows/:workflowId/logs/aggregate`.
- Scopes a conferir após habilitação: `workflows.readonly` e `workflows.logs`. Os scopes de escrita, publicação e exclusão não são necessários para esta entrega.
- Logs: intervalo UTC explícito, no máximo 30 dias por consulta, retenção documentada de 60 dias. Paginação por `referenceId` e `referenceCreatedAt` mantendo os mesmos filtros e janela. A interface oferece 7 e 30 dias.
- Os logs cobrem execuções reais; testes do construtor não aparecem nessa API.
- Estados desconhecidos não são classificados como sucesso. `skipped` não é falha e `waiting` não prova bloqueio. Execução de etapa não comprova entrega de mensagem.
- Estatísticas contam registros de log, não pessoas únicas. Não calcular taxa de conclusão dividindo conclusões por inscrições de uma janela sem vinculação de coorte.
- Erros, payloads `meta`, definições com headers de webhooks, nomes e emails de contatos não devem sair no diagnóstico. A interface pode identificar o registro por ID e abrir a execução no GHL para inspeção detalhada autorizada.
- Não criar tabela de logs nem espelhar dados clínicos; esta fase usa leitura sob demanda e cache da sessão.

## Liberação externa indispensável

O administrador deve solicitar ao suporte GHL a habilitação da **Workflows API v3 / Workflows no LeadConnector MCP** para a subconta `ok2UHC2QMZsd8UHsAgEa`, citando `WORKFLOW_API_NOT_ENABLED_FOR_LOCATION`. Não é uma falha a corrigir desligando autenticação ou ampliando permissões de escrita.

Depois da liberação:

1. Repetir leitura autenticada no Jornada. Distinguir beta, permissão, autenticação, falha transitória e janela sem resultados.
2. Se houver recusa de scope, conferir somente as permissões de leitura necessárias pelo fluxo seguro do provedor.
3. Comparar um workflow e uma execução já existente com a tela GHL, por IDs, data e estado. Não disparar nova automação para fabricar evidência.
4. Validar paginação com janela fixa; não confundir contagem da página com total.
5. Confirmar que outro tenant não acessa logs desta location e que papéis sem permissão não acionam o transporte.
6. Somente então registrar **verificado de ponta a ponta** para logs e estatísticas.

## MCP separado

O catálogo de ferramentas disponível nesta sessão não contém as novas ferramentas LeadConnector de workflow. O MCP Jornada instalado não as incorpora automaticamente. Conectar o endpoint OAuth oficial requer autenticação/consentimento próprios e não desbloqueia o beta por si só. Esta entrega não altera a configuração MCP do computador.

## Fontes oficiais consultadas

- [API Workflows — introdução](https://marketplace.gohighlevel.com/docs/ghl/workflows/index.html)
- [Busca de workflows](https://marketplace.gohighlevel.com/docs/ghl/workflows/search-workflows/index.html)
- [Logs](https://marketplace.gohighlevel.com/docs/ghl/workflows/get-workflow-logs/)
- [Estatísticas](https://marketplace.gohighlevel.com/docs/ghl/workflows/get-workflow-log-statistics/)
- [Scopes](https://marketplace.gohighlevel.com/docs/Authorization/Scopes/index.html)
- [LeadConnector MCP](https://marketplace.gohighlevel.com/docs/other/mcp/index.html)

Resultados locais, revisão final e publicação devem ser registrados em `MCP_CODEX_HANDOFF.md`. O marcador de build indica disponibilidade do código, não habilitação do beta nem validação operacional dos logs.
