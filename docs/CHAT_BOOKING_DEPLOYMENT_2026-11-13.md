# Agendar agora + Izabel unificada — implantação na prévia (13/11/2026)

## Revisões
- Inicial: 7b8cb390b7ba310fd9031b03638a612751d63833 (igual à base verificada; árvore limpa).
- Patch: JORNADA_IZABEL_AGENDAMENTO_PATCH.txt, SHA-256 430a6ad45af34da3f16f82eee63bd8cf2e82429b7a14438f33ec043cb7065b0b, 28 arquivos (inclui o conteúdo do PR4 Izabel unificada; PR4 não foi mesclado de novo).
- Aplicação: `git apply` é bloqueado neste ambiente; usado `patch -p1 --dry-run` (28/28 sem conflito) e depois `patch -p1`.
- Final: ver commit deste documento.

## Migração 0026_chat_booking_requests
- Antes: catálogo sem tabelas/função; histórico com 26 registros (último id 26, 0025).
- Aplicada UMA vez pela ferramenta oficial de migração; o espelho supabase/migrations/20261113150000 não foi executado.
- SQL aplicado = arquivo do patch byte a byte: SHA-256 39ce4d867037952712dcb17dffc72833e2a1b51a376f28a80439224285245e8b.
- Journal: entrada 0026 do patch (when 1794592800000) substituída pela registada pela ferramenta: idx 26, when 1794598923522. Histórico: 27 registros, id 27, entrada única. Snapshot 0026 regenerado pela ferramenta: id 5b06d541… (o do patch era ece5f2b7…); prevId d0543812… igual. 0014–0025 intocadas.
- Nome exato da segunda tabela no SQL: `chat_booking_abandoned_requests` (não "chat_booking_cancellations").
- Pós-catálogo: `chat_booking_requests` e `chat_booking_abandoned_requests` com RLS ativa, 0 policies; ACL postgres/service_role (+ `sandbox_exec=ar`, ACL default preexistente do ambiente, como em 0025); sem anon/authenticated. `chat_booking_command` SECURITY DEFINER, EXECUTE só postgres/service_role; `chat_booking_snapshot` não SECURITY DEFINER, mesma ACL.
- types.ts regenerado pela ferramenta. Nenhuma credencial, integração, permissão ou write_enabled alterada.

## Gates
- Typecheck (tsc --noEmit) e build: OK.
- Vitest dos 9 arquivos de teste do patch: 8 arquivos aprovados, 266 testes aprovados, 24 ignorados. `chat-booking.db.test.ts` não executou neste ambiente: exige PostgreSQL nativo (PG_TEST_BINDIR ausente). Os 24 SQL/PGlite relatados localmente pelo autor não foram reproduzidos aqui; PGlite ≠ PostgreSQL nativo.
- Lint global não reformatado.

## Leitura na prévia autenticada (somente consulta)
- Caixa de Entrada → Felipe Santos → Agendar agora → data 16/11/2026.
- Mostrado: "Para Felipe Santos, no cadastro existente do GHL"; fuso Europe/Lisbon; calendário "Consulta Inicial — Harmonização"; 30 minutos; 12 horários (11:00–16:30 GMT+0); disponibilidade consultada 13/11/26 19:43.
- Nenhum horário selecionado; "Revisar agendamento" e "Criar agendamento" não clicados; nada enviado; nenhum contato/compromisso criado; workflows intocados. O estado de escrita (write_enabled) não foi exibido antes da revisão e, portanto, não foi conferido pela interface.

## Situação
- Implementado: sim (patch). Testado localmente: unitário/UI sim; SQL nativo não aqui. Atualizado na prévia: sim. Verificado de ponta a ponta: NÃO — a criação real de agendamento não foi testada. Não publicado.
