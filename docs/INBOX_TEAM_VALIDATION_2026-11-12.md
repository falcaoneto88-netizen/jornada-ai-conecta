# Validação com a equipe — atendimento concentrado na Caixa de Entrada

> Registro histórico da preparação local. Os ensaios Izabel, artefatos e comandos que dependem do pacote privado não acompanham esta entrega pública. Consulte `PUBLICATION_INBOX_SUPERVISED_2026-11-12.md` e o manifesto final para o escopo e os gates desta cópia.

Proposta de protocolo, preparada em 12/11/2026. **Ainda não executado com a equipe.** Tempos, reduções e satisfação abaixo são metas para avaliação, não resultados medidos.

## Objetivo e limite da sessão

Verificar se reunir conversa, sugestão ajustável com aprovação, contexto comercial e próximo atendimento reduz tempo, troca de páginas e rolagem sem comprometer compreensão, aprovação humana ou preservação do trabalho. A fila geral de supervisão continua sendo a entrada de triagem e auditoria.

Usar uma prévia com contatos e mensagens sintéticos, serviços simulados e envio sem transporte real. Os cliques de aprovação, transferência, conclusão e retorno devem ter efeito apenas no cenário de teste. Não usar dados clínicos, telefones reais nem acionar mensagens, agendas ou workflows da produção. Se a prévia não tiver simulação completa de alguma ação, registrar a ação como não testável e encerrar antes do efeito externo; não apresentar a tarefa como concluída.

## Comparação

- Participantes sugeridos: 3–5 atendentes, incluindo alguém experiente e alguém com menor familiaridade com o Jornada. Quando possível, incluir uso de teclado e um participante que trabalhe no celular.
- Comparar a versão anterior preservada e a nova prévia com a mesma quantidade de mensagens, conteúdo equivalente, mesmos dados de responsável e mesma largura de tela. Não medir páginas com serviços ou latências diferentes sem registrar a diferença.
- Alternar a ordem das versões entre participantes; usar contatos sintéticos equivalentes, mas diferentes, para reduzir efeito de memorização.
- Fazer uma tarefa de aquecimento fora da medição. Depois, observar sem orientar o caminho, anotando dúvidas, retomadas e erros. Não gravar tela ou voz sem combinar isso com os participantes.
- Registrar o estado de cada serviço no início: implementação local, simulação de persistência, leitura local do contexto e eventuais partes não verificadas em produção. Resultado de UI não comprova entrega de mensagem nem integração GHL em tempo real.

## Tarefas cronometradas

| Tarefa                 | Enunciado ao atendente                                                                                                           | Início e fim da medição                                                                    | Evidência de conclusão                                                                                                                                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sugestão quase correta | “O rascunho acertou a orientação, mas precisa ajustar a saudação e deixar a pergunta final mais clara. Revise antes de aprovar.” | Início: conversa visível. Fim: revisão final concluída e confirmação simulada registrada.  | Texto final corresponde à prévia aprovada; nenhuma mensagem enviada ao abrir ou apenas editar; o histórico continua acessível. Se o ambiente não simular a aprovação, encerrar na prévia e registrar medição parcial. |
| Próximo atendimento    | “Confira quem é responsável, qual é o próximo passo e a hora da próxima consulta. Depois abra o próximo contato pendente.”       | Início: primeiro contato aberto. Fim: contato seguinte identificado e aberto corretamente. | Identificação correta de responsável/retorno/consulta, com origem da consulta e fuso; nenhum cadastro duplicado; nenhuma sugestão ou rascunho carregado no contato errado.                                            |
| Registrar retorno      | “Combine internamente conferir horários amanhã às 10h de Lisboa e atribua a um responsável da equipe.”                           | Início: conversa visível. Fim: confirmação de persistência simulada e resumo atualizado.   | Próxima ação, responsável e data/hora persistidos no cenário; lembrete interno claramente distinguido de mensagem programada; uma única gravação.                                                                     |
| Ajuste sem perda       | “Comece a editar o retorno, recolha o contexto para reler a conversa e volte para terminar.”                                     | Início: edição iniciada. Fim: edição recuperada e registro concluído na simulação.         | Texto e prazo preservados ao recolher/reabrir; resumo não apresenta rascunho como salvo; sair para outro contato não mistura dados.                                                                                   |
| Celular: ida e volta   | “Abra um contato, revise a sugestão, confira o contexto e volte à lista.”                                                        | Início: lista visível em 360/390 px. Fim: retorno à lista na posição esperada.             | Uma área por vez, botão de retorno alcançável, ações acessíveis sem cobrir conteúdo, foco coerente e rascunho preservado.                                                                                             |
| Recuperar uma falha    | “A atualização do contexto falhou. Identifique o problema e tente novamente quando a leitura voltar.”                            | Início: falha simulada. Fim: estado atualizado ou impedimento corretamente entendido.      | Dados antigos não apresentados como atuais; ausência de sucesso falso ou reenvio duplicado; edição bloqueada quando a versão/fuso mudou.                                                                              |

O retorno do exemplo é interno e administrativo. Não inserir orientação clínica no campo de próximo passo.

## O que registrar

Uma linha por participante, versão e tarefa:

| Campo                 | Definição                                                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Tempo                 | Segundos entre o início e o fim definidos; marcar separadamente tempo bloqueado por indisponibilidade.                                          |
| Trocas de página      | Navegações que saem da página de conversa/triagem. Contar abas ou áreas internas separadamente, não como página.                                |
| Rolagem               | Número de gestos de roda, arrasto ou swipe necessários, distinguindo rolagem do histórico e da página. Registrar largura/altura do dispositivo. |
| Retomadas             | Quantas vezes voltou para buscar uma informação necessária ao próximo passo.                                                                    |
| Acerto                | Completa, parcial, não concluída ou impedida pelo ambiente. Anotar motivo.                                                                      |
| Segurança e confiança | Texto final correto, contato correto, aprovação explícita, origem/fuso entendidos, nenhum envio duplo, nenhum rascunho perdido.                 |
| Facilidade percebida  | Nota de 1 a 5 após a tarefa e uma frase sobre a maior dificuldade.                                                                              |

Modelo para preenchimento, sem resultados fictícios:

| Participante | Versão | Dispositivo | Tarefa | Tempo (s) | Páginas | Áreas internas | Rolagens | Retomadas | Resultado | Facilidade 1–5 | Observação |
| ------------ | ------ | ----------- | ------ | --------- | ------- | -------------- | -------- | --------- | --------- | -------------- | ---------- |
| A preencher  |        |             |        |           |         |                |          |           |           |                |            |

## Decisão após a rodada

1. Comparar medianas por tarefa e os valores individuais; com 3–5 pessoas, reportar amplitude e observações, sem tratar a amostra como evidência estatística de toda a equipe.
2. Metas iniciais para discussão: reduzir em pelo menos 25% o tempo mediano para corrigir uma sugestão quase correta; realizar essa tarefa sem sair da conversa; reduzir rolagem/retomadas no celular. São metas propostas, sujeitas à linha de base.
3. Tratar como bloqueio: contato errado, envio sem aprovação, aprovação de texto diferente do exibido, perda de rascunho, duplicação, sobrescrita de alteração concorrente ou erro de fuso. A melhoria de velocidade não compensa esses problemas.
4. Registrar ajustes de clareza separadamente de problemas de implementação ou integração. Repetir somente tarefas afetadas após a correção, com cenários equivalentes.
5. Antes de publicação, confirmar a revisão exata testada, gates do projeto e dependências publicadas. Homologação visual local não comprova o fluxo real de mensagens nem autoriza envios.

## Implementação de contexto reutilizada

`AttendanceContextPanel` lê `readAttendanceContext` e grava via `saveAttendanceContext`. O resumo mostra somente os campos existentes: responsável, próxima ação, prazo, etapa e próxima consulta no cadastro do Jornada. Cadastro/agenda locais têm origem e horários de consulta/atualização explícitos; não são leitura ao vivo do GHL. A edição é recolhível sem desmontar campos, conserva versão/fuso esperado e valida a conclusão de um retorno já persistido. Não foram criados tabela, contato, consulta ou fonte paralela para esta interface.
