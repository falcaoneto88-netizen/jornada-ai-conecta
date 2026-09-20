# Correção de espelho desatualizado na conclusão remota (Experiência Falcão)

## Diagnóstico

`finish_site_lead_remote_v2` insere a oportunidade com `ON CONFLICT DO NOTHING` e logo a seguir exige que a linha local seja exatamente igual aos dados lidos na API. Quando a oportunidade já existe localmente com `stage_id` antigo, a verificação levanta erro, a transação é revertida e o pedido fica preso em `a_processar` com a reserva `reserved` — mesmo tendo sido lido corretamente no HighLevel. É o caso do pedido `884062b4-…`.

## Correção (apenas preparada, não aplicada)

Nova versão de `finish_site_lead_remote_v2` num ficheiro de migração pendente, fora do diretório aplicado:

`drizzle/pending/0011_site_lead_snapshot_reconciliacao.sql`

Comportamento:

1. Guardas mantidas tal como estão: organização, integração, binding, ligação, reserva no ledger, identidade do contacto, consentimento e funil configurado. Nada disto é enfraquecido.
2. Oportunidade existente com o MESMO contacto e o MESMO funil: a linha local é bloqueada (`FOR UPDATE`) e atualizada com etapa, estado e nome REAIS devolvidos pela API, com `updated_at = now()`. Nada é escrito, movido ou reaberto no HighLevel. Estados/etapas fechados ficam exatamente como vêm da API — nunca se assume `open` nem "Novo Lead".
3. Divergência de identidade (contacto diferente), funil diferente ou linha de demonstração: continua a falhar fechado, mas de forma persistida e auditável — o pedido passa a `em_revisao` com `remote_state = 'bloqueado'` e motivo próprio, o ledger fica `blocked`, e não há nova tentativa de escrita remota. Deixa de existir o rollback que devolvia o pedido a `a_processar` sem rasto.
4. Se, após a atualização, a linha final ainda não corresponder aos dados reais (escrita concorrente), o desfecho é `uncertain` no ledger com motivo de reconciliação — nunca sucesso, nunca nova escrita remota.
5. Auditoria sem PII: novo registo `site_lead.remote_snapshot_reconciled` com apenas identificadores do HighLevel e valores de etapa/estado antes e depois. Sem nome, telefone ou e-mail.

## Testes (Postgres isolado, novo ficheiro)

`src/lib/falcao-reconciliacao.db.test.ts`, com a mesma montagem dos testes existentes e a migração pendente carregada explicitamente:

- espelho desatualizado do mesmo contacto e funil: conclui, atualiza etapa/estado e regista auditoria;
- oportunidade fechada no HighLevel: estado/etapa fechados preservados no espelho;
- contacto local diferente na mesma oportunidade: bloqueia, pedido em revisão, ledger `blocked`, sem exceção;
- funil diferente: bloqueia fechado;
- reserva/dedup por pessoa mantida: segundo pedido da mesma identidade continua bloqueado;
- falha de persistência/concorrência: resultado incerto auditável, sem declarar sucesso e sem repetir escrita;
- auditoria sem dados pessoais.

## Limites

- Migração fica apenas preparada em `drizzle/pending/`; não é aplicada nem publicada.
- Sem reprocessar recibos reais, sem mensagens, sem alterações no HighLevel, sem mutações de dados reais.
- A submissão `0981dfd5-…` não é tocada: permanece em revisão, à espera de esclarecimento.
- Após revisão e aplicação, o pedido `884062b4-…` reconcilia-se numa nova leitura, sem intervenção manual em dados.

## Verificações no fim

`bunx vitest run`, `bunx tsgo --noEmit`, `bun run build` e lint dos ficheiros alterados, com SHA e resultados reportados.
