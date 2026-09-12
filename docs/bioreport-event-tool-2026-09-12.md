# Ferramentas BioReport → Jornada AI

Estado em 12/09/2026: **implantação concluída** nos dois projetos. Os patches foram incorporados, as publicações foram solicitadas via `deploy_project` e `get_project` retorna `is_published=true`. A transmissão de eventos **ainda não está ativada**, porque falta a configuração privada da chave de assinatura. Nenhum paciente, contato, mensagem ou workflow de produção foi alterado.

## Implantação já verificada

- **Código**: patches revisados incorporados ao Jornada AI (a partir de `eb4f167f9ee42d814bb2457b3c9a04a0cf4caad3`) e ao BioReport (a partir de `6f46c30`). Arquivos AUTO-GENERATED foram regenerados pelas ferramentas oficiais, não editados manualmente.
- **Banco de dados**: a migração `20260912160000_bioreport_events.sql` foi aplicada em transação e registrada em `schema_migrations`. As três tabelas têm RLS ativo; `anon`/`authenticated` não leem a chave e não têm INSERT direto em eventos.
- **Contagens**: zero chaves cadastradas, zero eventos recebidos.
- **Produção Jornada AI**: a rota pública `POST /api/public/bioreport-event` respondeu HTTP 401 `{"error":"unauthorized"}` quando chamada sem assinatura, conforme esperado.
- **MCP Jornada AI**: `initialize` sem token foi recusado com HTTP 401, conforme esperado.
- **Manifestos MCP remotos**: BioReport v0.4.0 com 12 ferramentas; Jornada AI v0.2.0 com 7 ferramentas.
- **Conector Jornada existente**: retornou `[]` ao listar automações (estado normal antes da configuração da chave).

## Uso após ativação

1. No BioReport, `jornada_preview_consultation` recebe `consultationId` (o parâmetro `id` da URL da Consulta do paciente) e mostra o paciente, os IDs e as datas das anamneses confirmadas e relatórios salvos. Retorna até dez de cada, com indicação de truncamento.
2. Confira o contato existente usando `ghl_find_contact` e confirme com o operador a associação entre paciente, consulta e contato. Não identificar pacientes apenas pelo nome.
3. `jornada_sync_consultation` recebe `consultationId`, `recordId`, `eventType` (`anamnese_recebida` ou `relatorio_disponivel`), `ghlContactId` e `confirm: true`. O servidor valida administrador, consulta e registro persistido antes de enviar.
4. No Jornada AI, `list_bioreport_events` consulta o recebimento por `contact_id`, `consultation_id` e `limit` (1–50). Só administradores da organização leem os eventos.

O envio usa o endpoint fixo `https://jornada-ai-conecta.lovable.app/api/public/bioreport-event`. A confirmação retorna `received` ou `duplicate`, o ID do evento/contato e `messages_sent: 0`. Uma repetição do mesmo registro não cria outro evento, inclusive sob concorrência.

## Dados e segurança

O corpo tem uma lista fechada de 14 campos: versão, origem, destino, identificação pública da chave, organização, location, tipo/ID do evento, consulta, paciente, registro de origem, contato HighLevel e datas. Não inclui nome, telefone, e-mail, respostas, medidas, diagnósticos ou texto do relatório. A identificação da chave não é a chave secreta.

HMAC-SHA256 assina o corpo exato no servidor. A assinatura circula apenas no cabeçalho entre os servidores e não é devolvida pelas ferramentas. O PostgreSQL valida a assinatura novamente, incluindo chamadas diretas pela API. A validade é de cinco minutos, com tolerância de um minuto para relógio adiantado. A chave é um texto hexadecimal minúsculo de 64 caracteres, tratado como texto UTF-8 em ambos os lados.

O receptor usa somente a chave pública/anon do Supabase. Uma função SQL com `SECURITY DEFINER`, escopo fixo e assinatura obrigatória insere o evento; não há service role no caminho novo. As tabelas mantêm RLS, sem escrita direta para anon/authenticated. A chave fica em esquema privado, sem acesso via API. O contato precisa existir, ser real e pertencer à organização/location vinculada. Vínculos de paciente/consulta não são substituídos silenciosamente. Auditoria e evento são atômicos.

Referência do algoritmo: [PostgreSQL pgcrypto — hmac](https://www.postgresql.org/docs/18/pgcrypto.html).

## Configuração privada pendente

Projetos: BioReport `26a42c4a-b53d-4fa2-b737-3b14bf0e0665`; Jornada AI `36345211-2616-42f7-bb9e-e78a9d00ca22`.

1. Criar uma chave aleatória exclusiva de 32 bytes, codificada em hexadecimal, em um ambiente privado. Não usar chave GHL/Supabase, não colocar em Git, mensagens, logs, argumentos de linha de comando ou variáveis `VITE_*`.
2. No backend BioReport configurar `BIOREPORT_JORNADA_SIGNING_SECRET`, `BIOREPORT_JORNADA_KEY_ID`, `JORNADA_AI_ORGANIZATION_ID` e o `GHL_LOCATION_ID` existente. Organização/location verificadas: `f07ab3be-7419-4779-a901-ef71c5fc27f0` / `ok2UHC2QMZsd8UHsAgEa`.
3. Cadastrar a mesma chave/identificação no banco do Jornada usando `scripts/configure-bioreport-integration.mjs --apply`, executado pelo operador com variáveis privadas e conexão `JORNADA_DATABASE_URL`. O script usa parâmetros SQL, TLS verificado em produção, não imprime credenciais e não substitui uma chave divergente. O receptor também precisa da URL e chave pública Supabase já usadas pelo projeto.
4. Atualizar a descoberta das ferramentas MCP nos dois projetos.
5. Validar primeiro a consulta de eventos vazia e a recusa de pedido sem assinatura. Só transmitir um evento real após confirmar o paciente/contato com o operador.

**Bloqueio atual**: não existe transferência segura de secrets entre projetos na API do Lovable Cloud. O bloqueio é operacional (Chrome não responde; secrets não podem ser movidos entre projetos), não de permissão. A autorização para concluir a configuração já existe; a execução deve ser feita pelo operador em ambiente privado.

Não foi adicionado disparo automático ao salvar a anamnese. Esta entrega cria o canal confirmado de eventos e seu histórico. Executar mensagens, mover etapas ou ativar workflows é uma etapa separada; `received` não significa que uma automação foi executada. O fluxo `/jornada` de protocolos continua separado da Consulta do paciente.

## Verificação local

- 10 testes novos no BioReport: confirmação, autorização antes de queries, minimização, consulta prévia, assinatura e erros sanitizados.
- 11 testes novos no Jornada AI: acesso administrativo, tamanho do corpo, assinatura ausente, encaminhamento exato e erros sanitizados.
- 30 verificações em PostgreSQL descartável com todas as migrações reais: HMAC, prazo, RLS, isolamento por organização, vínculo imutável, auditoria atômica, concorrência e revogação da chave.
- 53 testes Node e 33 Vitest preexistentes do BioReport passaram.
- TypeScript e builds dos dois projetos passaram. ESLint dos arquivos novos/alterados passou; `git diff --check` passou.
- O lint geral do BioReport falha com 875 erros e 6 avisos anteriores, em 55 arquivos cujos bytes são iguais ao HEAD de origem. Não foram corrigidos nesta entrega.
- Rotas e manifestos gerados foram atualizados pelas ferramentas oficiais; nenhum arquivo AUTO-GENERATED foi editado manualmente.

Reprodução: BioReport `node --test tests/jornada-events.test.mjs`; Jornada `npx vitest run src/lib/bioreport-events.test.ts src/lib/mcp/tools/list-bioreport-events.test.ts`. Para o teste SQL, instalar `npm install --prefix test/bioreport-runtime` e executar `node test/bioreport-events.db.mjs`. O teste cria e encerra seu próprio PostgreSQL local, com dados fictícios.
