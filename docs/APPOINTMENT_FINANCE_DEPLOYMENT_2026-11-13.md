# Agenda — valores administrativos: implantação e limites

Data: 13/11/2026. Projeto original Lovable: `36345211-2616-42f7-bb9e-e78a9d00ca22`.

## Escopo

Os valores são um complemento administrativo de uma consulta GHL já sincronizada.
Não são recibos, não comprovam pagamento e não alteram agenda, contatos, oportunidades,
mensagens ou automações do GHL. Não há segunda agenda nem aproveitamento do valor da
oportunidade como sinal recebido.

As funções `getAppointmentFinance` e `saveAppointmentFinance` estão em
`src/lib/appointment-finance.functions.ts`. O servidor deriva organização e ator
da sessão através de `resolverAcesso`; o cliente não envia organização ou location.
Leitura e edição exigem administrador, gestor ou comercial. Visualizador não acessa valores.

## Migração aditiva

- Drizzle: `drizzle/migrations/0025_appointment_finance.sql`.
- Espelho Supabase: `supabase/migrations/20261113130000_appointment_finance.sql`.
- SHA-256 de ambos: `39343c5250aea5191f0e6d370d6d7f16e70e7d49150bc76142e71a5044ba1a60`.
- Journal: entrada 25; snapshot segue a revisão 24.
- Tabelas novas: `appointment_finances` e `appointment_finance_requests`.
- RPC: `appointment_finance_command(text,uuid,uuid,jsonb)`, executável apenas por `service_role`.
- Trigger: `appointment_finance_validate_parent()` valida o vínculo de organização e consulta GHL real.

Aplicar **uma única vez** pelo mecanismo de migração do projeto, não pelos dois
espelhos. A aplicação da migração em banco publicado não foi realizada por estes testes.
O caminho Drizzle existente usa a configuração `LOVABLE_DB_MIGRATION_URL`; nenhum valor
de configuração precisa ser copiado para o cliente ou registrado no documento.

A migração pode preceder o novo código. Sem ela, o endpoint retorna `available:false`
com aviso de atualização pendente; o app não apresenta campos ausentes como valores zero.
Para recuar a interface, preservar as tabelas aditivas e sua auditoria em vez de apagar registros.

## Contrato e proteção

- Leitura: no máximo 200 IDs UUID de consultas; resultados pertencem à organização autenticada.
- Valores: centavos inteiros em EUR, total de 0 a 100.000.000 centavos, sinal entre zero e total.
- Ausência de registro é diferente de zero deliberadamente informado.
- Gravação: `expectedRevision` controla concorrência, `requestId` UUID controla repetição.
- A repetição idêntica devolve o resultado original; mesmo ID com outro ator ou conteúdo é recusado.
- O SQL revalida perfil, papel, binding e compromisso/contato não demo com IDs GHL.
- Locks preservam o vínculo do compromisso durante a gravação; atualização, ledger e auditoria
  são atômicos. Alterações diretas de valores são negadas ao papel `authenticated`.
- Auditoria `appointment.finance.saved` registra ator, revisão, request ID e origem administrativa;
  não copia valores, notas clínicas ou conteúdo de mensagens para o metadata.

## Validação

Testes de contrato e serviço: `src/lib/appointment-finance.test.ts` (30 cenários).
Testes SQL: `src/lib/appointment-finance.db.test.ts` (15 cenários) aplicam a sequência
real de migrações Supabase a identidades e consultas sintéticas.

Resultado local em 13/11/2026: **30/30 testes de contrato/serviço e 15/15 testes SQL
no PGlite aprovados**. ESLint dos arquivos financeiros, Prettier e `git diff --check`
também passaram. Nenhum banco externo foi consultado ou alterado.

O ambiente desta entrega não disponibilizou binários PostgreSQL nativos. Para executar
SQL, foi instalado isoladamente em `/private/tmp/jornada-finance-pglite` o pacote oficial
`@electric-sql/pglite@0.5.16`, com scripts de instalação desativados. Isso não modifica
`package.json`, `bun.lock` ou as dependências de produção. A extensão `pgcrypto` do próprio
pacote permite aplicar também as migrações anteriores, sem substituí-las por mocks.

PGlite executa PostgreSQL em memória com uma conexão exclusiva. A execução comprova
sintaxe, persistência, RLS/ACL, escopo, revisão e replay; chamadas simultâneas são
serializadas pelo adaptador. **Não comprova contenção entre conexões PostgreSQL independentes.**

Gate adicional em ambiente de teste com PostgreSQL nativo:

```sh
PG_TEST_BINDIR=/caminho/dos/binarios/postgresql node_modules/.bin/vitest run src/lib/appointment-finance.db.test.ts
```

Antes de declarar funcionamento publicado: confirmar migração aplicada no projeto original,
ler um compromisso autorizado, salvar/reler uma anotação administrativa de teste, verificar
revisão e auditoria e conferir que agenda GHL e mensagens permanecem sem alterações.
Não declarar integração ou pagamento validado apenas porque a interface compilou.

## Aplicação no projeto original — 13/11/2026

- Revisão base: `a6d3c74` (merge PR #3); HEAD antes da aplicação `bafff3e`.
- Antes: tabelas e RPC ausentes; último registro aplicado era 0024 (id 25). 0025 era a única pendente.
- Aplicada **uma vez** pela ferramenta oficial de migração (transação externa), usando o SQL Drizzle;
  o espelho `supabase/migrations/20261113130000_appointment_finance.sql` não foi executado.
- SQL enviado idêntico ao arquivo, exceto a newline final, que a ferramenta remove. O arquivo do
  repositório foi restaurado aos bytes originais (SHA-256 `39343c52…1a60`). Journal idx 25,
  `when` `1794586420181`; registro no banco id 26. Types regenerados.
- Correção de registro (13/11/2026): o snapshot 0025 **não** é inteiramente igual ao do merge —
  apenas o UUID `id` mudou (`ca4db39f…` → `d0543812…`); `prevId` e todo o conteúdo são iguais.
- O diff `a6d3c74..d06fc76` inclui ainda uma atualização automática da dependência de build
  `@lovable.dev/vite-tanstack-config` 2.26.5 → 2.27.1 (`package.json` e `bun.lock`), feita pelo
  ambiente, não por este trabalho. Nenhum outro arquivo foi alterado além dos listados.
- Catálogo: `appointment_finances` e `appointment_finance_requests` com RLS ativo; 1 policy de SELECT
  e 1 trigger em finances; requests sem policies e sem acesso de `authenticated`/`anon`.
  `authenticated` só SELECT em finances; `service_role` total. `appointment_finance_command` e
  `appointment_finance_validate_parent` SECURITY DEFINER com EXECUTE apenas `postgres`/`service_role`.
  `sandbox_exec=ar` vem de default ACL preexistente. Nenhuma permissão existente alterada.
- Leitura autenticada na prévia (`/agenda`, semana de 19/10/2026 com 1 consulta real): função
  de leitura respondeu `available:true`, `entries:[]`; a interface mostrou "Ainda não há valores
  registados" e não o aviso de atualização pendente. Nenhum valor gravado; sem POST de salvar.
- Não houve publicação, envio, alteração GHL, contatos, compromissos, oportunidades ou workflows.
  Testes locais (89 + 15 PGlite) não foram repetidos e não constituem evidência de produção.
