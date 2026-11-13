# Agenda do Jornada AI — implementação e implantação

Data: **13/11/2026**. Projeto original Lovable: `36345211-2616-42f7-bb9e-e78a9d00ca22`.

## O que foi implementado

A rota existente `/agenda` reúne consultas sincronizadas do GoHighLevel, valores administrativos e acesso ao Meu Chat. Foram preservadas a navegação e a paleta global do app.

- Vistas de dia, semana e mês; navegação por período e escolha direta de data.
- Pesquisa por cliente, procedimento ou responsável; filtros de estado administrativo e responsável. O resumo considera o período e os filtros visíveis.
- Em telas menores, semana e mês usam lista por dia. O detalhe abre no mesmo contexto, sem criar outra página de agenda.
- Detalhe com data/hora no fuso da clínica, estado administrativo, responsável e atualização do registro local.
- **Abrir Meu Chat** usa o ID GHL do contato, nunca o ID local como substituto. Sem vínculo, o app informa a indisponibilidade.
- **Nova consulta no GHL** e **Gerir no GHL** abrem o calendário conectado. Os links são ocultados se a leitura da ligação falhar ou se ela pertencer a outra organização.
- Total do procedimento, sinal informado e saldo calculado em centavos inteiros de EUR. Ausência de registro continua desconhecida, não vira zero.
- Rascunho de confirmação editável; valores entram somente quando selecionados explicitamente. **Gerar prévia** e **Copiar rascunho** não enviam mensagem nem modificam o estado da consulta.
- Acompanhamento por evidência existente permanece disponível em uma seção expansível.

O painel financeiro preserva o rascunho após falha, impede sobrescrita concorrente por revisão e reutiliza a identificação da mesma tentativa ao repetir uma gravação. Depois de salvar, aguarda a leitura do registro atualizado. Data e horário ficam visíveis; a identificação técnica do responsável está em **Identificação do registro**.

## Como o documento fornecido foi adaptado

O anexo `JORNADA_AGENDA_CODIGO.md` foi usado como referência funcional. Seu exemplo propõe Next.js, Prisma e NextAuth; o projeto atual usa React/TanStack e os serviços de autenticação e banco já existentes. A implementação reutiliza essa estrutura, sem adicionar um segundo cadastro de consultas ou trocar autenticação.

| Referência do anexo                        | Implementação neste projeto                                                                   |
| ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Nova página e modelo de consultas          | Expansão da rota e calendário existentes, usando `appointments` sincronizados do GHL          |
| Valores em ponto flutuante com zero padrão | Valores opcionais em registro separado, com centavos inteiros e zero somente quando informado |
| CRUD local de consultas                    | Criação, remarcação e cancelamento permanecem no GHL                                          |
| Confirmação WhatsApp simulada              | Prévia editável e cópia; sem envio, marcador de enviado ou confirmação fictícia               |
| Nova autenticação                          | Sessão, papéis e escopo de organização existentes                                             |

Principais arquivos: `src/routes/agenda.tsx`, `src/components/agenda-calendario.tsx`, `src/components/appointment-finance-panel.tsx`, `src/lib/agenda-workspace.ts`, `src/lib/appointment-finance.{core,functions,server}.ts` e `src/lib/repo.ts`.

## Limites e proteção

O GHL continua sendo a origem da agenda. A tela mostra dados importados e o momento da consulta local; isso não comprova atualização em tempo real no GHL. **Agendada** é um estado administrativo e não comprova resposta SIM.

Total, sinal e saldo são informações manuais da equipe: não são recibos, conciliação bancária ou prova de pagamento. Consultas canceladas ficam fora dos totais do resumo. Não foram incluídos dados demonstrativos no ambiente real, envios ou ativações de automação.

O servidor deriva organização e ator da sessão, valida o vínculo com a consulta e aplica permissões. O cache da agenda é separado por usuário/organização. Valores são ocultados quando a permissão é retirada ou a leitura falha; falha da agenda também retira o detalhe aberto. A operação financeira mantém revisão, repetição segura, auditoria e controles de acesso no banco.

## Evidências e situação da entrega

| Camada                               | Situação em 13/11/2026                                                     |
| ------------------------------------ | -------------------------------------------------------------------------- |
| Interface, contratos e serviço       | Implementados no código                                                    |
| Testes locais                        | **89 testes aprovados em 7 arquivos**                                      |
| SQL e persistência isolada           | **15 testes aprovados no PGlite**, separados dos 89 acima                  |
| Compilação, TypeScript e lint        | Aprovados nesta revisão                                                    |
| Inspeção visual local                | Larguras de **1280 px e 390 px**, sem transbordamento horizontal observado |
| Migração no banco remoto             | **Ainda não aplicada nesta entrega**                                       |
| Publicação e validação ponta a ponta | **Não comprovadas por esta validação local**                               |

Os testes SQL cobrem persistência, ACL/RLS, escopo, revisão e repetição no banco isolado. O adaptador PGlite serializa chamadas; isso não substitui um ensaio de contenção entre conexões PostgreSQL independentes. Os testes de interface usam dados sintéticos e fronteiras de integração controladas, não contatos reais.

## Sequência de implantação e conferência

1. Revisar a migração aditiva e aplicar **uma única vez**, usando o mecanismo do projeto. Existem arquivos equivalentes em Drizzle e Supabase; não executar ambos como migrações independentes. Ver [instruções financeiras de implantação](APPOINTMENT_FINANCE_DEPLOYMENT_2026-11-13.md).
2. Sincronizar esta revisão com o projeto original e conferir a prévia. Sem a migração, o app deve apresentar os valores como indisponíveis, mantendo as consultas e sem inventar saldos.
3. Quando a revisão estiver publicada, conferir `/api/version`: o identificador esperado no código é `jornada-agenda-workspace-20261113.1`. A presença desse texto no repositório não prova publicação.
4. Em uma consulta autorizada de teste, validar fuso, vínculo GHL, permissões, gravação/releitura de valores, revisão e auditoria. Conferir que agenda GHL, mensagens e automações continuam sem alterações decorrentes do registro financeiro.
5. Validar com a equipe localizar uma consulta, abrir o Meu Chat e preparar um rascunho; registrar eventuais erros antes de ampliar o uso.

Para recuar a interface, preservar as tabelas aditivas e os registros de auditoria. Não apagar valores já registrados como parte do retorno a uma versão anterior.
