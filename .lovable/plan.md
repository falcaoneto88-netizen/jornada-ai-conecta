# Instalar a skill TypeSafe no projeto

Os comandos `claude plugin …` e `npx skills add …` não se aplicam aqui. No Lovable, uma skill é instalada como rascunho e depois ativada. Fica então disponível em Settings > Skills.

## Passos
1. Descarregar o SKILL.md oficial (licença MIT) de `typesafe-ai/skills` e guardá-lo sem alterações como rascunho da skill `typesafe-ai`.
2. Ativar o rascunho, para a skill passar a ser usada automaticamente sempre que o trabalho envolver o Jev ou a TypeSafe (por exemplo, a ligação Jev via OpenRouter que já existe).
3. Confirmar que a skill aparece como ativa.

## Fora do âmbito
- Não mexer em código da app, na base de dados, nos segredos nem na publicação.
- O conteúdo da skill é tratado como orientação. Não executa nada sozinho.
- Nenhuma chamada ao OpenRouter: a `OPENROUTER_API_KEY` continua pendente.

## Detalhes técnicos
- Rascunho: `.agents/skills/typesafe-ai/SKILL.md`, com o conteúdo copiado tal como está no endereço raw do GitHub.
- A ativação é feita com a ferramenta de aplicação de skills, apontando para a pasta da skill.
