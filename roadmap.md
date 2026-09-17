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
