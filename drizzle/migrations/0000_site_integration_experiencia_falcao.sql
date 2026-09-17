begin;

-- Integração de captação por site próprio (origem verificada no servidor).
create table public.site_integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  slug text not null,
  source text not null,
  enabled boolean not null default false,
  local_stage_key text not null default 'novo_lead',
  ghl_location_id text,
  ghl_pipeline_id text,
  ghl_stage_id text,
  remote_write_state text not null default 'pendente',
  welcome_channel_state text not null default 'pendente',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint site_integrations_slug_unico unique (organization_id, slug),
  constraint site_integrations_source_unico unique (source),
  constraint site_integrations_source_formato check (source ~ '^[a-z0-9-]{3,64}$'),
  constraint site_integrations_remote_estado check (remote_write_state in ('pendente','habilitado','bloqueado')),
  constraint site_integrations_canal_estado check (welcome_channel_state in ('pendente','configurado'))
);

grant select on public.site_integrations to authenticated;
grant all on public.site_integrations to service_role;
alter table public.site_integrations enable row level security;

create policy site_integrations_leitura_org on public.site_integrations
  for select to authenticated using (organization_id = public.current_org_id());

create trigger site_integrations_updated_at before update on public.site_integrations
  for each row execute function public.update_updated_at_column();

-- Recibos de leads recebidos: sem cópia de dados pessoais.
create table public.site_lead_submissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  integration_id uuid not null references public.site_integrations(id) on delete cascade,
  request_id uuid not null,
  payload_hash text not null,
  status text not null,
  local_state text not null,
  remote_state text not null default 'pendente',
  welcome_state text not null default 'pendente',
  contact_id uuid references public.contacts(id) on delete set null,
  review_reason text,
  consent_version text not null,
  consent_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint site_lead_submissions_pedido_unico unique (integration_id, request_id),
  constraint site_lead_submissions_status check (status in ('registado','em_revisao')),
  constraint site_lead_submissions_local check (local_state in ('contacto_criado','contacto_existente','em_revisao')),
  constraint site_lead_submissions_remoto check (remote_state in ('pendente','bloqueado','enviado')),
  constraint site_lead_submissions_acolhimento check (welcome_state in ('pendente','preparado','enviado'))
);

create index site_lead_submissions_org_data on public.site_lead_submissions (organization_id, created_at desc);

grant select on public.site_lead_submissions to authenticated;
grant all on public.site_lead_submissions to service_role;
alter table public.site_lead_submissions enable row level security;

create policy site_lead_submissions_leitura_org on public.site_lead_submissions
  for select to authenticated using (organization_id = public.current_org_id());

create trigger site_lead_submissions_updated_at before update on public.site_lead_submissions
  for each row execute function public.update_updated_at_column();

-- Configuração administrativa: valida binding, funil e etapa antes de ativar.
create function public.configure_site_integration(
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
  if _confirm is distinct from true
    or coalesce(_slug,'') !~ '^[a-z0-9-]{3,64}$'
    or coalesce(_source,'') !~ '^[a-z0-9-]{3,64}$'
    or coalesce(_stage_key,'') !~ '^[a-z0-9_]{2,40}$'
    or coalesce(_location_id,'') !~ '^[A-Za-z0-9_-]{1,128}$'
    or coalesce(_pipeline_id,'') !~ '^[A-Za-z0-9_-]{1,128}$'
    or coalesce(_stage_id,'') !~ '^[A-Za-z0-9_-]{1,128}$' then
    raise exception using errcode='22023', message='Configuração inválida ou não confirmada.';
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
revoke all on function public.configure_site_integration(uuid,text,text,text,text,text,text,boolean,boolean) from public, anon, authenticated;
grant execute on function public.configure_site_integration(uuid,text,text,text,text,text,text,boolean,boolean) to authenticated;

-- Ingresso transacional do lead consentido. Só o servidor (service_role) executa.
create function public.ingest_site_lead(
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
  on conflict (integration_id, request_id) do nothing
  returning * into recibo;

  if recibo.id is null then
    -- Corrida: outro pedido idêntico ganhou a inserção.
    select * into existente from public.site_lead_submissions
      where integration_id = integracao.id and request_id = _request_id;
    if existente.payload_hash is distinct from _payload_hash then
      raise exception using errcode='23505', message='Pedido já registado com outros dados.';
    end if;
    return jsonb_build_object('receipt_id', existente.id, 'request_id', existente.request_id,
      'status', existente.status, 'local_state', existente.local_state,
      'remote_state', existente.remote_state, 'welcome_state', existente.welcome_state,
      'duplicate', true);
  end if;

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
revoke all on function public.ingest_site_lead(text,uuid,text,text,text,text,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.ingest_site_lead(text,uuid,text,text,text,text,text,text,timestamptz) to service_role;

commit;