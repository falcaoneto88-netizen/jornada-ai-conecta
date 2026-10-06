# Agente comercial V02 — homologação na Jornada AI

Estado em 06/10/2026: código e seleção do provedor publicados na Jornada AI, configuração desligada, listas de homologação vazias e nenhum cron instalado. Uma chamada real de IA com dados fictícios passou; a página abre autenticada, mas mostra que o serviço aguarda configuração segura. O usuário deseja o SMS do CRM com entrega pelo WhatsApp existente. A interface confirmou “ZaptosWPP V2 - WhatsAPP like SMS” como provedor predefinido; não é necessário contratar SMS de operadora nem trocar o canal solicitado. Os três segredos próprios aguardam cadastro pelo usuário; webhook/worker, fila e fluxo real continuam pendentes. Nenhuma mensagem enviada. O registro atualizado e os identificadores da publicação estão em `IMPLANTACAO.md`.

## Alternativa com a credencial já usada pelo Jev

Adaptação publicada e selecionada em 06/10/2026: `COMMERCIAL_AGENT_AI_PROVIDER=lovable` e `COMMERCIAL_AGENT_MODEL=openai/gpt-5.4-mini` geram rascunhos via Responses no gateway Lovable. O serviço lê `LOVABLE_API_KEY` apenas no servidor. Não substituir `OPENAI_API_KEY` pelo valor da chave Lovable: são credenciais de destinos diferentes. Esse caminho dispensa uma chave OpenAI separada, mas continua exigindo os três segredos próprios do agente, webhook/worker e homologação supervisionada.

O padrão sem configuração continua `openai`, com `gpt-4.1-mini` e `OPENAI_API_KEY`. Não há fallback automático. Modelo ou provedor não suportado, autenticação recusada, ausência de saldo e resposta inválida impedem a criação do rascunho. Os testes locais usam credenciais fictícias e não comprovam autenticação externa. Antes de ativar: validar no ambiente hospedado uma mensagem fictícia, o JSON estrito, o saldo/custo do modelo e os termos de retenção do gateway. `store:false` não comprova retenção zero pelo intermediário.

Os custos abaixo usam como referência a tabela do GPT-5.4 Mini; a cobrança efetiva do gateway usa os créditos Lovable e precisa ser conferida no workspace. O modelo e o caminho de integração aparecem no identificador salvo com cada rascunho (`openai/gpt-5.4-mini` no gateway).

## Onde ficará hospedado

A implementação integra o repositório existente `falcaoneto88-netizen/jornada-ai-conecta`, na branch `codex/agente-supervisionado-v02`, sobre `4782bba9388edb229e4a80086ad1df87b19b30f3`. Nenhum novo provedor foi contratado.

Projeto [Jornada AI no Lovable](https://lovable.dev/projects/36345211-2616-42f7-bb9e-e78a9d00ca22). Código instalado na aplicação atual `https://jornada-ai-conecta.lovable.app`, com interface `/agente-supervisionado`, rotas de servidor TanStack/Nitro e o Supabase já vinculado; atendimento ainda desligado. A região e a residência dos dados seguem a configuração atual do projeto; não foram alteradas nem confirmadas nesta implementação.

O processador é acionado por `pg_cron` + `pg_net`; não depende de aba de ChatGPT, navegador aberto ou computador local após implantação. O Supabase existente apresentou `pg_cron`, `pg_net` e `supabase_vault` em consulta somente de leitura. `scripts/commercial-agent-scheduler.sql` prepara um job **inativo** de 1 minuto, com URL/segredo recuperados do Vault. Não foi executado. Validar duração máxima de requisição do ambiente hospedado antes de habilitar o job; histórico extenso pode exigir reduzir o lote ou mudar a execução para um worker do mesmo provedor. Falhas expiram por lease e até três tentativas de geração; envios jamais são repetidos automaticamente.

O transporte solicitado permanece `type:"SMS"` no payload HighLevel, com entrega prevista pelo ZaptosWPP predefinido; não converter esse campo para `WhatsApp`. WhatsApp QR e o MultiAtendimento externo Zaptos embutido mostraram a instância #428, João Falcao / 351926991096, conectada, e Luciana #1861 desconectada. Atendentes listou o ADMIN “joao matos neto” nos dois canais. Atribuição exclusiva estava desligada, sem regras, e a verificação de preparação informou “O serviço de atendimento está indisponível”. Esse módulo não é o atendimento nativo do HighLevel. Sincronização de regras, repasse humano e entrega real ainda exigem homologação; nenhum fornecedor ou configuração de atendimento foi alterado nessa inspeção.

## Fluxo implementado

1. Webhook recebe JSON com `type`, `locationId`, `contactId`, `conversationId` e `messageId`. Verifica assinatura Ed25519 do Marketplace, ou segredo dedicado de um workflow controlado. Assinatura inválida nunca usa o método alternativo. Corpo limitado a 32 KB; texto do lead não entra como comando.
2. Persiste os IDs no inbox com unicidade por organização/tipo/messageId. Revalida o vínculo organização/location e a lista explícita de contatos de homologação.
3. Worker recupera contato, conversa e histórico paginado pelo HighLevel. Fecha o fluxo se identidade, ordenação, paginação ou canal não puderem ser comprovados.
4. OpenAI Responses gera somente JSON de resposta e sinalizações, sem ferramentas e sem escolher destinatário. V02 é a autoridade comercial; histórico serve para contexto e linguagem. Divergências bloqueiam aprovação.
5. Operador autenticado da clínica revisa histórico, destinatário e texto na Jornada AI. Aprovação exige versão/hash exatos, validade de 15 minutos, estado atual da conversa, DND/recusa/pausa, canal permitido e permissão de escrita existente.
6. Servidor faz uma única tentativa de envio, usando `contactId`, `replyMessageId`, canal e provedor da mensagem recebida. A API de envio do HighLevel não aceita `conversationId` no corpo; a resposta deve conter a conversa esperada. Resultado incoerente vira `unknown`. O teste real precisa comprovar esse roteamento no canal utilizado.
7. “Aceita pelo HighLevel” significa aceitação da API, não entrega nem leitura. Resultado incerto pausa o contato e impede reenvio/retomada. A tela permite conferir o ID de uma mensagem já enviada: servidor verifica conversa, contato, texto, canal e horário antes de registrar o resultado. Se não houver recibo comprovável, permanece pausado para investigação técnica; não existe botão “tentar de novo”.

## Pausa, recusa e limites

- “Assumir atendimento” pausa este serviço em todos os canais do contato. Outbound desconhecido também pausa; há uma condição conservadora em que o webhook do próprio envio chega antes do recibo e causa pausa. A equipe confere antes de retomar.
- Pausar não cancela uma requisição já despachada ao provedor. Antes do despacho, a sessão é revalidada transacionalmente.
- A pausa não desativa bots nativos, workflows, n8n ou ações manuais no HighLevel. Os contatos de homologação devem ficar fora de automações concorrentes.
- Recusa explícita encontrada no histórico recuperado e DND bloqueiam contato comercial. “Retomar” não apaga recusa. Reconsentimento precisa de processo humano separado, ainda não implementado.
- Anexos, questões clínicas, urgências, políticas ausentes e conflitos exigem equipe humana. Anexos não são interpretados. A versão não agenda, valida pagamentos, confirma recebimentos, manda materiais nem altera regras comerciais.
- Conservadoramente exige mensagem inbound há menos de 23 horas em todos os canais habilitados (WhatsApp/SMS/IG/FB). Templates e reativação fora dessa janela ficam fora desta versão.
- Respostas determinísticas de urgência/recusa/pedido de humano são rascunhos em português. O modelo tem instrução PT/FR/EN, mas qualidade multilíngue real ainda precisa de homologação.

## Configuração segura, inicialmente desligada

Modelo das variáveis em `environment.example`. Os valores reais entram somente no painel seguro do servidor da Jornada AI; nunca no chat, Git, arquivos servidos pelo navegador ou prefixo `VITE_`.

- `OPENAI_API_KEY`: necessário apenas para o provedor `openai`; projeto dedicado, limite de gasto configurado no provedor. No modo `lovable`, usar a `LOVABLE_API_KEY` já gerenciada pela plataforma.
- `COMMERCIAL_AGENT_ENCRYPTION_KEY`: chave aleatória de 32 bytes em base64. Guardar cópia no cofre; não rotacionar sem migrar ou expirar os rascunhos existentes.
- `COMMERCIAL_AGENT_WEBHOOK_SECRET` e `COMMERCIAL_AGENT_WORKER_SECRET`: valores diferentes, aleatórios, com pelo menos 32 caracteres.
- Reutilizar `GHL_PRIVATE_TOKEN`, `GHL_LOCATION_ID` e acesso Supabase de servidor já vinculados à clínica. Não ampliar acesso de outras organizações.
- Começar com `COMMERCIAL_AGENT_ENABLED=false`, `COMMERCIAL_AGENT_SEND_ENABLED=false`, configuração SQL `mode='off'`, listas de contatos/canais vazias e job inativo.

A migração `20261003120000_commercial_agent_supervised.sql` não cria configuração ativa. Depois de validar em banco de homologação, o administrador insere uma configuração da organização já vinculada, inicialmente desligada. A subconta previamente observada foi `ok2UHC2QMZsd8UHsAgEa`; revalidar o vínculo atual antes de preencher, sem associar clínicas por nome.

Webhook previsto: `/api/public/commercial-agent-webhook`. Assinar `InboundMessage` e `OutboundMessage` quando houver aplicativo Marketplace. Alternativa: workflow com cabeçalho `x-webhook-secret` e IDs estáveis mapeados de eventos reais. Não presumir que um gatilho genérico disponibiliza `messageId`/`conversationId`: demonstrar isso com contato de teste. Eventos sem IDs estáveis são recusados; não inferir conversa pelo nome/telefone.

Para o piloto SMS/Zaptos com integração privada já existente, usar `/api/public/commercial-agent-notification`: `Content-Type: application/json`, cabeçalho `x-webhook-secret` igual ao `GHL_WEBHOOK_SECRET` existente e corpo `{ "locationId": "ID_DA_LOCATION", "contactId": "ID_REAL_DO_CONTATO" }`. Os valores são apenas formato, não credenciais nem um evento executável. A notificação não aceita assinaturas Marketplace nem substitui o webhook anterior. Não presumir campos de mensagem no construtor: os IDs reais de mensagem/conversa são recuperados na API após validar escopo e allowlist. Não alterar o webhook do provedor Zaptos.

O modo exige `COMMERCIAL_AGENT_DISCOVERY_ENABLED=true`, início explícito `COMMERCIAL_AGENT_PILOT_SINCE` em ISO com fuso e no máximo um contato distinto. Registrar esse início na abertura efetiva do teste para impedir processamento do histórico anterior. Preservar o valor em reinícios. Manter ambos desligados até chaves/serviço/workflow prontos. Não ampliar a allowlist neste modo: há bloqueio intencional para mais de um contato. O worker verifica também saídas humanas; descoberta repetida usa os mesmos IDs e a deduplicação durável existente.

Worker: `/api/public/commercial-agent-worker`, cabeçalho `x-worker-secret`. Salvar no Vault `commercial_agent_worker_url` e `commercial_agent_worker_secret`. O SQL de agendamento exige HTTPS e caminho exato, usa valores do cofre e deixa o job inativo. Ativar o job somente junto do recebimento supervisionado para o único contato autorizado, mantendo envio bloqueado. Para este contato, descoberta usa quatro GETs (contato, pesquisa, conversa e uma página); geração faz sua própria revalidação. Observar timeout, HTTP/429 e consumo; não interpretar cron bem-sucedido como sucesso do processamento. Se API ou paginação falhar, não há geração; a retenção no banco continua antes da consulta externa.

Homologação externa pendente: configurar os três segredos no painel seguro e publicar sua configuração; permitir somente contato/canal de teste no transporte SMS/Zaptos confirmado; configurar webhook e worker; conferir isolamento entre organizações; ligar somente recebimento/geração; verificar webhooks e histórico reais; revisar V02 com a equipe; liberar envio supervisionado só para o contato de teste e conferir conversa/recibo reais. Também validar pausa, duplicidade e sincronização do repasse humano com o MultiAtendimento. Código e migração já estão instalados no projeto existente, com configuração desligada. Ativação em produção continua condicionada à validação.

## Manutenção

Responsável operacional sugerido: equipe comercial revisa a fila durante o horário de atendimento e decide conflitos. Responsável técnico ainda precisa ser designado para cloud, segredos, falhas e atualizações. Não há monitoramento humano contratado nem alertas externos enviados por esta implementação.

- Diariamente: fila de falhas, estados `unknown`, idade dos pendentes, execução do cron e respostas HTTP de `pg_net`. Um cron “succeeded” só comprova o agendamento HTTP, não o sucesso da chamada. Alertas operacionais devem olhar o status HTTP e o inbox, sem incluir texto do paciente.
- Semanalmente no piloto: amostra aprovada pela equipe, incidência de conflitos/urgências/recusas, tokens e latência. Limite inicial de 3.000 rascunhos por mês; tentativas que falham podem consumir tokens sem gerar rascunho, portanto esse limite não substitui o limite de gasto da OpenAI.
- Mudança comercial: atualizar os arquivos V02 somente com decisão da equipe, nova revisão/hash, cenários de aceitação e revisão de código. O serviço invalida aprovação de conteúdo com hash antigo.
- Segredos apenas no servidor; histórico/rascunho em AES-256-GCM vinculado à organização e evento. Logs registram códigos fechados e IDs, sem corpo de mensagens nem erro bruto do provedor. Não habilitar captura de corpos, replay de sessão ou analytics sobre a tela de revisão.
- Worker remove conteúdo criptografado após 7 dias, preservando IDs de deduplicação e recusa. Casos `sending/unknown` preservam conteúdo para reconciliação; revisar manualmente a retenção desses casos. Auditoria/IDs precisam de política de retenção da clínica antes de uso amplo.
- OpenAI recebe até as últimas 30 mensagens, com remoção heurística de email/telefone/data e sem IDs de CRM. Isso não garante anonimização de dados de saúde no texto livre. `store:false` não significa ausência de todo registro do provedor; conferir a configuração de dados aplicável antes de usar pacientes reais.
- Desligamento: `COMMERCIAL_AGENT_SEND_ENABLED=false`, depois `COMMERCIAL_AGENT_ENABLED=false`, `mode='off'` e cron inativo. Preservar banco/auditoria; não apagar evidências de envio incerto.

## Custo estimado de operação

Hipótese: 3.000 rascunhos/mês, média de 8.000 tokens de entrada e 300 de saída por rascunho, GPT-5.4 Mini. Tabela oficial OpenAI consultada em 06/10/2026: US$ 0,75/milhão de entrada e US$ 4,50/milhão de saída. Estimativa pelo preço do modelo: **US$ 22,05/mês**. Com 6–10 mil tokens de entrada e 200–400 de saída, intervalo **US$ 16,20–27,90**. O teste fictício de 3.914 tokens de entrada e 76 de saída equivale a US$ 0,0032775 nessa tabela; não é uma medição da fatura Lovable.

O Lovable informa cobrança em créditos baseada nos custos do fornecedor, mas as páginas consultadas não garantem repasse exato 1:1 em dólares. Conferir Plans & credit usage → Usage details → Run credits. Cálculos sem cache, descontos ou cobranças adicionais; tentativas que falham também podem consumir tokens. Nenhum orçamento foi imposto tecnicamente ao workspace nesta etapa.

Hospedagem/banco aproveitam a Jornada AI existente; nenhuma nova assinatura foi criada. O custo incremental depende do consumo e dos créditos atuais do Lovable/Supabase, não acessados para faturamento. HighLevel, WhatsApp/Zaptos, impostos, manutenção e trabalho humano são adicionais conforme os contratos existentes. Portanto US$ 22,05 é referência da parcela de IA, não o total fechado da operação. O fluxo solicitado reutiliza o provedor ZaptosWPP predefinido da conta; não exige nova contratação de SMS de operadora, e não houve contratação.

Fontes: [GPT-5.4 Mini e preços](https://developers.openai.com/api/docs/models/gpt-5.4-mini), [Lovable AI](https://docs.lovable.dev/features/ai#usage-and-pricing), [créditos Lovable](https://docs.lovable.dev/introduction/credits-and-usage#ai-gateway-costs), [agendamento Supabase](https://supabase.com/docs/guides/functions/schedule-functions), [envio HighLevel](https://marketplace.gohighlevel.com/docs/2021-07-28/ghl/conversations/send-a-new-message/), [controles de dados OpenAI](https://developers.openai.com/api/docs/guides/your-data).

## Executar a demonstração local

Instalar as dependências pelo lock existente (`bun install --frozen-lockfile`). Definir `PG_TEST_BINDIR` para o diretório de binários PostgreSQL que contém `initdb`, `pg_ctl` e `postgres`, e executar:

```sh
node scripts/demo-commercial-agent.mjs
```

Abrir **http://127.0.0.1:4191/demo/commercial-agent.html**, nunca o arquivo via `file://`. O servidor só aceita localhost, cria seu próprio banco temporário e não usa credenciais reais. Deve permanecer rodando durante a demonstração; ao encerrar, os dados fictícios são descartados.

Roteiro: receber mensagem → revisar histórico e preço → aprovação em duas etapas → uma mensagem na caixa fictícia → repetir webhook e conferir que continua uma → testar conflito e conferir botão de aprovação bloqueado → testar pedido de humano/recusa e conferir pausa. “Limpar demonstração” apaga somente o banco fictício criado pelo script.

## Evidências e pendências

As evidências de execução estão em `VALIDACAO.md`; o avanço remoto está em `IMPLANTACAO.md`. Migração e código estão instalados, com configuração desligada. Houve uma chamada real ao gateway Lovable com dados fictícios, sem envio a pacientes. O provedor SMS/Zaptos predefinido foi confirmado na interface. Segredos, webhook/worker, operação da fila autenticada, repasse humano e fluxo supervisionado real continuam pendentes; o build local, a resposta fictícia e o estado conectado da instância não comprovam esse fluxo.
