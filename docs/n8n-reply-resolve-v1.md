# Descoberta autenticada de resposta — 06/10/2026

Estado: implementado e testado localmente na base `d4b1c68` (integração sobre `08be9f2`). Não publicado nem verificado com resposta real por esta mudança. O marcador preparado para `/api/version` é `jornada-n8n-confirmation-20261006.1`, com `api.n8n-bridge=3`. A migração 0014 existente é pré-requisito; nenhuma migração nova é adicionada.

## Contrato adicional, compatível

Mesmo endpoint `POST /api/public/n8n/bridge`, mesma credencial Bearer, corpo limitado a 2048 bytes e quota existente por organização. A operação recebe somente:

```json
{"op":"appointment.reply.resolve","contactId":"CONTACT_ID_GHL"}
```

Campos adicionais (inclusive texto, intent, appointmentId, inboundMessageId, organização e location) são recusados. O callback Customer Replied somente acorda a consulta; não é evidência da mensagem. Não é necessário inventar `message.id` no Custom Webhook do GHL.

Exemplo de resposta com dados fictícios:

```json
{
  "status":"resolved",
  "readOnly":true,
  "reply":{
    "inboundMessageId":"MESSAGE_ID_GHL",
    "conversationId":"CONVERSATION_ID_GHL",
    "contactId":"CONTACT_ID_GHL",
    "locationId":"LOCATION_ID_GHL",
    "replyAt":"2026-10-06T12:00:00.000Z",
    "intent":"confirm"
  },
  "appointment":{
    "appointmentId":"APPOINTMENT_ID_GHL",
    "calendarId":"CALENDAR_ID_GHL",
    "startTime":"2026-10-07T12:00:00.000Z",
    "appointmentStatus":"new"
  }
}
```

`intent` classifica somente respostas exatas após trim: `SIM`/`CONFIRMO` → `confirm`, `NÃO`/`NAO` → `decline`, `REMARCAR` → `reschedule`, qualquer outro texto → `other`, sem distinção de maiúsculas/minúsculas. Não devolve texto livre, nome, telefone, endereço nem conteúdo clínico. O estado de consulta vem da leitura GHL e deve ser `new`, `booked` ou `confirmed`; `resolved` não significa presença confirmada.

## Evidência e isolamento

1. A autenticação e a organização/location continuam resolvidas no servidor. A ponte e o calendário precisam estar configurados; não muda nem exige flags de escrita/envio para esta leitura.
2. Confere o ID exato do contato na location por leitura autenticada.
3. Reutiliza `n8n_bridge_confirmation_requests(org, contact, agora)` para listar somente `req24`/`req12` aceitos, anteriores ao momento observado e para consultas futuras. Não usa nomes, telefone, payload do webhook, simulações, mensagens do workflow antigo ou `request_send_id` de uma confirmação que ainda não existe. Mais de 50 registros recusa, sem truncamento silencioso.
4. Reconsulta cada mensagem de solicitação por ID. Exige location/contato exatos, direção outbound, canal SMS/WhatsApp, texto simples, momento não posterior à aceitação. Todos os candidatos devem apontar a um único par consulta/horário e a uma única conversa. Duas solicitações para a mesma consulta (req24/req12) são compatíveis; duas consultas/conversas exigem intervenção.
5. Lê todas as páginas da conversa (limites existentes: 10 páginas e 1000 mensagens). Campos de identidade/timestamp ausentes ou incompatíveis, duplicação de IDs, cursor inválido/repetido e paginação incompleta recusam. As solicitações precisam aparecer nesse histórico com o mesmo momento.
6. A mensagem mais recente precisa ser inbound, canal compatível com a solicitação, posterior à aceitação, não futura e anterior à consulta. Empates não são ordenados por conveniência. Não procura um SIM antigo quando existe mensagem posterior. Reutiliza a guarda de contexto da confirmação: intervenção ou outra resposta entre a solicitação mais recente e a resposta impedem associação automática.
7. Reconsulta a mensagem por seu ID real e compara identidade, timestamp, canal e texto com o histórico. Reconsulta a consulta e exige mesmo ID, contato, location, calendário configurado, horário futuro e estado ativo. Repete o histórico completo antes de responder para detectar resposta/intervenção que chegou durante as leituras.

## Integração n8n e reentrega

Após 200 com `status=resolved` e `readOnly=true`, o n8n pode alimentar seu motor com o ID real e intent, sem copiar texto do webhook. Para `confirm`, conserva o contrato existente:

```json
{
  "op":"appointment.confirm",
  "appointmentId":"APPOINTMENT_ID_GHL",
  "contactId":"CONTACT_ID_GHL",
  "expectedStartTime":"2026-10-07T12:00:00.000Z",
  "inboundMessageId":"MESSAGE_ID_GHL"
}
```

A confirmação relê a mensagem real e todas as guardas; uma classificação ou estado local nunca a substitui. O agradecimento só vem após confirmação persistida e revalidação existente. Para `other`, seguir revisão humana; nunca converter em SIM. Recusa/indisponibilidade não pode gerar evento inbound fictício.

Repetir a descoberta sem mudanças devolve o mesmo ID. Não consome a resposta nem cria reserva. A idempotência da mutação permanece na operação `appointment.confirm`, com as mesmas chaves únicas e bloqueio de `unknown`/`reserved`. Depois de nova resposta, intervenção, cancelamento ou remarcação, a reentrega deve ser reavaliada e pode ser recusada. A descoberta observa o estado atual da conversa, não comprova qual mensagem histórica causou o callback.

## Resultados de recusa

Todas as recusas têm somente `{"error":"codigo"}`:

- 409: `confirmation_request_missing`, `confirmation_ambiguous`, `confirmation_evidence_overflow`, `confirmation_evidence_invalid`, `contact_not_verified`, `reply_missing`, `reply_not_verified`, `reply_history_unavailable`, `reply_outside_window`, `reply_superseded`, `confirmation_context_changed`, `appointment_changed`.
- 502: `ghl_unavailable`, `message_unavailable`, ou `confirmation_evidence_unavailable` ao falhar a leitura da solicitação GHL.
- 503: `confirmation_evidence_unavailable` ao falhar ledger/RPC, `confirmation_unavailable` sem adapter, `reply_clock_unavailable` sem horário válido.
- Auth, schema, configuração e quota conservam códigos existentes (401/400/403/409/413/415/429/503). Histórico incompleto/indisponível usa a recusa conservadora `reply_history_unavailable` (409).

A operação não grava estado de consulta, ledger de confirmação ou envio, não reserva, não faz PUT nem envia mensagem. Mantém apenas o contador de limite de requisições já existente na ponte. Seus tipos de dependências excluem métodos de mutação. Não lê ou altera credenciais, flags ou workflows.

O GHL não oferece transação entre os GETs e operações futuras: o resultado não é uma trava. Uma alteração após a última leitura pode invalidá-lo; por isso a confirmação e o agradecimento fazem suas próprias releituras. Não declara atomicidade entre sistemas.

## Validação local

76 novos casos do resolver, incluindo contrato estrito, autenticação, classificação mínima, paginação real, limites, identidade/canal, múltiplas consultas/conversas, cronologia, intervenções, reentrega, mudança durante leitura e ausência de reservas/PUT/envios em todos os casos. O gate integrado final, com os testes existentes da ponte/confirmação/adapters/escopo e os 29 casos de DND, aprovou **241 testes em 7 arquivos** em uma execução. TypeScript, build e lint dos arquivos alterados também passaram. Esta contagem não é validação publicada.

```sh
./node_modules/.bin/vitest run src/lib/n8n-bridge-reply-resolve.test.ts src/lib/n8n-bridge-confirmation.test.ts src/lib/n8n-bridge-confirmation.adapter.test.ts src/lib/n8n-bridge.test.ts src/lib/n8n-bridge.adapter.test.ts src/lib/n8n-bridge.escopo.test.ts src/lib/n8n-bridge-dnd.test.ts
./node_modules/.bin/tsc --noEmit --pretty false
```

A validação ponta a ponta depende da publicação desta revisão, de `req24`/`req12` real aceito no ledger, callback autenticado ligado no GHL/n8n e resposta real do contato controlado. Até essas evidências existirem: **aguardando ligação/validação**.
