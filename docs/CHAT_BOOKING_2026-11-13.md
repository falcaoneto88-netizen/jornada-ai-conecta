# Agendar pelo Meu Chat — 13/11/2026

## Fluxo do atendente

1. Abrir a conversa do contato existente e clicar em **Agendar agora**, junto à Izabel.
2. Escolher a data e um horário devolvido pela agenda configurada para a organização. Os horários usam o fuso IANA da organização; não o relógio do computador.
3. Revisar contato, calendário, data, duração e local quando disponível. A opção de acionar confirmações e lembretes começa desmarcada.
4. Clicar em **Criar agendamento**. A disponibilidade e o contexto são conferidos novamente pelo servidor.
5. Após a leitura de confirmação do GHL, voltar à conversa. O rascunho fica preservado; o contexto e a agenda local são atualizados.

O botão não cria um cadastro novo, não envia a resposta escrita no chat e não modifica workflows. Remarcação e cancelamento continuam no GHL. O nome do contato na revisão deve ser conferido antes do clique final.

## Dados e efeitos externos

O POST para o GHL contém somente `calendarId`, `locationId`, `contactId`, `startTime`, `endTime`, `appointmentStatus: new`, `toNotify` e as proteções `ignoreFreeSlotValidation: false` / `ignoreDateRange: false`. Não envia conversa, resumo da Izabel, notas, diagnóstico, imagens, valores ou sinais. O GHL permanece a fonte do compromisso; os valores administrativos continuam no módulo financeiro local existente.

`toNotify` é `false` por padrão. Ao marcar a opção, o atendente autoriza a política de notificações/automações já configurada no calendário. Isso não garante entrega de mensagens. Nenhuma automação é reconstruída ou ativada por esta implementação.

O estado interno do recibo `confirmed` significa **criação verificada**, não presença confirmada. O cache existente usa `confirmada` como estado administrativo; isso também não constitui evidência de resposta SIM nem de pagamento. O acompanhamento por evidência permanece separado.

## Autorização e confiabilidade

- A sessão resolve organização, papel, vínculo de location e credencial no servidor. IDs do cliente são conferidos, nunca usados para escolher outro tenant.
- Exige papel administrador/gestor/comercial, contato local não demonstrativo com ID GHL único, contato remoto na location esperada, calendário configurado e escrita habilitada.
- A API Calendar v3 fica num adaptador próprio. O helper geral GHL e sua versão `2021-07-28` permanecem intactos.
- Antes do POST, a RPC grava uma reserva durável. Repetir o mesmo UUID não repete o POST; outro UUID para o mesmo contato/calendário/início também é bloqueado enquanto o pedido não tiver sido rejeitado.
- O POST não tem repetição automática. Timeout, retorno inválido ou falha de persistência posterior ficam pendentes/incertos. **Verificar resultado** apenas consulta o pedido e, quando existe ID remoto confiável, lê esse compromisso exato.
- Sem ID confiável, não se associa um evento por aproximação de nome ou horário. É necessária conferência operacional no GHL; o app não libera uma nova tentativa que possa duplicar a consulta.
- Se uma leitura autenticada comprovar que o UUID não chegou a ser reservado, **Encerrar pedido sem registro** registra seu cancelamento preventivo no servidor. A mesma trava transacional impede uma chamada atrasada de reservar esse UUID. Se a reserva já existir, a ação devolve o recibo existente e mantém a verificação; não cancela o compromisso.
- O navegador guarda somente referências de recuperação por atendente/organização/contato. Rascunhos e dados da consulta não são copiados para esse registro.
- O ledger não é acessível a `anon` ou `authenticated`; sua RPC é exclusiva do backend e revalida o papel e a organização do ator.

## Estrutura

- `src/components/inbox-booking-panel.tsx`: seleção, revisão, recuperação e retorno ao chat.
- `src/components/ghl-inbox.tsx`: ação contextual no contato atual.
- `src/lib/chat-booking.core.ts`: contrato, duração, datas, horários e validação de eventos.
- `src/lib/chat-booking.server.ts`: acesso, adaptador GHL, serviço e recibos.
- `src/lib/chat-booking.functions.ts`: fronteira autenticada.
- `drizzle/migrations/0026_chat_booking_requests.sql`: ledger, exclusão de duplicações, RPC, cache e auditoria. O arquivo Supabase equivalente é um espelho, não uma segunda migração a executar.

## Implantação e limites de verificação

Aplicar a migração 0026 **uma vez** no projeto original, antes de liberar a operação. Revalidar journal, catálogo, ACL/RLS e revisão atual antes de aplicar; não repetir as migrações anteriores. A interface informa atualização pendente quando a RPC/tabela ainda não existe.

Conferir na prévia autenticada a leitura do contato, calendário, duração e horários reais. Alguns tipos de agenda ou duração ambígua são bloqueados de propósito; não se inventa duração nem se ignora disponibilidade. O token já existente precisa dos escopos de leitura de calendário/contato e escrita de eventos; nenhuma credencial ou permissão é alterada automaticamente.

Testes locais usam contatos, eventos e respostas sintéticos. Eles não comprovam uma criação real, entrega de mensagem ou execução de workflow. A primeira consulta real deve ser revisada no botão final pelo atendente; conferir o ID criado e a ausência de duplicação no GHL. Evidências locais e da atualização no Lovable serão registradas separadamente na entrega.

## Validação local realizada

- 225 testes passaram numa rodada de nove arquivos: contrato/serviço de agendamento, painel novo, fuso, agenda, valores administrativos, contexto e Izabel.
- 82 testes da Caixa de Entrada passaram numa rodada separada, incluindo rascunho/proveniência preservados ao abrir e fechar o agendamento.
- 24 testes SQL passaram com a cadeia completa de migrações em PGlite 0.5.16 isolado. Cobrem isolamento, ACL/RLS, reserva, repetição, cancelamento preventivo, persistência, cache e auditoria. O motor serializa transações: isso não comprova concorrência multiconexão num PostgreSQL nativo. A suíte nativa está preparada para `PG_TEST_BINDIR`.
- TypeScript e build de produção passaram. O lint dos arquivos alterados não tem erros. O lint global ainda aponta formatação preexistente em arquivos fora desta alteração; não houve reformatação geral.
- Prévia sintética em 1440×900 e 390×844: criação simulada, data alterada pelo teclado, revisão com notificações desmarcadas, retorno/Escape e rascunho preservados. Sem rolagem horizontal nas duas larguras. Nenhuma chamada real a CRM/modelo/serviço de mensagens nessa prévia.
- O detector Impeccable analisou os arquivos TSX sem novos achados; sua análise por expressões regulares não mede contraste ou layout. A conferência visual foi separada.
