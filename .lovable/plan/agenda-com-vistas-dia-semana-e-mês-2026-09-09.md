# Agenda com vistas Dia, Semana e Mês

Manter a agenda ligada ao GoHighLevel (só leitura, mesma sincronização) e mudar a apresentação para um calendário com três formatos: Dia, Semana e Mês.

## O que muda no ecrã Agenda

- Barra superior com: botão "Hoje", setas de anterior/seguinte, o período a que se refere (ex.: "20 – 26 de julho de 2026") e um seletor Dia / Semana / Mês.
- Vista Dia: lista das horas do dia escolhido, com cada marcação na sua hora, nome do cliente, título e estado.
- Vista Semana: sete colunas (segunda a domingo), cada marcação na coluna do seu dia, ordenada por hora. Dia atual destacado.
- Vista Mês: grelha do mês, cada célula mostra até 3 marcações (hora + nome) e "+N mais"; clicar no dia abre a vista Dia desse dia.
- Filtro opcional por responsável (os nomes já vêm do GoHighLevel), com "Todos" por defeito.
- Clicar numa marcação abre um painel lateral com cliente, título, hora de início e fim, estado e responsável, com ligação para a ficha do cliente.
- Mantém-se o botão "Atualizar agenda", os avisos de agenda por escolher, o estado de carregamento/erro/vazio e a nota de "só leitura".
- Mobile: em ecrã pequeno, Semana e Mês passam a apresentação compacta em lista por dia, para continuar legível.

## O que não muda

- A ligação ao GoHighLevel, a agenda configurada em Integrações › Mapeamento e a sincronização continuam exatamente iguais.
- Nada é criado, remarcado ou cancelado no GoHighLevel a partir daqui.
- Sem alterações à base de dados, ao webhook ou às permissões.

## Detalhes técnicos

- Ficheiro principal: `src/routes/agenda.tsx` reescrito para gerir estado `vista` ("dia" | "semana" | "mes") e `dataReferencia`, com navegação por período.
- Novo componente `src/components/agenda-calendario.tsx` com as três grelhas, construídas em Tailwind sobre os dados já devolvidos por `useMarcacoes()` (`inicioIso`, `fim`, `cliente`, `clienteId`, `titulo`, `estado`, `responsavel`). Sem nova dependência de calendário.
- Cálculo de semanas/meses com `date-fns` (já no projeto) em fuso local pt-PT, semana a começar na segunda-feira.
- Agrupamento por dia via `useMemo` sobre a lista já carregada; sem novas chamadas ao servidor.
- Painel de detalhe com `Sheet` do shadcn; seletor de vista com `Tabs`/`ToggleGroup`; cores de estado através dos tokens existentes (sem cores fixas).
- Sem alterações em `src/lib/repo.ts`, `src/lib/ghl-agenda.*` ou migrações.
