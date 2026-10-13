# Atendimento — primeira etapa local (13/10/2026)

> Registro histórico da primeira etapa. As pendências de fila/Meu dia, correlação durável do rascunho e quantidade de migrações abaixo foram superadas **no código local** pelo complemento ao final. Resultados de teste anteriores continuam atribuídos à respectiva revisão; não comprovam publicação.

Estado: implementado e testado localmente; não publicado, não aplicado ao banco de produção, não verificado com usuários reais.

Branch: `codex/attendance-workspace-20261013`. Base conferida com `origin/main`: `62736be971573df7c01f1554ffc3e37e67e9c343`.
Projeto preservado: Jornada AI original, Lovable `36345211-2616-42f7-bb9e-e78a9d00ca22`.

## O que foi feito

- Desktop: lista, conversa e contexto administrativo no mesmo espaço. Celular: contexto em painel lateral, mantendo a conversa.
- Contato identificado por `ghl_contact_id` exato dentro da organização da sessão. Consulta, etapa, fonte e horário de atualização explícitos. Dados locais não são apresentados como leitura GHL em tempo real.
- Responsável administrativo local por identidade de usuário e papéis existentes. Não substitui o responsável GHL e não representa bloqueio exclusivo de atendimento.
- Um próximo retorno administrativo por contato, reutilizando `contacts.next_action` e `next_action_at`, com responsável, prazo no fuso da organização, conclusão, versão e auditoria sem copiar texto livre.
- Rascunho privado por organização, atendente, contato e conversa. Texto cifrado no servidor; nenhum texto do rascunho entra no localStorage da aplicação. Metadados mínimos de envio incluem somente identificadores, revisão e instante.
- Gravação automática, recuperação, estados de erro/indisponibilidade e decisão explícita em conflito. Edições posteriores são preservadas durante respostas tardias e limpeza de envio comprovado. A exclusão de texto também é uma alteração pendente.
- Desfazer aplicação de sugestão/correção de texto. Não desfaz envio de mensagem.
- Removida a apresentação de `next_action_at` como se fosse agendamento. Retorno interno e consulta passam a ter semânticas distintas.
- Preservados os controles de envio manual, revisão, anexos, DND, resultado incerto e não repetição automática.

## Arquivos principais

- `src/components/ghl-inbox.tsx`: integração do painel e rascunhos; intenção de envio gravada depois da preparação e imediatamente antes do pedido de envio.
- `src/components/attendance-context-panel.tsx`: contexto, formulário, estados e cache compartilhado desktop/celular.
- `src/components/attendance-draft-sync.ts`: coordenação de rascunhos, revisão, concorrência e limpeza após confirmação.
- `src/lib/attendance-context.{core,server,functions}.ts`: validação, escopo autenticado e conversão de prazo civil para UTC.
- `src/lib/attendance-draft.{core,server,functions}.ts`: escopo, verificação de conversa/contato GHL, criptografia e persistência privada.
- `supabase/migrations/20261013100000_attendance_context.sql`: responsável/versionamento, comando restrito ao servidor e auditoria.
- `supabase/migrations/20261013110000_attendance_drafts.sql`: rascunhos privados, CAS e validade.
- `src/lib/repo.ts`: remoção da equivalência indevida entre retorno e consulta.

## Evidências de validação

- Suíte integrada focada: **122 testes passaram em 6 arquivos** (inbox, controlador de rascunhos, painel, contexto, serviço de rascunhos e workspace).
- Contexto: **20 testes de contrato e 9 testes PostgreSQL passaram**; os testes PostgreSQL aplicaram todas as migrações reais em banco efêmero com identidades fictícias. Esses 20 de contrato se sobrepõem à suíte integrada; não somar como casos novos.
- Rascunhos: **11 testes PostgreSQL passaram** sobre fixture isolada e a migração real de rascunhos. Cobertura: cifragem, isolamento, concorrência, versão, validade e limpeza condicionada. A criação da mesma tabela também passou na cadeia completa de migrações da suíte de contexto.
- `npx tsc --noEmit`: passou.
- `npm run build`: passou; avisos de APIs TanStack `inputValidator` depreciadas e configuração de paths permanecem, sem erro de compilação.
- ESLint dos arquivos novos e inbox: zero erros; dois avisos preexistentes de Fast Refresh por exports auxiliares na inbox. Lint global não foi usado como comprovação de limpeza do repositório inteiro.
- `git diff --check`: passou.
- Prévia isolada com componentes reais e APIs substituídas por dados fictícios: desktop 1440x900 e celular 390x844/360x800; leitura, atribuição, salvar/concluir retorno, campo de prazo, preservação e recuperação de rascunho observados. Em 360 e 1440, largura do documento igual à viewport, sem transbordamento horizontal.
- Mudanças de fuso/horário de verão, leitor sem escrita, responsável de outra organização, CAS entre dois operadores, escrita direta bloqueada, resposta atrasada e sincronização GHL preservando contexto cobertos em testes.
- Prévia não é prova de integração publicada nem de entrega de mensagem. Nenhuma chamada real de envio ou IA foi feita.

Capturas locais, fora do pacote de produção:

- `../.attendance-qa-20261013/desktop-attendance.jpg`
- `../.attendance-qa-20261013/mobile-context-360.jpg`

## Dependências para disponibilizar à equipe

1. Revisar e integrar esta branch sem reescrever o histórico existente.
2. Aplicar as duas novas migrações antes de disponibilizar o código. A aplicação sem elas mostra indisponibilidade, sem criar registros alternativos.
3. Confirmar somente presença/validade das configurações existentes: `COMMERCIAL_AGENT_ENCRYPTION_KEY`, configuração Supabase do servidor, vínculo de location e autorização de leitura GHL. Nenhum valor foi exposto ou alterado nesta etapa.
4. Publicar e verificar autenticação, papéis reais, migrações e persistência no ambiente publicado, com contato de teste e sem envio automático.
5. Medir latência e volume de leituras GHL geradas pela verificação de escopo dos rascunhos. Falha de verificação não deve liberar acesso.
6. Rascunhos têm validade lógica de sete dias e limpeza no acesso; há função de expurgo, mas nenhum agendamento de expurgo foi ativado. Definir retenção/limpeza física antes de prometer eliminação automática em sete dias. A recuperação persiste apenas texto; anexos continuam temporários.

## O que permanece fora desta etapa

- Fila global de prioridades, retornos reaparecendo automaticamente na fila e página “Meu dia”.
- Indicador de outro atendente digitando e exclusividade de atendimento.
- Resumo IA com evidências, biblioteca contextual de modelos aprovados e linha do tempo unificada.
- Integração de pagamentos, mensagens programadas, alteração de workflow ou de oportunidades GHL.
- Publicação, migração em produção e teste com a equipe.

Próxima entrega sugerida: fila e “Meu dia” consumindo estes mesmos campos de responsável/retorno, sem duplicar contatos ou tarefas.

## Complemento — Meu dia, fila administrativa e recuperação durável (13/10/2026)

Estado desta etapa: **implementado localmente, com testes dirigidos locais; integração, migrações remotas, publicação e verificação publicada pendentes**. A revisão de código e os gates combinados finais serão registrados pelo coordenador após congelar a alteração. Base local deste incremento: `9e7f740`, na mesma branch `codex/attendance-workspace-20261013`.

### Meu dia e fila

- A página Meu dia e a fila administrativa reutilizam `contacts.attendance_owner_id`, `next_action`, `next_action_at` e `appointments`. Não há nova tabela de tarefas nem alteração de responsável, tarefa, consulta ou oportunidade no GHL.
- `readAttendanceWorkspace` exige sessão autenticada. O perfil determina a organização; a RPC `attendance_workspace_read`, executável somente pelo servidor, revalida a organização e os papéis `administrador`, `gestor`, `comercial` e `visualizador`. Os filtros são meus, todos e sem responsável, dentro do escopo organizacional já permitido. Visualização não concede escrita.
- A RPC é somente leitura. Contagens completas e página selecionada usam o mesmo snapshot SQL; páginas de 25 ou 50 itens não limitam as contagens aos contatos carregados no navegador. Atualizações entre pedidos podem alterar a composição das páginas.
- Cobertura: contatos locais não demonstrativos com `ghl_contact_id` válido e consultas vinculadas ao ID local exato. Não há correspondência por nome. Os motivos de fila são retorno vencido, retorno de hoje e consulta de hoje, com fonte e instante consultado.
- “Retornos de hoje” inclui os prazos do dia civil inteiro; “vencidos” inclui qualquer prazo anterior ao instante consultado, inclusive de hoje. Há sobreposição: os cartões não devem ser somados. Consultas de hoje usam o intervalo do dia no fuso da organização e os estados ativos explicitamente admitidos pela consulta. Horário passado não prova ausência à consulta.
- “Aguardando resposta” permanece **indisponível**, nunca zero inferido, porque não há uma projeção completa de mensagens para toda a clínica. Não lido não significa resposta pendente.
- A fonte da fila é o banco local: consultas vinculadas ao GHL são identificadas como cache GHL. `checkedAt` informa quando a leitura local ocorreu; `lastContactSyncAt` informa a sincronização de contatos, sem representar atualização da agenda ou leitura GHL em tempo real.
- Ao selecionar um contato, `resolveAttendanceConversations` faz leitura GHL autenticada por ID exato e confirma contact/location. Consulta somente metadados, com limite de quatro páginas de 25 conversas. Apenas cobertura comprovadamente completa com uma conversa permite abertura única; múltiplas, nenhuma ou cobertura incompleta permanecem explícitas. Não cria conversa nem carrega milhares de históricos.

Arquivos adicionais: `src/components/attendance-my-day.tsx`, `src/lib/attendance-workspace.{core,server,functions}.ts`, respectivos testes, `src/routes/index.tsx` e integração da fila/contexto em `src/components/ghl-inbox.tsx`.

### Rascunho ligado ao envio comprovado

- Antes do POST externo, a revisão privada do texto pode ser vinculada ao dispatch manual existente por organização, autor, location, contato, conversa, requestId, revisão e HMAC do texto exato. O servidor calcula o hash; não confia em recibo ou hash fornecidos pelo navegador.
- A RPC `attendance_draft_bind_dispatch` vincula somente um dispatch ainda preparado e compatível. `attendance_draft_load_reconciled` recupera a obrigação de limpeza no servidor, inclusive em outro dispositivo, somente quando o ledger registra `sent`, aprovação e `messageId` não vazio para a mesma revisão. Não transforma `unknown`, `sending`, rejeição ou ausência de recibo em sucesso.
- A limpeza usa a mesma trava pessoal e CAS dos rascunhos. Uma edição posterior, inclusive texto idêntico com nova revisão, permanece. Não há segundo envio para obter essa limpeza.
- **Concorrência no vínculo:** `draft_binding_conflict` pode ocorrer depois da criação do dispatch preparado ou quando outra requisição já o avançou. Esse erro não autoriza gerar outro requestId nem repetir POST. A interface conserva a intenção original e consulta o estado do mesmo pedido antes de liberar uma nova tentativa; um estado incerto continua bloqueado. Essa conduta é parte do contrato de integração, não uma declaração de entrega pelo provedor.
- Validade lógica de sete dias e limpeza no acesso permanecem. Existe função de expurgo, mas **não foi criado/ativado cron**. Conteúdo cifrado de escopos inativos pode permanecer após a validade sem manutenção. Não prometer exclusão física em sete dias. Metadados de vínculo seguem a retenção do ledger manual, sem texto livre; anexos não se tornam rascunhos persistentes.

### Migrações locais e ordem de implantação

Aplicar as quatro migrações em ordem antes do novo código:

1. `20261013100000_attendance_context.sql`: responsável, versão, retorno e auditoria administrativa.
2. `20261013110000_attendance_drafts.sql`: rascunho pessoal cifrado e CAS.
3. `20261013130000_attendance_draft_dispatch_recovery.sql`: vínculo ao ledger manual e recuperação de limpeza.
4. `20261013140000_attendance_workspace.sql`: RPC de leitura do Meu dia e índice da fila; sem tarefa adicional.

Nesta documentação, “migração local” significa arquivo preparado e aplicado em PostgreSQL efêmero de teste, **não** aplicação no Lovable Cloud. Ausência das estruturas deve resultar em indisponibilidade explícita. Não criar armazenamento alternativo para disfarçar migração ausente.

### Evidências e limites desta etapa

- Meu dia/resolução de conversa: **19 testes dirigidos locais** (11 de contrato e oito PostgreSQL) passaram. A suíte de banco aplica a cadeia real de migrações em banco efêmero, com dados fictícios, mais de mil contatos, escopo, paginação, transição de horário de verão e leitura concorrente à conclusão de retorno. Estes números não substituem nem devem ser somados sem deduplicação aos gates combinados finais.
- Revisão independente de recuperação do rascunho não encontrou defeito concreto de isolamento, limpeza de revisão nova, segundo POST ou dependência inversa de locks nas RPCs examinadas. Isso é evidência de revisão de código, não teste remoto ou prova de entrega.
- Pré-verificação do coordenador em **13/10/2026** confirmou somente presença das configurações `COMMERCIAL_AGENT_ENCRYPTION_KEY`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GHL_PRIVATE_TOKEN` e `GHL_LOCATION_ID`; a chave de cifra passou na validação de 32 bytes. Nenhum valor foi registrado neste documento.
- A mesma verificação retornou HTTP **200** na leitura autenticada da location esperada e HTTP **200** com **seis pipelines**. Confirma leitura GHL nessa subconta; não comprova todas as operações do CRM, envio ou execução de automações.
- Revisão editorial remota observada após a pré-verificação: `161c8998773a04e76edec4b5b64c04766c21fcef`, com registro em `.lovable/plan.md`; deve ser preservada na integração. Essa revisão não contém a nova implementação local e não identifica por si só a versão publicada.
- Marcador candidato: build `jornada-attendance-workspace-20261013.1` e capacidades `attendanceContext:1`, `attendanceDrafts:1`, `attendanceDraftRecovery:1`, `attendanceDay:1`. Conferir `/api/version` após publicar; um `release:null` não fornece prova do SHA publicado.
- Nenhum envio real, ativação de automação, alteração de contatos/oportunidades/workflows GHL ou aplicação remota de migração foi realizado por esta etapa local.

Continuam pendentes publicação verificável, teste autenticado do Meu dia e persistência entre dispositivos no ambiente publicado, latência real das leituras de escopo e política de expurgo físico. Presença de atendentes, exclusividade de atendimento e fila global de respostas continuam fora da implementação; responsável local não representa esses estados.


### Fechamento local para implantação — 13/10/2026

- Suíte combinada: 176 testes em nove arquivos passaram; após o vínculo `draftRevision` da interface, os 82 casos de inbox/contexto passaram novamente. Três testes específicos do painel persistente passaram, incluindo SSR/hidratação, Escape/foco e edição preservada ao fechar/reabrir ou mudar entre desktop e celular. Contagens se sobrepõem e não devem ser somadas.
- Banco PostgreSQL efêmero: 44 testes de rascunhos/recuperação/ledger, oito de Meu dia e dez de contexto passaram. A cadeia real de migrações foi executada; a consulta `booked` agora é consistente entre contexto e Meu dia.
- A interface envia a revisão privada exata junto ao pedido manual. Os três erros `draft_binding_*` mantêm a intenção e o bloqueio até a consulta do ledger, inclusive sob requisições concorrentes. Mídia sem texto não cria obrigação de limpeza.
- Salvar/concluir acompanhamento invalida todos os filtros do Meu dia da mesma sessão/organização. A fila atualiza a cada minuto em primeiro plano e ao recuperar foco.
- Conferência visual com componentes reais e APIs fictícias: 1280/1440 desktop e 390/360 celular, sem transbordamento horizontal. Filtros de prazo/responsável, atalho por contato exato e preservação de edição de contexto conferidos. Capturas em `../.attendance-qa-20261013/desktop-attendance-v2-1440.jpg`, `desktop-meu-dia-v2-1440.jpg` e `mobile-context-v2-360.jpg`. Estes arquivos não integram o pacote publicado.
- TypeScript e build passaram; avisos de depreciação TanStack/paths e dois avisos preexistentes Fast Refresh permanecem. ESLint dirigido e `git diff --check` sem erros após formatação dos testes. Nenhuma mensagem enviada durante validação.

### Estado ATUAL publicado — 13/10/2026 20:00 UTC (substitui as pendências de publicação acima, que ficam como histórico local)

- Revisões: pacote `6c6343a`; editorial integrada `6d7874e` (44/44 `afterSha256` exatos conforme coordenador; extras só `.lovable/plan.md`, drizzle 0018–0021/meta/_journal e tipos gerados). Deployment `b26d373e-3322-49a3-91c8-94e2439759f1`.
- Migrações nativas efetivamente aplicadas no backend: `0018_attendance_context`, `0019_attendance_drafts`, `0020_attendance_draft_dispatch_recovery`, `0021_attendance_workspace` (SQL equivalente aos ficheiros `supabase/migrations/20261013{10,11,13,14}0000_*`, sem comentários/wrappers `begin`/`commit`). Ausência conferida antes; aplicadas uma vez.
- Segurança (read-only): 6 RPCs `security definer` só `service_role`; guard sem execução anon/auth; `attendance_drafts` RLS+FORCE, SELECT anon/auth=false. Binding GHL preservado; donos locais atribuídos 0.
- Marcador público: `GET /api/version` 200 (coordenador 19:57:37.255Z; reconferido 20:00:44.274Z), build `jornada-attendance-workspace-20261013.1`, `attendanceContext:1`, `attendanceDrafts:1`, `attendanceDraftRecovery:1`, `attendanceDay:1`, capacidades anteriores preservadas, `release:null` — não prova SHA.
- Evidência UI publicada (coordenador): Meu dia em Europe/Lisbon, "Meus" 0 itens, filtro "Sem responsável" com 1 consulta; abertura por ID exato do contacto de teste mostrou contexto real. Rascunho: texto administrativo fictício salvo como 1 payload cifrado v1 com TTL 7d, recuperado idêntico após reload, esvaziado → 0 payloads, 1 tombstone (payload/hash/expiry NULL). Guard de envio bloqueou janela >24h.
- Testes: execução Lovable 179 unitários/10 suítes passaram; 4 suítes DB (39) não executadas (PG_TEST_BINDIR ausente). Evidência DB local do coordenador: 62 testes, incluindo 23 regressões manual-inbox. Contagens sobrepostas não somadas.
- Não comprovado em produção: envio/entrega, recuperação pós-envio entre dispositivos (só local), expurgo agendado (nenhum cron). Nenhuma mensagem, mídia, IA, escrita GHL, dono/retorno real, workflow ou ativação.
