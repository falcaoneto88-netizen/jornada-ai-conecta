# Roadmap

- [x] Ligação real ao GoHighLevel (teste + sincronização em leitura)
- [x] Editor visual de automações
- [ ] Recetor de webhook Custom Webhook do GoHighLevel
  - [x] Binding server-only location -> organização
  - [x] Processamento real de contact.created / contact.updated
  - [x] Idempotência durável, retry e estado (recebido/processado/falhado)
  - [x] UI de Webhooks com URL correta e estados reais
  - [x] Testes automatizados (vitest)
  - [ ] Teste real a partir do GoHighLevel (depende de GHL_WEBHOOK_SECRET e do workflow do utilizador)
- [ ] GHL_WEBHOOK_SECRET por registar em Definições do projeto › Secrets (bloqueado: só o utilizador pode inserir o valor)

## Oportunidades do funil (2026-09-09)
- [x] Mapeamento real de funis/etapas em Integrações (leitura)
- [x] Sincronização paginada de oportunidades (status=all) + vista Oportunidades em Jornada
- [x] Importação real do funil "Pipeline Harmonização de Glúteo" (39 oportunidades, 11 etapas) — executada como operação administrativa do sistema, auditada sem atribuição a utilizador

## Agenda GoHighLevel (2026-09-09)
- [x] Tabela `appointments` com RLS/GRANTs e índice único por marcação GHL
- [x] Escolha e validação da agenda em Integrações › Mapeamento
- [x] Secção Agenda (leitura) + próxima marcação na ficha do cliente
- [x] Importação real da agenda `nPXR1Fyp0r3CpaMMGSki` "Consulta Inicial — Harmonização": 34 marcações, 13 clientes novos, repetição idempotente (operação administrativa do sistema)

## Atualização automática da agenda (2026-09-09)
- [x] Rota interna `/api/public/hooks/sincronizar-agenda` protegida por CRON_SECRET
- [x] Tarefa horária no backend (minuto 5) a importar a agenda em leitura
- [x] Quadro da Agenda recarrega sozinho a cada 5 minutos
- [ ] Publicar a aplicação para a tarefa horária atingir a versão em produção

## Pagamentos (2026-09-10)
- [ ] Ativar recebimento de pagamentos (Paddle) — a aguardar confirmação do utilizador

## Experiência Falcão — site (2026-09-17)
- [x] Tabelas `site_integrations` e `site_lead_submissions` com RLS, GRANTs e auditoria sem dados pessoais
- [x] Configuração administrativa (`configure_site_integration`) validando binding, funil e etapa local
- [x] Rota assinada `POST /api/public/falcao-lead` (HMAC-SHA256, janela 5 min, 4096 bytes, payload estrito)
- [x] Ingresso transacional idempotente (`ingest_site_lead`): recibo, revisão de conflitos, etapa preservada
- [x] Testes: 21 do ingresso, 5 da configuração, 13 contra Postgres real
- [ ] Registar `FALCAO_SITE_SIGNING_SECRET` (64 hexadecimais) em Definições do projeto › Secrets e no site
- [ ] Ligar o recebimento no cartão de Integrações (desligado por omissão)
- [ ] Escrita no GoHighLevel (contacto + oportunidade) por validar — mantida bloqueada
- [ ] Canal e modelo aprovado do acolhimento por confirmar — nada é enviado

### Correções de revisão (2026-09-17, migração 0001)
- [x] Ingresso serializado por pedido e por identidade (sem corrida de idempotência)
- [x] Configuração restrita aos valores fixos e validada no funil real do GoHighLevel
- [x] Contagens exatas no cartão, com aviso explícito quando a leitura falha
- [x] Limites de abuso por identidade e por integração (sem IP em bruto); reenvios não consomem quota
- [x] Recibo validado campo a campo; limite temporário responde 429
- [x] Escrita remota (contacto + oportunidade) reservada, idempotente e auditada
- [ ] Canal do acolhimento por verificar: só existe envio pelo GoHighLevel, dependente de escrita ativa, modelo aprovado e janela de 24 h
- [ ] `FALCAO_SITE_SIGNING_SECRET` por registar pelo proprietário
- [ ] `remote_write_state` continua 'pendente': escrita remota desligada

### Acolhimento pelo canal existente (2026-09-17, migração 0002)
- [x] Envio pelo tipo SMS da API oficial, encaminhado pelo provedor predefinido da conta (ZaptosWPP V2)
- [x] Outbox durável com intenção auditada e uma única tentativa por recibo
- [x] DND/opt-out verificados imediatamente antes do envio
- [x] Estados separados: enviado (aceite pela API) e entregue (só com recibo do provedor)
- [x] Interruptores explícitos do administrador; tudo desligado por omissão
- [ ] Teste controlado do encaminhamento pelo provedor (sem prova técnica na API)

### Revisão bloqueante — ledger durável (2026-09-17, migração 0004)
- [x] Respostas de procura sem contrato explícito bloqueiam novas criações
- [x] Telefone consentido, ID, location e DND são obrigatoriamente revalidados
- [x] Ledger durável impede segunda execução remota ou acolhimento para a mesma pessoa
- [x] IDs externos incertos ficam apenas no recibo de reconciliação
- [x] `type: SMS` preservado para o provedor ZaptosWPP predefinido
- [ ] Integração, escrita remota e acolhimento continuam desligados até revisão

## Ponte Ad Navigator (v1.1)
- [x] Migração aplicada na base real (`drizzle/migrations/0009_ad_navigator_bridge_v1_1_definitivo.sql`), só estrutura e funções — nenhum pareamento nem concessão criados.
- [x] Vínculo pela ligação real ao GoHighLevel (organização não-demo, `location_id` + `default_pipeline_id`), independente do site.
- [x] Agregados numa única consulta, validação estrita do contrato, formatos exatos de código/bearer, teto de abuso por rota, `build` fixo em `/api/version`.
- [x] Travas corrigidas (`0010_ad_navigator_locks_v1_2.sql`): leitura em `FOR UPDATE` desde o início, autorização e vínculo travados até ao commit, modo real da ligação exigido.
- [ ] Ponte por publicar; só declarar ligada após troca real + leitura autenticada do resumo + persistência confirmada no Ad Navigator.

### Reconciliação de espelho desatualizado (2026-09-20, migração APLICADA)
- [x] `drizzle/migrations/0011_site_lead_snapshot_reconciliacao.sql` aplicada na base do Jornada — conclusão remota aceita etapa/estado reais do GoHighLevel para oportunidade já existente do mesmo contacto e funil
- [x] ACL preservada: `REVOKE` de `public`/`anon`/`authenticated`, `EXECUTE` apenas para `service_role` (mais o dono `postgres`); `search_path` vazio
- [x] Guarda conservadora de versão: linha local alterada depois da reserva do recibo **ou sem prova de versão** (`remote_attempted_at` nulo) nunca é sobrescrita (reconciliação auditável)
- [x] Incoerências passam a ficar persistidas em revisão/auditoria, em vez de reverterem e prender o recibo em `a_processar`
- [x] Testes PostgreSQL isolados (`src/lib/falcao-reconciliacao.db.test.ts`, 11) + regressão de `falcao-lead`/ledger (41) com a nova função carregada
- [ ] Reconciliação limitada do pedido `884062b4-…` — a fazer pelo utilizador; nada foi reprocessado
- [ ] Submissão `0981dfd5-…` fica em revisão: telefone e e-mail ligados a contactos diferentes, a aguardar esclarecimento

