# Leitura autenticada de clientes e oportunidades para o Falcão Ads

Objetivo: permitir que o outro projeto (Falcão Ads) leia, de forma autenticada e só de leitura, os clientes e as oportunidades da Jornada AI com os identificadores do GoHighLevel, para casar campanhas e UTMs sem criar oportunidades duplicadas.

## O que será criado

1. **Nova ferramenta MCP `list_opportunities`**
   - Devolve: identificador interno, identificador da oportunidade no GoHighLevel, nome, etapa (chave e identificador), valor, estado, data de criação/atualização e o identificador do cliente associado.
   - Filtros: etapa, estado, período (data inicial/final), limite (máximo 50) e cursor para paginação.
   - Somente leitura, sem escrita e sem qualquer chamada ao GoHighLevel.

2. **Ampliação da ferramenta MCP `list_contacts`**
   - Acrescenta ao resultado o identificador do contacto no GoHighLevel, a origem e as datas de criação/atualização.
   - Acrescenta filtro por período de atualização e paginação por cursor, para sincronizações incrementais.
   - Mantém os campos atuais; não acrescenta nada clínico.

3. **Campos deliberadamente fora do resultado**
   - Notas, conteúdo de mensagens, eventos do BioReport e qualquer dado clínico.
   - Telefone e e-mail continuam apenas em `list_contacts`, como hoje, porque já são visíveis na aplicação; se preferir, posso removê-los da resposta destinada ao Falcão Ads.

## Segurança e isolamento

- As duas ferramentas usam a sessão do utilizador que chama (mesmo mecanismo atual), pelo que só devolvem dados da organização desse utilizador.
- Nenhum token, segredo ou chave é devolvido.
- Nada é escrito: sem alterações em clientes, oportunidades, GoHighLevel, workflows ou definições.
- Nenhuma migração de base de dados; nenhuma tabela nova.

## Como evitar oportunidades duplicadas

O Falcão Ads passa a ler os identificadores do GoHighLevel já existentes e usa-os como chave de casamento com as campanhas. Não cria oportunidades próprias nem escreve de volta.

## Detalhes técnicos

- Novo ficheiro `src/lib/mcp/tools/list-opportunities.ts`, registado em `src/lib/mcp/index.ts`.
- Ajuste em `src/lib/mcp/tools/list-contacts.ts` (colunas selecionadas, filtros, paginação).
- Testes unitários para os dois, no mesmo estilo de `src/lib/mcp/tools/list-bioreport-events.test.ts`.
- O manifesto `.lovable/mcp/manifest.json` é regenerado automaticamente pela ferramenta oficial.
- Sem publicação: a revisão e a publicação ficam consigo.
