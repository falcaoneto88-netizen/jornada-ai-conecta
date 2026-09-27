# Skill TypeSafe e Jev sem OpenRouter

## 1. Instalar a skill TypeSafe
Os comandos `claude plugin …` e `npx skills add …` não se aplicam aqui. No Lovable, uma skill entra como rascunho e depois é ativada.
- Guardar o SKILL.md oficial (licença MIT) sem alterações como rascunho da skill `typesafe-ai` e ativá-lo.
- A skill passa a aparecer em Settings > Skills e é usada sempre que o trabalho envolver o Jev.

## 2. Passar o Jev para a IA incluída na plataforma (sem OpenRouter)
- O Jev passa a correr pela IA da própria plataforma. Deixa de ser preciso ter uma chave OpenRouter e ela não entra em nenhum código.
- O cartão "Testar conexão Jev" em Integrações > Credenciais mantém-se, continua reservado a administradores e continua a usar a mensagem fictícia. O texto do cartão deixa de mencionar o OpenRouter.
- Antes da primeira chamada, confirmar que o modelo Jev está disponível para esta conta.
- Correr um único teste real com os dados fictícios e relatar o resultado. Se aparecer "sem créditos" ou "indisponível", o teste para aí: não se repete nem se troca de modelo.

## Fora do âmbito
- Não publicar, não tocar na base de dados, no GHL, no Ad Navigator nem no BioReport.
- Não enviar mensagens. Não usar dados reais de pacientes.
- Nenhuma chamada ao OpenRouter.

## Detalhes técnicos
- Rascunho da skill: `.agents/skills/typesafe-ai/SKILL.md`, ativado com a ferramenta de aplicação de skills.
- `jev.core.ts`: `JEV_URL` passa a `https://ai.gateway.lovable.dev/v1/systemone` e `JEV_MODELO` passa a `typesafe/jev-latest`. O pedido fica no formato `{ model, state, questions }`, segundo a referência de formatos do Jev. A resposta é lida em `answers[id].choice/score/noul`, e a validação atual do prefixo `typesafe/jev-` mantém-se.
- `jev.server.ts`: cabeçalhos `Authorization: Bearer LOVABLE_API_KEY` e `X-Lovable-AIG-SDK: fetch`. Os estados 402, 403, 404 e 429 continuam em categorias fechadas, sem expor o corpo da resposta.
- `jev.functions.ts`: `OPENROUTER_API_KEY` passa a `LOVABLE_API_KEY`. Se a chave faltar, é criada pela ferramenta própria da plataforma.
- Confirmar a disponibilidade do modelo com `GET /v1/models` antes do teste.
- Atualizar `jev.test.ts` e o texto de `jev-card.tsx`. Depois correr os testes do Jev, a verificação de tipos e o build.
- Acrescentar ao `roadmap.md` a tarefa "Jev sem OpenRouter" e retirar a pendência da `OPENROUTER_API_KEY`.
