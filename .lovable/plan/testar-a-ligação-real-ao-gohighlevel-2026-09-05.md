# Testar a ligação real ao GoHighLevel

## Situação atual
O aplicativo está a correr sem erros: todas as telas carregam e não há erros no navegador. O token e o ID da subconta do GoHighLevel já estão guardados em segurança no backend. Falta apenas confirmar, com uma conta iniciada, que a ligação real funciona.

## O que vamos fazer

1. Você inicia sessão na aplicação (tela de acesso, com o seu e-mail).
2. Abre a tela **Integrações** e clica em **Testar conexão**.
3. Eu acompanho o resultado:
   - Se aparecer o nome da conta do GoHighLevel, a ligação está validada.
   - Se aparecer uma mensagem de erro (token inválido, permissões em falta, subconta errada), eu digo exatamente o que corrigir no GoHighLevel.
4. Com a ligação validada, executamos a **primeira sincronização em modo leitura** e conferimos os clientes importados na tela Clientes.
5. Só depois de os dados estarem corretos é que se liberta a opção de escrita/envios.

## Correções incluídas
Qualquer falha que aparecer neste teste (mensagem pouco clara, estado que não atualiza, botão que não responde) é corrigida no mesmo trabalho.

## Fica de fora
- Receber eventos automáticos do GoHighLevel (webhooks) — precisa do segredo do webhook, que ainda não foi cadastrado.
- Atualizar clientes e etapas automaticamente a partir desses eventos.
