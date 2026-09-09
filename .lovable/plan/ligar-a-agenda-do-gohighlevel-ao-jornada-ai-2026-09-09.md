# Ligar a agenda do GoHighLevel ao Jornada AI

Agenda a ligar: `nPXR1Fyp0r3CpaMMGSki` (conta/location já validada e ligada).

## O que vai passar a existir

1. **Agenda ligada em Integrações**
   - A tela Integrações passa a listar as agendas reais da conta e permite escolher a agenda de Harmonização; a agenda indicada fica gravada como agenda oficial.
   - Antes de gravar, o sistema confirma que essa agenda existe mesmo na conta ligada; se não existir, mostra erro claro e não grava.

2. **Nova secção "Agenda"**
   - Nova entrada no menu, ao lado de Jornada.
   - Lista as marcações por dia (hoje, próximos 30 dias, e histórico recente), com hora no formato DD/MM/AAAA HH:MM, nome do cliente, estado da marcação (confirmada, faltou, cancelada, realizada) e responsável.
   - Botão "Atualizar agenda" para trazer novamente do GoHighLevel; estados de vazio, a carregar e erro.
   - Só leitura: nada é criado nem alterado no GoHighLevel.

3. **Ligação à ficha do cliente**
   - Cada marcação é associada ao cliente correspondente (pelo contacto do GoHighLevel); se o cliente ainda não existir na base, é criado como cliente real a partir dos dados do contacto.
   - Na Jornada e em Clientes passa a aparecer a próxima marcação do cliente.
   - Marcações sem cliente identificável ficam assinaladas como "por associar", nunca associadas ao cliente errado.

4. **Repetir a importação não duplica**
   - Cada marcação é identificada pelo seu ID no GoHighLevel; repetir a atualização actualiza a mesma linha.

## Detalhes técnicos

- Migração aditiva: tabela `appointments` (`organization_id`, `contact_id`, `ghl_appointment_id`, `ghl_calendar_id`, `title`, `start_at`, `end_at`, `status`, `assigned_user_name`, `is_demo`, timestamps), índice único por (`organization_id`, `ghl_appointment_id`), GRANTs para `authenticated`/`service_role`, RLS por organização e papel no mesmo padrão de `opportunities`.
- `src/lib/ghl.server.ts`: acrescentar operações de leitura na allowlist — `calendars.list` (já existe) e `calendars.events` (`GET calendars/events` com `locationId`, `calendarId`, `startTime`, `endTime`), sem escrita, mantendo origem fixa, versão fixa, bloqueio de redirects e imposição do `location_id` do binding.
- `src/lib/ghl-agenda.core.ts` (puro, testável): normalização de eventos, validação de janela temporal, associação ao contacto, deduplicação e relatório de ocorrências (`por associar`, `agenda diferente`, `ignorado`).
- `src/lib/ghl-agenda.functions.ts`: `listarAgendas`, `configurarAgenda` (valida o ID contra a lista oficial da location antes de gravar em `ghl_connections.calendar_id`) e `sincronizarAgenda`, todas com `requireSupabaseAuth`, resolução utilizador → organização → papel → binding, e auditoria em `audit_logs`.
- `src/routes/agenda.tsx`: nova rota com `head()` próprio, hooks `useAgenda`, invalidação de caches após sincronizar; consulta apenas `is_demo=false` em modo conta e dados demo em modo demonstração.
- `src/lib/repo.ts`: leitura das marcações e da próxima marcação por cliente (demo e real).
- `src/routes/integracoes.tsx`: seletor de agenda com lista real e estado da ligação; invalida agenda/clientes após configurar.
- Testes Vitest focados em: validação da agenda contra a lista oficial, janela temporal, deduplicação por ID, marcação sem contacto (não associa nem apaga vínculo anterior), e evento de outra agenda tratado como ocorrência.
- Suíte, tipos e build executados no fim. Sem publicação e sem qualquer escrita no GoHighLevel.

## Fica de fora

- Criar, remarcar ou cancelar marcações no GoHighLevel.
- Sincronização automática periódica (a atualização é manual ou por webhook, já existente para contactos).
