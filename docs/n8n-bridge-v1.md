# Ponte n8n → Jornada → GoHighLevel (v1)

Estado: **código, testes e migração aplicados; ponte DESLIGADA.** A migração foi aplicada em
produção a 2026-09-30 ~16:35 UTC. Pendentes: secret do token, credencial dedicada do n8n, escolha
de canal, deploy e leitura autenticada de ponta a ponta. O n8n **não está ligado** e o erro
`Invalid JWT` do n8n **não está resolvido**: só poderá ser declarado resolvido depois de uma
leitura autenticada de ponta a ponta (n8n → ponte → GHL) verificada. A entrada existente
`POST /api/public/n8n/confirmacao-consulta` (HMAC com `N8N_JORNADA_SIGNING_SECRET`) mantém-se
intacta: regista estados de confirmação e **não envia mensagens**.

Estado de verificação: `concurrency_verified = false`. A reserva durável da ponte garante no
máximo uma tentativa por org+consulta+horário+tipo, mas **não** resolve corridas de estado entre
execuções do n8n nas suas Data Tables.

## Estado de implantação (2026-09-30)

- Migração aplicada em produção (transação). Verificado: RLS ativo nas três tabelas, 0 concessões
  a anon/authenticated, `authenticated` não pode executar `n8n_bridge_claim_send`,
  `n8n_bridge_sends` com 0 linhas.
- Semeadura mínima: apenas a organização `f07ab3be-7419-4779-a901-ef71c5fc27f0`, agenda
  `nPXR1Fyp0r3CpaMMGSki` e morada da clínica preenchida pelo utilizador.
- Configuração verificada: `bridge_enabled=false`, `live_send_enabled=false`, `simulation=true`,
  `channel=null`, `channel_verified=false`, vendedor de reserva `null`. Nenhum segredo criado.
- n8n (rascunho `WrDn82MwKBcuM73G`): os 4 nós HTTP já apontam para esta ponte, com corpos estritos
  por `op`, sem redirecionamentos, sem repetição automática e timeout 120000 ms. A credencial
  Bearer dedicada **ainda não está configurada**.
- Testes no n8n: 23 cenários sintéticos, 8 regressões de regras independentes e verificações do
  adaptador passaram. **Não há teste real de ponta a ponta.**

## Endpoint

`POST /api/public/n8n/bridge` — só POST, `Content-Type: application/json`, corpo ≤ 2048 bytes,
sem CORS, sem redirects, quota 60 pedidos/minuto por organização.

Autenticação: `Authorization: Bearer <N8N_JORNADA_BRIDGE_TOKEN>` (secret novo, ≥ 32 caracteres
aleatórios, comparação em tempo constante). Sem secret configurado → `503 bridge_unavailable`.
Sessão de utilizador não substitui este token.

Organização/location vêm apenas do servidor: `GHL_LOCATION_ID` → `ghl_location_bindings` →
`ghl_connections` (`location_id` igual, `status = 'conectada'`, `write_enabled`). Se
`JORNADA_AI_ORGANIZATION_ID` existir tem de coincidir com o binding; se faltar, vale o binding. O corpo não aceita URL, path, token, location, org,
canal, texto ou menções: campos extra → `400 invalid_request`.

### Operações (união estrita por `op`)

| op | corpo | resposta 200 |
|---|---|---|
| `health` | `{}` | `{ok, bridgeEnabled, simulation, liveSendEnabled, writeEnabled, calendarConfigured, channelConfigured, channelVerified, smsRouteConfigured:false, addressConfigured}` |
| `contact.get` | `{contactId}` | `{contact:{id,locationId,firstName,phone,assignedTo,dnd,dndSettings}}` |
| `appointment.get` | `{appointmentId}` | `{event:{id,locationId,calendarId,contactId,startTime,endTime,appointmentStatus}}` |
| `message.send` | `{appointmentId,contactId,expectedStartTime,kind}` | `{messageId,status:"accepted",duplicate,delivered:false}` |

`kind ∈ booking | req24 | req12 | confirm | escalation | handoff`.
Em simulação: `{simulated:true,status:"simulated",messageId:null,duplicate:false,delivered:false,kind}` — sem reserva e sem POST.

Erros (`{error}`): 401 `unauthorized`; 403 `bridge_disabled` / `live_send_disabled`; 409
`calendar_not_configured`, `calendar_mismatch`, `contact_mismatch`, `appointment_rescheduled`,
`appointment_not_active`, `appointment_in_past`, `channel_not_configured`,
`address_not_configured`, `contact_phone_missing`, `dnd_not_confirmed`, `contact_not_verified`,
`appointment_not_verified`, `sms_route_not_configured`, `provider_not_configured`,
`channel_not_verified`, `seller_not_configured`, `seller_not_in_location`,
`send_already_attempted`; 429 `rate_limited`; 502 `ghl_unavailable`, `send_rejected`,
`outcome_unknown`; 503 `binding_unavailable`, `bridge_schema_unavailable`, `reservation_unavailable`.

### Regras de `message.send`

1. Reconsulta a consulta no GHL: mesma location, agenda configurada, mesmo contacto, `startTime`
   igual ao esperado (normalizado ao segundo), estado `confirmed|new|booked`, futura.
2. Reconsulta o contacto por pesquisa de ID exato (o GET simples omite DND). DND global `false` e
   canais `SMS` e `WhatsApp` presentes e `inactive`. Ausência nunca é consentimento.
3. Canal (nenhum escolhido por omissão; nada é ativado automaticamente):
   - `sms` (operadora): **bloqueado na v1** → `409 sms_route_not_configured`, também em simulação.
     O tipo `SMS` desta conta sai pelo provedor ZaptosWPP; usá-lo como "SMS" seria enviar WhatsApp.
     Só poderá ser aceite depois de existir uma rota de SMS de operadora configurada e verificada
     de forma independente.
   - `whatsapp_zaptos`: exige `zaptos_provider_id` (não secreto, guardado no servidor) e
     `channel_verified = true`. `channel_verified` nasce `false`, é reposto a `false` sempre que o
     canal ou o provedor mudam no formulário, e só é marcado `true` pelo fluxo de implantação
     administrativo (SQL manual) após verificação. Quem chama nunca o define. O envio fixa
     `conversationProviderId`.
4. Corpo enviado a `POST /conversations/messages` (API 2021-07-28), com `status: "pending"` e o
   `appointmentId` da consulta acabada de validar:
   - mensagem: `{type:"SMS", contactId, message, conversationProviderId, appointmentId, status:"pending"}`
   - `escalation`/`handoff`: `{type:"InternalComment", contactId, message:"@Responsável<userId>ID</userId> …", mentions:["ID"], appointmentId, status:"pending"}`
     — menção inline e `mentions` com o mesmo ID do responsável comercial (`assignedTo`) ou do
     vendedor de reserva configurado e verificado na location; nunca o médico; sem escolha automática.
   Textos PT-PT fixos, Europe/Lisbon, DD/MM/YYYY HH:mm. `confirm` exige morada.
5. Envio real exige: `bridge_enabled`, `live_send_enabled`, `simulation=false`,
   `ghl_connections.write_enabled`, integração `conectada`, canal verificado.
6. Reserva atómica antes do POST; uma única tentativa. 2xx com `messageId` → `accepted`. Só uma
   recusa HTTP 4xx explícita é `rejected`; timeout, erro de rede, 3xx, 5xx, 2xx sem ID ou
   persistência falhada → `unknown` (reconciliação manual, sem retry). Duplicado só devolve
   `messageId` se `accepted`. `accepted` = aceite pela API; **não prova entrega**.

Limitação: estes corpos seguem a documentação oficial mas não foram testados contra a API real.

## Migração (pendente)

Fonte única: `sql/pending/0013_n8n_bridge_v1.sql` (não está em `drizzle/migrations` nem em
`supabase/migrations`). Cria `n8n_bridge_settings`, `n8n_bridge_sends`, `n8n_bridge_rate` e as
RPCs `n8n_bridge_hit`, `n8n_bridge_claim_send`, `n8n_bridge_finish_send` (SECURITY DEFINER,
`search_path=''`, só `service_role`; RLS ativo sem concessões a anon/authenticated).
Sem a migração a ponte responde `503 bridge_schema_unavailable`.

Aplicação manual (quando autorizada): executar o ficheiro no editor SQL do backend e confirmar que
as três tabelas existem com os padrões desligados.

## Ativação manual (pendente, por esta ordem)

1. Aplicar a migração.
2. Adicionar o secret `N8N_JORNADA_BRIDGE_TOKEN` (≥ 32 caracteres aleatórios) em Secrets e o
   mesmo valor numa credencial **dedicada** do n8n *Generic Auth → Bearer Auth* (`httpBearerAuth`).
   Não reutilizar a credencial *Header Auth* do GHL.
3. No cartão Integrações → “n8n — Confirmação de consultas”: agenda (`nPXR1Fyp0r3CpaMMGSki`),
   morada, vendedor de reserva opcional. Canal: o utilizador **ainda não escolheu WhatsApp**;
   `sms` fica bloqueado na v1.
4. Deploy e verificação de uma leitura autenticada de ponta a ponta.
5. `update n8n_bridge_settings set bridge_enabled=true` → testar leituras e `message.send` em simulação.
6. Só depois, com autorização explícita: escolha de canal, verificação do provedor
   (`channel_verified=true` por SQL), `simulation=false`, `live_send_enabled=true`.

## Exemplos (placeholders)

```bash
curl -X POST https://<dominio>/api/public/n8n/bridge \
  -H "Authorization: Bearer <N8N_JORNADA_BRIDGE_TOKEN>" -H "Content-Type: application/json" \
  -d '{"op":"appointment.get","appointmentId":"<APPOINTMENT_ID>"}'

-d '{"op":"message.send","appointmentId":"<APPOINTMENT_ID>","contactId":"<CONTACT_ID>","expectedStartTime":"<ISO_START>","kind":"req24"}'
```

## Substituição dos 4 nós HTTP do n8n

| Nó atual | Corpo para `POST /api/public/n8n/bridge` |
|---|---|
| GHL Contacto Inicial | `{"op":"contact.get","contactId":"{{ $json.appointment.contactId }}"}` |
| GHL Contacto Atual | `{"op":"contact.get","contactId":"{{ $json.envelope.ctx.appointment.contactId }}"}` |
| GHL Consulta Atual | `{"op":"appointment.get","appointmentId":"{{ $json.envelope.ctx.appointment.appointmentId }}"}` |
| GHL Enviar Mensagem | `{"op":"message.send","appointmentId":"{{ $json.envelope.ctx.appointment.appointmentId }}","contactId":"{{ $json.envelope.ctx.appointment.contactId }}","expectedStartTime":"{{ $json.envelope.ctx.appointment.startTime }}","kind":"{{ $json.action.type }}"}` |

Configuração de cada nó HTTP Request: autenticação *Generic Credential Type → Bearer Auth*
(`httpBearerAuth`, credencial dedicada), corpo JSON, `Full Response` ativado, **sem** seguir
redirecionamentos e **sem** repetição automática (Retry On Fail desligado). Horários (24h/12h),
regras e decisões permanecem no n8n; a ponte não agenda nada.

## Origem dos eventos GHL → n8n

Os eventos de marcação devem ir **diretamente** do GHL para o webhook do n8n com transporte
autenticado (header secreto do webhook n8n), sem regras comerciais no GHL. A sincronização horária
da agenda feita pelo Jornada é periódica e **não** é imediata; não deve ser usada como gatilho de
`booking`.
