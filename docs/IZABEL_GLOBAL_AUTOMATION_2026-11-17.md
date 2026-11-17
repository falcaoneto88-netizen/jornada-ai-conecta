# Izabel em todo o Meu Chat — 17/11/2026

## RESUMO ATUAL — 17/11/2026 22:38 UTC: Izabel global PUBLICADA com automação DESLIGADA

- Publicação feita pelo Codex pela interface no projeto original; a revisão conferida antes do clique foi 2c7569fd654280245c4f966126141fbc6abc53cd. O Lovable confirmou "Seu site foi atualizado".
- GET público /api/version às 2026-11-17T22:38:43.215Z: build jornada-izabel-global-20261117.1; izabelGlobalAutomation=1; supervisionQueueRead=2; knowledgeVersion=V03; automaticScope=approved_owner_text_subset; automaticActivation=organization_opt_in_new_inbound_only; release=null (o endpoint não prova o SHA publicado).
- UI autenticada verificada após publicar em /agente-supervisionado e /caixa-de-entrada: Izabel automática desligada, botão "Ativar em todo o Meu Chat", supervisão com Histórico 230 e Ligação GHL validada. Ninguém clicou em ativar e não houve envio.
- O Codex reproduziu a revisão final 2c7569f num checkout isolado: tsc, build e 19/19 testes (inbox-review.test.ts e inbox-route.test.ts) passaram. Duas revisões técnicas independentes não encontraram bloqueio para publicar com a automação OFF. As contagens anteriores ficam como estão, sem somar suítes sobrepostas.
- Revisão final: types.ts regenerado pela plataforma (dispatch_origin: string) + validação estrita fail-closed em inbox-review.server.ts.
- Migrações 0029 e 0030 aplicadas uma única vez cada, variante Drizzle. O espelho Supabase da 0030 mantém begin/commit; a variante aplicada usa a transação da ferramenta. Não são iguais byte a byte.
- Estado: implementado ✔ · testado local e prévia ✔ · publicado com UI autenticada ✔ · E2E com paciente (envio, recibo, segunda resposta, intervenção e pausa) ✘.
- Cron não verificável pelo papel disponível; o cursor do observer foi visto a avançar. Emissores externos ainda precisam de conferência operacional. A identidade Zaptos final7009 continua pendente, com cadastros separados.
- Histórico anterior preservado abaixo.


## Estado desta entrega

Implementação **local**, com ativação **desligada por padrão**. Nenhuma migração, publicação, ativação, mensagem, contato, consulta ou workflow foi alterado em produção nesta entrega.

Destino: projeto original Jornada AI `36345211-2616-42f7-bb9e-e78a9d00ca22`. Base de trabalho local `fb19952b9a42d21ff30b3fa93220b99b51637944`, acrescida das alterações preservadas de conclusão V03 e deste incremento. O `origin/main` local consultado aponta `6dfb88e1728c88149e2d1ed9799b763118a9f4e8`; isso não é uma nova consulta ao GitHub nem identifica o código publicado.

Build preparado: `jornada-izabel-global-20261117.1`. A rota `/api/version` identifica capacidade de ativação global, e não afirma que ela esteja ligada. A publicação desta revisão não foi verificada.

## Como funciona para a equipe

1. No **Meu Chat**, administrador ou gestor encontra **Ativar em todo o Meu Chat**. A supervisão apresenta o mesmo estado, gravado no servidor.
2. A confirmação mostra os canais já autorizados. O servidor confere identidade, organização, subconta, configuração de envio e biblioteca privada antes de registrar a ativação.
3. Todas as **novas mensagens elegíveis** recebidas a partir desse instante podem gerar uma resposta textual automática. Não é preciso ligar por conversa. O histórico anterior, rascunhos antigos e eventos anteriores à ativação não são reenviados.
4. **Assumir atendimento** pausa a Izabel somente para aquele contato. As conversas que a equipe já assumiu continuam pausadas quando o botão geral é ligado. Não há retomada silenciosa.
5. **Pausar em todo o chat** bloqueia novos despachos. Uma requisição já aceita pelo canal pode concluir; a pausa não apaga nem cancela mensagens entregues.
6. Casos que dependem da equipe aparecem em **Com a equipe**. Envio com resultado incerto permanece em **Envio a conferir**, sem repetir o POST. Registros automáticos não podem ser aprovados como se fossem sugestões supervisionadas.

O botão aplica-se à organização da sessão. Não habilita outras subcontas. Usuários comerciais podem consultar o estado e assumir atendimentos conforme as permissões existentes, mas só administrador/gestor altera o controle global.

## Limite da autonomia

Esta versão automatiza o subconjunto **comercial textual V03** cuja fonte tem status `approved_owner`. O artefato privado local contém 30 registros elegíveis ao modo supervisionado: 25 `approved_owner` e 5 `draft_supervised`; estes cinco ficam fora da geração automática. O arquivo privado não foi adicionado ao Git nem ao bundle.

Geração automática exige identificação dos registros que fundamentam a resposta. Perguntas clínicas, sinais de urgência, solicitação de humano, anexos, falta de evidência e informação financeira/agenda não verificada encaminham à equipe. O agente não diagnostica, prescreve, recebe pagamentos, modifica agenda nem promete executar ações que não possui. O modo supervisionado existente permanece disponível.

O canal SMS do GHL preserva o provedor já configurado, inclusive transporte Zaptos/WhatsApp quando esse for o provedor comprovado. Não representa contratação de SMS de operadora. Rotas nativas também exigem evidência própria; WhatsApp exige o par de números da mensagem canônica. Nenhum canal é escolhido por aproximação.

## Implementação e controles

| Área | Implementação |
| --- | --- |
| Controle global | `src/components/izabel-global-control.tsx`; montado em `caixa-de-entrada.tsx` e `agente-supervisionado.tsx` |
| Intervenção humana | `izabel-takeover-control.tsx`, reutilizando sessão e pausa existentes no cabeçalho do Meu Chat |
| Autenticação e autorização | `commercial-agent-automation.functions.ts`, `automation-context.server.ts`, `automation-control.server.ts`; organização solicitada comparada à sessão, location derivada no servidor |
| Política e fontes | `knowledge-v03.server.ts`, `providers.server.ts`; política automática independente, biblioteca privada verificada, sem fallback V02 |
| Processamento | `service.server.ts`, `runtime.server.ts`; worker existente, nova autorização separada da aprovação humana |
| Persistência | SQL0029: configuração global, versão, início, canais e ator; despacho com origem automática e snapshot do autorizador; `approved_by` fica nulo |
| Fila | SQL0030 e `queue-read.server.ts`; proposta automática em Equipe, envio incerto em Conferir, conclusão em Histórico; RPC anterior preservada |
| Rota e recibo | Rota incluída no payload criptografado/hash e revalidada antes do POST; reconciliação automática verifica o recibo pela mesma rota |

O backend revalida contexto, DND, recusa, janela do canal, histórico, versão da sessão, política, canais e permissão de escrita. A reserva durável compartilha os bloqueios dos envios manuais. Alterações concorrentes do botão usam versão esperada; não há alteração otimista apresentada como sucesso.

Um outbound observado enquanto o despacho automático ainda não gravou o recibo é adiado brevemente, sem avançar o cursor. Após o recibo, o ID exato identifica a própria mensagem. Uma saída diferente continua sendo intervenção humana. Despacho antigo ou incerto não fica adiado indefinidamente; exige reconciliação. A correção não retoma conversas automaticamente.

Falha entre persistir uma proposta e despachá-la pode deixá-la em Equipe. Não há reenvio automático de propostas antigas. Isso prioriza evidência e evita duplicação após interrupções.

## Aplicação futura no projeto original

1. Conferir a revisão remota e preservar as mudanças já existentes; não sobrescrever o projeto com este checkout antigo inteiro.
2. Aplicar primeiro `supabase/migrations/20261117160000_commercial_agent_global_automation.sql` e depois `20261117170000_commercial_agent_automation_queue.sql`. Os arquivos Drizzle `0029` e `0030` são **espelhos**, não migrações adicionais para executar em duplicidade.
3. Publicar o código correspondente, mantendo `automation_enabled=false`. Conferir o build esperado em `/api/version` e os controles autenticados nas duas telas.
4. Verificar operação do worker, avanço do cursor, vínculo GHL e rota de envio atuais. Estado de configuração não comprova latência, entrega ou funcionamento ponta a ponta.
5. Conferir bots/workflows concorrentes no GHL/n8n/Zaptos. O bloqueio durável desta aplicação não substitui coordenação com outros emissores independentes.
6. Validar com contato de teste inequívoco: nova entrada, resposta, recibo, próxima resposta, intervenção humana, pausa global, duplicação e erro incerto. Só então usar o botão geral com ciência de que ele abrange todas as novas entradas elegíveis da clínica.

Configurações reutilizadas, sem valores: `COMMERCIAL_AGENT_ENABLED`, `COMMERCIAL_AGENT_SEND_ENABLED`, `COMMERCIAL_AGENT_DISCOVERY_ENABLED`, `COMMERCIAL_AGENT_ENCRYPTION_KEY`, `COMMERCIAL_AGENT_WORKER_SECRET`, `COMMERCIAL_AGENT_AI_PROVIDER`, `COMMERCIAL_AGENT_MODEL`, `IZABEL_KNOWLEDGE_BUCKET`, `GHL_PRIVATE_TOKEN`, `GHL_LOCATION_ID`, `LOVABLE_API_KEY` ou `OPENAI_API_KEY`, além do vínculo e da permissão de escrita GHL existentes. Nenhum segredo novo foi criado. O controle não instala nem ativa o cron.

A decisão do usuário de manter separados os dois cadastros do número final 7009 permanece. O encaminhamento das respostas pelo Zaptos ao cadastro pretendido continua sendo uma pendência externa; esta entrega não mescla nem associa contatos por telefone.

Rollback operacional: desligar o botão global e conferir a persistência. As migrações são aditivas e podem permanecer; voltar o código não deve remover auditoria nem registros de despacho. Não repetir envios cujo resultado seja incerto.

## Evidências locais

- Regressão final comercial e de interface: **1.148 testes aprovados em 36 arquivos**, com PostgreSQL nativo temporário e provedores falsos, incluindo corrida do recibo, isolamento, concorrência, rota WhatsApp e pausas. Não foram usados pacientes nem endpoints de envio reais.
- Controle/serviço, SQL global/ingresso, fila v2 e testes de providers também passaram separadamente. Esses subconjuntos se sobrepõem à regressão; não somar suas contagens.
- Após os ajustes finais de texto, os controles foram revalidados: suíte global17/17 e painel33/33 aprovados. “Ativada” informa configuração persistida, sem prometer entrega. Build repetido após os rótulos finais: aprovado.
- Tipos de banco atualizados; `tsc --noEmit` e build cliente/servidor aprovados. Build emite avisos de APIs depreciadas já usadas no projeto.
- ESLint dos 41 arquivos de código/testes alterados: zero erros, três avisos Fast Refresh existentes. O arquivo gerado `types.ts` mantém o formato do gerador: a regra Prettier acusa 2.890 divergências; as demais regras passaram com essa regra de formatação desativada somente na verificação CLI. Não foi reformatado o arquivo gerado inteiro nem declarada aprovação do lint global.
- Impeccable aplicado aos controles e layout existente: detector final dos sete arquivos UI retornou `[]`.
- Prévia local com componentes reais e APIs fictícias: ativar, assumir atendimento e pausar conferidos visualmente a 1280×720, sem overflow horizontal; Escape fecha a confirmação e devolve o foco ao botão. Não constitui teste autenticado de produção nem validação visual móvel.
- Capturas locais: `outputs/izabel-global-proof/controle-global-simulacao.png` e `controle-global-desligado.png`, explicitamente marcadas como simulação.

Pendente: aplicação/publicação desta revisão, verificação autenticada do estado e do cron atuais, geração com modelo real, testes semânticos com a equipe e fluxo real de envio/recibo. Nenhuma dessas pendências é apresentada como concluída por um build, fixture ou botão visível.

## Implantação no Lovable — 17/11/2026 ~22:30 UTC (prévia; NÃO publicado)

- Base conferida: 6dfb88e; 46/46 before_sha256 iguais; 46/46 contents com after_sha256 corretos. Código/docs/testes gravados exatos. Commit automático da plataforma ao aplicar migração: e0882ad.
- Preflight (SELECT): commercial_agent_command e commercial_agent_queue_read presentes; commercial_agent_inbox.observed_at presente; objetos 0029/0030 ausentes; audit=6579 linhas; drafts invalidated 220 / pending 8 / rejected 1 / sent 1.
- 0029 e 0030 aplicadas UMA vez cada via lov_database--migration (transação da ferramenta). Variante única: Drizzle; espelhos supabase/migrations gravados mas não executados (o espelho 0030 mantém begin/commit; não são byte a byte iguais à variante aplicada). 0030 aplicada sem as linhas `begin;`/`commit;` (a ferramenta proíbe controle de transação e fornece a transação); demais linhas idênticas. Journal real: idx 29 when 1794954385800, idx 30 when 1794954505405 (candidatos 1794931200000/1794934800000 não usados); snapshots 0029/0030 gerados pela plataforma; entradas 0000–0028 preservadas. SQL gravado = pacote exceto newline final (restaurada) e begin/commit da 0030.
- types.ts: o gerado tipava dispatch_origin como string; mantido o conteúdo exato do pacote (união "supervised"|"automatic"), necessário para o tsc.
- Pós-aplicação (SELECT): automation_enabled=false, version=0, canais vazios, since/ator/policy_hash nulos; 230/230 drafts dispatch_origin=supervised; estados inalterados; audit=6579 (índice criado sem gravar linhas). RPCs commercial_agent_automation_command e commercial_agent_queue_read_v2: SECURITY DEFINER, search_path="", EXECUTE só postgres/service_role. RLS ativa em settings/drafts/audit, sem novas policies. n8n: bridge_enabled/live_send/channel_verified inalterados.
- Gates: tsc OK; vite build OK; ESLint nos 41 TS/TSX do pacote (types.ts excluído) 0 erros, 3 avisos fast-refresh; git diff --check OK; vitest 1725/1725 em 45 arquivos (commercial-agent, izabel, UI, n8n; sem *.db). NÃO executados: 9 arquivos *.db.test.ts (234 testes) — initdb falha no sandbox; os 9 arquivos PG / 234 testes não foram repetidos no Lovable. (Correção 17/11 22:40 UTC: os 1148 testes locais em 36 arquivos executados localmente pelo Codex/revisão técnica incluem unitários, UI e PG — NÃO são 1148 testes de banco.)
- Geração sintética direta (configuredAutomaticGenerator, loader privado real, escopo f07ab3be/ok2UHC2QMZsd8UHsAgEa; sem worker/evento/fila/persistência/envio), modelo openai/gpt-5.4-mini, modo automatic, todas com fontes approved_owner:
  - PT comercial: ok, 4913/109 tokens, 4 fontes, handoff=true (flags commercial_conflict, unsupported_action), 1,6 s.
  - FR sem fonte: ok, 4913/79, handoff=true (missing_policy), 1,0 s.
  - EN clínica individual: ok, 4922/95, handoff=true (clinical), 1,1 s.
  - PT opt-out: ok, 4912/45, optOut=true, handoff=true, 0,9 s.
  - PT pedido de humano: ok, 4912/60, handoff=true (human_requested), 0,9 s.
  Nota: com flags, o servidor exigiria revisão (review_required); nenhum caso seria enviado automaticamente.
- Configuração (só presença): IZABEL_KNOWLEDGE_BUCKET, LOVABLE_API_KEY, COMMERCIAL_AGENT_AI_PROVIDER, COMMERCIAL_AGENT_MODEL, COMMERCIAL_AGENT_ENABLED, COMMERCIAL_AGENT_SEND_ENABLED, COMMERCIAL_AGENT_DISCOVERY_ENABLED, COMMERCIAL_AGENT_WORKER_SECRET presentes no sandbox. Bucket izabel-knowledge privado; binding org↔location presente; ghl_connections.write_enabled=true. Agendadores (cron): não legíveis pelo papel de leitura — não verificados nem alterados.
- Estado: local ✔ · prévia ✔ (automação global OFF) · publicado ✘ (aguarda comparação independente) · E2E com paciente ✘.

## Casos sintéticos positivos — 17/11/2026 ~22:38 UTC (prévia; NÃO publicado)

Comparação independente (Codex/revisão técnica) sobre 6eae29d: 42/46 exatos; diferenças só nos 2 documentos, journal real, envelope transacional da 0030 e snapshots gerados. Código e guardas não alterados.

Gerador automático real direto (configuredAutomaticGenerator, loader privado real, mesmo escopo; sem worker/fila/persistência/envio), openai/gpt-5.4-mini:
- PT saudação simples: ok, flags [], handoff=false, optOut=false; 2 fontes approved_owner; 4904/64 tokens; 0,96 s.
- PT institucional (localização, resposta expressa em fonte approved_owner): ok, flags [], handoff=false, optOut=false; 1 fonte approved_owner; 4907/55 tokens; 0,89 s.
O gerador não devolve campo requiresHumanReview; o equivalente servidor é flags>0 → review_required. Com flags vazias e sem handoff, ambos são elegíveis no gerador. O envio continua dependente das demais verificações do servidor (automação ligada, janela, versão, canal) — atualmente OFF.

Observer/worker (SELECT apenas, nada executado): receive_cursor_until = 2026-11-17 22:33:00.787 UTC (avançando); inbox: última ignored 18:30:06 UTC (5963), última ready 13:08:03 UTC (230); último draft 13:08:04 UTC; último audit 22:19:37 UTC (últimas 6 h: human_paused 3, human_resumed 1); audit total 6579. Agendadores (cron): não legíveis pelo papel de leitura.
