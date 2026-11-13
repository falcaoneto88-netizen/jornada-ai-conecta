# Agente supervisionado — direção visual de 12/11/2026

> Registro histórico da preparação local. Os ensaios Izabel, artefatos e comandos que dependem do pacote privado não acompanham esta entrega pública. Consulte `PUBLICATION_INBOX_SUPERVISED_2026-11-12.md` e o manifesto final para o escopo e os gates desta cópia.

Estado: implementado e verificado localmente, sem publicação, commit ou push. Base de código: `a75951e2c7b84bea3b4396b6385a5f49892eeed4`, branch `codex/izabel-chat-20261112`, preservando alterações anteriores.

## Direção e implementação

Aplicada a skill Motion Site Designer, com revisão complementar do Impeccable. A proposta usa navegação azul profunda, superfície de leitura branca e fundo cinza claro. Cormorant Garamond distingue os títulos da marca; Inter mantém legibilidade dos controles e conversas. Ambas já pertencem ao aplicativo.

Paleta: sidebar `#14283F`, ação `#213D60`, fundo `#F4F6F8`, texto `#223247`, seleção `#E8EEF5`. Verde, âmbar e vermelho continuam reservados a estados, acompanhados de texto. Contrastes calculados dos pares principais: branco/ação 11,05:1; texto/fundo 12,00:1; texto/seleção 11,13:1. Esses cálculos não constituem certificação completa de acessibilidade.

- `src/components/supervision-art-direction.css`: tokens restritos à rota, sidebar com texto e ícones claros, tipografia, categorias, mensagens, proposta, ações e tratamento de foco. Portais de diálogo/menu/lista recebem os tokens somente enquanto esta rota está presente.
- `src/routes/agente-supervisionado.tsx`: importa o tema e aplica o wrapper da rota.
- `src/components/commercial-agent-queue.tsx`: atributos visuais nos elementos existentes. Nenhum handler, guarda de envio ou regra de permissão foi alterado nesta etapa.
- Movimento de entrada do painel: 200 ms, deslocamento de 6 px e opacidade, sem remontar componentes por contato. A preferência `prefers-reduced-motion` desativa animações e transições, incluindo diálogos.

O tema global das outras páginas permanece intacto. Esta proposta é clara; não foi criada uma variante escura adicional. O arquivo Figma anterior não foi atualizado nesta etapa.

## Evidências locais

- 69 testes aprovados em quatro suítes: fila, atendimento manual, Izabel e rota.
- TypeScript sem erros; build de produção concluído.
- ESLint dos dois componentes/rota alterados: zero erros; um aviso preexistente de Fast Refresh em `commercial-agent-queue.tsx`.
- `git diff --check` sem problemas. Detector Impeccable de layout: `[]`.
- Prévia com componentes reais e serviços simulados em `http://127.0.0.1:4187/agente-supervisionado`, com nomes fictícios e sem transporte de mensagens.
- Larguras 360, 390, 768 e 1440 px: sem transbordamento horizontal. Abertura do atendimento foca o título; retorno restaura foco à linha selecionada. Em 360 px, o botão de retorno ficou abaixo do cabeçalho e acessível.
- Teclado: Tab avança da identificação ao link e entre linhas da fila; indicador de foco de 2 px confirmado no estilo computado. A remoção de sombras decorativas preserva `:focus-visible`.
- Simulação manual de movimento reduzido na prévia: `animation-name: none` e `transition-duration: 0s`. A media query nativa foi inspecionada no código; não houve emulação da preferência do sistema operacional.
- Console do navegador: nenhum erro capturado na verificação final.

Arquivos em `outputs/art-direction-2026-11-12/`: screenshots desktop/celular, evidências DOM, logs dos testes, TypeScript e build. A prévia recebeu as mesmas referências de fontes do aplicativo para melhorar a fidelidade visual.

## Limites e próximo passo

Não houve mensagens, alterações no GHL, banco, credenciais, automações ou publicação. A migração e demais alterações de backend anteriores continuam com seu estado documentado nos respectivos handoffs; o build desta etapa não prova operação publicada.

Próximo passo: revisar esta direção no uso da equipe antes de estendê-la à Caixa de Entrada IA ou publicá-la. Manter a hierarquia de ações e os avisos de envio durante essa revisão.
