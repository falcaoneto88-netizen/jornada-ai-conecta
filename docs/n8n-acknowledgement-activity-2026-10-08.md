# Atividade técnica após confirmação — 08/10/2026

## Causa observada

Após a resposta autêntica CONFIRMO, o backend confirmou o compromisso e persistiu `state=confirmed` às 19:18:34.043998 UTC. O GHL acrescentou à conversa uma atividade às 19:18:34.961 UTC, com tipo `TYPE_ACTIVITY_APPOINTMENT`/31, direção outbound, source `app`, sem `userId`. A validação publicada do agradecimento devolveu `reply_superseded` ao encontrar esse item posterior à resposta. Não havia outro item posterior no histórico autenticado inspecionado.

A lista autenticada expôs `activity.type=appointment_updated` e `activity.data.id`/`timestamp` correspondentes ao compromisso e ao início exatos. `data` também trouxe `serviceBookingId:null`, `industryType:null` e `appointmentTitle:string`. Não expôs status anterior/novo, calendário ou ator. O GET individual não trouxe esse objeto; não se deve fabricar o vínculo a partir do título ou corpo.

## Correção restrita ao agradecimento

O helper privado `acknowledgementContext` é utilizado somente por `validarAgradecimento`, depois da comprovação do ledger, mensagem inbound e pedido aceito. A validação normal de resposta, resolução de resposta, confirmação inicial e lembretes não ganha uma exceção.

A leitura do ledger confirmado inclui a coluna `finished_at` já existente. Ela deve ser uma data válida posterior à resposta, anterior ao início e não futura. Não há migração. O histórico completo continua verificando IDs, location, contato, conversa, datas, duplicação e paginação.

Somente um ID de atividade pode ser desconsiderado na avaliação do agradecimento, quando **todos** os critérios forem satisfeitos:

- Tipo numérico 31 e `messageType=TYPE_ACTIVITY_APPOINTMENT`, outbound, source `app`, sem propriedade `userId`.
- `activity` contém apenas `type`, `data` e título opcional. Tipo exatamente `appointment_updated`.
- `data` contém apenas `id`, `timestamp`, `serviceBookingId`, `industryType` e `appointmentTitle` opcional de tipo string. ID e instante de início são exatos; os dois campos de contexto são null. Campos adicionais de status, old/new, calendário ou autor bloqueiam a exceção.
- `dateAdded` e `dateUpdated` são iguais e válidos, não futuros, entre a conclusão persistida e no máximo cinco segundos depois. Como o banco conserva microssegundos, o limite inicial é arredondado para cima e o final para baixo à precisão de milissegundos; não se amplia a janela.
- O GET fresco do compromisso ainda comprova status `confirmed` e os mesmos IDs, contato, calendário e início. Os bloqueios de autenticação, DND, grant e reservas continuam necessários.

Qualquer mensagem real posterior, inclusive outro SIM, resposta negativa ou outbound humano, mantém a recusa. Atividade de outro compromisso/horário, sem vínculo, editada, fora da janela, com metadados adicionais incompatíveis ou duplicada também mantém a recusa. A validação é repetida após a reserva do agradecimento antes do POST; não executa outro PUT de confirmação.

## Limite da evidência

Esta é uma **correlação temporal e de identidade restrita**, apropriada ao piloto supervisionado com uma execução e sem intervenções simultâneas. `source=app` e ausência de `userId` não provam quem realizou a alteração. A atividade não fornece status nem autoria e não é tratada como prova independente de confirmação; o ledger e o readback continuam sendo necessários. Uma intervenção externa concorrente sobre a mesma consulta na mesma janela pode ser indistinguível com os campos disponibilizados. Não se afirma causalidade inequívoca, ausência de corrida distribuída ou `concurrency_verified=true`.

Não há filtro global de `TYPE_ACTIVITY_*`, remoção de mensagens no CRM ou alteração do histórico original. A cópia temporária usada pelo helper elimina no máximo o único ID correlacionado. O caminho de recuperação precisa pedir somente o agradecimento pendente, mantendo o booking, pedido e confirmação já persistidos e suas chaves.

## Verificação

Gates locais concluídos: **528 testes em 13 suítes**, TypeScript sem erros, lint dos arquivos alterados sem erros e build exit0. A revisão independente não encontrou bloqueador novo depois de restringir as chaves estruturadas. Os avisos existentes do build foram preservados. SQL não mudou e seus testes não foram reexecutados.

```sh
node_modules/.bin/vitest run src/lib/n8n-bridge-confirmation.test.ts src/lib/n8n-bridge-confirmation.adapter.test.ts src/lib/n8n-bridge.test.ts
node_modules/.bin/tsc --noEmit
npm run build
```

O marcador público aditivo é `capabilities.n8nAcknowledgementActivity: 1`; build e demais capacidades permanecem. A integração precisa preservar o remoto atual. Publicação do código, grant/flags habilitados e recebimento do agradecimento são verificações distintas. Este incremento local não publica, não habilita flags e não envia mensagens.
