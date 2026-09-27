# Jev: tratar o "Limite de pedidos atingido (429)"

## Diagnóstico (confirmado nos registos da IA)
- 4 pedidos às 18:09:55–18:10:02 UTC devolveram 429 com a mensagem "The upstream provider is rate limiting this model" — o limite vem do fornecedor do modelo Jev, não da app nem da chave.
- As chamadas anteriores (15:39, 15:41, 17:47) passaram todas. O pedido enviado está correto; não há erro no código.
- Os 4 pedidos seguidos (cliques repetidos + a repetição automática) só agravam o limite.

## O que mudar
1. **Aguardar o tempo indicado**: ler o `Retry-After` do 429 e guardá-lo no resultado do teste (sem dados sensíveis).
2. **Botão em pausa**: no cartão Jev e nos botões "Classificar mensagem"/"Classificar conversa", depois de um 429 o botão fica desativado com contagem ("Tente novamente em 30 s"). Sem `Retry-After`, pausa de 30 s.
3. **Mensagem mais clara**: "O fornecedor do Jev está temporariamente sobrecarregado. Nada foi alterado; tente novamente dentro de alguns segundos." — deixa claro que a ligação continua válida (o sucesso anterior mantém-se como histórico).
4. **Sem repetição automática no 429 quando a espera for longa**: repetir só uma vez se o `Retry-After` for ≤ 3 s; caso contrário devolver logo o estado de pausa (evita gastar pedidos).
5. Testes: 429 com e sem `Retry-After`, botão desativado durante a pausa, sucesso posterior limpa a falha.

## Fora do âmbito
Sem mudanças no HighLevel, CRM, envios, publicação ou modelo.

## Detalhes técnicos
- `jev.core.ts`: `esperaRetry` devolve também `pausaAte`; `categoriaDoStatus` distingue `rate_limit_fornecedor`.
- `jev.server.ts` / `jev-pedidos.functions.ts`: propagar `retryAfterSegundos`.
- `jev-card.tsx`, `jev-pedido.tsx`, `jev-mensagem.tsx`: estado local `pausaAte` + contagem.
