-- Serialização do ingresso, limites de abuso, constantes fixas e processamento remoto auditado.

create table if not exists public.site_lead_rate (
  integration_id uuid not null references public.site_integrations(id) on delete cascade,
  bucket text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (integration_id, bucket, window_start)
);
grant all on public.site_lead_rate to service_role;
alter table public.site_lead_rate enable row level security;

alter table public.site_lead_submissions
  add column if not exists ghl_contact_id text,
  add column if not exists ghl_opportunity_id text,
  add column if not exists remote_reason text,
  add column if not exists remote_attempted_at timestamptz,
  add column if not exists welcome_reason text;

alter table public.site_lead_submissions drop constraint if exists site_lead_submissions_remoto;
alter table public.site_lead_submissions add constraint site_lead_submissions_remoto
  check (remote_state in ('pendente','a_processar','confirmado','bloqueado','enviado'));

create or replace function public.configure_site_integration(
  _organization_id uuid, _slug text, _source text, _stage_key text,
  _location_id text, _pipeline_id text, _stage_id text, _enabled boolean, _confirm boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  registo public.site_integrations;
begin
  if auth.uid() is null
    or not public.tem_papel(array['administrador']::public.app_role[])
    or public.current_org_id() is distinct from _organization_id then
    raise exception using errcode='42501', message='Acesso restrito ao administrador da organização.';
  end if;
  -- Valores fixos: nada aqui é escolhido pelo cliente.
  if _confirm is distinct from true
    or _slug is distinct from 'experiencia-falcao'
    or _source is distinct from 'experiencia-falcao'
    or _stage_key is distinct from 'novo_lead'
    or _location_id is distinct from 'ok2UHC2QMZsd8UHsAgEa'
    or _pipeline_id is distinct from '2QGyurvcmwhNhRgq0jCq'
    or _stage_id is distinct from 'c23ea507-33f5-41b6-933b-fd532ccbb773' then
    raise exception using errcode='22023', message='Configuração fixa inválida ou não confirmada.';
  end if;
  if not exists (select 1 from public.ghl_location_bindings
    where organization_id=_organization_id and location_id=_location_id) then
    raise exception using errcode='42501', message='Destino não autorizado.';
  end if;
  if not exists (select 1 from public.journey_stages
    where organization_id=_organization_id and key=_stage_key) then
    raise exception using errcode='22023', message='Etapa local inexistente.';
  end if;

  insert into public.site_integrations as si
    (organization_id, slug, source, enabled, local_stage_key, ghl_location_id, ghl_pipeline_id, ghl_stage_id)
  values (_organization_id, _slug, _source, coalesce(_enabled,false), _stage_key, _location_id, _pipeline_id, _stage_id)
  on conflict (organization_id, slug) do update set
    source = excluded.source,
    enabled = excluded.enabled,
    local_stage_key = excluded.local_stage_key,
    ghl_location_id = excluded.ghl_location_id,
    ghl_pipeline_id = excluded.ghl_pipeline_id,
    ghl_stage_id = excluded.ghl_stage_id
  where si.organization_id = _organization_id
  returning * into registo;

  insert into public.audit_logs(organization_id,actor_id,actor_name,action,entity,entity_id,metadata,verified)
    values(_organization_id, auth.uid(), 'Administrador', 'site_integration.configured',
      'site_integration', registo.id::text,
      jsonb_build_object('slug', registo.slug, 'enabled', registo.enabled), true);

  return jsonb_build_object('configured', true, 'enabled', registo.enabled, 'id', registo.id);
end $$;

create or replace function public.ingest_site_lead(
  _source text, _request_id uuid, _payload_hash text, _full_name text,
  _phone text, _phone_normalized text, _email text,
  _consent_version text, _consent_at timestamptz
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  integracao public.site_integrations;
  existente public.site_lead_submissions;
  correspondencias uuid[];
  alvo uuid;
  estado_local text;
  estado text;
  motivo text;
  recibo public.site_lead_submissions;
  janela timestamptz;
  identidade text;
  contagem integer;
begin
  select * into integracao from public.site_integrations
    where source = _source and enabled = true;
  if not found then
    raise exception using errcode='42501', message='Integração indisponível.';
  end if;
  if integracao.ghl_location_id is null or not exists (
    select 1 from public.ghl_location_bindings
      where organization_id = integracao.organization_id and location_id = integracao.ghl_location_id) then
    raise exception using errcode='42501', message='Destino não autorizado.';
  end if;
  if coalesce(_payload_hash,'') !~ '^[a-f0-9]{64}$' or _request_id is null or coalesce(_full_name,'') = '' then
    raise exception using errcode='22023', message='Pedido inválido.';
  end if;

  -- Serializa o mesmo pedido: o vencedor da corrida insere, os restantes leem o recibo.
  perform pg_advisory_xact_lock(
    hashtextextended('site_lead:' || integracao.id::text || ':' || _request_id::text, 0));

  select * into existente from public.site_lead_submissions
    where integration_id = integracao.id and request_id = _request_id;
  if found then
    if existente.payload_hash is distinct from _payload_hash then
      raise exception using errcode='23505', message='Pedido já registado com outros dados.';
    end if;
    return jsonb_build_object('receipt_id', existente.id, 'request_id', existente.request_id,
      'status', existente.status, 'local_state', existente.local_state,
      'remote_state', existente.remote_state, 'welcome_state', existente.welcome_state,
      'duplicate', true);
  end if;

  -- Limites de abuso: só pedidos novos consomem quota (reenvios já retornaram acima).
  janela := to_timestamp(floor(extract(epoch from now()) / 600) * 600);
  identidade := md5(integracao.id::text || ':' || coalesce(_phone_normalized,'')
    || ':' || lower(coalesce(_email,'')));
  insert into public.site_lead_rate(integration_id, bucket, window_start, hits)
    values (integracao.id, 'identidade:' || identidade, janela, 1)
    on conflict (integration_id, bucket, window_start)
      do update set hits = public.site_lead_rate.hits + 1
    returning hits into contagem;
  if contagem > 5 then
    raise exception using errcode='53400', message='Limite temporário de pedidos atingido.';
  end if;
  insert into public.site_lead_rate(integration_id, bucket, window_start, hits)
    values (integracao.id, 'integracao', janela, 1)
    on conflict (integration_id, bucket, window_start)
      do update set hits = public.site_lead_rate.hits + 1
    returning hits into contagem;
  if contagem > 60 then
    raise exception using errcode='53400', message='Limite temporário de pedidos atingido.';
  end if;

  -- Serializa por identidade normalizada: pedidos distintos da mesma pessoa não duplicam contacto.
  if _phone_normalized is not null and _phone_normalized <> '' then
    perform pg_advisory_xact_lock(
      hashtextextended('site_ident_tel:' || integracao.organization_id::text || ':' || _phone_normalized, 0));
  end if;
  if _email is not null and _email <> '' then
    perform pg_advisory_xact_lock(
      hashtextextended('site_ident_mail:' || integracao.organization_id::text || ':' || lower(_email), 0));
  end if;

  select coalesce(array_agg(distinct c.id), '{}') into correspondencias
    from public.contacts c
    where c.organization_id = integracao.organization_id
      and (
        (_phone_normalized is not null and c.phone_normalized = _phone_normalized)
        or (_email is not null and lower(c.email) = lower(_email))
      );

  if array_length(correspondencias, 1) is null then
    insert into public.contacts(organization_id, full_name, phone, phone_normalized, email,
      stage_key, tags, source, is_demo)
    values (integracao.organization_id, _full_name, _phone, _phone_normalized, _email,
      integracao.local_stage_key, array[]::text[], integracao.slug, false)
    returning id into alvo;
    estado_local := 'contacto_criado';
    estado := 'registado';
  elsif array_length(correspondencias, 1) = 1 then
    -- Não rebaixa etapa, não altera preferências de contacto nem mescla pessoas.
    alvo := correspondencias[1];
    estado_local := 'contacto_existente';
    estado := 'registado';
  else
    alvo := null;
    estado_local := 'em_revisao';
    estado := 'em_revisao';
    motivo := 'telefone_ou_email_correspondem_a_mais_de_um_contacto';
  end if;

  insert into public.site_lead_submissions(organization_id, integration_id, request_id, payload_hash,
    status, local_state, remote_state, welcome_state, contact_id, review_reason,
    consent_version, consent_at)
  values (integracao.organization_id, integracao.id, _request_id, _payload_hash,
    estado, estado_local, 'pendente', 'pendente', alvo, motivo, _consent_version, _consent_at)
  returning * into recibo;

  insert into public.audit_logs(organization_id,actor_id,actor_name,action,entity,entity_id,metadata,verified)
    values(integracao.organization_id, null, 'Integração de site', 'site_lead.received',
      'site_lead_submission', recibo.id::text,
      jsonb_build_object('slug', integracao.slug, 'status', recibo.status,
        'local_state', recibo.local_state, 'request_id', recibo.request_id), false);

  return jsonb_build_object('receipt_id', recibo.id, 'request_id', recibo.request_id,
    'status', recibo.status, 'local_state', recibo.local_state,
    'remote_state', recibo.remote_state, 'welcome_state', recibo.welcome_state,
    'duplicate', false);
end $$;

-- Reserva de um recibo para escrita remota: respeita write_enabled e estado da integração.
create function public.claim_site_lead_remote(_submission uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.site_lead_submissions;
  i public.site_integrations;
  c public.contacts;
begin
  select * into s from public.site_lead_submissions where id = _submission for update;
  if not found then
    raise exception using errcode='22023', message='Recibo inexistente.';
  end if;
  select * into i from public.site_integrations where id = s.integration_id;
  if not found or i.enabled is distinct from true or i.remote_write_state is distinct from 'habilitado' then
    raise exception using errcode='42501', message='Escrita remota não habilitada.';
  end if;
  if not exists (select 1 from public.ghl_connections
    where organization_id = s.organization_id and write_enabled = true) then
    raise exception using errcode='42501', message='Escrita no GoHighLevel desativada.';
  end if;
  if not exists (select 1 from public.ghl_location_bindings
    where organization_id = s.organization_id and location_id = i.ghl_location_id) then
    raise exception using errcode='42501', message='Destino não autorizado.';
  end if;
  if s.status is distinct from 'registado' or s.contact_id is null then
    raise exception using errcode='42501', message='Recibo em revisão.';
  end if;
  if s.remote_state is distinct from 'pendente' then
    raise exception using errcode='42501', message='Recibo já processado ou bloqueado.';
  end if;
  select * into c from public.contacts where id = s.contact_id;
  update public.site_lead_submissions
    set remote_state = 'a_processar', remote_attempted_at = now()
    where id = _submission;
  return jsonb_build_object('submission_id', s.id, 'organization_id', s.organization_id,
    'location_id', i.ghl_location_id, 'pipeline_id', i.ghl_pipeline_id, 'stage_id', i.ghl_stage_id,
    'contact_id', c.id, 'full_name', c.full_name, 'phone', c.phone,
    'phone_normalized', c.phone_normalized, 'email', c.email, 'ghl_contact_id', c.ghl_contact_id);
end $$;

-- Conclusão auditada: confirma IDs reais ou bloqueia para reconciliação manual.
create function public.finish_site_lead_remote(
  _submission uuid, _state text, _reason text, _ghl_contact text, _ghl_opportunity text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.site_lead_submissions;
  i public.site_integrations;
begin
  if _state not in ('confirmado','bloqueado') then
    raise exception using errcode='22023', message='Estado inválido.';
  end if;
  if _ghl_contact is not null and _ghl_contact !~ '^[A-Za-z0-9_-]{1,128}$' then
    raise exception using errcode='22023', message='Identificador remoto inválido.';
  end if;
  if _ghl_opportunity is not null and _ghl_opportunity !~ '^[A-Za-z0-9_-]{1,128}$' then
    raise exception using errcode='22023', message='Identificador remoto inválido.';
  end if;
  select * into s from public.site_lead_submissions where id = _submission for update;
  if not found or s.remote_state is distinct from 'a_processar' then
    raise exception using errcode='42501', message='Recibo não está em processamento.';
  end if;
  select * into i from public.site_integrations where id = s.integration_id;

  update public.site_lead_submissions set
    remote_state = _state,
    remote_reason = left(coalesce(_reason,''), 200),
    ghl_contact_id = coalesce(_ghl_contact, ghl_contact_id),
    ghl_opportunity_id = coalesce(_ghl_opportunity, ghl_opportunity_id)
    where id = _submission
    returning * into s;

  if _ghl_contact is not null and s.contact_id is not null then
    update public.contacts set ghl_contact_id = _ghl_contact
      where id = s.contact_id and organization_id = s.organization_id and ghl_contact_id is null;
  end if;

  if _ghl_opportunity is not null and s.contact_id is not null then
    insert into public.opportunities(organization_id, contact_id, ghl_opportunity_id, name,
      pipeline_id, stage_id, status, is_demo)
    values (s.organization_id, s.contact_id, _ghl_opportunity, 'Experiência Falcão',
      i.ghl_pipeline_id, i.ghl_stage_id, 'open', false)
    on conflict (organization_id, ghl_opportunity_id) where ghl_opportunity_id is not null
      do nothing;
  end if;

  insert into public.audit_logs(organization_id,actor_id,actor_name,action,entity,entity_id,metadata,verified)
    values(s.organization_id, auth.uid(), 'Integração de site', 'site_lead.remote_' || _state,
      'site_lead_submission', s.id::text,
      jsonb_build_object('remote_state', s.remote_state, 'reason', left(coalesce(_reason,''), 200),
        'has_contact', _ghl_contact is not null, 'has_opportunity', _ghl_opportunity is not null), true);

  return jsonb_build_object('submission_id', s.id, 'remote_state', s.remote_state,
    'ghl_contact_id', s.ghl_contact_id, 'ghl_opportunity_id', s.ghl_opportunity_id);
end $$;

revoke all on function public.claim_site_lead_remote(uuid) from public, anon, authenticated;
grant execute on function public.claim_site_lead_remote(uuid) to service_role;
revoke all on function public.finish_site_lead_remote(uuid,text,text,text,text) from public, anon, authenticated;
grant execute on function public.finish_site_lead_remote(uuid,text,text,text,text) to service_role;