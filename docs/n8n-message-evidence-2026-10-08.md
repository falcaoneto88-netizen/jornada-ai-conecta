# Evidência de mensagens GHL — correção local de 08/10/2026

## Causa comprovada

A execução manual 105 do workflow original concluiu o ciclo de dois itens. O `booking` foi aceito; a tentativa de `req24` recebeu HTTP 409 `reminder_evidence_invalid` antes de reservar ou enviar. Portanto o loop não foi a causa desse bloqueio.

A leitura autenticada posterior do GHL, comunicada pela verificação operacional do projeto às 17:59 UTC, identificou duas diferenças de contrato em relação ao parser:

- `GET /conversations/messages/:id` retornou `{ message: { ... }, traceId }`, enquanto o adaptador entregava esse envelope ao parser de mensagem plana.
- A mensagem emitida pelo provedor configurado tem `messageType: TYPE_CUSTOM_SMS`, `type: 20`, `source: api`, `contentType: text/plain` e `conversationProviderId` igual ao configurado no servidor. Esse tipo não estava entre os aceitos.

O horário GHL da mensagem foi `17:44:28.571Z`, anterior à conclusão persistida `17:44:29.780323+00:00`. Isso satisfaz o teste temporal atual; não há motivo comprovado para relaxar a comparação. O histórico paginado autenticado conservou o envelope esperado e teve 103 mensagens em duas páginas. As respostas anteriores vieram como `TYPE_SMS`, sem `source` nem `conversationProviderId`. Nenhum corpo de mensagem, telefone, segredo ou credencial é necessário para essa correção.

## Alteração mínima

- O adaptador de mensagem reconhece a resposta plana existente ou o envelope observado com apenas `message` e `traceId` opcional de tipo string. Rejeita envelopes malformados, aninhados ou com identidades/metadados conflitantes. Não combina campos nem preenche identidade com parâmetros da requisição.
- O parser mantém os tipos SMS/WhatsApp anteriores e admite a exceção `TYPE_CUSTOM_SMS` apenas **outbound**, com `type` numérico 20, `source: api`, rota servidor `whatsapp_zaptos` e `conversationProviderId` exatamente igual ao provedor não vazio configurado. Tipo custom recebido sem esse contexto, por outro canal/provedor ou na direção inbound continua recusado.
- A exceção usa transporte `sms`, correspondente ao contrato GHL observado, para preservar a correspondência com a resposta `TYPE_SMS` sem provedor. Não afirma consentimento nem entrega.
- A configuração do servidor chega aos parsers de lembretes, resolução da resposta, confirmação e agradecimento. Não há mudanças em gatilhos, templates, histórico, filtros temporais, DND, escopo, grants, flags, reservas ou persistência.
- `/api/version` acrescenta `capabilities.n8nMessageEvidence: 2` preservando o build e as capacidades anteriores. O marcador permite conferir publicação por leitura sem disparar mensagens.

## Verificação e limites

Testes com dados fictícios cobrem o envelope autenticado, identidade divergente, provedor ausente/trocado, tipo/direção/source incorretos, respostas SMS sem provedor e os quatro caminhos de uso. Lembretes continuam recusando intervenção/resposta posterior e mensagem com horário posterior à conclusão persistida. Reserva e efeitos externos continuam ausentes nos cenários recusados.

Gates locais concluídos: 467 testes em 13 suítes, TypeScript sem erros, lint dos arquivos alterados sem erros e build exit0. A revisão independente do diff não encontrou bloqueador. O build conserva avisos existentes de depreciação e empacotamento. SQL não mudou e não foi reexecutado nesta revisão.

```sh
node_modules/.bin/vitest run src/lib/n8n-bridge-message-contract.test.ts src/lib/n8n-bridge-confirmation.adapter.test.ts src/lib/n8n-bridge-reminders.test.ts src/lib/n8n-bridge-reply-resolve.test.ts src/lib/n8n-bridge-confirmation.test.ts
node_modules/.bin/tsc --noEmit
npm run build
```

Implementado e testado localmente; nenhum SQL novo. Publicação e validação de ponta a ponta são estados separados, ainda não comprovados por este candidato. Após a publicação autorizada, conferir o marcador e a saúde sem habilitar nada automaticamente. A retomada precisa evitar repetir o `booking` já aceito: reler ledger, estado n8n, grant e compromisso exato antes da fase restante. Uma resposta `accepted` continua significando aceitação pelo GHL, não recebimento pelo contato. `concurrency_verified` não muda.
