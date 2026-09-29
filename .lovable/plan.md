# Entrada n8n → Jornada AI: confirmações de consultas

## Situação verificada
- O workflow "Falcão | Confirmação de Consultas | V1" existe no n8n, mas **não está disponível para leitura** ("Available in MCP" desligado). Por isso não consegui ler o nó "Jornada AI: enviar etapa (adaptador)" nem o formato que ele envia.
- O Jornada já tem uma agenda de consultas ligada ao HighLevel (cada consulta identificada pelo ID da marcação no HighLevel) e entradas públicas assinadas (site Experiência Falcão, BioReport) com proteção contra duplicados. A nova entrada segue o mesmo modelo.

**Para fixar o formato definitivo:** ligue "Available in MCP" nas Definições do workflow. Assim leio o nó e ajusto o formato abaixo antes de o dar como final. Se preferir não ligar, o n8n deve enviar exatamente o formato proposto aqui.

## O que será criado
1. **Endereço de receção** (teste, pré-visualização):
   `https://project--36345211-2616-42f7-bb9e-e78a9d00ca22-dev.lovable.app/api/public/n8n/confirmacao-consulta`
   (o endereço publicado só funciona depois de publicar, o que não será feito agora)
2. **Header de autenticação:** `X-Jornada-Signature`, com uma assinatura do corpo feita com a chave partilhada, mais `X-Jornada-Timestamp`. Pedidos com mais de 5 minutos ou sem assinatura válida são recusados.
3. **Formato proposto (JSON, máximo 4 KB):**
```text
{
  "event_id": "texto único por evento (ex.: ID da execução n8n + nó)",
  "ghl_appointment_id": "ID da marcação no HighLevel",
  "status": "confirmada" | "cancelada" | "reagendamento_pedido" | "sem_resposta",
  "occurred_at": "data/hora ISO 8601"
}
```
   Sem nome, telefone, e-mail ou texto do paciente.
4. **Proteção contra duplicados:** cada `event_id` é guardado; repetido devolve "já recebido" sem alterar nada. Uma confirmação mais antiga nunca sobrepõe uma mais recente.
5. **Registo:** atualiza apenas o estado da consulta já existente na agenda do Jornada da clínica ligada ao HighLevel; consulta desconhecida fica registada para revisão, sem criar nada. Histórico na auditoria sem dados pessoais.
6. **Nada é enviado** ao paciente nem escrito no HighLevel.

## Chave de autenticação
Cadastrada pelo formulário seguro de segredos do Lovable (vou abrir o pedido) com o nome `N8N_JORNADA_SIGNING_SECRET`. O mesmo valor, gerado por si (gestor de palavras-passe), vai para uma credencial do n8n — nunca no chat.

## Testes previstos (a separar de "criado")
- Testes automáticos: assinatura válida/inválida, janela de 5 min, duplicado, formato inválido, consulta de outra clínica, evento mais antigo.
- Teste real contra o endereço de teste com uma consulta fictícia — só depois de a chave estar cadastrada.

## Detalhes técnicos
- Rota `src/routes/api/public/n8n/confirmacao-consulta.ts` (HMAC-SHA256 sobre `timestamp.corpo`, comparação em tempo constante, Zod estrito).
- Migração: tabela `n8n_appointment_events` (event_id único por org, status, occurred_at, resultado) com RLS/GRANT só service_role e leitura admin; RPC SECURITY DEFINER transacional com search_path vazio.
- Organização resolvida pelo vínculo HighLevel fixo no servidor, nunca pelo corpo.
