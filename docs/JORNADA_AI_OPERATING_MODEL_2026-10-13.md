# Jornada AI — decisão de experiência e lógica operacional

Data: 13/10/2026. Projeto original: `36345211-2616-42f7-bb9e-e78a9d00ca22`.
Base analisada: `f13f8a7`, branch local `codex/attendance-workspace-20261013`.

## Decisão

Organizar o Jornada como um espaço de trabalho de atendimento, com duas entradas principais: **Meu dia** para escolher a próxima ação e **Atendimento** para executá-la com contexto. Reutilizar as rotas, contatos, agenda, modelos e mecanismos de envio existentes. Não criar outro CRM.

No desktop, a conversa ocupa o maior espaço: navegação compacta, fila à esquerda, histórico e composição no centro e próximo passo/contexto à direita. No celular, alternar entre fila e conversa; contexto abre em painel próprio. Não comprimir três colunas em uma tela estreita.

O painel direito começa por **próximo passo, prazo e responsável**. Dados cadastrais, etapa comercial e agenda vêm depois. Assistência IA fica em aba separada e aplica sugestões ao rascunho para revisão. Preparar texto não envia mensagem nem conclui atendimento.

## Referências e escolhas

Fontes oficiais consultadas em 13/10/2026. São referências de organização; funcionalidades de outros produtos não comprovam disponibilidade no nosso contrato de API.

| Referência | Padrão aproveitado | Adaptação ao Jornada |
| --- | --- | --- |
| [Intercom — personalização da inbox](https://www.intercom.com/help/en/articles/7911926-customize-the-inbox-to-suit-you-and-how-you-work-best) | Painéis recolhíveis, detalhes e responsável junto da conversa, atalhos de composição | Conversa dominante; próximo passo antes dos campos secundários; IA recolhível |
| [Front — nova experiência da inbox](https://help.front.com/en/articles/3889728) | Cabeçalho compacto, mais espaço de leitura, separação de itens abertos/postergados/concluídos | Distinguir precisa de ação, retorno combinado e encerrado, com evidência e decisão humana |
| [HighLevel — Conversations](https://help.gohighlevel.com/support/solutions/articles/155000006610-getting-started-with-the-conversations-tab) | Navegação, lista, histórico e contexto no mesmo espaço | Aproveitar GHL como fonte de mensagens/agenda; expor na Jornada apenas operações e permissões realmente integradas |

Manter rascunhos privados por atendente, controles de envio e identidade exata já existentes. Não adotar compartilhamento automático de rascunhos, IA autônoma ou indicadores de presença sem implementação própria.

## O que existe e o que falta

| Evidência do projeto | Consequência para a decisão |
| --- | --- |
| `src/components/ghl-inbox.tsx`, `attendance-context-panel.tsx` | Lista, conversa, painel e composição já existem; reorganizar, sem duplicar telas |
| `src/components/inbox-workspace.ts` | Filtros atuais de leitura/canal atuam nas conversas carregadas; não constituem fila global de pendências |
| `src/lib/ghl-observation.core.ts` | Resumo de conversa não traz direção; mensagens individuais trazem direção/estado. `unreadCount` não significa resposta pendente |
| `src/lib/ghl-observation.ts` | Consulta periódica não equivale a presença de outro atendente nem cobertura completa de mensagens |
| `src/lib/dashboard.ts` | Agenda da visão geral mostra até cinco itens por dia; seu tamanho não pode servir como total de consultas |
| `src/lib/attendance-context.*` e migração `20261013100000_attendance_context.sql` | Responsável interno e um retorno por contato já estão implementados localmente com versão, fuso e auditoria |
| `src/lib/repo.ts` | Lista antiga usa `owner_name` e pode substituir última interação por `updated_at`; não usar esses campos para identidade ou prioridade por demora |
| `src/lib/attendance-draft.*`, `src/components/attendance-draft-sync.ts` | Rascunhos privados persistentes já preparados; limpeza após envio exige confirmação por revisão, inclusive após recarregar |
| `src/lib/n8n-bridge-confirmation.ts` | Já há regras de correlação de resposta com consulta; não substituir por interpretação isolada de “SIM” |
| Migração `20260912160000_bioreport_events.sql` | Eventos clínicos têm deduplicação, instantes separados e acesso administrativo; não ampliar acesso comercial implicitamente |

Os componentes de contexto/rascunhos de 13/10 foram testados localmente. O protótipo de layout é uma simulação separada. Nenhum dos dois estados comprova implantação na versão pública.

## Três dimensões independentes

| Dimensão | Pergunta respondida | Regra |
| --- | --- | --- |
| Atendimento | Quem precisa fazer o quê agora? | Próximo passo, responsável e motivo verificável; estado explícito quando houver suporte |
| Jornada comercial | Em que etapa está a oportunidade? | IDs reais de oportunidade/pipeline/etapa do GHL; não deduzir pagamento ou consulta pelo nome da etapa |
| Consulta | Qual compromisso, horário e situação? | ID do compromisso, fuso e estado da fonte; confirmação por resposta precisa de mensagem e vínculo exatos |

Estados de atendimento propostos: **aguardando equipe**, **em atendimento**, **aguardando paciente**, **retorno combinado**, **concluído** e **indeterminado** quando faltar evidência. Ainda não existe uma máquina completa desses estados no backend. Na primeira etapa, só inferir retorno agendado/vencido a partir dos campos persistidos e exibir as demais evidências existentes sem inventar estados.

Regras de transição propostas:

- Nova solicitação recebida pode gerar “aguardando equipe” após identificação e deduplicação do evento. Uma confirmação automática de recebimento não a resolve.
- Atribuir responsável não significa que alguém esteja digitando, lendo ou detenha exclusividade. “Em atendimento” exigirá ação/presença explícita.
- “Aguardando paciente” exige uma solicitação identificável de resposta, feita e aceita pelo provedor; não inferir de qualquer mensagem de saída.
- Retorno combinado exige próximo passo, responsável e instante no fuso da clínica. É lembrete interno, não mensagem agendada.
- “Concluído” exige decisão explícita ou regra previamente validada. Preparar texto, aplicar IA ou concluir um retorno não encerra automaticamente toda a conversa.
- Falha, resultado de envio incerto e informação desatualizada são alertas independentes. Não devem sobrescrever etapa comercial ou estado da consulta.

## Fila de prioridades

Ordenação inicial proposta: **envio a verificar → retorno vencido → solicitação recebida pendente → retorno de hoje → demais contatos**. Dentro do mesmo grupo, atender a evidência mais antiga primeiro. Mostrar motivo principal e razões secundárias, fonte e horário. Oferecer ordenação alternativa por antiguidade/prazo e filtro “meus/todos/sem responsável”. Uma prioridade manual futura deve registrar autor e motivo.

Não usar a contagem de não lidas, o nome do paciente, `updated_at`, uma etiqueta de pipeline ou classificação opaca da IA como prova de pendência. Não priorizar risco clínico automaticamente na fila comercial.

Uma fila global de respostas precisa de cobertura verificável da sequência de mensagens. O contrato deve identificar última entrada relevante, limite de atendimento humano e saída humana/decisão que tratou a solicitação. Saída automática, lembrete, resultado incerto ou simples leitura não bastam.

Implementação posterior recomendada: projeção mínima de metadados com organização/location, IDs de contato/conversa/mensagem, direção, origem, estado do provedor, ocorrido em, recebido em e cobertura da sincronização. Deduplicar por ID do provedor, tratar chegada fora de ordem e reconciliar lacunas. Evitar copiar conteúdo clínico. Reutilizar ingestão existente onde houver contrato compatível; dados de confirmação do n8n não provam cobertura de toda a caixa de entrada.

## “Meu dia”: quatro blocos com definição explícita

| Bloco | Critério proposto | Dependência |
| --- | --- | --- |
| Aguardando minha resposta | Conversas distintas sob minha responsabilidade com solicitação recebida ainda não tratada, comprovada por evidência | Projeção/cobertura global de mensagens; não substituir por não lidas |
| Retornos de hoje | Contatos com próximo passo ativo e prazo dentro do dia da clínica; destacar subconjunto vencido | Campos locais existentes, consulta agregada por `attendance_owner_id`, limites do dia convertidos para UTC |
| Pendências que preciso resolver | Itens com motivo conhecido: retorno vencido, envio a verificar ou tarefa interna suportada | Modelo de motivos e deduplicação por item; não inventar tarefas para ausência de dados |
| Consultas de hoje | IDs de compromissos elegíveis no dia da clínica, associados a contatos sob minha responsabilidade | Consulta completa no servidor, estados explícitos e vínculo exato com contato/conversa |

“Meus” corresponde ao usuário autenticado por ID, não a um nome livre. Cada bloco abre a mesma inbox com filtro e item correspondente. Se houver várias conversas possíveis para um contato, apresentar escolha; não abrir uma conversa por semelhança de nome/telefone.

As contagens devem ser calculadas no servidor sobre todo o escopo autorizado, não sobre as 25 conversas carregadas ou os cinco agendamentos exibidos. Os blocos podem se sobrepor; não somar seus números como total de pacientes. Dados indisponíveis/parciais recebem esse rótulo, nunca zero fictício.

Primeira versão operacional possível: retornos, responsável, consultas e alertas com evidências já disponíveis. O bloco de respostas deve permanecer explicitamente indisponível até existir a fonte completa. No protótipo todos os blocos usam dados fictícios para avaliar a navegação.

## Fonte de cada informação

| Sistema | Papel preservado | Limite |
| --- | --- | --- |
| GHL | Contato, conversa, mensagens, agenda e oportunidades externas | Aceito, entregue e lido são estados distintos; alterações exigem operação e escopo autorizados |
| Jornada AI | Organização da fila, responsável local, retorno interno, rascunhos privados e auditoria | Responsável interno não substitui automaticamente o assignee GHL; espelhos locais exibem idade/fonte |
| n8n | Execução dos fluxos existentes e evidência correlacionada | Execução bem-sucedida não prova entrega nem resposta humana; não criar motor paralelo |
| BioReport Studio | Conteúdo clínico no ambiente apropriado; eventos autorizados vinculados por ID | Não ampliar acesso a notas clínicas no atendimento comercial |
| Ad Navigator | Somente agregados do contrato comercial | Fora do contexto clínico/conteúdo das conversas |

Exibir separadamente **ocorrido em**, **recebido/importado em** e **consultado em** quando relevantes. `checkedAt` comprova uma consulta, não a atualização do provedor. Usar a organização da sessão no servidor e validar location/contato/conversa em todas as leituras e escritas.

## Ordem de entrega recomendada

Estimativas de engenharia, não prazos garantidos; pressupõem acesso ao repositório e ambiente de homologação. Etapas se sobrepõem e devem ser recalibradas após revisão do protótipo.

| Ordem | Entrega | Esforço estimado | Condição de conclusão |
| --- | --- | --- | --- |
| 1 | Consolidar a limpeza de rascunho após envio no servidor; fechar retenção/expurgo e revisar migrações locais | 1–2 dias, incluindo homologação | Recuperação entre dispositivos comprovada; revisão posterior preservada; nenhum reenvio |
| 2 | Aplicar o layout escolhido aos componentes reais e entregar fila de retornos/Meu dia com dados existentes | 3–5 dias | Mesmos IDs e controles; filtros globais corretos; atalhos abrem atendimento; móvel validado |
| 3 | Base de evidências para pendência de resposta e indicadores de atualização | 4–7 dias | Cobertura, paginação, deduplicação, autorização e sequência temporal comprovadas |
| Depois | Respostas aprovadas por contexto, resumo revisável com fontes e colaboração em tempo real | Estimar após uso do piloto | Biblioteca aprovada, dados mínimos e conflitos reais compreendidos |

Adiar por enquanto: IA que responde sozinha, novo CRM/tabela paralela de tarefas, automações adicionais, presença/bloqueio de operador sem contrato, painel de métricas decorativo e resumo clínico automático na fila comercial.

## Validação com a equipe

Usar dois atendentes e contatos fictícios antes de qualquer piloto com dados reais. Não enviar mensagens reais durante a validação de layout.

1. Encontrar um retorno vencido, entender o motivo e abrir a conversa sem trocar de sistema.
2. Identificar responsável, consulta e próximo passo; diferenciar consulta de lembrete interno.
3. Registrar retorno, mudar responsável e concluir somente o retorno; verificar persistência, versão e fuso.
4. Alternar contatos e recuperar rascunhos privados; conferir que outro atendente não recebe o texto.
5. Simular conflito entre atendentes, falha de salvamento, envio incerto e limpeza após envio seguida de reload. Não duplicar mensagem nem apagar uma revisão posterior.
6. Preparar uma resposta aprovada, editar, desfazer e revisar destinatário/canal. Preparar não envia.
7. Repetir em 1440, 390 e 360 px, com teclado e movimento reduzido; nenhum controle essencial pode depender de hover.

Comparar antes/depois: mediana e percentil 90 do tempo para encontrar a próxima ação; trocas de tela por tarefa; taxa de tarefas concluídas corretamente; retornos perdidos; conflitos/rascunhos perdidos; envios repetidos; erros de identidade. Medir tempo até primeira resposta humana somente quando houver origem/direção/cobertura confiáveis. Registrar falhas e amostra, sem prometer ganho percentual antes do piloto.

## Estado e evidências da entrega

- Implementado e testado localmente antes desta revisão: contexto administrativo e rascunhos privados, commit `f13f8a7`; evidências em `ATTENDANCE_WORKSPACE_V1_2026-10-13.md`.
- Publicação revalidada em leitura em 13/10/2026 às 14:19 UTC: `/api/version` retornou `jornada-inbox-ux-20261012.1`, `release:null`. O marcador não comprova SHA publicado.
- A inspeção do projeto/banco original no mesmo dia encontrou a base editorial `62736be` e não encontrou as duas migrações de atendimento aplicadas. Não se deve atribuir o comportamento local à produção.
- Protótipo de layout: artefato isolado com dados sintéticos, sem credenciais, integrações ou envios. Não substitui a aplicação e não persiste dados no servidor.
- Correção incremental de limpeza de rascunho e QA do protótipo: resultados registrados no adendo desta entrega após validação.
- Nenhuma publicação, migração remota, mensagem, alteração GHL ou ativação de automação faz parte desta entrega.

### Correção incremental de rascunho: alcance exato

O caso reproduzido era envio confirmado seguido de falha ao limpar o rascunho no servidor. A intenção de envio desaparecia e, ao recarregar, o texto voltava sem correlação com o envio anterior.

A mitigação local guarda uma pendência separada de limpeza, por usuário/organização/contato/conversa/revisão, contendo somente IDs e instante. Falha de limpeza mantém aviso, bloqueia novo envio e oferece recuperação explícita. A recuperação faz leitura autenticada fresca e CAS; só remove a pendência ao comprovar limpeza ou revisão posterior. Não chama a operação de enviar.

Após reload, o texto antigo ainda pode aparecer no editor junto do aviso; ele não pode ser reenviado enquanto a pendência estiver ativa. Texto editado depois e revisões de outra aba são preservados. Se o armazenamento do navegador falhar, a interface mantém a intenção original e pede para conservar a página aberta.

**Limite:** o marcador está neste navegador. Limpar os dados locais ou usar outro dispositivo pode perder essa correlação enquanto o rascunho cifrado continua no servidor. Isso é uma mitigação testada, não solução de limpeza entre dispositivos. A persistência da obrigação no servidor e sua relação com o ledger de envio devem ser fechadas antes de disponibilizar rascunhos persistentes à equipe. Não foi alterado o esquema nesta revisão.

Gates do incremento: 134 testes passaram em seis arquivos (inbox, controlador, contexto e rascunhos); TypeScript, build e diff-check passaram. Lint dos quatro arquivos modificados: zero erros, dois avisos preexistentes de Fast Refresh. Nenhuma migração foi modificada; suítes PostgreSQL anteriores não foram repetidas nem apresentadas como nova verificação de produção.

### Protótipo e revisão visual concluída

- Artefato: `../.attendance-concept-20261013/index.html`, com `styles.css`, `app.js` e instruções em `README.md`. Prévia em `http://127.0.0.1:4185/` enquanto o servidor local estiver aberto.
- Duas telas navegáveis, cinco contatos fictícios, filtros, rascunho por contato em memória, responsável, editar/concluir retorno, assistência de exemplo com origem, revisão e preparação sem envio. Nenhuma chamada de rede no JavaScript, credencial ou armazenamento persistente do protótipo.
- Sintaxe JavaScript e 24 verificações sintéticas de interação passaram; após ajuste de escopo, verificação direcionada confirmou cartões pessoais em 2 respostas / 3 retornos / 2 pendências / 1 consulta. Esses números são exclusivamente fictícios.
- Navegador: desktop 1440×900, celular 390×844 e 360×800. Observados fila/conversa/contexto, formulário de retorno com prazo, atribuição, conclusão sem mudar consulta, assistência, revisão sem envio e rascunho por contato. Em 1440 e 360, documento com largura igual à viewport; compositor em 360 termina dentro da altura disponível.
- Escape fecha o painel e a navegação permanece acessível. Estilos contêm foco visível e alternativa `prefers-reduced-motion`; não foi feita auditoria completa WCAG nem teste com leitor de tela. Console da prévia sem erros/avisos nas interações verificadas.
- Capturas locais: `desktop-atendimento.jpg`, `desktop-meu-dia.jpg`, `mobile-conversa-360.jpg` e `mobile-contexto-360.jpg`, no diretório do protótipo.
- O protótipo não está integrado ao código de produção. A primeira implantação continua sendo layout + retornos/agenda reais, após consolidar a limpeza de rascunhos no servidor. A fila global de resposta fica para a etapa com cobertura comprovada de mensagens.
