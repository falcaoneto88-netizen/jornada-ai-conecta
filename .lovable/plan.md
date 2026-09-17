# Correção bloqueante da integração Experiência Falcão

## Escopo
- Tornar a interpretação das respostas do HighLevel estritamente fechada: resposta sem `contact` explícito, formatos incompletos, DND desconhecido e paginação não comprovada bloqueiam qualquer criação ou envio.
- Exigir correspondência exata do ID, location e telefone consentido antes de contacto, oportunidade ou acolhimento; preservar `type: "SMS"` para o ZaptosWPP existente.
- Adicionar uma migração aditiva com ledger durável por organização, integração, operação, canal e identidade/contacto. Tentativas aceites ou incertas permanecem bloqueadas até reconciliação explícita.
- Endurecer as funções de reserva e conclusão para validar organização, integração, binding, identidade e IDs; um contacto não validado não será associado ao registo local.
- Validar oportunidades existentes por contacto e funil, exigindo resposta comprovadamente completa antes de concluir ausência ou criar nova.

## Testes e verificação
- Acrescentar testes do adaptador HTTP para `{}`, `[]`, `contact: null`, DND ausente/malformado, ID divergente e listagem incompleta.
- Acrescentar testes PostgreSQL reais para dois pedidos sequenciais da mesma identidade: primeiro aceite e primeiro incerto, garantindo uma única reserva externa; incluir rollback/falha de persistência e consistência entre conta, integração e binding.
- Executar todos os testes, verificação TypeScript e compilação; corrigir apenas regressões deste patch.

## Limites mantidos
- Nenhuma mensagem ou escrita real no HighLevel, consulta de pessoas reais, ativação de flags ou publicação.
- Nenhuma alteração em BioReport, fluxos clínicos ou outras partes do produto.
- Se o formato oficial de “sem duplicado” não puder ser provado, novas criações ficam explicitamente bloqueadas.
