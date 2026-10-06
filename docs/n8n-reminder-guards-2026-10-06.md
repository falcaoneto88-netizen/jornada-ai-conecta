# Guarda de lembretes e concorrência — 06/10/2026

Implementada localmente para `message.send kind=req24/req12`. Não altera contrato HTTP, banco, flags, credenciais nem o marcador `concurrency_verified` do n8n. Publicação e verificação com mensagens reais continuam tarefas distintas.

## Problemas concretos contidos

1. **NÃO ou atendimento humano antes do req12.** A retoma pode ter lido `pending` antes da resposta e regravar estado antigo. O GHL pode continuar `booked`, por isso apenas consultar a agenda não impedia o lembrete. Agora qualquer mensagem recebida ou intervenção não pertencente aos envios aceitos desse percurso, desde o aviso inicial, impede req24/req12.
2. **SIM ou confirmação durante a reserva do lembrete.** O SQL garante unicidade por tipo de mensagem, não exclusão entre req12 e `appointment.confirm`. A guarda é repetida depois de adquirir a reserva e imediatamente antes do POST: reconsulta histórico, preferências e compromisso. Resposta, atendimento, DND, cancelamento, remarcação ou confirmação observada nessa etapa termina a reserva como `rejected`, sem POST.
3. **Duas retomadas/reentregas do mesmo lembrete.** A reserva SQL existente continua sendo a autoridade. Apenas o vencedor pode fazer o POST; `reserved`/`unknown` não são repetidos automaticamente. Atualização antiga da Data Table não cria uma segunda autorização no ledger.

## Implementação mínima

- `src/lib/n8n-bridge-reminders.ts`: valida a evidência e a elegibilidade. Reutiliza os parsers de mensagens, de contato/consulta e a paginação completa já usados na confirmação.
- `src/lib/n8n-bridge.server.ts`: `criarDepsLembretes` lê no máximo três registros de `n8n_bridge_sends`, por igualdade exata de organização, consulta, horário, contato, tipo e `state=accepted`. Não cria função SQL, reserva nem tabela.
- `src/lib/n8n-bridge.core.ts`: executa a guarda antes da simulação/reserva e repete depois da reserva antes de enviar. As demais guardas e a finalização de envio existentes permanecem.

`req24` exige um `booking` aceito, com messageId autenticado, na mesma consulta e horário. `req12` exige também `req24` aceito. Mensagens antigas/simuladas e registros sem contato não atendem ao contrato. Assim, a simulação pode apontar falta de evidência real; ela não inventa um envio anterior para fazer a validação passar.

A âncora temporal é o **primeiro aviso booking** desse mesmo percurso, e não o lembrete mais recente. Isso impede que um req24 atrasado, registrado após um NÃO, apague o limite da resposta anterior. O histórico precisa conter os IDs e momentos dos envios aceitos, todos na mesma conversa/contato/location/canal. Após a âncora, são permitidos somente os IDs desses envios aceitos. Inbound, mensagem humana, outra automação ou mensagem sem correspondência bloqueiam. Histórico incompleto, cursor inválido, divergência de identidade ou leitura indisponível não significam ausência de resposta.

Depois de ler a conversa, a guarda relê o contato e o compromisso. Exige ausência de DND, mesmo ID/contato/calendário/horário futuro e estado `new` ou `booked`. `confirmed` recusa com `appointment_already_confirmed`. Resultados da guarda não incluem corpo de mensagens.

Erros novos: `reminder_evidence_unavailable` (503 para ledger, 502 para mensagem GHL), `reminder_evidence_invalid`, `reminder_request_missing`, `reminder_history_unavailable` e `reminder_reply_or_intervention` (409). Os erros de contato, DND e consulta continuam os existentes.

## O que isto permite concluir

Para req24/req12, uma Data Table n8n obsoleta pode provocar uma tentativa recusada ou um estado de projeção impreciso, mas não substitui a prova de elegibilidade e unicidade do servidor. O agradecimento já possui guarda própria da resposta mais recente, e `appointment.confirm` já faz reserva durável e releituras autenticadas.

Isso contém os cenários acima sem exigir uma serialização global do n8n. Não foi removida a exigência `concurrency_verified`: antes de mudar essa política, é preciso distinguir os efeitos protegidos de falhas de projeção/retoma e revalidar o workflow publicado. A Data Table ainda pode perder atualização sob upserts concorrentes, e o nó que exige persistência local antes do agradecimento pode bloquear uma confirmação que o backend já comprovou. Isso é uma falha de continuidade/reconciliação; não prova que um segundo envio foi autorizado.

Esta correção não ampliou a guarda de conversa a `escalation`/`handoff` (comentários internos). Em particular, uma escalada interna “sem resposta” atrasada ainda precisa ser distinguida dos lembretes ao paciente. Não afirmar a jornada inteira resolvida somente por estes testes.

## Limite externo real

Não existe CAS documentado entre a última leitura GHL e o POST. Uma resposta ou alteração pode surgir depois dessa leitura. A nova checagem reduz a janela e barra mudanças já observáveis; não promete atomicidade entre sistemas. Serializar execuções do n8n também não impediria uma mensagem ou edição humana externa nessa janela. Não se cria compensação automática, reenvio nem falsa flag de concorrência para ocultar esse limite.

## Evidência local

A suíte nova cobre elegibilidade, ausência de fonte, identidade, histórico incompleto, resposta/intervenção antes e durante a reserva, SIM/confirmed/cancelamento/remarcação concorrentes, DND novo, reentrega e dois concorrentes com somente um POST. Os testes existentes de reservas SQL continuam complementando o teste de orquestração com mock de reserva; são provas diferentes.

Comandos:

```sh
./node_modules/.bin/vitest run src/lib/n8n-bridge-reminders.test.ts src/lib/n8n-bridge.test.ts src/lib/n8n-bridge-dnd.test.ts
./node_modules/.bin/tsc --noEmit --pretty false
```

O primeiro gate focado passou: 121 testes nas três suítes. O gate integrado e a revisão de publicação ficam registrados em `MCP_CODEX_HANDOFF.md` pela tarefa principal.

## Configuração de concorrência n8n Cloud

A documentação oficial consultada em 06/10 descreve limites de produção por instância/plano e fila FIFO; execuções manuais, subworkflows e erros não usam esse limite. As configurações por workflow documentadas não incluem máximo de execuções paralelas. `executionOrder=v1` ordena ramos dentro de uma execução, não serializa várias execuções do workflow. Não foi encontrado suporte documentado para configurar este workflow Cloud com concorrência 1.

Fontes oficiais: [concorrência Cloud](https://docs.n8n.io/deploy/use-n8n-cloud/understand-concurrency), [configurações de workflow](https://docs.n8n.io/build/manage-workflows/configure-workflow-settings), [controle disponível em self-hosted](https://docs.n8n.io/deploy/host-n8n/configure-n8n/scaling/control-concurrency).
