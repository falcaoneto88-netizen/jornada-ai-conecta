# Jornada AI

Crie um aplicativo full-stack responsivo chamado “Jornada AI — Dr. João Falcão”, em português-BR, para centralizar atendimento com IA e criar/acompanhar automações da jornada do cliente integradas ao GoHighLevel (GHL).

OBJETIVO
Permitir que a equipe comercial visualize pacientes/leads, acompanhe a fase da jornada, crie automações, receba sugestões da IA e sincronize contatos, oportunidades, conversas e eventos com o GoHighLevel por API REST e webhooks. O sistema deve funcionar em modo demonstração sem credenciais e mudar claramente para modo conectado após validação real.

IDENTIDADE VISUAL
Visual clínico premium e minimalista:
- fundo creme #faf9f5
- texto principal #2b2b2b
- títulos #111111
- dourado #c5a880 para ações, progresso e detalhes
- cards brancos, cantos 14–18px, sombras discretas
- tabelas com cabeçalhos pretos e texto branco, zebra discreto
- tipografia elegante e muito legível
- desktop e mobile impecáveis
Evite gradientes chamativos, excesso de cores e aparência genérica de template SaaS.

NAVEGAÇÃO
Sidebar recolhível com:
1. Visão Geral
2. Caixa de Entrada IA
3. Jornada do Cliente
4. Automações
5. Clientes
6. Modelos de Mensagem
7. Integrações
8. Configurações

1) VISÃO GERAL
- KPIs: novos leads, consultas agendadas, taxa de confirmação, orçamentos pendentes, procedimentos agendados, pacientes em follow-up, automações com erro
- gráfico simples de conversão por etapa
- painel “Ações prioritárias” com leads sem resposta, consultas D-1, orçamentos sem follow-up e falhas de sincronização
- seletor de período e status da conexão GHL

2) CAIXA DE ENTRADA IA
- lista de conversas e painel do atendimento
- canais: WhatsApp, Instagram, Facebook e e-mail
- resumo automático da conversa
- classificação de intenção: informação, preço, agendamento, objeção, pós-procedimento, urgência
- sentimento e prioridade
- 3 respostas sugeridas pela IA: objetiva, acolhedora e premium
- botão “Copiar”, “Editar” e “Enviar via GHL”; enviar só quando houver conexão real e confirmação do usuário
- histórico e registro de auditoria
- aviso visível de que assuntos clínicos sensíveis devem ser revisados por profissional; nunca diagnosticar

3) JORNADA DO CLIENTE
- kanban com drag-and-drop e contadores
- etapas iniciais editáveis:
  Novo Lead
  Em Atendimento
  Consulta Agendada
  Consulta Confirmada
  Consulta Realizada
  Orçamento Enviado
  Procedimento Agendado
  Pós-Procedimento
  Follow-up
  Reativação
- ao mover um card, abrir confirmação mostrando quais automações serão disparadas
- detalhe do cliente em drawer lateral com dados, tags, origem, última conversa, próxima ação, agendamento, responsável e histórico
- permitir mapear cada etapa local para Pipeline ID e Stage ID do GHL

4) AUTOMAÇÕES
Construtor visual baseado em blocos, fácil para equipe não técnica:
- gatilhos: contato criado, oportunidade mudou de etapa, mensagem recebida, consulta agendada, consulta confirmada, tempo sem resposta, data/hora relativa, webhook recebido
- condições: etapa, tag, canal, responsável, respondeu/não respondeu, status de agendamento
- ações: enviar WhatsApp/e-mail/SMS via GHL, adicionar/remover tag, criar/atualizar oportunidade, mover etapa, atribuir responsável, criar tarefa, aguardar, chamar webhook, pedir sugestão à IA
- templates prontos:
  Novo lead — resposta imediata
  4 dias sem resposta — reativação
  Consulta agendada — boas-vindas
  Consulta D-1 — confirmação e preparo
  Consulta confirmada — agradecimento
  Pós-consulta — orçamento e follow-up
  Procedimento agendado — acolhimento
  Pós-procedimento D+0, D+2, D+5 e D+7
- cada automação tem nome, status rascunho/ativa/pausada, versão, gatilho, passos, última execução, taxa de sucesso e erros
- botão testar automação com cliente de demonstração
- log de execuções detalhado
IMPORTANTE: nunca mostrar automação “ativa” no GHL sem confirmação da API. Em modo demo, usar rótulo “Simulação”.

5) CLIENTES
- tabela pesquisável e filtrável
- nome, telefone mascarado, e-mail, fase, tags, origem, responsável, próxima ação e última interação
- importar/sincronizar do GHL
- deduplicação por GHL Contact ID, telefone normalizado e e-mail
- exportação CSV
- drawer com timeline completa

6) MODELOS DE MENSAGEM
- biblioteca por etapa/canal/idioma: PT-BR, PT-PT, francês, espanhol e inglês
- variáveis como {{contact.first_name}}, data, horário e responsável
- editor, pré-visualização e validação de variáveis
- botão “Melhorar com IA” preservando tom acolhedor, premium, direto e humano
- nunca inventar valores, condições clínicas ou promessas de resultado

7) INTEGRAÇÃO GHL
Tela com:
- modo Demonstração / Conectado
- campos: API Base URL configurável, Private Integration Token, Location ID, Pipeline ID padrão, Calendar ID e Webhook Secret
- credenciais nunca podem ficar no localStorage nem ser retornadas ao frontend; devem ser gravadas como secrets/backend
- botão “Testar conexão” deve chamar backend e validar de verdade
- endpoint backend para proxy GHL com allowlist de operações
- endpoints de webhook de entrada com validação do secret, idempotência e log
- exibir Callback URL com botão copiar
- mapeamento de campos personalizados, pipelines, stages, usuários e calendários
- botão sincronização manual com status e timestamp
- tratamento de rate limit, timeout, token inválido, resposta parcial e retry com backoff
- nenhuma chave hardcoded no código
- preparar arquitetura compatível com API v2 do GoHighLevel/LeadConnector, mantendo URLs e versões configuráveis no backend

8) CONFIGURAÇÕES
- usuários e papéis: Administrador, Gestor, Comercial e Visualizador
- permissões por ação
- identidade da clínica
- horário/fuso Portugal e Brasil
- políticas de retenção de logs
- saúde do sistema

DADOS E BACKEND
Crie estrutura real, não apenas uma landing page:
- autenticação por e-mail
- banco com tabelas/propostas equivalentes para profiles, ghl_connections, journey_stages, contacts, opportunities, conversations, messages, automations, automation_versions, automation_runs, message_templates, webhooks_inbox, audit_logs
- RLS/controle por workspace/organização
- Edge Functions/backend para test-ghl-connection, ghl-proxy, ghl-webhook, sync-ghl e ai-support
- tokens criptografados/secretos, nunca em tabelas públicas
- idempotency_key nos webhooks
- registros de auditoria para envio, alteração de etapa e execução de automação
- dados de demonstração realistas em português, claramente marcados como DEMO

IA
- usar a integração de IA disponível no Lovable, caso esteja habilitada, atrás da função ai-support
- prompts de sistema voltados a suporte e conversão, sem diagnóstico clínico
- gerar resumo, intenção, prioridade e sugestões de resposta
- fallback seguro quando IA não estiver configurada

QUALIDADE
- estados loading/empty/error/success
- toasts úteis
- acessibilidade e contraste
- validação de formulários
- rotas protegidas
- sem botões decorativos: ações principais devem funcionar
- README/área interna com instruções objetivas para conectar o GHL
- não publicar automaticamente; deixar como projeto privado
- construir primeiro o MVP funcional completo com dados demo e integrações preparadas.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://jornada-ai-conecta.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/36345211-2616-42f7-bb9e-e78a9d00ca22).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
