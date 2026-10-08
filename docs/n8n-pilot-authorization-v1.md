# Piloto explícito de um agendamento — contrato v1

Data: 08/10/2026. Candidato local baseado em `19d5e22ac77093798a1d6f11f3681e1044ca8726`. Não publicado, sem migração remota, sem grant e sem envio real executado por este trabalho. O release remoto tem alterações independentes: integrar por diff, preservar arquivos e metadados existentes.

## Problema e decisão

As flags anteriores habilitam o bridge para a organização/agenda. Não havia allowlist própria que restringisse um teste real a um único contato e agendamento. A tabela nova `n8n_bridge_pilot_grants` autoriza no máximo uma tupla por organização: contato exato, compromisso exato, instante inicial, expiração e ações enumeradas. A ausência de grant deixa todas as escritas reais do bridge bloqueadas, mesmo para quem tem um Bearer válido. Não há fallback para envio amplo.

O piloto não altera `simulation`, `live_send_enabled`, `bridge_enabled`, `channel_verified`, write enablement do GHL nem `concurrency_verified` do n8n. Um grant ativo não comprova canal, entrega, consentimento, configuração do workflow ou execução ponta a ponta. Contatos duplicados não são fundidos nem tratados como aliases: compromisso, mensagem de solicitação e resposta precisam pertencer ao mesmo ID verificado.

## Contrato HTTP preservado

As operações e corpos existentes permanecem iguais. O cliente não fornece org, location ou grant; campos adicionais continuam rejeitados pelo schema estrito. A organização vem do escopo autenticado no servidor e o alvo é cruzado com leitura atual do GHL.

A resposta autenticada de `health` acrescenta:

```ts
pilot: {
  status: "off" | "active" | "expired" | "unavailable";
  contactId: string | null;
  appointmentId: string | null;
  expectedStartTime: string | null;
  expiresAt: string | null;
  allowedKinds: ("booking" | "req24" | "req12" | "confirm" | "appointment.confirm")[];
}
```

`off` cobre linha ausente, desabilitada ou sem ações; campos do alvo ficam nulos. `unavailable` cobre erro de leitura, schema ausente, dados inválidos ou organização divergente. O relógio do servidor é a autoridade: expiração e início do compromisso são limites exclusivos. Datas são ISO com offset; o início segue a normalização por segundo já adotada pelo bridge. O grant não aceita comentários internos `escalation`/`handoff`; esses tipos continuam no contrato HTTP, mas sem autorização real neste piloto estreito.

Erros novos: `503 pilot_unavailable`, `403 pilot_expired`, `403 pilot_not_authorized`. Saúde continua disponível para diagnóstico sem afirmar que está pronta para envio.

## Precedência e persistência

1. Autenticação, limite de corpo, schema estrito, rate limit, org/location, flags de conexão, compromisso/contato/agenda/status/horário e demais guardas existentes continuam necessários.
2. Simulação retorna sem reservar, confirmar ou enviar. Grant não transforma uma simulação em execução real.
3. As flags reais existentes precisam permitir a ação. `req24`/`req12` ainda rejeitam resposta/intervenção posterior. O agradecimento ainda exige confirmação durável, SIM/CONFIRMO autêntico e contexto fresco; um grant não substitui essas provas.
4. Só então há leitura de grant antes da reserva durável. Falha não reserva e não executa POST/PUT.
5. Após a reserva e as verificações atuais de evidência, o grant é lido novamente imediatamente antes do efeito externo. Revogação, expiração, alteração do alvo ou falha de leitura marca a reserva `rejected`, sem efeito remoto. A confirmação também verifica o grant antes de persistir prova quando o GHL já está confirmado, sem repetir PUT.
6. Reservas e chaves únicas existentes não mudam. Repetições aceitas reutilizam o resultado; reservado/unknown não é reenviado automaticamente. Se até a gravação de `rejected` falhar, a reserva durável anterior continua impedindo novo efeito automático; não se afirma persistência concluída.

## Configuração e revogação administrativa

A função servidor nova `guardarPilotoN8n`, em `src/lib/n8n-bridge.functions.ts`, usa o middleware de sessão já existente. `guardarPilotoBridge` verifica usuário autenticado, papel administrador, organização do perfil igual ao vínculo GHL e origem exata confiável do projeto. Não recebe token, organização ou location do cliente. Não há novo segredo ou credencial.

Entrada de ativação (IDs e horários abaixo são apenas o formato, sem valores reais):

```ts
{
  enabled: true,
  contactId,
  appointmentId,
  expectedStartTime, // ISO com offset, compromisso futuro na agenda configurada
  expiresAt,        // > agora; <= início; <= agora + 24 horas
  allowedKinds: ["booking", "req24", "appointment.confirm", "confirm"]
}
```

Antes de gravar, o servidor faz GET do contato e compromisso, verifica ID/location/contato/agenda/início/status e lê de volta a linha persistida. Escreve só a tabela de grants; não modifica GHL, flags ou credenciais. Revogação: `{ enabled: false }`; não depende de leitura do GHL e não restaura flags. O cartão n8n em `/integracoes` contém a seção **Piloto de um agendamento**, visível apenas para administradores fora do modo demo. Preencher contato/compromisso exatos, início e expiração ISO com fuso e marcar as ações permitidas; **Guardar autorização do piloto** chama esta função pela sessão autenticada. **Revogar autorização** envia somente `{ enabled: false }`, independentemente dos campos ainda não salvos. Não há SQL direto, Bearer do bridge ou segredo no browser. A leitura administrativa retorna o estado persistido e o instante da verificação; a badge é uma fotografia dessa leitura, não um relógio de validade. **Atualizar estado do piloto** relê o servidor. Nenhuma operação ocorre ao montar a tela.

Nenhum grant deve ser pré-criado: primeiro obter o ID exato de um compromisso de teste novo e a identidade correspondente ao canal receptor; depois configurar apenas as ações necessárias e janela curta. Outro agente comercial eventualmente autorizado para o mesmo contato mantém suas próprias regras; intervenções desse agente continuam invalidando lembretes/agradecimento no bridge.

## Migração e implantação

1. Rever o diff contra o HEAD remoto atual, preservando edições independentes. O journal local registra idx15/tag `0015_n8n_bridge_pilot_grants`, após idx14 existente; revalidar que nenhum novo idx15 remoto surgiu antes de integrar.
2. Aplicar a migração aditiva `drizzle/migrations/0015_n8n_bridge_pilot_grants.sql` pelo processo autorizado do projeto. Ela não contém seed. Conferir tabela vazia, RLS=true e ausência de grants para PUBLIC/anon/authenticated. Na aplicação, apenas service_role tem acesso; além de service_role e postgres, a plataforma mantém o papel interno privilegiado `sandbox_exec` (BYPASSRLS, com leitura/inserção na ACL). anon e authenticated não herdam nenhum desses papéis (verificado por SQL em 08/10/2026), portanto clientes autenticados comuns não podem ler nem escrever grants diretamente.
3. Publicar o código mantendo os outros campos de `/api/version`. A capacidade aditiva `capabilities.pilotAuthorization: 1` identifica esta guarda sem renomear o build já existente. Verificar a presença da capacidade publicada e `health.pilot.status=off` autenticado, com todas as flags ainda preservadas.
4. Só depois de identidade e novo compromisso verificados, configurar o grant com a sessão administrativa autorizada. Verificar readback e saúde autenticada. A criação não ativa canal/flags/workflow.
5. A eventual habilitação real continua sendo uma ação operacional distinta, limitada ao grant. O roteiro manual n8n precisa confirmar a tupla e saúde novamente antes de cada passo; webhooks e fluxo global permanecem em simulação. Depois do teste, revogar o grant e restaurar as flags temporariamente alteradas pelo operador, se houver.

Se a migração estiver ausente, o código falha fechado (`pilot_unavailable`) em escrita real. Se o código ainda for antigo, a tabela isolada não protege escrita: não habilitar flags confiando apenas na migração. Este candidato não aplica SQL, não publica e não ativa nada.

## Limites reais

Não há transação distribuída entre PostgreSQL e GHL. Revogação, mudança de horário, nova resposta ou intervenção depois da última releitura e antes de um POST/PUT remoto ainda tem uma pequena janela de corrida. Não se introduz CAS no GHL nem se afirma eliminar essa janela. O piloto exige execução manual supervisionada, com um único disparo por fase, sem mudanças simultâneas no agendamento. As reservas existentes protegem repetição da mesma ação; não são um mutex global para toda a jornada. `concurrency_verified` permanece false.

A simulação, testes sintéticos e uma resposta `accepted` não comprovam entrega nem consentimento. Ponta a ponta só após solicitação enviada, resposta autêntica vinculada, confirmação persistida, agradecimento aceito e recebimento verificado no contato exato. Se outra conversa/intervenção torna o SIM ambíguo, a guarda bloqueia e exige revisão humana.

## Reprodução de testes

Usar as dependências existentes compatíveis com `bun.lock`; nenhum pacote novo foi adicionado.

```sh
node_modules/.bin/vitest run src/components/n8n-pilot-control.test.tsx src/lib/n8n-bridge.test.ts src/lib/n8n-bridge-confirmation.test.ts src/lib/n8n-bridge-reply-resolve.test.ts src/lib/n8n-bridge-reminders.test.ts src/lib/n8n-bridge-dnd.test.ts src/lib/n8n-bridge.adapter.test.ts src/lib/n8n-bridge.escopo.test.ts src/lib/n8n-bridge.credentials.test.ts src/lib/n8n-bridge-pilot.test.ts src/lib/n8n-bridge-pilot.admin.test.ts
BIOREPORT_TEST_RUNTIME="$PWD/../integration-review-2026-09-21/test/bioreport-runtime" node_modules/.bin/vitest run src/lib/n8n-bridge-pilot.db.test.ts src/lib/n8n-bridge-confirmation.db.test.ts
node_modules/.bin/tsc --noEmit
npm run build
```

`BIOREPORT_TEST_RUNTIME` aponta para o runtime local já existente com `embedded-postgres` e `pg`, fora das dependências padrão. O helper cria PostgreSQL temporário em loopback, não lê DATABASE_URL nem credenciais do banco real. Em sandbox restrito pode precisar permissão para abrir a porta local; `EPERM 127.0.0.1` não é falha da migração. Gates desta revisão: 395 testes de contrato/adaptadores/admin/UI + 23 testes PostgreSQL, executados em suítes separadas. Tsc sem erros, lint dos arquivos alterados sem erros e build exit0 também concluídos localmente. Avisos de depreciação e bundling existentes foram preservados; não houve correção fora do escopo.

## Incremento de interface — 08/10/2026

Incremento local separado sobre `f90d8edae4ac2457ade805c6acf61f0d2efefbc9`: seção no cartão existente, leitura de grant por sessão administrativa e testes DOM do formulário/integração. Não inclui migração adicional, ativação ou envio. Tsc, lint e build locais não equivalem à validação visual/publicada; a abertura da página real e o uso da sessão administrativa devem ser verificados após implantação. Uma gravação só mostra sucesso após a função servidor comprovar persistência; a interface mantém o estado lido e exibe bloqueios de envio separadamente.
