# Atendimento manual da equipe

O painel `/agente-supervisionado` oferece uma barra de atendimento manual independente da aprovação das sugestões da IA. A equipe pode escolher qualquer conversa recebida da clínica, carregar o histórico atual, assumir a conversa, escrever até 1.500 caracteres e conferir o texto antes de enviar. Administrador, gestor e comercial autenticados usam a mesma organização/location já vinculadas. Não há envio ao digitar, ao selecionar o contato ou ao atualizar o histórico.

## Uso

1. Em **Atendimento manual**, selecione a conversa recebida. Confira nome, identificador, canal e histórico; o link abre exatamente essa conversa no HighLevel.
2. Clique **Assumir conversa para escrever**. Se ela já estiver com a equipe, a escrita fica disponível assim que as condições de envio forem confirmadas.
3. Escreva a mensagem e clique **Revisar mensagem manual**. A preparação pausa o agente e invalida sugestões antigas, sem enviar.
4. Confira destinatário e texto e clique **Confirmar e enviar mensagem manual**.
5. O retorno “aceita pelo HighLevel” não comprova entrega ou leitura. Acompanhe a conversa. Use **Devolver ao agente** apenas quando a equipe terminar o atendimento.

As mensagens digitadas são preservadas separadamente por conversa enquanto o painel estiver aberto. Não são guardadas no armazenamento do navegador. Mudança de conversa não leva o texto de um contato para outro. Uma nova mensagem invalida a revisão; atualizar o histórico preserva o texto digitado para nova conferência.

## Limites e segurança

`manual_send_all_contacts` é uma autorização própria, criada desligada na migração e ativada somente na clínica autorizada. Não altera `allowed_contacts` das sugestões da IA, o recebimento geral, o modo supervisionado ou a ausência de envio automático. O transporte manual homologado é `SMS`, utilizado pelo provedor Zaptos/WhatsApp já instalado. Os demais canais permanecem disponíveis para consulta e atendimento pelo HighLevel.

Texto humano pode ser enviado durante a pausa ou após uma sugestão da IA ficar desatualizada, sem aplicar ao texto escrito pela equipe os filtros editoriais de geração da IA. Permanecem obrigatórios autenticação, vínculo de organização/location, conversa previamente recebida, histórico canônico recente, DND/recusa e janela conservadora de 23 horas desde a última entrada. Áudio, anexos e início de contato com destinatário não recebido não fazem parte desta barra.

Cada preparação recebe identificador idempotente e grava somente conteúdo cifrado. A confirmação confere versão, histórico e texto; bloqueia concorrência com outros envios manuais e da IA. O canal e o provedor vêm da última mensagem recebida confirmada, mesmo quando há uma mensagem de saída mais recente. Recibos são vinculados à conversa correta e não podem ser reutilizados entre envios.

Resultado incerto permanece bloqueado, sem repetição automática. A equipe confere a conversa no HighLevel e informa o ID da mensagem encontrada. O servidor verifica destinatário, conversa, texto, canal, provedor e horário antes de registrar o recibo. Uma mensagem não localizada não deve ser reenviada por tentativa; exige investigação do provedor. Estados incertos preservam o conteúdo cifrado até reconciliação. Os demais conteúdos manuais são apagados após sete dias, mantendo registros de deduplicação e auditoria sem o texto.

## Operação

A barra usa o serviço já hospedado na Jornada AI, as credenciais do servidor e o cron existentes. Mensagens manuais não chamam o modelo de IA. Continuam sujeitos à cobrança de transporte do provedor contratado. Não é necessária uma chave nova. Erros são registrados com códigos sanitizados, sem credenciais ou texto das conversas.

Para desligar apenas este recurso, definir `manual_send_all_contacts=false` na organização correspondente. Isso impede novos envios manuais e mantém o recebimento. Para interromper o agente inteiro, usar o modo `off`. Não apagar recibos, sessões, recusas ou registros de deduplicação.

Referências de contrato da integração: [histórico por conversa](https://marketplace.gohighlevel.com/docs/2021-07-28/ghl/conversations/get-messages/index.html) e [mensagem por ID](https://marketplace.gohighlevel.com/docs/2021-07-28/ghl/conversations/get-message/index.html). A verificação da resposta real do provedor prevalece sobre exemplos genéricos da documentação.
