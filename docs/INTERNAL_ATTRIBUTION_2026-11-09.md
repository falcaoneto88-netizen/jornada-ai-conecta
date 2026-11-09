# Atribuição interna do formulário — preparação em 09/11/2026

Estado: código e migração preparados localmente. Não aplicado em produção. Não liga Pixel, CAPI, CRM ou mensagens. O contrato antigo do formulário continua válido sem o campo opcional `attribution`.

## Contrato

```json
{
  "version": "2026-11-09.attribution.v1",
  "source": "ig",
  "medium": "paid_social",
  "campaign": "pt-s01-001",
  "campaignId": "12345678901",
  "adsetId": "12345678902",
  "adId": "12345678903",
  "capturedAt": "2026-11-09T12:00:00.000Z",
  "consent": { "analytics": true, "version": "2026-11-09.analytics.v1" }
}
```

- Este objeto é o campo opcional `attribution` do corpo assinado existente. Exemplo sintético; os IDs não indicam ativos reais.
- `source`: `fb`, `ig`, `an`, `msg` ou `meta`. `medium`: exclusivamente `paid_social`.
- `campaign`: código opaco `^(pt|be)-s\d{2}-\d{3}$`. IDs: strings com 5–30 algarismos.
- `capturedAt`: ISO com UTC ou offset, no máximo 24 horas antes do ingresso e 5 minutos no futuro. Frontend deve gerar `Date.toISOString()`.
- Consentimento de análise independente do consentimento de contacto. Sem autorização de análise, omitir a atribuição; o pedido de contacto pode continuar normalmente.
- Campos extras são recusados, inclusive URLs, click IDs, nomes, informações de procedimento e estado `verifiedMeta`.
- Estes são metadados declarados pelo site. Não comprovam relação entre anúncio, campanha, conta e organização na Meta. Não são prova de conversão atribuída pela Meta nem permitem recuperar a origem de um visitante retroativamente.

## Persistência e segurança

Pedidos sem atribuição continuam chamando `ingest_site_lead_v2`, sem novo argumento e sem depender da migração 0022. Pedidos com atribuição chamam exclusivamente `ingest_site_lead_v3`, que valida o contrato no banco, executa v2 e guarda a atribuição na mesma transação. Não existe fallback que descarte a atribuição. Organização, integração e recibo são derivados da linha efetivamente criada/devolvida pelo banco. O pedido não pode escolher o tenant.

`site_lead_attributions` tem RLS ativa, sem políticas nem privilégios para `anon`/`authenticated`. `service_role` possui apenas SELECT direto; inserção é interna ao RPC `SECURITY DEFINER` com `search_path` vazio. Não existe rota pública de consulta. A remoção do recibo elimina a atribuição em cascata; não foi criado um agendamento de retenção.

O hash v1 permanece byte a byte igual quando `attribution` está ausente. Quando presente, todos os seus campos entram no hash em ordem explícita. Reenvio idêntico recupera o recibo existente; alterações produzem conflito. Recibos antigos não recebem backfill e atribuição existente não é substituída. O TTL é validado no banco apenas para pedidos novos. Um reenvio exato já persistido pode recuperar o recibo depois de 24 horas, conservando a atribuição congelada; somente o timestamp do envelope assinado é renovado. Não trocar nem remover a origem para reenviar.

Nenhum campo de atribuição é acrescentado à escrita GHL, às mensagens ou ao payload CAPI. Não existe consulta analítica na interface nesta etapa; a futura consulta autenticada deverá filtrar a organização resolvida no servidor e declarar a cobertura de atribuição.

## Ordem de implantação

1. Rever/aplicar a migração `0022_site_lead_internal_attribution.sql` e suas ACLs no projeto existente.
2. Publicar o backend v3 e validar que pedidos sem atribuição continuam funcionais.
3. Publicar o site compatível com a captura desligada por omissão; ligar somente depois de confirmar o backend e o consentimento separado.
4. Executar teste autorizado e delimitado, sem dados clínicos; distinguir persistência interna de conversões/recepção pela Meta.

Falha ou ausência da migração não deve virar sucesso para pedidos com atribuição. O marcador `attributionVersion` do GET público confirma apenas o código de aplicação; não comprova presença da tabela, ACLs nem do RPC no banco. Rollback do backend para v2 exige manter a captura do site desligada e não fazer reenvios com payload alterado.

## Verificações locais

- Em 09/11/2026: **59 testes unitários aprovados**, **46 verificações SQL PGlite aprovadas**, `tsc --noEmit` aprovado e `git diff --check` sem erros. Os testes são locais e sintéticos; não comprovam implantação ou atribuição de leads reais.
- Unitários: `npx vitest run src/lib/falcao-lead.test.ts src/lib/falcao-attribution.test.ts`.
- Banco sintético: `ATTRIBUTION_TEST_RUNTIME=/caminho/local/do/runtime node test/falcao-attribution.db.mjs`, com `@electric-sql/pglite` instalado nesse runtime. Usa migrações reais da base não clínica e do ingresso, sem rede externa.
- Testes cobrem schema, consentimento, hash legado, identidade do replay, ACL/RLS, isolamento por integração, rejeição de campos extras, TTL, rollback do contacto/recibo quando a atribuição falha, eliminação em cascata e preservação de flags externas.
- PGlite não comprova concorrência entre processos, implantação nem integração real. Nenhum efeito externo foi testado.
