# Revisão de interação — Jornada AI (skill emil-design-eng)

Identidade visual preservada: mesmas cores, fontes, bordas e espaçamentos. Só muda como botões, menus e janelas reagem e se movem. Nenhuma alteração ou publicação até sua aprovação.

| Antes | Depois | Porquê |
| --- | --- | --- |
| Botões sem resposta ao toque | Leve redução (escala 0,97) ao pressionar, 140 ms | Confirma que o clique foi recebido |
| Menus suspensos e seletores abrem do centro | Abrem a partir do botão que os acionou | Movimento coerente com a origem |
| Menus/popovers com curva padrão fraca | Curva de saída rápida própria (`cubic-bezier(0.23,1,0.32,1)`), 150–200 ms | Sensação mais ágil e premium |
| Painel lateral (gaveta) abre em 500 ms, `ease-in-out` | 300 ms com curva tipo iOS; fecho mais rápido (200 ms) | 500 ms parece lento em uso diário |
| Janelas (diálogos) com entrada e saída iguais | Entrada 200 ms, saída 150 ms; mantêm-se centradas | Sair deve ser mais rápido que entrar |
| Fundo escuro das janelas a 80% preto fixo | Usar token do tema (mesma aparência), transição só de opacidade | Respeita tokens e modo escuro |
| Dicas (tooltips) sempre com atraso e animação | Após a primeira, as seguintes abrem instantâneas | Barras de ícones ficam mais rápidas |
| `transition-all` no menu principal, abas, barra de progresso e acordeão | Transição só das propriedades necessárias (cor, opacidade, transform) | Evita animar layout e travamentos |
| Efeitos de passar o rato também disparam no telemóvel | Restringir a dispositivos com rato | Evita estados “presos” no toque |
| Sem suporte a “reduzir movimento” | Com a preferência ativa, manter só esmaecimentos | Acessibilidade |
| Ações frequentes (enviar, trocar conversa, atalhos de teclado) | Sem animação extra | Usadas dezenas de vezes por dia |

## Detalhes técnicos
- Tokens novos em `src/styles.css`: `--ease-out`, `--ease-in-out`, `--ease-drawer`, regra `prefers-reduced-motion`.
- Ajustes em `components/ui/` (button, dropdown-menu, select, popover, tooltip, dialog, sheet, tabs, progress, accordion) e `app-shell.tsx`.
- Sem mudanças de lógica, dados, envio, banco ou integrações. Validação por capturas desktop/mobile e testes existentes de componentes.
