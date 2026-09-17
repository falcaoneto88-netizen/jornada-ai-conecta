-- Identidade consentida imutável, exclusão mútua durável por pessoa,
-- quota com valores já derivados por HMAC no servidor e espelho fiel do remoto.

create table if not exists public.site_lead_identities (
  submission_id uuid primary key references public.site_lead_submissions(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  integration_id uuid not null references public.site_integrations(id) on delete cascade,
  full_name text not null,
  phone text,
  phone_normalized text,
  email text,
  created_at timestamptz not null default now()
);
grant select on public.site_lead_identities to authenticated;
grant all on public.site_lead_identities to service_role;
alter table public.site_lead_identities enable row level security;
create policy site_lead_identities_leitura_org on public.site_lead_identities
  for select to authenticated using (organization_id = public.current_org_id());

create or replace function public.bloquear_alteracao_identidade_site()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception using errcode='42501', message='Identidade consentida é imutável.';
end $$;
create trigger site_lead_identities_imutavel before update on public.site_lead_identities
  for each row execute function public.bloquear_alteracao_identidade_site();

create table if not exists public.site_lead_execution_locks (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  scope text not null,
  identity_key text not null,
  submission_id uuid not null references public.site_lead_submissions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (organization_id, scope, identity_key)
);
grant all on public.site_lead_execution_locks to service_role;
alter table public.site_lead_execution_locks enable row level security;

-- Ingresso v2: quota por valores já derivados (HMAC no servidor) e identidade consentida guardada.
create function public.ingest_site_lead_v2(
  _source text, _request_id uuid, _payload_hash text, _full_name text,
  _phone text, _phone_normalized text, _email text,
  _consent_version text, _consent_at timestamptz,
  _quota_phone text, _quota_email text
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
  contagem integer;
  balde text;
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
  if coalesce(_payload_hash,'') !~ '^[a-f0-9]{64}$' or _request_id is null or coalesce(_full_name,'') = ''
    or coalesce(_quota_phone,'') !~ '^[a-f0-9]{64}$'
    or (_email is not null and coalesce(_quota_email,'') !~ '^[a-f0-9]{64}$') then
    raise exception using errcode='22023', message='Pedido inválido.';
  end if;

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

  janela := to_timestamp(floor(extract(epoch from now()) / 600) * 600);
  foreach balde in array array_remove(array['telefone:' || _quota_phone,
      case when _email is not null then 'email:' || _quota_email end], null)
  loop
    insert into public.site_lead_rate(integration_id, bucket, window_start, hits)
      values (integracao.id, balde, janela, 1)
      on conflict (integration_id, bucket, window_start)
        do update set hits = public.site_lead_rate.hits + 1
      returning hits into contagem;
    if contagem > 5 then
      raise exception using errcode='53400', message='Limite temporário de pedidos atingido.';
    end if;
  end loop;
  insert into public.site_lead_rate(integration_id, bucket, window_start, hits)
    values (integracao.id, 'integracao', janela, 1)
    on conflict (integration_id, bucket, window_start)
      do update set hits = public.site_lead_rate.hits + 1
    returning hits into contagem;
  if contagem > 60 then
    raise exception using errcode='53400', message='Limite temporário de pedidos atingido.';
  end if;

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

  insert into public.site_lead_identities(submission_id, organization_id, integration_id,
    full_name, phone, phone_normalized, email)
  values (recibo.id, integracao.organization_id, integracao.id,
    _full_name, _phone, _phone_normalized, lower(_email));

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
revoke all on function public.ingest_site_lead_v2(text,uuid,text,text,text,text,text,text,timestamptz,text,text)
  from public, anon, authenticated;
grant execute on function public.ingest_site_lead_v2(text,uuid,text,text,text,text,text,text,timestamptz,text,text)
  to service_role;

-- Reserva remota v2: identidade consentida, divergência para revisão e exclusão mútua por pessoa.
create function public.claim_site_lead_remote_v2(_submission uuid, _source text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.site_lead_submissions;
  i public.site_integrations;
  c public.contacts;
  ident public.site_lead_identities;
  chave text;
  dono uuid;
begin
  select * into s from public.site_lead_submissions where id = _submission for update;
  if not found then
    raise exception using errcode='22023', message='Recibo inexistente.';
  end if;
  select * into i from public.site_integrations where id = s.integration_id;
  if not found or i.source is distinct from _source or i.enabled is distinct from true
    or i.remote_write_state is distinct from 'habilitado' then
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

  select * into ident from public.site_lead_identities where submission_id = s.id;
  if not found then
    update public.site_lead_submissions set remote_state='bloqueado',
      remote_reason='identidade_consentida_ausente' where id = s.id;
    return jsonb_build_object('blocked', true, 'reason', 'identidade_consentida_ausente');
  end if;

  select * into c from public.contacts where id = s.contact_id;
  -- O consentimento é do formulário: divergência não se mescla nem se transfere.
  if coalesce(c.phone_normalized,'') is distinct from coalesce(ident.phone_normalized,'')
    or lower(coalesce(c.email,'')) is distinct from coalesce(ident.email,'') then
    update public.site_lead_submissions set status='em_revisao', local_state='em_revisao',
      review_reason='divergencia_com_identidade_consentida',
      remote_state='bloqueado', remote_reason='divergencia_com_identidade_consentida'
      where id = s.id;
    return jsonb_build_object('blocked', true, 'reason', 'divergencia_com_identidade_consentida');
  end if;

  chave := 'contacto:' || s.contact_id::text;
  insert into public.site_lead_execution_locks(organization_id, scope, identity_key, submission_id)
    values (s.organization_id, 'remote', chave, s.id)
    on conflict (organization_id, scope, identity_key) do nothing;
  select submission_id into dono from public.site_lead_execution_locks
    where organization_id = s.organization_id and scope = 'remote' and identity_key = chave;
  if dono is distinct from s.id then
    return jsonb_build_object('blocked', true, 'reason', 'execucao_em_curso_para_a_mesma_pessoa');
  end if;

  update public.site_lead_submissions
    set remote_state = 'a_processar', remote_attempted_at = now()
    where id = _submission;

  insert into public.audit_logs(organization_id,actor_id,actor_name,action,entity,entity_id,metadata,verified)
    values(s.organization_id, auth.uid(), 'Integração de site', 'site_lead.remote_intent',
      'site_lead_submission', s.id::text,
      jsonb_build_object('scope','remote','lock_key', chave), true);

  return jsonb_build_object('submission_id', s.id, 'organization_id', s.organization_id,
    'location_id', i.ghl_location_id, 'pipeline_id', i.ghl_pipeline_id, 'stage_id', i.ghl_stage_id,
    'contact_id', c.id, 'full_name', ident.full_name, 'phone', ident.phone,
    'phone_normalized', ident.phone_normalized, 'email', ident.email,
    'ghl_contact_id', c.ghl_contact_id, 'blocked', false);
end $$;
revoke all on function public.claim_site_lead_remote_v2(uuid,text) from public, anon, authenticated;
grant execute on function public.claim_site_lead_remote_v2(uuid,text) to service_role;

-- Conclusão remota v2: espelha só dados reais lidos no remoto e liberta a exclusão mútua.
create function public.finish_site_lead_remote_v2(
  _submission uuid, _state text, _reason text, _ghl_contact text, _ghl_opportunity text,
  _opp_name text, _opp_pipeline text, _opp_stage text, _opp_status text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.site_lead_submissions;
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
  if _state = 'confirmado' and (_ghl_contact is null or _ghl_opportunity is null) then
    raise exception using errcode='22023', message='Confirmação exige contacto e oportunidade reais.';
  end if;
  if _ghl_opportunity is not null and (_opp_pipeline is null or _opp_stage is null or _opp_status is null) then
    raise exception using errcode='22023', message='Oportunidade sem dados reais do GoHighLevel.';
  end if;

  select * into s from public.site_lead_submissions where id = _submission for update;
  if not found or s.remote_state is distinct from 'a_processar' then
    raise exception using errcode='42501', message='Recibo não está em processamento.';
  end if;

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
    values (s.organization_id, s.contact_id, _ghl_opportunity,
      coalesce(nullif(_opp_name,''), 'Oportunidade'), _opp_pipeline, _opp_stage, _opp_status, false)
    on conflict (organization_id, ghl_opportunity_id) where ghl_opportunity_id is not null
      do nothing;
  end if;

  delete from public.site_lead_execution_locks
    where organization_id = s.organization_id and scope = 'remote' and submission_id = s.id;

  insert into public.audit_logs(organization_id,actor_id,actor_name,action,entity,entity_id,metadata,verified)
    values(s.organization_id, auth.uid(), 'Integração de site', 'site_lead.remote_' || _state,
      'site_lead_submission', s.id::text,
      jsonb_build_object('remote_state', s.remote_state, 'reason', left(coalesce(_reason,''), 200),
        'has_contact', _ghl_contact is not null, 'has_opportunity', _ghl_opportunity is not null), true);

  return jsonb_build_object('submission_id', s.id, 'remote_state', s.remote_state,
    'ghl_contact_id', s.ghl_contact_id, 'ghl_opportunity_id', s.ghl_opportunity_id,
    'persisted', true);
end $$;
revoke all on function public.finish_site_lead_remote_v2(uuid,text,text,text,text,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.finish_site_lead_remote_v2(uuid,text,text,text,text,text,text,text,text)
  to service_role;

-- Acolhimento v2: identidade consentida, exclusão mútua por pessoa e origem esperada.
create function public.claim_site_lead_welcome_v2(_submission uuid, _source text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.site_lead_submissions;
  i public.site_integrations;
  c public.contacts;
  ident public.site_lead_identities;
  chave text;
  dono uuid;
begin
  select * into s from public.site_lead_submissions where id = _submission for update;
  if not found then
    raise exception using errcode='22023', message='Recibo inexistente.';
  end if;
  select * into i from public.site_integrations where id = s.integration_id;
  if not found or i.source is distinct from _source or i.enabled is distinct from true
    or i.welcome_channel_state is distinct from 'configurado' then
    raise exception using errcode='42501', message='Canal de acolhimento não configurado.';
  end if;
  if not exists (select 1 from public.ghl_connections
    where organization_id = s.organization_id and write_enabled = true) then
    raise exception using errcode='42501', message='Escrita no GoHighLevel desativada.';
  end if;
  if s.remote_state is distinct from 'confirmado' or s.ghl_contact_id is null then
    raise exception using errcode='42501', message='Contacto no GoHighLevel por confirmar.';
  end if;
  if s.consent_version is null or s.consent_at is null then
    raise exception using errcode='42501', message='Consentimento por documentar.';
  end if;
  if s.welcome_state is distinct from 'pendente' then
    raise exception using errcode='42501', message='Acolhimento já tentado ou bloqueado.';
  end if;

  select * into ident from public.site_lead_identities where submission_id = s.id;
  if not found then
    update public.site_lead_submissions set welcome_state='bloqueado',
      welcome_reason='identidade_consentida_ausente' where id = s.id;
    return jsonb_build_object('blocked', true, 'reason', 'identidade_consentida_ausente');
  end if;
  select * into c from public.contacts where id = s.contact_id;
  if coalesce(c.phone_normalized,'') is distinct from coalesce(ident.phone_normalized,'')
    or lower(coalesce(c.email,'')) is distinct from coalesce(ident.email,'') then
    update public.site_lead_submissions set welcome_state='bloqueado',
      welcome_reason='divergencia_com_identidade_consentida' where id = s.id;
    return jsonb_build_object('blocked', true, 'reason', 'divergencia_com_identidade_consentida');
  end if;

  chave := 'contacto:' || s.contact_id::text;
  insert into public.site_lead_execution_locks(organization_id, scope, identity_key, submission_id)
    values (s.organization_id, 'welcome', chave, s.id)
    on conflict (organization_id, scope, identity_key) do nothing;
  select submission_id into dono from public.site_lead_execution_locks
    where organization_id = s.organization_id and scope = 'welcome' and identity_key = chave;
  if dono is distinct from s.id then
    return jsonb_build_object('blocked', true, 'reason', 'acolhimento_em_curso_para_a_mesma_pessoa');
  end if;

  update public.site_lead_submissions set
    welcome_state = 'a_enviar',
    welcome_intent_at = now(),
    welcome_consent_version = s.consent_version
    where id = _submission;

  insert into public.audit_logs(organization_id,actor_id,actor_name,action,entity,entity_id,metadata,verified)
    values(s.organization_id, auth.uid(), 'Integração de site', 'site_lead.welcome_intent',
      'site_lead_submission', s.id::text,
      jsonb_build_object('consent_version', s.consent_version, 'consent_at', s.consent_at,
        'channel', 'sms_ghl'), true);

  return jsonb_build_object('submission_id', s.id, 'organization_id', s.organization_id,
    'ghl_contact_id', s.ghl_contact_id,
    'first_name', split_part(coalesce(ident.full_name,''), ' ', 1),
    'phone_normalized', ident.phone_normalized, 'email', ident.email,
    'consent_version', s.consent_version, 'blocked', false);
end $$;
revoke all on function public.claim_site_lead_welcome_v2(uuid,text) from public, anon, authenticated;
grant execute on function public.claim_site_lead_welcome_v2(uuid,text) to service_role;

create function public.finish_site_lead_welcome_v2(
  _submission uuid, _state text, _reason text, _message_id text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.site_lead_submissions;
begin
  if _state not in ('enviado','bloqueado') then
    raise exception using errcode='22023', message='Estado inválido.';
  end if;
  if _state = 'enviado' and coalesce(_message_id,'') !~ '^[A-Za-z0-9_-]{1,128}$' then
    raise exception using errcode='22023', message='Envio aceite exige identificador de mensagem.';
  end if;
  select * into s from public.site_lead_submissions where id = _submission for update;
  if not found or s.welcome_state is distinct from 'a_enviar' then
    raise exception using errcode='42501', message='Acolhimento não está em envio.';
  end if;
  update public.site_lead_submissions set
    welcome_state = _state,
    welcome_reason = left(coalesce(_reason,''), 200),
    welcome_message_id = _message_id,
    welcome_sent_at = case when _state = 'enviado' then now() else welcome_sent_at end
    where id = _submission
    returning * into s;
  delete from public.site_lead_execution_locks
    where organization_id = s.organization_id and scope = 'welcome' and submission_id = s.id;
  insert into public.audit_logs(organization_id,actor_id,actor_name,action,entity,entity_id,metadata,verified)
    values(s.organization_id, auth.uid(), 'Integração de site', 'site_lead.welcome_' || _state,
      'site_lead_submission', s.id::text,
      jsonb_build_object('reason', left(coalesce(_reason,''), 200),
        'has_message_id', _message_id is not null, 'delivered', false), true);
  return jsonb_build_object('submission_id', s.id, 'welcome_state', s.welcome_state,
    'welcome_message_id', s.welcome_message_id, 'delivered', false, 'persisted', true);
end $$;
revoke all on function public.finish_site_lead_welcome_v2(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.finish_site_lead_welcome_v2(uuid,text,text,text) to service_role;