# Confirmação e agradecimento estrito em produção — candidata de 16/11/2026

Estado desta revisão: implementada e testada localmente. A aplicação da migração, publicação, seleção das ações e entrega real são verificações distintas, a cargo da integração principal. Este documento não comprova nenhuma delas.

## Mudança compatível

A política de produção passa a admitir, mediante seleção explícita, `appointment.confirm` e `confirm`, além de `booking`, `req24` e `req12`. Uma política antiga não recebe ações adicionais automaticamente. Seleções de piloto não são copiadas para a produção na interface.

O pedido de confirmação mantém o contrato existente: `op=appointment.confirm`, `appointmentId`, `contactId`, `expectedStartTime` e `inboundMessageId`. Organização, location, credenciais, texto e resultado continuam derivados ou verificados no servidor. O sucesso exige pedido anterior aceito no ledger, mensagem inbound SIM/CONFIRMO lida no GHL, contexto íntegro sem ambiguidade, consulta futura no calendário exato, reserva única, releitura e readback do estado confirmado. Uma execução desconhecida não é repetida.

`message.send kind=confirm` mantém os mesmos IDs e horário; o chamador não passa texto nem evidência fabricada. A evidência é recuperada da confirmação persistida e relida no GHL. Depois da reserva, o servidor verifica novamente histórico, consulta, contato, DND, canal e autoridade atual.

## Regra específica do agradecimento

Em produção, **nenhuma atividade sem autoria comprovada é ignorada**. A atividade `TYPE_ACTIVITY_APPOINTMENT` que o GHL pode acrescentar após o PUT continua aparecendo no histórico. Mesmo que corresponda à consulta e à janela temporal, ela bloqueia o agradecimento se for posterior à resposta. O código não presume que foi criada por esta execução.

Assim, é possível confirmar a consulta com evidência válida e bloquear separadamente o agradecimento. O workflow deve registrar pendência humana e a razão retornada; não pode marcar agradecimento enviado, repetir confirmação, limpar histórico ou contornar a recusa. Isso não equivale a agradecimento automático garantido para todo SIM.

A exceção temporal existente continua limitada ao modo piloto supervisionado. O modo é lido em cada validação do agradecimento, antes e depois da reserva; a revisão e o modo da autoridade são comparados novamente imediatamente antes do efeito externo. Falha de leitura da política impede o envio e nunca habilita a exceção.

## Migração aditiva

`0028_n8n_strict_confirmation_production.sql` amplia o CHECK de produção e a validação de ações da RPC administrativa. `0027` permanece inalterada. A RPC também recusa a seleção de `confirm` sem morada, inclusive se a configuração mudou depois da verificação no servidor. Não semeia políticas, altera flags, habilita ações em linhas existentes ou cria chaves.

Na integração Lovable, preservar o timestamp e o ID reais da migração 0027 já aplicada. O `prevId` do snapshot 0028 deve apontar ao snapshot 0027 efetivamente integrado; não reescrever nem reaplicar 0027.

## Workflow e limites

O n8n deve conferir `health.runtime`, revisão, escopo e `allowedKinds` antes de cada efeito. Só encadear o agradecimento após `appointment.confirm` retornar `confirmed:true`, sem tratar estado projetado de Data Table como prova. Respostas `unknown`, reservas em curso, alteração de contexto, histórico indisponível ou ambiguidade exigem revisão; não autorizam repetição automática.

Após o PUT, uma nova chamada ao resolvedor de resposta pode encontrar a atividade GHL em vez do SIM. Uma interrupção entre a confirmação e o agradecimento não deve ser recuperada repetindo o PUT nem reutilizando um SIM antigo: registrar a pendência com os IDs exatos para análise. O ledger evita duplicação, mas não é um mecanismo automático de recuperação de todas as interrupções.

A API GHL não fornece CAS na atualização usada pelo projeto. As leituras e o readback detectam mudanças observáveis, mas não tornam a sequência GET→PUT/POST atômica perante alterações externas. Os testes não comprovam causalidade de atividades do CRM, entrega no destinatário ou ausência de corrida distribuída.

## Verificação local

- 351 testes em cinco suítes de confirmação, runtime, administração, UI e envio passaram. Incluem confirmação em produção, ações não selecionadas, ambiguidade, resultado desconhecido, agradecimento estrito, atividade/humano/NÃO durante a reserva e mudança de modo.
- 41 testes PostgreSQL em duas suítes passaram com banco temporário em loopback. Incluem migração 0027→0028 preservando a política preexistente e flags, ACL/RLS, CAS, concorrência, isolamento, reserva única e rejeição de morada removida.
- A exceção existente do piloto conserva seus testes de aceitação e recusa. Nenhum teste usa mensagens ou dados reais.

Os gates finais combinados e evidências de publicação devem ser registrados em `MCP_CODEX_HANDOFF.md` após a integração.
