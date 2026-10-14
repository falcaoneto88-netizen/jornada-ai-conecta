# Auditoria de workflows GHL — resultado da leitura

## Fonte, período e cobertura
- Fonte: chamada oficial `GET /workflows/` da API GHL (Version 2021-07-28), com o token privado do servidor. É a mesma chamada que o app já usa no catálogo. Location conferida: ok2UHC2QMZsd8UHsAgEa. HTTP 200.
- Data: 14/10/2026, por volta das 23:15 UTC. A lista é o estado atual; não cobre um período.
- Cobertura: 25 workflows, sendo 10 publicados e 15 em rascunho. A API só devolve estes campos: id, name, status, version, createdAt, updatedAt e locationId.

## Publicados (10)
| Workflow | Versão | Atualizado |
|---|---|---|
| 07 dias — Acompanhamento de Hidratação | 17 | 05/09/2026 |
| Jornada AI | 5 | 06/10/2026 |
| Jornada AI — Piloto supervisionado V02 | 3 | 08/10/2026 |
| Pré-Procedimento Harmonização Glutea | 38 | 15/09/2026 |
| Pós-Prcedimento Harmonização Glútea | 20 | 05/09/2026 |
| Rabo Power Max SMS | 8 | 12/10/2026 |
| Recrutamento Comercial Remoto — Confirmação de pré-cadastro | 5 | 02/10/2026 |
| Recrutamento Comercial Remoto — Envio de pré-cadastro | 6 | 02/10/2026 |
| n8n \| Encaminhar agendamento Harmonização \| RASCUNHO (o nome diz rascunho, mas o estado é publicado) | 8 | 05/10/2026 |
| n8n \| Encaminhar resposta à confirmação | 5 | 08/10/2026 |

## Rascunhos (15)
7 Dias Cuidados Pós-Procedimento; Boas vindas Felps Concierge; Comunicaçao Interna; Confirmação Consulta Presencial; Confirmação de consulta de Harmonização Glutea (versão 108, atualizado em 05/10); Consulta Online - Confirmação…; Dieta - [CADÊNCIA]; Follow up pos cirurgico; Glúteos SMS Offer (atualizado em 14/10); 2 sem nome ("New Workflow : …"); Onboarding and Payment Confirmation; Pre consulta Emagrecimento; Pré-Black | Glúteos 400 mL; [Consulta AGENDADA Emagrecimento].

## Limitação exata
- A API pública do GHL não fornece gatilho, ações ou canais, nem execuções, última execução ou contatos ativos no fluxo. Não existe endpoint GET para isso. Esses dados só aparecem no editor e no "Execution logs" do GHL. Por isso, função e canais não foram verificados; os nomes acima sugerem a função, mas isso é só inferência.
- n8n (as duas ligações mostram a mesma instância): há 3 fluxos, todos da ponte Jornada.
  - Agenda e Confirmação V2: ativo.
  - Diagnóstico: inativo; só faz um teste de ligação (POST health).
  - Confirmação V1: inativo.
  - Nenhum desses fluxos lista ou consulta workflows do GHL. Existe uma credencial HighLevel OAuth, mas nenhum fluxo a usa para leitura. Nada foi executado.
- `list_automations` do plugin lê a tabela interna do app. Ela vir vazia não diz nada sobre os workflows do GHL.

## Próximo passo opcional (precisa de aprovação)
Um caminho parcial, só de leitura: cruzar as tags de contato e os campos de "workflow" dos contatos. Isso dá apenas uma estimativa de quem está nos fluxos e não é uma contagem confiável. A alternativa é exportar manualmente o "Execution logs" de cada workflow publicado no GHL e me enviar.
Nada foi alterado, executado ou enviado.
