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
- [ ] Importação real do funil "Pipeline Harmonização de Glúteo" — falta sessão de administrador (aguarda login do utilizador no preview)
