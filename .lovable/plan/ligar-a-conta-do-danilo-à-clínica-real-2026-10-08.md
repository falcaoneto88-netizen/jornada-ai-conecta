# Ligar a conta do Danilo à clínica real

## Causa (confirmada por leitura)
A conta `danilo.dluxe@hotmail.com` foi criada às 17:11 UTC e o registo criou automaticamente uma clínica nova e vazia (`33ee4836-…`, "Clínica Dr. João Falcão", 0 clientes, 0 consultas). A clínica real com os dados é `f07ab3be-7419-4779-a901-ef71c5fc27f0`. Por isso a página dele aparece vazia — não é falha de permissões nem de código.

## O que vou fazer
1. Mover o perfil do Danilo para a clínica real `f07ab3be-…`.
2. Dar-lhe o papel **administrador** nessa clínica e remover o papel da clínica vazia.
3. Deixar a clínica vazia intacta (sem dados; não apago nada).
4. Confirmar por leitura: perfil e papel na clínica real, e que ele passa a ver clientes/consultas.

## Limites
- Só esta conta. Sem mudanças de código, flags, ponte n8n, GHL, autorização de teste ou publicação.
- O Danilo deve sair e voltar a entrar (ou recarregar) para ver os dados.

## Detalhes técnicos
- Feito por migração única e transacional, porque a troca de organização no perfil é bloqueada por trigger (`bloquear_troca_org`) e `user_roles` não aceita escrita direta. A migração desativa o trigger só para esta linha (ou usa a via de sistema permitida), atualiza `profiles.organization_id` para o ID `cf6119e3-fe19-4383-a630-6417bc9094d1`, insere `user_roles(user_id, f07ab3be…, 'administrador')` e apaga o papel em `33ee4836…`, com guardas por ID/e-mail exatos.
- Nota: o registo cria uma clínica nova por cada conta; corrigir esse comportamento (convites) fica para outro pedido, se quiser.
