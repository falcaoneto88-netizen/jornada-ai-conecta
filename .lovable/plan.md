# Receber eventos reais do GoHighLevel

## Situação atual
A ligação ao GoHighLevel está validada e a importação de clientes em modo leitura já funciona (100 contactos importados). O endereço que recebe eventos automáticos já existe e valida o segredo, mas hoje apenas guarda o evento numa caixa de entrada técnica: nada é criado ou atualizado na Jornada nem nas Conversas. Falta também cadastrar o segredo do webhook.

## O que vamos fazer

1. **Cadastrar o segredo** — abro o formulário seguro para guardar `GHL_WEBHOOK_SECRET`. Você cria um valor aleatório forte (num gestor de senhas), guarda-o no formulário e usa exatamente o mesmo valor no GoHighLevel.
2. **Passar a processar os eventos** — cada evento recebido deixa de ficar parado na caixa técnica e passa a atualizar a aplicação:
   - contacto criado/atualizado → cria ou atualiza o cliente em Clientes;
   - oportunidade criada/atualizada/etapa alterada → move o cliente na Jornada;
   - mensagem recebida/enviada → cria ou atualiza a conversa e a mensagem na Caixa de Entrada;
   - marcação/agendamento → regista a interação no histórico do cliente.
   Eventos desconhecidos continuam guardados sem falhar, e eventos repetidos não duplicam nada.
3. **Registo e auditoria** — cada evento processado fica marcado com data, resultado e eventual erro, visível na tela Integrações (últimos eventos recebidos, com estado).
4. **Guia passo a passo dentro do app** — acrescento na aba "Guia de conexão" um bloco de webhooks com: o endereço a copiar, onde colar no GoHighLevel, quais eventos ativar, onde colar o segredo e como confirmar que chegou o primeiro evento.

## Passo a passo que você vai seguir (também ficará no app)

1. Gerar um valor secreto forte e guardá-lo no formulário que eu abro.
2. No GoHighLevel, na subconta, abrir Settings → Integrations / Webhooks (ou criar um Workflow com a ação "Webhook").
3. Colar o endereço de receção que a tela Integrações mostra.
4. Método POST, formato JSON.
5. Adicionar o cabeçalho `x-webhook-secret` com o mesmo valor secreto.
6. Ativar os eventos: contacto criado, contacto atualizado, oportunidade criada, oportunidade atualizada/etapa alterada, mensagem recebida, mensagem enviada, agendamento criado/atualizado.
7. Guardar e disparar um teste (por exemplo, editar um contacto).
8. Voltar à tela Integrações e confirmar o evento na lista de "Últimos eventos recebidos".
9. Conferir o cliente na Jornada e na Caixa de Entrada.

## Detalhes técnicos
- `src/routes/api/public/ghl-webhook.ts`: manter a validação por `x-webhook-secret` e HMAC, gravar em `webhooks_inbox` e delegar o tratamento a um novo módulo `src/lib/ghl-webhook.server.ts` (mapeamento evento → tabelas), respondendo 200 rapidamente.
- Escritas via `supabaseAdmin` restritas à `organization_id` resolvida pelo `location_id`; sem `location_id` conhecido o evento fica registado como não atribuído.
- Desduplicação por `idempotency_key` (já existente) e por `ghl_contact_id` / id de oportunidade / id de mensagem, com o mesmo padrão de ler-e-atualizar já usado na sincronização (índices únicos parciais impedem `ON CONFLICT`).
- `processed_at`, `process_status` e `process_error` passam a refletir o processamento real.
- `src/routes/integracoes.tsx`: bloco de webhooks com endereço, estado do segredo e últimos eventos; guia atualizado.

## Fica de fora
- Envio de mensagens para o GoHighLevel (continua bloqueado até ativar "Permitir escrita").
- Reprocessamento automático de eventos antigos já na caixa técnica.
