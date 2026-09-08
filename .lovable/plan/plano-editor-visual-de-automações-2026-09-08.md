# Plano: Editor visual de automações

## Objetivo
Transformar a página **Automações** em um construtor visual funcional onde seja possível montar fluxos com gatilho, condições, ações, esperas e ramificações simples, salvando versões e executando simulações.

## Estado atual confirmado
- A tabela `automations` já existe com `steps` como `jsonb` (array).
- Hoje `steps` guarda apenas rótulos de texto (`string[]`).
- A interface permite criar rascunho com nome + gatilho, ativar/pausar, testar em simulação e ver logs.
- Não é possível editar ou configurar os passos reais da automação.
- A tabela `automation_versions` já existe para versionar definições.

## O que será implementado

### 1. Modelo de dados estruturado para passos
Criar tipos TypeScript para cada tipo de passo:
- `gatilho` — tipo do gatilho (já configurado no cabeçalho da automação).
- `condicao` — campo, operador e valor (ex: etapa é "Consulta Agendada", tag contém "DEMO").
- `acao` — tipo da ação + parâmetros (ex: enviar WhatsApp usando modelo X, mover etapa, adicionar tag, atribuir responsável, pedir sugestão à IA).
- `espera` — tempo em minutos/horas/dias.
- `ramificacao` — ramo "sim" / "não" para condições (MVP: condições simples sem aninhamento profundo).

### 2. Compatibilidade com dados existentes
- Atualizar o tipo `Automation` para `passos: AutomationStep[]`.
- No mapeamento do Supabase, converter passos antigos (`string[]`) para passos genéricos do tipo `acao` com o rótulo original.
- Atualizar os dados DEMO para usarem o novo formato estruturado.

### 3. Componente visual do editor
- Criar `AutomationEditor` como construtor vertical de blocos.
- Cada bloco mostra ícone, título, resumo dos parâmetros e botões de editar/remover.
- Botão "Adicionar passo" abre menu com: Condição, Ação, Espera.
- Formulário lateral/drawer para configurar cada bloco com selects de etapas, modelos, canais, responsáveis e tags.
- Manter o cabeçalho com nome, descrição e gatilho.

### 4. Persistência e versionamento
- Atualizar `useGuardarAutomacao` para receber o objeto completo (nome, descrição, gatilho, status, passos estruturados).
- Ao salvar, gravar `steps` em `automations` e inserir nova linha em `automation_versions` com `current_version + 1`.
- Atualizar `current_version` na automação.
- Auditoria: `automacao.guardada` e `automacao.versao_criada`.

### 5. Simulação e logs
- Atualizar `useTestarAutomacao` para interpretar os passos estruturados e gerar log detalhado por bloco.
- Na aba "Log de execuções", mostrar os passos simulados de forma legível.
- Manter o bloqueio de envios reais em modo demo e quando `write_enabled` estiver desativado.

### 6. Detalhes e listagem
- Atualizar o card de automação para renderizar passos estruturados (ícone + resumo).
- Atualizar o modal de detalhes para exibir o fluxo completo de forma legível.

### 7. QA
- Testar criação, edição, ativação/pausa e simulação.
- Verificar mobile (drawer em vez de dialog largo).
- Validar estados vazios, loading e erros.
- Confirmar que não há console errors e que o build passa.

## Fora do escopo desta fase
- Execução real automática via webhooks (ainda depende de `GHL_WEBHOOK_SECRET`).
- Condições aninhadas complexas ou loops.
- Editor drag-and-drop completo (será um construtor vertical simples, mais rápido de validar).

## Resultado esperado
O usuário poderá criar e editar automações visualmente, configurar ações reais (modelo, etapa, tag, responsável), salvar versões e testar em simulação com logs detalhados.
