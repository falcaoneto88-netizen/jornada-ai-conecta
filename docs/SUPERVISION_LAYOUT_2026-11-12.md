# Jornada AI — layout de supervisão

> Registro histórico da preparação local. Os ensaios Izabel, artefatos e comandos que dependem do pacote privado não acompanham esta entrega pública. Consulte `PUBLICATION_INBOX_SUPERVISED_2026-11-12.md` e o manifesto final para o escopo e os gates desta cópia.

Data: 12/11/2026. Projeto original Jornada AI. Base de código: `a75951e2c7b84bea3b4396b6385a5f49892eeed4`, branch local `codex/izabel-chat-20261112`.

## Direção

A tarefa principal é escolher uma pendência, conferir o histórico, revisar a proposta e decidir. A área de trabalho aproxima esses passos; configuração e homologação ficam em segundo plano. A identidade existente continua: fundo creme, superfícies claras, dourado para seleção, Inter no conteúdo e Cormorant Garamond no título da página.

As quatro categorias representam consultas reais da fila existente, sem novas métricas ou estados inventados. No computador, lista e revisão ocupam uma área comum. Em telas menores, selecionar abre o detalhe no mesmo espaço, com retorno à fila e restauração de foco.

## Limites preservados

- V02 continua vigente; Izabel v1 continua candidata em homologação.
- Aprovar continua sendo uma ação de envio, com diálogo explícito e as verificações existentes. O refinamento não libera contatos, canais ou envios.
- Alertas de desatualização, DND, recusa, revisão humana, falha e envio incerto permanecem visíveis quando aplicáveis.
- Nenhuma mudança de backend, banco, autenticação, workflow, contato ou configuração externa neste incremento visual.
- A nova fila depende da migração local documentada em `SUPERVISION_QUEUE_REVIEW_2026-11-12.md`; este trabalho não a aplica à produção.

## Ferramentas e artefatos

Motion Site Designer orienta hierarquia, interação, responsividade e redução de movimento. Impeccable complementa a revisão de layout operacional. O Figma contém uma proposta nativa editável com conteúdo fictício, separada da implementação executável.

Figma: [desktop](https://www.figma.com/design/zsGWICCREyZonAfFhPAMJX?node-id=4-148) e [celular](https://www.figma.com/design/zsGWICCREyZonAfFhPAMJX?node-id=4-313). São 152 camadas descendentes, 77 textos e 23 instâncias; não é um protótipo interativo nem uma reprodução exata da tela executável. A implementação reutiliza os componentes do aplicativo e preserva todos os avisos e estados operacionais.

A revisão automática recusou a importação direta da tela para o Figma por possível exposição de dados sensíveis. Não houve contorno. A alternativa usa somente textos sintéticos autorados e tokens de interface; não exporta conversas reais, dados clínicos, credenciais ou o pacote privado Izabel.

Prévia local: `http://127.0.0.1:4187/agente-supervisionado`. Usa os componentes reais com serviços substituídos por fixtures sem transporte real. Essa prévia não comprova conexão ou persistência publicada.

## Verificação

- 69 testes passaram em quatro suítes: fila, atendimento manual, bancada Izabel e rota. Não foram acrescentados testes que apenas repetem classes de estilo.
- TypeScript global e build Vite aprovados. ESLint dirigido: zero erros; permanece o aviso anterior de Fast Refresh sobre `friendlyError` exportado junto do componente.
- Impeccable layout: `[]`; isso não constitui certificação de acessibilidade.
- Navegador com componentes reais e dados fictícios: 1440, 754, 390 e 360 px sem overflow horizontal. Seleção por teclado, foco na revisão, retorno ao item, busca por Enter e alerta de envio incerto conferidos. Console sem erros na consulta final.
- A inspeção detectou um problema concreto em 360 px: o botão Voltar podia ficar sob o cabeçalho fixo após o foco automático. Antes, botão em y=46,5 e cabeçalho até y=161; o centro atingia o cabeçalho. A margem de rolagem do título corrigiu a posição para y=184; o hit-test passou a atingir Voltar e o clique retornou à fila, restaurando o foco.
- Controles refinados usam transição de opacidade de 150 ms, sem animação de dimensões ou biblioteca nova. O CSS compilado contém `prefers-reduced-motion` com transições desativadas. A preferência do sistema estava desligada; **não houve emulação visual do sistema em modo reduzido** nesta sessão.

Evidências: `outputs/layout-2026-11-12/` contém capturas `desktop.jpg` e `mobile.jpg`, resultados do navegador, logs de testes, TypeScript, lint, build e detector. O desenho Figma e sua verificação estão em `outputs/supervision-2026-11-12/FIGMA_LAYOUT_HANDOFF.md`.

Código deste incremento: `src/components/commercial-agent-queue.tsx` e `src/routes/agente-supervisionado.tsx`. Filtros e busca compartilham a faixa em telas largas; fila e revisão usam uma superfície com divisória, e a homologação aparece depois do trabalho operacional. Nas telas menores, filtros recolhem durante a revisão e o retorno preserva a seleção. Nenhuma função de envio foi substituída ou liberada.

## Publicação

Não publicado. A entrega é uma proposta editável no Figma e uma implementação local para revisão. A publicação do aplicativo e a migração da fila permanecem etapas separadas.
