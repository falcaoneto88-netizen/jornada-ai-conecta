# Estado da implantação — 05/10/2026

## Reutilização da chave usada pelo Jev — preparada localmente

O Jev e o briefing da Jornada AI já usam `LOVABLE_API_KEY` no servidor. O novo agente agora tem um adaptador opcional para reutilizar essa credencial via `https://ai.gateway.lovable.dev/v1/responses`, com o modelo `openai/gpt-5.4-mini`. Essa alteração está apenas no checkout local, posterior à PR #1; não está publicada nem configurada no ambiente hospedado.

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

- `OPENAI_API_KEY`: chave de projeto OpenAI com orçamento configurado.
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
