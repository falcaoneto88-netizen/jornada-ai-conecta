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
