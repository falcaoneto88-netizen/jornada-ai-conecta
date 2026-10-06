# Confirmação de consulta pela ponte n8n — atualização de 06/10/2026

Estado em 06/10/2026: implementação integrada localmente sobre a revisão `08be9f2` do projeto original. Migração 0014 aplicada pela tarefa principal após autorização específica do usuário; backend atualizado ainda não publicado/verificado de ponta a ponta por esta integração local.

## Contrato adicional compatível

`POST /api/public/n8n/bridge`, com a mesma autenticação Bearer, limite de corpo e quota existentes:

```json
{
  "op": "appointment.confirm",
  "appointmentId": "ID_GHL_DA_CONSULTA",
  "contactId": "ID_GHL_DO_CONTATO",
  "expectedStartTime": "2026-10-07T15:30:00+01:00",
  "inboundMessageId": "ID_GHL_DA_RESPOSTA"
}
```

Não recebe texto, organização, location, estado ou credenciais do cliente. O escopo continua derivado de `ghl_location_bindings` e `ghl_connections` no servidor. As operações anteriores não mudam de formato.

## Evidência necessária

1. Consulta autenticada no calendário configurado, mesmo contato, horário exato e futuro, estado `new`, `booked` ou `confirmed`.
2. Contato autenticado na location esperada.
3. Mensagem consultada no GHL por seu ID, da mesma location e contato, direção `inbound`, canal SMS/WhatsApp e conteúdo `text/plain`. O corpo normalizado deve ser exatamente `SIM` ou `CONFIRMO`.
4. Solicitação `req24` ou `req12` aceita e registrada em `n8n_bridge_sends` antes da resposta, com o mesmo compromisso e horário. Uma execução local/simulada não é evidência de envio.
5. Mensagem de solicitação também reconsultada no GHL, direção `outbound`, mesma conversa e contato. A resposta deve ocorrer após a solicitação e antes da consulta.
6. O histórico da conversa é reconsultado e paginado até ficar completo (máximo de 10 páginas/1000 mensagens). O SIM deve continuar sendo a mensagem mais recente, sem outra pergunta/intervenção entre a solicitação verificada e a resposta. Empate de horário, histórico incompleto ou mensagem posterior bloqueia. A checagem é repetida perto do PUT.
7. A lista de solicitações precisa produzir exatamente uma consulta candidata. Duas consultas possíveis na mesma conversa exigem tratamento humano, mesmo que o cliente envie um appointmentId específico.

O servidor examina até 50 solicitações elegíveis do mesmo contato e organização; a função SQL devolve 51 para detectar excedentes e recusar sem truncamento silencioso. Falha em qualquer leitura de evidência impede a confirmação. Solicitações de outros contatos são excluídas na consulta SQL. O ID do contato é gravado durante a reserva de um novo envio, após leitura autenticada. A sobrecarga antiga de quatro parâmetros continua disponível; seus envios sem vínculo de contato não são aceitos como evidência. Mensagens dos workflows nativos do GHL não constam desse registro e não são prova para esta operação.

## Persistência e resultado

A migração `drizzle/migrations/0014_n8n_bridge_confirmations.sql` adiciona `contact_id` opcional aos envios, uma sobrecarga de reserva compatível e uma tabela com RLS, sem concessões para `anon`/`authenticated`, e três funções de confirmação exclusivas de `service_role`. Ela não muda flags, segredos ou conexões. Deve ser aplicada antes de disponibilizar a operação real. O journal Drizzle local inclui a entrada 0014. A tentativa de 05/10 havia sido bloqueada antes da execução. Em 06/10/2026, após autorização específica do usuário, a tarefa principal aplicou a migração e conferiu RLS ativo, ausência de concessões a anon/authenticated e execução das funções pelo serviço. As flags permaneceram inalteradas. Nenhuma publicação do novo backend foi executada por esta integração local.

Uma reserva única protege tanto `(organização, mensagem recebida)` quanto `(organização, consulta, horário)`. O resultado `unknown` ou `reserved` bloqueia novas tentativas automáticas. Só uma reserva efetua o PUT e só a transição inicial de `reserved` pode ser concluída.

Após a reserva, a consulta é reconsultada. O único corpo de atualização é:

```json
{"appointmentStatus":"confirmed","toNotify":false}
```

Não é enviada mensagem por essa operação. Uma leitura posterior deve comprovar o mesmo ID, contato, location, calendário e horário com estado `confirmed`; só depois o resultado é gravado e devolvido como confirmado. O n8n pode então solicitar a mensagem de agradecimento usando a operação de envio existente. `message.send kind=confirm` agora exige tanto estado GHL `confirmed` quanto registro durável `n8n_bridge_confirmations.state=confirmed` para a mesma organização, consulta e horário. Um estado GHL confirmado isoladamente não libera o agradecimento.

Em simulação, nenhuma reserva nem PUT ocorre, e a resposta contém `confirmed:false`. Escrita real continua dependente de `simulation=false`, `live_send_enabled=true`, `write_enabled=true` e conexão GHL válida. Nenhuma dessas flags foi alterada.

## Limites que permanecem explícitos

- A API GHL documentada não oferece comparação e troca do estado por versão. As leituras imediatamente anteriores da consulta/conversa e a verificação posterior reduzem e detectam mudanças, mas não tornam o GET→PUT atômico perante uma edição humana ou resposta concorrente após a última leitura. Não enviar PUT de cancelamento/remarcação automaticamente como compensação.
- O recebimento e encaminhamento do ID real da resposta pelo GHL/n8n precisam ser ligados e verificados separadamente; texto no webhook não substitui a leitura autenticada.
- Não se confirma automaticamente uma mensagem cujo ID, formato, contexto, momento ou solicitação de origem não puderem ser comprovados.
- `dateUpdated` é preservado em `appointment.get` somente quando fornecido e válido na fonte. A ausência nunca é preenchida com o horário da execução.
- O agradecimento e qualquer confirmação clínica são etapas distintas desta atualização de estado da agenda.

## Referências oficiais verificadas

- [Get message by message id](https://marketplace.gohighlevel.com/docs/ghl/conversations/get-message/index.html)
- [Get messages by conversation id](https://marketplace.gohighlevel.com/docs/ghl/conversations/get-messages/index.html)
- [Update appointment](https://marketplace.gohighlevel.com/docs/ghl/calendars/edit-appointment/index.html)

Os contratos acima foram conferidos na documentação oficial. O formato de resposta do provedor e as permissões efetivas ainda precisam de validação no ambiente conectado antes de declarar funcionamento de ponta a ponta.

## Guarda do agradecimento após a confirmação

Antes de reservar `message.send kind=confirm`, o servidor lê a referência da confirmação persistida e reconsulta a mensagem SIM/CONFIRMO, a solicitação correspondente e o histórico completo. Resposta posterior NÃO/REMARCAR, intervenção humana, referência inconsistente ou falha de leitura bloqueiam o agradecimento, mesmo se o GHL continuar `confirmed`. Essa verificação é repetida depois da reserva, imediatamente antes do POST; se o contexto mudou, a reserva termina `rejected` e nenhuma mensagem é enviada. A consulta também é reconsultada após a leitura do histórico. A guarda não repete o PUT nem altera a confirmação anterior. Não exige nova migração.

O limite externo permanece: um evento que chegue após a última leitura e antes do POST não pode ser excluído atomicamente pela API GHL. Não se afirma garantia de atomicidade entre os sistemas.

## Reprodução dos testes locais

Usar as dependências já instaladas do checkout:

```sh
./node_modules/.bin/vitest run src/lib/n8n-bridge-confirmation.test.ts src/lib/n8n-bridge-confirmation.adapter.test.ts src/lib/n8n-bridge.test.ts src/lib/n8n-bridge.adapter.test.ts src/lib/n8n-bridge.escopo.test.ts
./node_modules/.bin/tsc --noEmit --pretty false
```

O teste SQL utiliza `embedded-postgres` e `pg` do runtime existente, separados das dependências principais. `BIOREPORT_TEST_RUNTIME` aponta para o diretório desse runtime (contendo `package.json` e `node_modules`); não é uma URL nem uma credencial. O banco é temporário em loopback, sem acesso ao banco conectado. Não instalar outro runtime para executar esta revisão.

```sh
BIOREPORT_TEST_RUNTIME="/caminho/do/runtime/existente/test/bioreport-runtime" ./node_modules/.bin/vitest run src/lib/n8n-bridge-confirmation.db.test.ts
```
