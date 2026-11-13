# Izabel unificada no Meu Chat

Revisão: 13/11/2026. Base de código: `7b8cb39`. Projeto original Lovable: `36345211-2616-42f7-bb9e-e78a9d00ca22`.

## Problema e comportamento resultante

O painel dividia a mesma resposta entre modelos, escrita genérica e tradução. O assistente antigo recebia texto do navegador, sem consultar a agenda nem aplicar a base comercial V02. Modelos incompletos exibiam variáveis técnicas. Isso exigia copiar texto e alternar ferramentas.

A conversa passa a ter uma única Izabel. O atendente abre o contato, escolhe **Preparar resposta**, confere a sugestão no editor e usa o envio existente depois de revisar. O idioma é automático, com uma única seleção para corrigir a escolha. Contexto, próximo passo e modelos de apoio ficam recolhíveis no mesmo painel.

Se já houver um rascunho, a Izabel apresenta a alternativa e exige **Substituir meu rascunho**. Continua possível desfazer. Troca de contato, alteração do texto, novas mensagens carregadas e mudanças de contexto invalidam resultados pendentes. No celular, a Izabel abre em um painel com retorno à conversa e restauração do foco.

## Fontes e limites

- `src/lib/izabel-reply.functions.ts`: função POST autenticada; não envia mensagens.
- `src/lib/izabel-reply.server.ts`: deriva organização/location da sessão, verifica contato e conversa no GHL, lê contexto existente e usa a base comercial V02 no servidor.
- `src/lib/izabel-reply.core.ts`: contrato, respostas seguras e frases de agenda por idioma.
- `src/components/inbox-izabel-panel.tsx`: preparação, idioma, fontes, avisos e substituição explícita.
- `src/components/ghl-inbox.tsx`: integração com editor, proteção do rascunho e fluxo de aprovação/envio já existente.
- `src/components/inbox-template-picker.tsx`: informações faltantes recebem nomes legíveis; modelos incompletos continuam bloqueados para inserção.

Uma data de consulta só entra na sugestão após conferência do vínculo e do evento diretamente no GHL. Se a resposta incluir agenda, essa consulta é novamente lida depois da geração. A frase factual é composta pelo servidor, no fuso configurado do atendimento; o modelo não inventa horários nem confirma agendamentos. Agenda sem vínculo, indisponível, cancelada ou divergente gera aviso e não fornece uma confirmação fictícia. Agendamento não prova pagamento nem resposta SIM.

O modelo recebe até 30 mensagens verificadas, primeiro nome, etapa e próximo passo. Telefones/e-mails são removidos desse contexto. Não há ferramentas de escrita para o modelo, execução de workflows, registro de transcript novo nem exposição da chave no navegador. Isso não constitui anonimização integral do texto livre: mensagens podem conter dados pessoais e o provedor de IA existente continua recebendo o contexto necessário. Áudio e imagens não são interpretados por esta mudança.

Mantidos os controles existentes de envio, DND, aprovação e proveniência das sugestões supervisionadas. Uma geração não libera envio bloqueado. A verificação da agenda ocorre na preparação; o atendente precisa conferir a atualidade antes de enviar. O clique de preparar é intencional: evita gerar a cada abertura/poll e não ativa atendimento autônomo.

## Homologação e protocolo

A base comercial V02 já existente foi reutilizada. O pacote Izabel v1 continua identificado como **em homologação**, separado da redação contextual agora implementada. Não foram liberadas automaticamente imagens privadas, instruções clínicas novas nem todo o conteúdo importado.

Há divergências documentais no pacote novo (versões/paginação e condições de crédito/abatimento da consulta). A nova redação bloqueia afirmar crédito, abatimento ou cobrança adicional sem regra validada. Traduções são propostas revisáveis, não passam a ser modelos aprovados. Questões clínicas, urgência, pedido de humano e recusa de contato recebem avisos e tratamento supervisionado. As verificações de texto e as instruções do modelo reduzem risco; não substituem revisão humana nem comprovam acerto semântico universal.

Não foi comprovado que as migrações financeiras 0023–0025 causavam os problemas de redação. Esta revisão não altera schema, autenticação, RLS, agenda, CRM, n8n ou workflows e não depende de uma migração nova.

## Validação e entrega

- Build de produção e TypeScript: aprovados localmente.
- ESLint dos arquivos alterados: zero erros; dois avisos de Fast Refresh no arquivo de inbox existente.
- Testes de contrato/acesso/agenda/idioma e UI: **181 testes aprovados em seis arquivos**, na execução final sequencial de 55,74 s, com provedores simulados. Cobrem isolamento, falhas do provedor, resposta malformada, consulta alterada durante a geração, preservação do rascunho e aprovação. Uma execução paralela anterior sofreu timeouts; a execução final passou inteira.
- Prévia isolada usa os componentes reais e somente dados fictícios; bloqueia rede externa. Conferidos desktop 1440×900 e celular 390×844 sem rolagem horizontal, troca PT/FR, substituição explícita, desfazer e Escape com retorno de foco.
- Detector Impeccable: nenhum achado nos três componentes examinados. Não é uma auditoria completa de acessibilidade.
- Revisão independente do build: 700 trechos de 16 arquivos da base comercial apareceram no SSR e nenhum nos 41 assets públicos examinados. Nenhum padrão de chave privada/token foi encontrado nesses assets. Nomes de configurações já existentes na tela Integrações não são valores de credenciais.

**Estado desta revisão:** implementada e testada localmente. Não considerar publicada nem verificada ponta a ponta no ambiente real. A entrega remota deve ficar em branch/PR de revisão até liberação. O editor Lovable e o site público devem ser conferidos separadamente após integração.

Configurações reutilizadas: `LOVABLE_API_KEY` e a configuração GHL existente, sem novos segredos. Nenhum valor de configuração deve aparecer em documentação ou logs.

## Aceite no ambiente autenticado

1. Em um contato de teste autorizado, preparar rascunho em português e verificar fontes e dados da conversa, sem enviar.
2. Repetir com mensagem francesa/espanhola, verificar idioma automático, conteúdo e seleção manual.
3. Consulta vinculada: conferir ID, horário/fuso/status com o GHL; repetir sem vínculo e após remarcação. Não deve afirmar consulta inexistente ou antiga.
4. Editar durante a geração, trocar contato e manter um rascunho anterior; nenhum resultado pode sobrescrever texto indevidamente.
5. Confirmar papéis autorizados e negar tentativa de outra organização. Testar indisponibilidade de IA/GHL sem falso sucesso.
6. Validar com a equipe uma dúvida comercial, uma pergunta clínica e um pedido de humano. Aprovar o pacote novo somente após revisão separada de conteúdo e materiais.
7. Medir tempo para resolver uma sugestão quase correta, número de trocas de tela, uso de copiar/colar, erros factuais e correções de idioma. Comparar com a versão anterior usando os mesmos casos.

Nenhuma mensagem foi enviada e nenhuma automação foi ativada nesta validação.
