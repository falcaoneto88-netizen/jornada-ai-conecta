# Ponte n8n → Jornada → GoHighLevel (v1)

Estado: **código e testes prontos; DESLIGADA.** Migração não aplicada em produção, token não criado,
nenhum nó do n8n ligado, nenhum envio real efetuado. A entrada existente
`POST /api/public/n8n/confirmacao-consulta` (HMAC com `N8N_JORNADA_SIGNING_SECRET`) mantém-se
intacta: regista estados de confirmação e **não envia mensagens**.

## Endpoint

`POST /api/public/n8n/bridge` — só POST, `Content-Type: application/json`, corpo ≤ 2048 bytes,
sem CORS, sem redirects, quota 60 pedidos/minuto por organização.

Autenticação: `Authorization: Bearer <N8N_JORNADA_BRIDGE_TOKEN>` (secret novo, ≥ 32 caracteres
aleatórios, comparação em tempo constante). Sem secret configurado → `503 bridge_unavailable`.
Sessão de utilizador não substitui este token.

Organização/location vêm apenas do servidor (`JORNADA_AI_ORGANIZATION_ID` + `GHL_LOCATION_ID` +
`ghl_location_bindings` + `ghl_integrations`). O corpo não aceita URL, path, token, location, org,
canal, texto ou menções: campos extra → `400 invalid_request`.

### Operações (união estrita por `op`)

| op | corpo | resposta 200 |
|---|---|---|
| `health` | `{}` | `{ok, bridgeEnabled, simulation, liveSendEnabled, writeEnabled, calendarConfigured, channelConfigured, addressConfigured}` |
| `contact.get` | `{contactId}` | `{contact:{id,locationId,firstName,phone,assignedTo,dnd,dndSettings}}` |
| `appointment.get` | `{appointmentId}` | `{event:{id,locationId,calendarId,contactId,startTime,endTime,appointmentStatus}}` |
| `message.send` | `{appointmentId,contactId,expectedStartTime,kind}` | `{messageId,status:"accepted",duplicate,delivered:false}` |

`kind ∈ booking | req24 | req12 | confirm | escalation | handoff`.
Em simulação: `{simulated:true,status:"simulated",messageId:null,duplicate:false,delivered:false,kind}` — sem reserva e sem POST.

Erros (`{error}`): 401 `unauthorized`; 403 `bridge_disabled` / `live_send_disabled`; 409
`calendar_not_configured`, `calendar_mismatch`, `contact_mismatch`, `appointment_rescheduled`,
`appointment_not_active`, `appointment_in_past`, `channel_not_configured`,
`address_not_configured`, `contact_phone_missing`, `dnd_not_confirmed`, `contact_not_verified`,
`appointment_not_verified`, `seller_not_configured`, `seller_not_in_location`,
`send_already_attempted`; 429 `rate_limited`; 502 `ghl_unavailable`, `send_rejected`,
`outcome_unknown`; 503 `binding_unavailable`, `bridge_schema_unavailable`, `reservation_unavailable`.

### Regras de `message.send`

1. Reconsulta a consulta no GHL: mesma location, agenda configurada, mesmo contacto, `startTime`
   igual ao esperado (normalizado ao segundo), estado `confirmed|new|booked`, futura.
2. Reconsulta o contacto por pesquisa de ID exato (o GET simples omite DND). DND global `false` e
   cada canal exigido presente e `inactive` (`sms` → SMS; `whatsapp_zaptos` → SMS e WhatsApp).
   Ausência nunca é consentimento.
3. Textos PT-PT fixos no servidor, fuso Europe/Lisbon, DD/MM/YYYY HH:mm. `confirm` exige morada.
   `escalation`/`handoff` = comentário interno (`InternalComment`) com menção ao responsável
   comercial do contacto (`assignedTo`), ou ao vendedor de reserva configurado e verificado na
   location; nunca ao médico da consulta; sem escolha automática.
4. Envio real exige: `bridge_enabled`, `live_send_enabled`, `simulation=false`,
   `ghl_integrations.write_enabled`, integração `conectada`.
5. Reserva atómica (`UNIQUE org+appointmentId+startTime+kind`) antes do POST; uma única tentativa.
   2xx com `messageId` → `accepted` persistido. Timeout/5xx/2xx sem ID/persistência falhada →
   `unknown` (reconciliação manual, sem retry). 4xx → `rejected`. Duplicado só devolve `messageId`
   se `accepted`.
6. Ambos os canais usam o tipo `SMS` da API (o provedor ZaptosWPP da conta encaminha). `accepted`
   significa aceitação pela API — **não prova entrega** nem que saiu por SMS real.

Limitação: o formato `InternalComment` + `mentions` não foi validado contra a API real.

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
2. Adicionar o secret `N8N_JORNADA_BRIDGE_TOKEN` (≥ 32 caracteres aleatórios) em Secrets e a mesma
   credencial num *Header Auth* do n8n.
3. No cartão Integrações → “n8n — Confirmação de consultas”: agenda (`nPXR1Fyp0r3CpaMMGSki`),
   canal, morada, vendedor de reserva opcional.
4. `update n8n_bridge_settings set bridge_enabled=true` → testar leituras e `message.send` em simulação.
5. Só depois, com autorização explícita: `simulation=false`, `live_send_enabled=true`.

## Exemplos (placeholders)

```bash
curl -X POST https://<dominio>/api/public/n8n/bridge \
  -H "Authorization: Bearer <N8N_JORNADA_BRIDGE_TOKEN>" -H "Content-Type: application/json" \
  -d '{"op":"appointment.get","appointmentId":"<APPOINTMENT_ID>"}'

-d '{"op":"message.send","appointmentId":"<APPOINTMENT_ID>","contactId":"<CONTACT_ID>","expectedStartTime":"<ISO_START>","kind":"req24"}'
```

## Substituição dos 4 nós HTTP do n8n

| Nó atual | Novo corpo para `POST /api/public/n8n/bridge` |
|---|---|
| GHL Contacto Inicial | `{"op":"contact.get","contactId":"{{$json.contactId}}"}` |
| GHL Contacto Atual | `{"op":"contact.get","contactId":"{{$json.contactId}}"}` |
| GHL Consulta Atual | `{"op":"appointment.get","appointmentId":"{{$json.appointmentId}}"}` |
| GHL Enviar Mensagem | `{"op":"message.send","appointmentId":"…","contactId":"…","expectedStartTime":"…","kind":"req24"}` |

Todos com credencial *Header Auth* `Authorization: Bearer …`, sem redirects. O n8n deixa de
precisar do token GHL (o `Invalid JWT` atual desaparece porque o GHL é chamado pelo Jornada).
Horários (24h/12h), regras e decisões permanecem no n8n; a ponte não agenda nada.

## Origem dos eventos GHL → n8n

Os eventos de marcação devem ir **diretamente** do GHL para o webhook do n8n com transporte
autenticado (header secreto do webhook n8n), sem regras comerciais no GHL. A sincronização horária
da agenda feita pelo Jornada é periódica e **não** é imediata; não deve ser usada como gatilho de
`booking`.
