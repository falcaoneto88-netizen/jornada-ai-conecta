# Operação da ponte n8n pelo canal atual do GHL — 16/11/2026

## Escopo desta entrega

O utilizador confirmou manter o canal atual do GHL: o endpoint de mensagens SMS usa o provedor Zaptos/WhatsApp. Não é SMS de operadora e não é uma nova ligação direta ao WhatsApp. Organização e location continuam derivadas no servidor; IDs vistos na interface servem apenas à conferência.

O contrato anterior permite escritas reais apenas por um grant de piloto, limitado a contacto, compromisso, início, ações e prazo. Retirar `simulation` sozinho não cria uma operação contínua autorizada. Esta entrega acrescenta uma política persistida e revogável por organização, conservando as verificações independentes.

**Limite deliberado:** a produção contínua desta versão permite apenas `booking`, `req24` e `req12`. `appointment.confirm` e `confirm` continuam restritos ao piloto supervisionado. A exceção de atividade técnica usada no agradecimento foi validada para piloto serial, não para intervenções concorrentes. `handoff` e `escalation` também não são liberados. O controlo novo não equivale à jornada completa homologada.

## Implementação

- `src/components/n8n-runtime-control.tsx`: modos Desligado, Piloto supervisionado e Produção; seleção explícita das ações, evidência da agenda/canal e revisão, aviso quando a configuração deixou de coincidir. Não ativa ao carregar a página.
- `src/lib/n8n-bridge-runtime.admin.server.ts`: exige sessão de administrador e origem confiável. Confere canal padrão/provedor e calendário por GET autenticado no GHL antes de pedir produção. Não recebe organização, location, provedor ou prova de verificação do navegador.
- `drizzle/migrations/0027_n8n_bridge_runtime_policy.sql`: política por organização e RPC `n8n_bridge_set_runtime_policy`. A RPC resolve organização/papel novamente, compara a revisão, verifica binding e configuração sob bloqueio, persiste política/flags/auditoria na mesma transação. Tabela sem escrita direta por `anon`, `authenticated` ou `service_role`; RPC só executável pelo servidor. Não semeia políticas nem ativa configurações existentes.
- `src/lib/n8n-bridge-runtime.ts`: revalida política, revisão, organização/location, flags e configuração antes da reserva e antes do efeito externo. Mudança, revogação ou leitura indisponível bloqueia. Ausência de linha mantém o contrato de piloto; erro de leitura não vira autorização.
- `src/lib/n8n-bridge.core.ts`: preserva contacto, agenda, DND, ledger e resultado desconhecido; reconsulta contacto/DND e compromisso após a reserva antes do envio inicial. O transporte continua no GHL com o provedor escolhido. Canais DND são conferidos sem distinção de caixa; todos os aliases são avaliados e qualquer bloqueio prevalece, sem sobrescrever valores contraditórios.
- `src/lib/n8n-bridge-reply-resolve.ts`: distingue identidade não comprovada (`contact_not_verified`) de preferências DND ausentes/malformadas (`contact_preferences_not_verified`). Não transforma ausência de preferências em autorização.
- `src/routes/api/version.ts`: marcador candidato `jornada-n8n-production-20261116.1`, capacidade aditiva `n8nRuntimePolicy:1`. O contrato de operações da ponte permanece versão 3.

Desligar não depende da disponibilidade do GHL ou da validade do binding antigo. A operação usa CAS; uma revisão concorrente exige recarregar o estado. A revogação não desfaz um POST já aceito no GHL. Não existe transação distribuída ou garantia global de concorrência com intervenções no CRM.

## Evidência remota anterior à implantação

Conferida em 16/11/2026, separada dos testes locais:

- Leitura autenticada de `GET /locations/:locationId/conversationChannels/SMS`: HTTP 200; o padrão da location esperada é `ZaptosWPP V2 - WhatsAPP like SMS`, correspondendo ao provedor configurado na ponte.
- `/integracoes` e consulta do projeto original: `bridgeEnabled=true`, `simulation=true`, `liveSendEnabled=false`, `channelVerified=false`. Piloto inativo. Não são prova de envio ativo.
- `/api/version`, conferido pelo Lovable às 12:40 UTC: build publicado `jornada-agenda-workspace-20261113.1`, `release:null`. Não identifica o SHA publicado. Base Git desta entrega: `206e6517ab0611abc22e43ae5061c76bdf95afad`.
- Banco do projeto original: migrações n8n 0012–0015 presentes; última migração observada 0026. Nenhuma 0027 aplicada naquele instante. Dois registos de envio na ponte, o mais recente em 08/10; nenhuma evidência que identifique o contacto da execução 1542.
- UI GHL: encaminhamento de agenda publicado, gatilho Estado do compromisso, calendário Consulta Inicial — Harmonização, evento Normal. Corpo mínimo `WorkflowAppointmentSnapshot` com `appointmentId` e `contactId`. Resposta guardada de 13/11 é HTTP 200 / “Workflow was started”; só comprova aceitação do webhook.
- UI GHL: encaminhamento de resposta publicado; gatilho Cliente Respondido com canal SMS; corpo `CustomerReplied` com `contactId`. Ambos apontam ao webhook existente `https://jfalcaoneto.app.n8n.cloud/webhook/falcao-agenda-v2-eventos`. Nenhum workflow foi editado ou testado nesta inspeção.
- A API de logs de workflow retorna `WORKFLOW_API_NOT_ENABLED_FOR_LOCATION`: disponibilidade limitada a subcontas selecionadas, não prova de token/scopes errados. A leitura pela interface foi possível.
- GET autenticado do contacto de teste existente comprovou ID/location exatos, DND global falso e preferências com chaves `call`, `email`, `sms` em minúsculas, válidas e inativas. Isso revelou que a guarda antiga, que consultava só `SMS`/`WhatsApp`, poderia ignorar um bloqueio expresso em minúsculas. Corrigido e testado antes de publicar. Não identifica o contacto da execução 1542 nem comprova o estado histórico daquele erro.

## Falha da execução 1542

Mensagem fornecida pelo utilizador: `Resposta não resolvida: contact_not_verified [line 14]`, nó Conferir resposta resolvida. A verificação ocorre antes da leitura da resposta SIM e das flags de envio. Desligar simulação não corrige essa falha.

O código antigo reúne identidade e formato das preferências sob a mesma mensagem. A nova distinção melhora o diagnóstico, mas **não prova a causa dessa execução histórica**. Continua necessário conferir o `contactId` enviado por Jornada Resolver Resposta e a resposta autenticada de contacto. Não atribuir a execução a um contacto por nome, telefone duplicado ou exemplo de outubro.

## Dependência n8n e retomada

O controle da aba Chrome falhou nesta sessão; o catálogo de abas mostra uma execução, mas isso não dá acesso aos nós, dados ou à revisão publicada. Não foi alterado, publicado, reexecutado ou declarado funcional o workflow `WrDn82MwKBcuM73G`.

Antes da ativação contínua, comparar o workflow publicado com `health.runtime`, a lista de ações e a revisão; impedir uso de sinal de piloto como autorização de produção. Não marcar `concurrency_verified=true` por conveniência. A deduplicação da ponte não resolve upserts concorrentes nas Data Tables do n8n nem retomadas incorretas de etapas.

Não repetir a execução 1542 ou eventos antigos para testar. A validação deve usar um compromisso futuro identificado e autorizado, reler os ledgers e distinguir aceitação no GHL de entrega ao destinatário. Confirmar primeiro contacto, agenda, consentimento e ausência de DND. Resposta sem solicitação ativa pode ser ignorada conforme contrato; identidade não comprovada continua bloqueada.

## Ordem de implantação e observação

1. Integrar os arquivos preservando a revisão remota, sem reescrever histórico.
2. Aplicar 0027 uma vez e verificar ACLs, RPC, ausência de políticas e flags preexistentes preservadas.
3. Publicar e conferir `/api/version`, sessão administrativa e leitura da política. Publicação não ativa produção.
4. Revalidar o workflow n8n e o contacto da falha. Só depois ativar as ações elegíveis no projeto original e conferir a política persistida, a auditoria e as flags.
5. Executar validação controlada e registar cada fronteira: GHL → n8n → ponte → ledger → GHL → entrega. A confirmação após SIM requer homologação adicional antes de operação contínua.

Nomes de configurações reutilizadas, sem valores: `GHL_PRIVATE_TOKEN`, `GHL_LOCATION_ID`, `JORNADA_AI_ORGANIZATION_ID`, `N8N_JORNADA_BRIDGE_TOKEN` ou credencial já existente em `n8n_bridge_credentials`. Nenhuma chave foi criada, copiada ou exposta.

Os resultados finais de testes, integração e publicação são registados em `docs/MCP_CODEX_HANDOFF.md`; nenhum estado posterior deve ser inferido apenas da existência deste documento.
