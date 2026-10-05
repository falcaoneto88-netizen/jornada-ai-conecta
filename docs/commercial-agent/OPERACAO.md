# Agente comercial V02 — homologação na Jornada AI

Estado em 05/10/2026: banco instalado e validado na Jornada AI, configuração desligada, listas de homologação vazias e nenhum cron ativo. Código ainda local, sem publicação e sem mensagens reais. Bloqueios de acesso e credenciais estão em `IMPLANTACAO.md`. A demonstração usa o serviço e PostgreSQL reais, com HighLevel, OpenAI e operador fictícios. Não comprova integração externa nem qualidade das respostas de um modelo real.

## Onde ficará hospedado

A implementação integra o repositório existente `falcaoneto88-netizen/jornada-ai-conecta`, na branch `codex/agente-supervisionado-v02`, sobre `4782bba9388edb229e4a80086ad1df87b19b30f3`. Nenhum novo provedor foi contratado.

Projeto [Jornada AI no Lovable](https://lovable.dev/projects/36345211-2616-42f7-bb9e-e78a9d00ca22). Destino planejado depois de homologação: aplicação atual `https://jornada-ai-conecta.lovable.app`, com interface `/agente-supervisionado`, rotas de servidor TanStack/Nitro e o Supabase já vinculado. A região e a residência dos dados seguem a configuração atual do projeto; não foram alteradas nem confirmadas nesta implementação.

O processador é acionado por `pg_cron` + `pg_net`; não depende de aba de ChatGPT, navegador aberto ou computador local após implantação. O Supabase existente apresentou `pg_cron`, `pg_net` e `supabase_vault` em consulta somente de leitura. `scripts/commercial-agent-scheduler.sql` prepara um job **inativo** de 1 minuto, com URL/segredo recuperados do Vault. Não foi executado. Validar duração máxima de requisição do ambiente hospedado antes de habilitar o job; histórico extenso pode exigir reduzir o lote ou mudar a execução para um worker do mesmo provedor. Falhas expiram por lease e até três tentativas de geração; envios jamais são repetidos automaticamente.

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

- `OPENAI_API_KEY`: projeto dedicado, limite de gasto configurado no provedor.
- `COMMERCIAL_AGENT_ENCRYPTION_KEY`: chave aleatória de 32 bytes em base64. Guardar cópia no cofre; não rotacionar sem migrar ou expirar os rascunhos existentes.
- `COMMERCIAL_AGENT_WEBHOOK_SECRET` e `COMMERCIAL_AGENT_WORKER_SECRET`: valores diferentes, aleatórios, com pelo menos 32 caracteres.
- Reutilizar `GHL_PRIVATE_TOKEN`, `GHL_LOCATION_ID` e acesso Supabase de servidor já vinculados à clínica. Não ampliar acesso de outras organizações.
- Começar com `COMMERCIAL_AGENT_ENABLED=false`, `COMMERCIAL_AGENT_SEND_ENABLED=false`, configuração SQL `mode='off'`, listas de contatos/canais vazias e job inativo.

A migração `20261003120000_commercial_agent_supervised.sql` não cria configuração ativa. Depois de validar em banco de homologação, o administrador insere uma configuração da organização já vinculada, inicialmente desligada. A subconta previamente observada foi `ok2UHC2QMZsd8UHsAgEa`; revalidar o vínculo atual antes de preencher, sem associar clínicas por nome.

Webhook previsto: `/api/public/commercial-agent-webhook`. Assinar `InboundMessage` e `OutboundMessage` quando houver aplicativo Marketplace. Alternativa: workflow com cabeçalho `x-webhook-secret` e IDs estáveis mapeados de eventos reais. Não presumir que um gatilho genérico disponibiliza `messageId`/`conversationId`: demonstrar isso com contato de teste. Eventos sem IDs estáveis são recusados; não inferir conversa pelo nome/telefone.

Worker previsto: `/api/public/commercial-agent-worker`, cabeçalho `x-worker-secret`. Salvar no Vault `commercial_agent_worker_url` e `commercial_agent_worker_secret`. O SQL de agendamento exige HTTPS e caminho exato, usa valores do cofre e deixa o job inativo.

Homologação externa pendente: publicar o código em ambiente controlado do projeto existente; configurar chaves no cofre; permitir somente contato/canal de teste; conferir autenticação de duas organizações; ligar somente recebimento/geração; verificar webhooks e histórico reais; revisar V02 com a equipe; liberar envio supervisionado só para o contato de teste e conferir conversa/recibo reais. A migração já foi aplicada e registrada no projeto existente, com configuração desligada. Ativação em produção continua condicionada à validação.

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

Hipótese, não medição: 3.000 rascunhos/mês, média de 8.000 tokens de entrada e 300 de saída por rascunho, GPT-4.1 mini. Tabela oficial consultada em 05/10/2026: US$ 0,40/milhão de entrada e US$ 1,60/milhão de saída. Estimativa: **US$ 11,04/mês de OpenAI**. Com 6–10 mil tokens de entrada e 200–400 de saída, intervalo calculado **US$ 8,16–13,92**. Reserva sugerida para piloto: US$ 20/mês na API, acompanhando tentativas e volume reais. Não é limite técnico garantido pelo aplicativo.

Hospedagem/banco aproveitam a Jornada AI existente; nenhuma nova assinatura foi criada. O custo incremental depende do consumo e dos créditos atuais do Lovable/Supabase, não acessados para faturamento. HighLevel, WhatsApp/SMS, impostos e trabalho humano são adicionais conforme os contratos existentes. Portanto US$ 11,04 é a parcela estimada de IA, não o total fechado da operação.

Fontes: [GPT-4.1 mini e preços](https://developers.openai.com/api/docs/models/gpt-4.1-mini), [cobrança Lovable](https://lovable.dev/blog/simplifying-billing), [agendamento Supabase](https://supabase.com/docs/guides/functions/schedule-functions), [envio HighLevel](https://marketplace.gohighlevel.com/docs/2021-07-28/ghl/conversations/send-a-new-message/), [controles de dados OpenAI](https://developers.openai.com/api/docs/guides/your-data).

## Executar a demonstração local

Instalar as dependências pelo lock existente (`bun install --frozen-lockfile`). Definir `PG_TEST_BINDIR` para o diretório de binários PostgreSQL que contém `initdb`, `pg_ctl` e `postgres`, e executar:

```sh
node scripts/demo-commercial-agent.mjs
```

Abrir **http://127.0.0.1:4191/demo/commercial-agent.html**, nunca o arquivo via `file://`. O servidor só aceita localhost, cria seu próprio banco temporário e não usa credenciais reais. Deve permanecer rodando durante a demonstração; ao encerrar, os dados fictícios são descartados.

Roteiro: receber mensagem → revisar histórico e preço → aprovação em duas etapas → uma mensagem na caixa fictícia → repetir webhook e conferir que continua uma → testar conflito e conferir botão de aprovação bloqueado → testar pedido de humano/recusa e conferir pausa. “Limpar demonstração” apaga somente o banco fictício criado pelo script.

## Evidências e pendências

As evidências de execução estão em `VALIDACAO.md`; o avanço remoto está em `IMPLANTACAO.md`. A migração foi aplicada no projeto existente e seu isolamento foi verificado. Não houve publicação do novo código, contratação de hospedagem, chamada real à OpenAI nem envio a pacientes por este agente. Configurar e homologar externamente continua necessário; o build local não prova o ambiente remoto.
