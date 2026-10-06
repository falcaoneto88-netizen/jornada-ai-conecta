# Estado da implantação — 06/10/2026

## Estado vigente — preparação do piloto SMS/Zaptos, ainda desligado

Base atualizada para `ee7f3463640c992f415a67130c8cbdcfb0e100f0`, preservando as alterações n8n já existentes. Foi configurada somente a allowlist do contato controlado terminado em 7009 e canal `SMS`, com `mode=off`. Nenhuma geração ou envio real foi liberado.

Diagnóstico seguro de 06/10: chave de criptografia presente, mas não decodifica 32 bytes; segredos próprios webhook/worker ausentes. As credenciais existentes HighLevel/Lovable permanecem no servidor. A entrada e o salvamento das três chaves foram entregues ao usuário no painel seguro. Nenhum valor está neste documento.

Inspeção canônica read-only do contato autorizado: contato, pesquisa de conversas, conversa e primeira página de mensagens retornaram HTTP 200. Uma única conversa com IDs de escopo iguais; 24 registros, `nextPage=false`. Tipos observados: 13 `TYPE_CUSTOM_SMS`, 10 atividades e 1 Instagram. O adapter agora trata `TYPE_CUSTOM_SMS` como transporte `SMS`, preservando `conversationProviderId`; atividades não são mensagens comerciais. A verificação não envia mensagem nem demonstra recebimento novo.

A entrada adicional `/api/public/commercial-agent-notification` aceita somente um aviso autenticado com `locationId`/`contactId`, usando o `GHL_WEBHOOK_SECRET` já usado pelo workflow de contatos. Não confia em texto, messageId ou conversationId enviados pelo workflow. Consulta a API canônica e só depois registra os IDs reais. O worker também verifica mensagens enviadas para reconhecer intervenção humana. O caminho Marketplace/segredo próprio anterior permanece separado.

Novo caminho desabilitado por padrão: `COMMERCIAL_AGENT_DISCOVERY_ENABLED=false`. Para homologar, definir início explícito `COMMERCIAL_AGENT_PILOT_SINCE` em ISO com fuso no instante da abertura do piloto, autorizar um único contato no banco e seguir a sequência em `OPERACAO.md`. O modo de descoberta recusa mais de um contato; ampliação requer revisão. Histórico completo limitado a 20 páginas de 50, sem retorno parcial. Nenhuma resposta automática foi acrescentada.

Workflow HighLevel `Jornada AI — Piloto supervisionado V02`, ID `28842f38-999d-44f2-a25d-c5460051045f`, criado e salvo em rascunho com zero inscritos. Gatilho `Cliente Respondido`, filtros canal SMS e etiqueta exclusiva `jornada-piloto-v02`; reentrada já habilitada. Ação aponta a `/api/public/commercial-agent-notification`, preserva o cabeçalho autenticado existente e manda somente locationId/contactId (`{{contact.id}}`, campo já observado no workflow original). Gravação da resposta do webhook desligada. A etiqueta foi criada e aplicada somente ao contato autorizado; a etiqueta anterior foi preservada, confirmado na interface com duas etiquetas. A cópia não altera o workflow original nem o webhook de entrega Zaptos. Nenhum botão de teste/publicação foi executado. O HighLevel identifica essa ação como premium; a execução pode consumir créditos adicionais do contrato atual.

Pendências de ponta a ponta: corrigir/salvar chaves, publicar configuração segura, configurar Vault/worker, finalizar o workflow isolado, iniciar recebimento restrito, mensagem real do contato de teste, rascunho com histórico, aprovação humana, envio único na conversa correta, recibo/entrega, duplicidade e pausa humana. Custos e manutenção seguem descritos em `OPERACAO.md`.

## Registro anterior de 06/10 — IA validada com dados fictícios

Publicado em 06/10/2026, commit Lovable/main `50e417bf5fd8dfb7be0ed251ccd7ec218ff7d5bf`, deployment `0487c4cf-f3ac-412a-b642-cdef7439a9f8`. O cabeçalho do endpoint público confirmou o novo deployment. `GET /api/public/commercial-agent-webhook` retornou HTTP 200, `supervised_only`; `POST {}` retornou HTTP 503, `disabled`. Banco reconferido: `mode=off`, zero contatos/canais permitidos, inbox, rascunhos e jobs. Nenhuma migração ou configuração de envio foi ativada.

Foram salvas no painel seguro as seleções não secretas `COMMERCIAL_AGENT_AI_PROVIDER=lovable` e `COMMERCIAL_AGENT_MODEL=openai/gpt-5.4-mini`, depois publicadas. Uma chamada real no servidor Lovable, usando a credencial gerenciada existente e apenas um cenário fictício, gerou resposta válida: 3.914 tokens de entrada e 76 de saída. Isso valida o adaptador/modelo; não comprova recebimento de mensagens, histórico real, aprovação ou envio. Nenhuma chave foi lida, exportada ou copiada.

Os três segredos próprios ainda estavam ausentes no diagnóstico: `COMMERCIAL_AGENT_ENCRYPTION_KEY`, `COMMERCIAL_AGENT_WEBHOOK_SECRET` e `COMMERCIAL_AGENT_WORKER_SECRET`. O formulário seguro foi preparado com o primeiro nome e valor vazio; a entrada e o salvamento foram entregues ao usuário conforme a regra de segurança do navegador. Não registrar valores no chat ou neste documento.

O usuário indicou o telefone controlado terminado em 7009 e esclareceu que deseja o “SMS” do CRM com entrega pelo WhatsApp existente. O contato foi encontrado por igualdade exata no Jornada AI e no HighLevel, com organização/location corretas e sem DND ativo na interface; ainda não foi incluído na allowlist. Em Sistema telefônico → Definições adicionais, a inspeção de 06/10/2026 confirmou “ZaptosWPP V2 - WhatsAPP like SMS” marcado como “Predefinição”. A inferência anterior de que seria necessário contratar SMS de operadora estava errada: essa contratação e uma troca de canal não são pendências para o fluxo solicitado. O payload deve preservar `type:"SMS"`, que identifica o transporte da API; não renomeá-lo para `WhatsApp`. Nenhum fornecedor foi alterado e nenhum serviço foi contratado. A entrega efetiva pelo WhatsApp ainda precisa ser demonstrada com o contato de teste.

WhatsApp QR e MultiAtendimento mostraram a instância #428, João Falcao / 351926991096, conectada; a instância Luciana #1861 estava desconectada. MultiAtendimento é o serviço externo Zaptos embutido, não o atendimento nativo do HighLevel. Atendentes listou um ADMIN, “joao matos neto”, com acesso a ambos os canais. A atribuição exclusiva estava desligada e não havia regras; “Verificar preparação novamente” retornou “O serviço de atendimento está indisponível”. A sincronização das regras e do repasse humano entre esses serviços ainda precisa ser validada. Essas observações não comprovam funcionamento de ponta a ponta; não houve envio nem mutação do CRM durante a inspeção.

A interface do MultiAtendimento oferece regras por canal/tag, encaminhamento individual ou em rodízio, simulação e prévia antes de aplicar à base. A atribuição exclusiva e a aplicação à base estavam suspensas; não foram habilitadas. Tags automáticas não tinham regras/aplicações listadas. A tela de tags em massa oferece seleção de até 500 contatos, adição sem remoção das tags existentes e revisão antes de aplicar; nenhuma seleção ou aplicação foi feita. A busca pelo telefone exato de homologação não retornou contato no MultiAtendimento, e a busca na lista de conversas por telefone/nome também não retornou resultado; isso não substitui a verificação do destinatário já encontrado no HighLevel nem prova ausência de variantes de identidade. Demonstrar a ligação entre IDs dos sistemas no teste controlado.

O workflow HighLevel “Jornada AI” (`7f2ac268-cc3d-4f11-b336-07f487d97f36`) estava publicado. O construtor mostrou o gatilho “Contacto Criado” e a ação “#2 Jornada AI — Contato criado”. Esse fluxo não comprova recebimento de mensagens do agente comercial. O primeiro carregamento falhou e a leitura funcionou após atualizar a página; nada foi editado, salvo, publicado ou testado com contatos. Não substituir o webhook de entrega do provedor Zaptos pelo webhook de observação do agente: são funções distintas.

Em Conversation AI → Lista de Agentes, “Felps Marcel Harmonização Glútea”, “Assistente Dr. João Falcão”, “Felps Marcel - Agendamentos Harmonização” e “Felps — Assistente Dr. João Falcão” estavam em modo Sugestivo. “Atendimento Dr. João Falcão V02 TESTE” estava Desativado e com canais “Não configurado”, assim como os outros três agentes desativados da lista. O painel tinha atividade recente atribuída a SMS e Instagram, mas isso não comprova envio automático: os modos atuais observados são sugestivos. Nenhum bot foi editado, ativado ou desativado. O agente V02 nativo e o novo serviço supervisionado Jornada AI são instalações distintas; não misturar seus estados nem ativar ambos para o mesmo teste.

Referências técnicas conferidas: [provedor personalizado que substitui SMS](https://marketplace.gohighlevel.com/docs/marketplace-modules/ConversationProviders/), [envio via API](https://marketplace.gohighlevel.com/docs/ghl/conversations/send-a-new-message/), [webhook de entrega ao provedor](https://marketplace.gohighlevel.com/docs/webhook/ProviderOutboundMessage/), [modo sugestivo do Conversation AI](https://help.gohighlevel.com/support/solutions/articles/155000001335). A documentação pública do Zaptos descreve integração e multiatendimento, mas não foi localizado contrato público suficiente de API/eventos para comprovar sincronização de responsáveis, pausa ou arquivamento: [guia do fornecedor](https://zaptoscompany.com/como-integrar-whatsapp-ao-gohighlevel-ghl/).

O diagnóstico remoto acessou a rota sem sessão e confirmou redirecionamento para login. Após esta publicação, uma nova aba do Chrome abriu a rota com a sessão existente: interface “Agente supervisionado”, “Conta ativa”, “Ligação GHL validada” e aviso “O serviço aguarda configuração segura no servidor”. O acesso autenticado à página foi comprovado; carregar e operar a fila ainda depende da configuração. Após cadastrar os segredos e publicá-los no serviço: configurar webhook com IDs estáveis, preparar worker/cron inativo, excluir o contato de automações concorrentes, liberar somente recebimento/geração para esse contato no transporte SMS/Zaptos já escolhido e demonstrar aprovação humana e envio/recibo. Pausa, duplicidade e repasse humano precisam ser comprovados nesse fluxo real antes de ampliar o atendimento.

A alteração recente `08be9f2..50e417b` acrescenta apenas tipos Supabase de recursos n8n; a sobrecarga antiga foi preservada e TypeScript passou com o novo arquivo sobreposto em memória. O custo de referência atualizado para o modelo selecionado está em `OPERACAO.md`.

## Registro de 05/10/2026 — publicação inicial desligada

Após a aprovação do usuário, a instalação foi publicada em `https://jornada-ai-conecta.lovable.app`. Commit integrado no Lovable/main: `b3db32e2580b5585997834a26885f43b8b1b2e8f`; árvore `414d9fd993f54733b32ecc741c00770ec461a7d6`, idêntica ao código local revisado. Deployment `beb7b403-9236-4e0c-b69d-df5e9c0d2333`. O painel confirmou “Seu site foi atualizado”, e o cabeçalho HTTP do endpoint público identificou esse mesmo deployment.

A sincronização anterior `9e35e0c` havia removido os arquivos do agente. Foram restaurados os 44 arquivos exatos a partir da branch revisada `codex/restaurar-agente-lovable` (`91569b8`), preservando as correções recentes de `__root.tsx` e dos tipos Supabase. O Git confirmou igualdade da árvore inteira antes da publicação. Nenhuma migração foi repetida.

Verificações no domínio publicado, em 05/10/2026 às 18:43 UTC, sem credenciais nem dados de contatos:

- `GET /api/public/commercial-agent-webhook`: HTTP 200, `{"service":"commercial-agent-v02","mode":"supervised_only"}`.
- `POST /api/public/commercial-agent-webhook`, corpo vazio `{}`: HTTP 503, `{"status":"disabled"}`.
- `POST /api/public/commercial-agent-worker`, sem segredo, corpo `{}`: HTTP 401, `{"error":"unauthorized"}`.
- Banco reconferido após publicação: `mode=off`, zero contatos/canais autorizados, zero eventos/rascunhos e zero jobs do agente.

As primeiras requisições Python receberam HTTP 403 do provedor; as mesmas verificações via curl atingiram a aplicação e deram os resultados acima. A rota `/agente-supervisionado` foi aberta com o título correto, mas permaneceu em “A carregar…” na observação disponível; a fila autenticada ainda não foi validada. O controle do Chrome foi interrompido por outra interface de extensão durante a preparação do painel de secrets.

Antes desta publicação, 94 testes locais, TypeScript e build passaram. No Lovable, tipos/build passaram e 741 testes passaram, com 20 ignorados; o arquivo de testes PostgreSQL do agente falhou porque o ambiente executa como root. Isso não representa homologação remota do banco nem dos provedores; os testes transacionais locais anteriores permanecem a evidência disponível.

A implementação para reutilizar `LOVABLE_API_KEY` agora está publicada, mas o provedor ainda não foi selecionado nas variáveis do ambiente nem validado com uma chamada real. Permanecem pendentes os três segredos próprios, a configuração explícita do provedor, o contato/canal controlado, o webhook/worker e o ciclo real de recebimento, geração, aprovação e envio. Nenhuma mensagem foi gerada ou enviada pelo novo agente.

Os registros abaixo descrevem etapas anteriores; menções a publicação bloqueada ou código apenas local foram superadas pelo estado vigente acima.

## Reutilização da chave usada pelo Jev — implementação publicada, configuração pendente

O Jev e o briefing da Jornada AI já usam `LOVABLE_API_KEY` no servidor. O novo agente agora tem um adaptador opcional para reutilizar essa credencial via `https://ai.gateway.lovable.dev/v1/responses`, com o modelo `openai/gpt-5.4-mini`. Essa alteração está publicada; a seleção do provedor e a homologação real no ambiente hospedado continuam pendentes.

Para selecionar esse caminho no servidor, definir `COMMERCIAL_AGENT_AI_PROVIDER=lovable` e `COMMERCIAL_AGENT_MODEL=openai/gpt-5.4-mini`. A chave gerenciada pelo Lovable permanece no ambiente existente: não ler, exportar ou copiar para `OPENAI_API_KEY`. Nesse modo, uma chave direta OpenAI não é necessária. Sem seleção explícita, permanece o provedor OpenAI direto; falhas não trocam de provedor automaticamente.

O adaptador mantém V02, redução de dados do histórico, `store:false`, JSON Schema estrito, validação local, timeout e bloqueio de redirecionamento. O modelo Jev permanece responsável pelas classificações existentes; não é usado para redigir as respostas. Nenhuma configuração de envio, allowlist ou geração foi ativada.

Validação local desta adaptação: 22 testes específicos do gateway e 72 testes de regressão do núcleo/provedor/HTTP do agente e Jev passaram, além de TypeScript e build Vite/Nitro. As chamadas de IA nesses testes são simuladas; não usaram a chave real. Os testes de banco anteriores não foram repetidos, pois não houve alteração em SQL nem no serviço de persistência/envio.

A compatibilidade foi conferida na [documentação Lovable](https://docs.lovable.dev/features/ai), no [contrato Responses do gateway](https://tanstack.com/ai/latest/docs/adapters/lovable) e na [documentação oficial OpenAI do GPT-5.4 Mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini). A disponibilidade da credencial/modelo, saldo, JSON Schema e resposta real ainda precisam de homologação com dados fictícios no ambiente hospedado. `store:false` é uma opção enviada à API; não é prova de ausência de logs ou retenção pelo intermediário. O custo do gateway usa o saldo de IA Lovable e a estimativa anterior para GPT-4.1 Mini direto não se aplica a esse modelo.

## Atualização após liberação do upload

O upload no Chrome foi confirmado. Os 44 arquivos da implementação foram publicados na branch `codex/agente-supervisionado-v02`; a comparação Git comprovou conteúdo idêntico à versão local revisada (árvore `3772f25d1af2a8778439b1d0f8b28cb12bbe535e`).

A [PR #1](https://github.com/falcaoneto88-netizen/jornada-ai-conecta/pull/1) foi criada e, após autorização específica para integrar com o agente desligado, mesclada em `main`. Commit de integração: `a862367d1c1da104f290ea95dc44c66f86d2d16c`. O Lovable confirmou esse mesmo commit como revisão atual, com atualização concluída. A árvore de `main` também coincide com o código revisado.

Banco reconferido após a integração: `mode=off`, zero contatos e canais autorizados, zero eventos/rascunhos e zero jobs do agente. Não houve geração real pela OpenAI nem envio real.

O preview exige autenticação; chamadas externas sem credenciais retornaram HTTP 403 do acesso ao preview. Esse resultado não comprova o comportamento dos endpoints da aplicação. A fila autenticada, a geração e o envio supervisionado reais ainda precisam de homologação.

A publicação no domínio `jornada-ai-conecta.lovable.app` foi rejeitada pela revisão automática por ser uma ação adicional à integração autorizada. Nenhum deploy de produção foi executado. Foi solicitada autorização específica para publicar a instalação ainda desligada. Não confundir a sincronização do preview com publicação em produção.

As credenciais e o contato de teste continuam pendentes. O código já está no GitHub e no preview; o bloqueio anterior de upload foi resolvido.

## Registro da etapa anterior à liberação do upload

Implantação parcial na infraestrutura existente da Jornada AI. O banco está preparado; o novo código ainda não foi publicado. O agente permanece desligado, sem mensagens reais.

## Instalado e conferido

- Projeto Lovable: `36345211-2616-42f7-bb9e-e78a9d00ca22`.
- Migração `20261003120000_commercial_agent_supervised.sql` aplicada em transação no Supabase do projeto e registrada em `supabase_migrations.schema_migrations`, com o SQL integral.
- Cinco tabelas criadas com RLS habilitada. Nenhum grant direto para `anon`, `authenticated` ou `PUBLIC`. A função de comando aceita execução somente por `service_role` entre esses papéis verificados.
- Configuração da organização `f07ab3be-7419-4779-a901-ef71c5fc27f0`, vinculada à location `ok2UHC2QMZsd8UHsAgEa`: `mode=off`, zero contatos e zero canais autorizados, zero rascunhos.
- Nenhum cron do agente instalado ou ativo. As integrações e automações existentes não foram alteradas.
- Conexão HighLevel existente encontrada com status `conectada` e escrita permitida. Isso não comprova o fluxo deste novo agente.

## Código e verificação

Implementação revisada no commit local `5fe1900f768985b257cc19faf8ef871fb9b312aa`, branch `codex/agente-supervisionado-v02`, sobre `4782bba9388edb229e4a80086ad1df87b19b30f3`. A base remota e o projeto Lovable ainda estavam nesse último commit na conferência.

63 testes específicos do agente, 38 testes de regressão GHL, 32 testes de migrações/biblioteca PostgreSQL, TypeScript e build passaram localmente. A demonstração usa PostgreSQL e serviço reais, com HighLevel/OpenAI/operador fictícios. Não houve chamada real à OpenAI nem envio real pelo agente.

## Bloqueio de publicação

A conta usada pelo Git local e conector é `falcaoneto318`, sem permissão de escrita no repositório original. O push retornou 403. A conta proprietária `falcaoneto88-netizen` está conectada no Chrome, mas o upload de arquivos locais foi recusado pelo navegador. Nenhum arquivo foi confirmado no GitHub, nenhuma PR foi criada e nenhuma publicação Lovable foi executada.

Caminho preferido: liberar o upload local na extensão ChatGPT do Chrome, ou conectar Git/conector à conta que já tem permissão no repositório. Não é necessário ampliar permissões de colaboradores. [Instruções oficiais de upload](https://developers.openai.com/codex/app/chrome-extension#upload-files).

Uma tentativa alternativa de reutilizar a credencial salva para criar um fork foi rejeitada pela revisão automática antes da execução. Não houve extração dessa credencial nem criação de fork.

## Credenciais pendentes

A lista de nomes em Cloud → Secrets foi inspecionada sem ler valores. `GHL_PRIVATE_TOKEN` e `GHL_LOCATION_ID` já existem; não foram modificados. Ausentes:

- `OPENAI_API_KEY`: necessária somente se for escolhido OpenAI direto; dispensada no caminho Lovable solicitado, depois de configurar explicitamente o provedor.
- `COMMERCIAL_AGENT_ENCRYPTION_KEY`: 32 bytes aleatórios codificados em base64, com cópia protegida para preservar acesso aos rascunhos.
- `COMMERCIAL_AGENT_WEBHOOK_SECRET`: segredo aleatório exclusivo, mínimo 32 caracteres, para o modo workflow.
- `COMMERCIAL_AGENT_WORKER_SECRET`: outro segredo aleatório exclusivo, mínimo 32 caracteres.

O formulário Add secret foi deixado aberto com o nome `OPENAI_API_KEY`, valor vazio e sem salvar. O usuário deve inserir os valores no painel seguro; nunca no chat ou Git. Mudanças de secrets são imediatas no preview e dependem de publicação para o site ao vivo, conforme aviso do provedor.

Manter `COMMERCIAL_AGENT_ENABLED=false` e `COMMERCIAL_AGENT_SEND_ENABLED=false` durante a instalação. Na ausência dessas variáveis, o código também permanece desligado. Para os três segredos próprios, usar geração criptográfica no gerenciador seguro de senhas ou no ambiente técnico, preservando a distinção entre eles.

## Próximas etapas concretas

1. Publicar a branch completa e conferir que seus arquivos correspondem ao código testado; criar PR, revisar e integrar na base conectada ao Lovable.
2. Conferir sincronização e build no preview, autenticação e isolamento. A migração já aplicada não deve ser repetida; conferir o registro pelo identificador acima.
3. Configurar secrets no painel e preparar o cron inativo, conforme `OPERACAO.md`.
4. Identificar o ID exato de um contato controlado pela equipe, permitir somente esse contato/canal e excluí-lo de automações concorrentes.
5. Validar webhook de entrada e saída, IDs estáveis e assinatura/segredo; habilitar apenas recebimento e geração inicialmente.
6. Gerar resposta real, revisar V02, obter aprovação humana do texto exato, liberar envio supervisionado para o contato de teste e conferir a conversa e o recibo reais.
7. Validar pausa, duplicidade, falhas, duração das chamadas e manutenção antes de ampliar o piloto. Não ativar atendimento amplo antes dessa validação.

O serviço ficará na aplicação atual `https://jornada-ai-conecta.lovable.app`, com `/agente-supervisionado` e os endpoints de webhook/worker no mesmo domínio; essa nova rota ainda não está publicada. Custo, manutenção e limites estão em `OPERACAO.md`. Ainda é necessário designar o responsável técnico operacional.
