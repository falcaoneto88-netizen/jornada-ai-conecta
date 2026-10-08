# Recebimento geral de mensagens — 08/10/2026

O recebimento geral é independente da autorização de enviar. `receive_all_contacts=true` aceita novas mensagens individuais da location vinculada à organização, a partir de `receive_since`. Não acrescenta destinatários a `allowed_contacts`, não amplia `allowed_channels` e não cria envio automático. A migração instala esses campos desligados.

## Entrada e processamento

O worker já agendado consulta a API oficial `/conversations/messages/export` a cada minuto. Completa o fluxo sem filtro de canal e, separadamente, o fluxo `Email`, sempre com location imposta pelo servidor, intervalo fechado e paginação. Retém somente identificadores, direção e data canônica durante a descoberta. Corpos, anexos e endereços da exportação não são registrados. A recuperação de histórico para revisão mantém a criptografia e os limites existentes.

O cursor `receive_cursor_until` só avança após concluir as duas leituras e persistir todos os eventos válidos. Cada varredura repete dez minutos anteriores, sem ultrapassar o marco inicial. Identificadores estáveis passam pela deduplicação durável. A sessão preserva o marco temporal das mensagens já observadas: uma entrada antiga recuperada com atraso é registrada sem substituir a pergunta mais recente. Um callback assinado é apenas um aviso: a data e os IDs são conferidos na API antes do ingresso. Avisos de um contato não avançam o cursor global.

Mensagens de saída também são observadas. A saída do próprio agente é reconhecida pelo recibo persistido; outra saída pausa o atendimento daquele contato e invalida rascunhos anteriores. Pausa, opt-out, DND, isolamento de organização/location, versão da conversa e verificação imediatamente anterior ao envio continuam obrigatórios.

Cada execução tenta processar até cinco itens, com limite de início de processamento de 45 segundos após a descoberta. O teto mensal existente de 3.000 rascunhos é mantido. Nos canais já autorizados, o serviço gera sugestões conforme o Treinamento Comercial V02. Outros canais entram para revisão manual, sem chamada ao modelo e sem envio. Novos destinatários fora da lista de envio aparecem com aprovação desabilitada e explicação visível.

## Cobertura e limites

O transporte Zaptos/WhatsApp já homologado aparece como `SMS`/`TYPE_CUSTOM_SMS`. A exportação oficial inclui mensagens não-email e o fluxo separado de email. Chamadas, voicemail, atividades e comentários internos não são tratados como perguntas comerciais. A API do HighLevel não oferece Group Chat nem SMS Review Request nesse endpoint; esses tipos continuam no HighLevel e não devem ser anunciados como recebidos pelo agente.

Referência: [documentação oficial de exportação](https://marketplace.gohighlevel.com/docs/2021-07-28/ghl/conversations/export-messages-by-location/index.html).

São aceitas até vinte páginas de cem registros por fluxo em uma leitura completa. Se houver falha de rede, escopo divergente, paginação incompleta ou metadado inválido, o cursor não avança. O worker devolve um código sanitizado e a leitura será retomada no próximo ciclo. Esse limite exige acompanhamento de volume; não há promessa de atendimento imediato sob qualquer carga.

## Ativação e manutenção

Publicar o código revisado depois de aplicar a migração transacional. Conferir build, regressões e permissão exclusiva de execução da função pelo serviço. Ativar apenas a organização/location já vinculadas, com novo marco UTC arredondado a milissegundos e cursor inicialmente nulo. Preservar a lista de envio, os canais, as credenciais e o modo `supervised`.

Confirmar em produção que o cursor avança e que o worker responde sem erro. O fluxo HighLevel de aviso pode permanecer como aceleração; a descoberta geral é executada pelo cron e não depende da etiqueta do piloto. Nunca substituir o webhook do provedor Zaptos por esta observação.

Para interromper somente a ampliação, definir `receive_all_contacts=false`. Isso mantém o caminho do piloto autorizado; contatos fora da lista deixam de gerar rascunhos. Para parar o agente inteiro, usar o modo `off`. Uma nova ativação com novo marco deve zerar o cursor no mesmo comando. Não apagar sessões, opt-outs, recibos, auditoria ou tombstones de duplicação.

Segredos permanecem no servidor e no Vault existente. A operação é hospedada na Jornada AI/Lovable já utilizada. Não há novo provedor de hospedagem ou credencial. O aumento de consumo depende das mensagens recebidas e das sugestões geradas; limites e acompanhamento de uso permanecem necessários.
