# Ponte Jornada AI → Ad Navigator — contrato de transporte v1

Somente **indicadores comerciais agregados**. Nunca nomes, telefones, emails, tags,
conversas, anexos, protocolos ou qualquer dado clínico. Nenhum segredo do Jornada
(token do GoHighLevel, credencial da Meta, bearer do recetor) sai desta aplicação.

`schema_version: 1`. Todas as respostas usam `Cache-Control: no-store`.

## 1. Pareamento (no Jornada)

Integrações → cartão **"Ad Navigator — indicadores"**, visível apenas ao
administrador autenticado da organização, resolvido no servidor por
`requireSupabaseAuth` + `resolverAcesso(..., ["administrador"])` e pelo vínculo
de location lido server-side.

O botão gera um código de uso único:

- 32 bytes aleatórios, `base64url`, prefixo `jpair_`;
- TTL de 10 minutos;
- mostrado **uma única vez** na interface, para colar no Ad Navigator já autenticado;
- no servidor guarda-se apenas o `SHA256` do código, junto com organização,
  emissor, location e funil resolvidos server-side. O código em claro nunca é
  persistido, registado, auditado, documentado nem exposto em MCP.

O mesmo cartão permite **revogar** pareamentos por consumir e concessões ativas;
a revogação é auditada e não depende de nenhuma credencial ou serviço externo.

## 2. `POST /api/ad-navigator/v1/exchange`

Corpo JSON estrito (exatamente estas três chaves, nada mais):

```json
{
  "code": "jpair_...",
  "receiver_tenant_id": "00000000-0000-4000-8000-000000000000",
  "credential_hash": "<64 hex minúsculos>"
}
```

O recetor gera o seu próprio bearer (32 bytes), guarda-o **cifrado no seu vault**
e envia apenas o `SHA256` desse bearer em `credential_hash`. O Jornada nunca
recebe nem emite o bearer.

Regras: `Content-Type: application/json`, corpo limitado a 2048 bytes, sem
seguir redirects, `no-store`, erros sanitizados (`pedido_invalido`,
`pareamento_invalido`, `demasiados_pedidos`), limite de abuso persistente por
janela com chave derivada (hash) — nunca IP nem PII.

O consumo é atómico numa transação (`SELECT ... FOR UPDATE` sobre o pareamento):
o código funciona exatamente uma vez. Expiração, repetição, corrida ou código
revogado são recusados. A troca revalida que o emissor continua administrador
real, que a organização existe e que location/funil/vínculo/ligação continuam a
coincidir e ativos. O código é uma **autorização temporária explícita** para o
`receiver_tenant_id` indicado; nunca se associa acesso por proprietário comum.

Sucesso — HTTP 200:

```json
{
  "schema_version": 1,
  "grant_id": "<uuid>",
  "organization_id": "<uuid>",
  "organization_name": "string",
  "location_id": "string",
  "pipeline_id": "string",
  "scope": "commercial_summary:read",
  "expires_at": "<ISO>"
}
```

A concessão expira em 90 dias e é revogável a qualquer momento no cartão.

## 3. `GET /api/ad-navigator/v1/summary`

Cabeçalho `Authorization: Bearer <token dedicado do recetor>`. **Sem query string
e sem corpo**: nenhum identificador de tenant, organização ou location é aceite
do cliente. O servidor calcula o `SHA256` do bearer e procura a concessão
internamente.

Em **cada** leitura revalida: concessão existente, não revogada e não expirada;
emissor ainda administrador da organização; integração, location e funil ainda
coincidentes; ligação ao GoHighLevel conectada. Falha fechada com
`credencial_invalida` / `autorizacao_indisponivel`.

Resposta HTTP 200:

```json
{
  "schema_version": 1,
  "snapshot_id": "string",
  "generated_at": "<ISO>",
  "grant_id": "<uuid>",
  "organization_id": "<uuid>",
  "location_id": "string",
  "pipeline_id": "string",
  "scope": "commercial_summary:read",
  "source": "jornada_local",
  "coverage": {
    "kind": "local_snapshot",
    "upstream_complete": false,
    "last_synced_at": "<ISO|null>",
    "latest_record_at": "<ISO|null>",
    "reason": "upstream_coverage_not_verified"
  },
  "counts": {
    "opportunities": 0,
    "linked_contacts": 0,
    "unlinked_opportunities": 0,
    "by_status": { "open": 0, "won": 0, "lost": 0, "abandoned": 0, "unknown": 0 },
    "by_stage": { "novo_lead": 0 }
  },
  "attribution": { "status": "unavailable", "reason": "campaign_link_not_available" },
  "revenue": { "value": null, "reason": "financial_source_not_connected" }
}
```

### Regras dos agregados

- Fonte: `opportunities` com `is_demo = false`, da organização e do funil
  vinculados à concessão. Sem qualquer `join` a contactos, conversas ou fichas
  clínicas — só colunas técnicas (`contact_id`, `status`, `stage_key`, datas).
- `linked_contacts` é `count(distinct contact_id)` **dentro destes registos**;
  não é o total de leads atribuídos.
- `unlinked_opportunities` conta oportunidades sem `contact_id`.
- Contagens calculadas no próprio Postgres, numa única leitura consistente, sem
  paginação nem limite de 1000 linhas do PostgREST.
- `by_status` traz sempre as cinco chaves. Estados desconhecidos somam em `unknown`.
- `by_stage` usa apenas esta allowlist; qualquer outra chave soma em `unknown`, e
  nunca é devolvido texto livre:
  `novo_lead, em_atendimento, consulta_agendada, consulta_confirmada,
  consulta_realizada, orcamento_enviado, procedimento_agendado, pos_procedimento,
  follow_up, reativacao, consulta_nao_paga, consulta_paga, nao_compareceu,
  follow_up_2, depoimento_indicacao, perdido_desqualificado,
  procedimento_realizado, unknown`.
- `snapshot_id` é o `SHA256` do conteúdo estável do snapshot em JSON canónico
  (chaves ordenadas), incluindo `coverage` (frescura) e as contagens, e
  **excluindo** `generated_at`. Duas leituras iguais devolvem o mesmo `snapshot_id`.
- `last_synced_at` é apenas metadado local de `ghl_connections`. **Não prova
  completude**: por isso `upstream_complete` é `false` nesta fase, sempre.
- `attribution` e `revenue` são explicitamente indisponíveis: não existe ligação
  a campanhas nem fonte financeira ligada.

## 4. `GET /api/version`

Identificador de release público: `service`, versões de API, `build` estático
desta revisão (`jornada-adnav-v1.1-20260918`, nunca nulo, serve de prova de
publicação) e `release` do ambiente quando existe. Não expõe ambiente, segredos
nem caminhos internos.

## 5. Segurança e base de dados

- Vínculo: a origem de verdade é a ligação real ao GoHighLevel da organização
  (`ghl_connections` + `ghl_location_bindings`, organização não-demo, `status`
  `conectada`, `location_id` e `default_pipeline_id` não vazios), resolvida pela
  função `ad_navigator_vinculo`. A integração de site **não** participa: mudar o
  funil padrão da ligação revoga efetivamente a leitura, mesmo que o site
  continue a apontar para o funil antigo. Criação, troca, resumo e revogação
  revalidam sempre organização, papel do emissor, vínculo e funil.
- Ordem única de travas em **todas** as operações (criar, trocar, ler, revogar),
  o que elimina impasses por ordem cruzada:
  1. trava consultiva por organização (serializa a organização);
  2. organização não-demo `FOR SHARE`;
  3. perfil do emissor `FOR SHARE`;
  4. papel de administrador `FOR SHARE`;
  5. ligação GoHighLevel `FOR SHARE` (exige `status = 'conectada'` **e**
     `mode = 'conectado'`) e depois o vínculo de location `FOR SHARE`;
  6. pareamento ou concessão `FOR UPDATE`.
  As autorizações são avaliadas **depois** da espera pela trava e ficam
  protegidas até ao commit: remover o papel do emissor ou trocar o funil padrão
  a meio de uma operação nunca escapa. A leitura toma a concessão em
  `FOR UPDATE` desde o início — escreve o contador na mesma transação, por isso
  duas leituras simultâneas nunca se bloqueiam mutuamente. Nenhum código novo
  escapa a uma revogação concorrente e a troca continua exatamente única.
- O resumo calcula totais, estados, etapas e frescura numa **única** consulta
  sobre uma CTE materializada: todos os números vêm da mesma versão dos dados.
- `ad_navigator_pairings`, `ad_navigator_grants`, `ad_navigator_rate_limits` e
  `ad_navigator_route_limits` têm todos os privilégios revogados a `PUBLIC`,
  `anon` e `authenticated`, com RLS ativa; só `service_role` e as funções
  autorizadas lhes tocam.
- Todas as funções são `SECURITY DEFINER` com `search_path = ''` e nomes
  totalmente qualificados.
- `ad_navigator_create_pairing`, `ad_navigator_state` e
  `ad_navigator_revoke_access`: executáveis por `authenticated`, mas validam
  `auth.uid()`, `current_org_id()` e `tem_papel(['administrador'])`.
- `ad_navigator_vinculo`, `ad_navigator_membro`,
  `ad_navigator_vinculo_travado`, `ad_navigator_exchange`, `ad_navigator_summary` e
  `ad_navigator_rate_hit_v2`: execução apenas para `service_role`.
- Limite de abuso: `ad_navigator_rate_hit_v2` avalia primeiro um **teto por
  rota** (600/minuto) e só depois o balde derivado do segredo apresentado
  (30/minuto). Chaves aleatórias não fazem a tabela crescer; a limpeza de linhas
  antigas é limitada a 200 por chamada. Nada de IP, cabeçalhos do cliente ou PII
  entra nesta contagem.
- Formatos exatos: código `jpair_` + 43 caracteres `base64url`; bearer com 43
  caracteres `base64url`; hashes em 64 hexadecimais minúsculos.
- O resumo recusa (500 sanitizado) qualquer agregado que não cumpra o contrato —
  contagens em falta, negativas, fracionadas, incoerentes com o total, etapas
  fora da allowlist ou identidades malformadas. Nunca se inventa zero.
- A RLS existente do projeto mantém-se intacta; não há chaves administrativas
  partilhadas com o recetor.
- Migrações: `0009_ad_navigator_bridge_v1_1_definitivo.sql` cria as tabelas e a
  primeira versão das funções; `0010_ad_navigator_locks_v1_2.sql` substitui as
  funções pela versão com a ordem de travas acima. O ficheiro
  `0008_ad_navigator_bridge_v1_1.sql` ficou com o texto da versão anterior,
  baseada no site, e não é usado.

## 6. Estado

Preparação entregue e testada localmente. **Não declarar a ponte "ligada"** antes
de verificar, em conjunto com o Ad Navigator: (1) uma troca real bem-sucedida,
(2) uma leitura autenticada do resumo e (3) a persistência confirmada do lado do
Ad Navigator. As rotas vivem em `/api/ad-navigator/v1/*`; se o alojamento
interpuser autenticação de site nesse prefixo, o acesso externo tem de ser
confirmado antes de considerar a ponte operacional.
