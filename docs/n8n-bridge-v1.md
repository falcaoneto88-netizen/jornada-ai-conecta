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

Autenticação: `Authorization: Bearer <CHAVE>` (contrato HTTP inalterado). Duas fontes, nunca
ambas válidas ao mesmo tempo:

1. `N8N_JORNADA_BRIDGE_TOKEN` (ambiente, ≥ 32 caracteres) — **tem precedência**. Se existir com
   tamanho válido, só ele autentica e a criação pela interface fica indisponível. Se existir mas
   for curto, tudo é recusado (`503`), sem recurso à BD.
2. Sem token de ambiente: credencial por organização em `public.n8n_bridge_credentials`, criada
   pelo administrador no cartão (ver “Criação guiada da chave”). A org é resolvida só no servidor
   (binding abaixo) e a chave tem de pertencer a essa org.

Comparação: SHA-256 de tamanho fixo em tempo constante. Sem fonte configurada, schema em falta ou
binding indisponível → `503 bridge_unavailable`; chave errada/ausente/de outra org → `401`/`503`.
`health` autentica mesmo com `bridge_enabled=false`; leituras e envios continuam a exigir
`bridge_enabled` e os gates de canal/escrita real. Sessão de utilizador não substitui a chave.

### Criação guiada da chave (só administrador)

Integrações → “n8n — Confirmação de consultas” → **Chave de ligação: Por criar/Configurada**.
“Criar chave para o n8n” abre um diálogo; “Criar chave” é a ação final do utilizador. O servidor
(`criarChaveN8n`) exige sessão real (`getUser`), papel administrador, organização do perfil igual
ao binding GHL do servidor, entrada estrita `{confirm:true}` e `Origin` exata de
`https://jornada-ai-conecta.lovable.app` ou da pré-visualização do projeto (`Sec-Fetch-Site`, se
enviado, tem de ser `same-origin`). Gera `randomBytes(32)` em hex, grava **só** o SHA-256
(hex minúsculo) com INSERT simples (PK = organização: criação única; conflito → “já criada”),
relê o digest para confirmar e só então devolve a chave uma vez. Falha → nenhuma chave devolvida.
A chave vive só em estado React do diálogo (campo password só de leitura, “Copiar chave” por
clique, “Já guardei a chave” limpa); nunca storage, URL, cache ou logs; nunca é mostrada de novo.
Revogação/rotação não implementadas na v1 (exigem SQL administrativo).

Passos para o utilizador: n8n → workflow → nó “GHL Contacto Inicial” → *Connect to Bearer Auth* →
colar em “Bearer Token” só a chave (sem “Bearer”) → *Save*. A mesma credencial é depois reutilizada
nos outros 3 nós HTTP. Nenhuma chave deve ser colada no chat.

A prontidão devolve apenas booleanos: `tokenPresente` (ambiente válido ou credencial guardada),
`podeCriarChave`, `credentialSchemaAvailable` — nunca digest, fingerprint ou chave.

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

## Migração (aplicada)

Fonte única de registo: `sql/pending/0013_n8n_bridge_v1.sql` (não está em `drizzle/migrations` nem
em `supabase/migrations`; o caminho do ficheiro permanece estável porque os testes o referenciam).
**Já está aplicada em produção (2026-09-30 ~16:35 UTC) — não reaplicar.** Cria
`n8n_bridge_settings`, `n8n_bridge_sends`, `n8n_bridge_rate` e as RPCs `n8n_bridge_hit`,
`n8n_bridge_claim_send`, `n8n_bridge_finish_send` (SECURITY DEFINER, `search_path=''`, só
`service_role`; RLS ativo sem concessões a anon/authenticated).

### Migração 0014 (pendente)

`sql/pending/0014_n8n_bridge_credentials.sql` — aditiva, **não aplicada**. Cria
`n8n_bridge_credentials (organization_id PK/FK, key_sha256 CHECK ^[0-9a-f]{64}$, created_by,
created_at)`, RLS ativo, `REVOKE ALL` de PUBLIC/anon/authenticated, só `service_role`. Até ser
aplicada, a criação fica indisponível e a autenticação por BD falha fechada.

## Ativação manual (pendências, por esta ordem)

1. ~~Aplicar a migração.~~ **Feita** (2026-09-30; não repetir).
2. Aplicar 0014, fazer deploy e o administrador criar a chave no cartão (alternativa: secret
   `N8N_JORNADA_BRIDGE_TOKEN`); colar a chave numa credencial **dedicada** do n8n *Generic Auth → Bearer Auth* (`httpBearerAuth`).
   Não reutilizar a credencial *Header Auth* do GHL. — **Pendente** (os nós já usam Bearer Auth,
   mas a credencial não está configurada).
3. No cartão Integrações → “n8n — Confirmação de consultas”: agenda (`nPXR1Fyp0r3CpaMMGSki`) e
   morada já estão guardadas. Falta escolher o canal — o utilizador **ainda não escolheu
   WhatsApp**; `sms` fica bloqueado na v1 — e, se aplicável, o vendedor de reserva.
4. Deploy e verificação de uma leitura autenticada de ponta a ponta. — **Pendente** (nenhum
   cenário sintético conta como teste real).
5. `update n8n_bridge_settings set bridge_enabled=true` → testar leituras e `message.send` em simulação.
6. Só depois, com autorização explícita: escolha de canal, verificação do provedor
   (`channel_verified=true` por SQL), `simulation=false`, `live_send_enabled=true`.

## Exemplos (placeholders)

```bash
# Leitura de consulta
curl -X POST https://<dominio>/api/public/n8n/bridge \
  -H "Authorization: Bearer <N8N_JORNADA_BRIDGE_TOKEN>" -H "Content-Type: application/json" \
  -d '{"op":"appointment.get","appointmentId":"<APPOINTMENT_ID>"}'

# Envio (só depois de ativado e configurado)
curl -X POST https://<dominio>/api/public/n8n/bridge \
  -H "Authorization: Bearer <N8N_JORNADA_BRIDGE_TOKEN>" -H "Content-Type: application/json" \
  -d '{"op":"message.send","appointmentId":"<APPOINTMENT_ID>","contactId":"<CONTACT_ID>","expectedStartTime":"<ISO_START>","kind":"req24"}'
```

## Substituição dos 4 nós HTTP do n8n

> Estado: os 4 nós do rascunho `WrDn82MwKBcuM73G` já foram alterados para chamar esta ponte com
> estes corpos, sem redirecionamentos, sem repetição automática e com timeout 120000 ms. Falta
> apenas a credencial Bearer dedicada (passo 2 das pendências). 23 cenários sintéticos passaram;
> nenhum teste real de ponta a ponta foi feito.

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
