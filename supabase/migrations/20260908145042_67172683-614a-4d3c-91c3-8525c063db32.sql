alter table public.contacts
  add column if not exists ghl_synced_version text,
  add column if not exists ghl_synced_at timestamptz;

create or replace function public.ghl_claim_delivery(
  _org uuid,
  _location text,
  _key text,
  _event_type text,
  _event_id text,
  _source_version text,
  _payload jsonb,
  _ghl_contact_id text,
  _content_fallback boolean,
  _lock_timeout_seconds integer default 120
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_bound uuid;
  v_id uuid;
  v_row public.webhooks_inbox%rowtype;
  v_applied text;
begin
  select organization_id into v_bound from public.ghl_location_bindings where location_id = _location;
  if v_bound is null or v_bound <> _org then
    return jsonb_build_object('outcome', 'mismatch');
  end if;

  insert into public.webhooks_inbox (
    organization_id, idempotency_key, event_type, event_id, location_id,
    source_version, payload, signature_valid, status, attempts, locked_at
  ) values (
    _org, _key, _event_type, _event_id, _location,
    _source_version, coalesce(_payload, '{}'::jsonb), true, 'a_processar', 1, now()
  )
  on conflict (idempotency_key) do nothing
  returning id into v_id;

  if v_id is not null then
    return jsonb_build_object('outcome', 'claimed', 'inbox_id', v_id, 'fence', 1);
  end if;

  select * into v_row from public.webhooks_inbox where idempotency_key = _key for update;
  if not found then
    return jsonb_build_object('outcome', 'mismatch');
  end if;
  if v_row.organization_id is distinct from _org then
    return jsonb_build_object('outcome', 'mismatch');
  end if;

  if v_row.processed_at is not null or v_row.status = 'processado' then
    if coalesce(_content_fallback, false) and _ghl_contact_id is not null then
      select ghl_synced_version into v_applied
      from public.contacts
      where organization_id = _org and ghl_contact_id = _ghl_contact_id;
      if v_applied is distinct from _source_version then
        update public.webhooks_inbox set
          status = 'a_processar',
          attempts = v_row.attempts + 1,
          locked_at = now(),
          processed_at = null,
          error_message = null,
          source_version = _source_version
        where id = v_row.id;
        return jsonb_build_object('outcome', 'claimed', 'inbox_id', v_row.id, 'fence', v_row.attempts + 1);
      end if;
    end if;
    return jsonb_build_object('outcome', 'duplicate', 'inbox_id', v_row.id);
  end if;

  if v_row.status = 'a_processar'
     and v_row.locked_at is not null
     and v_row.locked_at > now() - make_interval(secs => coalesce(_lock_timeout_seconds, 120)) then
    return jsonb_build_object('outcome', 'in_flight', 'inbox_id', v_row.id);
  end if;

  update public.webhooks_inbox set
    status = 'a_processar',
    attempts = v_row.attempts + 1,
    locked_at = now(),
    processed_at = null,
    source_version = _source_version
  where id = v_row.id;
  return jsonb_build_object('outcome', 'claimed', 'inbox_id', v_row.id, 'fence', v_row.attempts + 1);
end;
$$;

create or replace function public.ghl_apply_contact_event_v2(
  _inbox_id uuid,
  _fence integer,
  _org uuid,
  _ghl_contact_id text,
  _full_name text,
  _phone text,
  _phone_normalized text,
  _email text,
  _tags text[],
  _source text,
  _last_interaction timestamptz,
  _event_type text,
  _source_version text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row public.webhooks_inbox%rowtype;
  v_contact_id uuid;
  v_synced_at timestamptz;
  v_created boolean := false;
  v_stage text;
  v_phone_norm text := _phone_normalized;
  v_conflict uuid;
begin
  select * into v_row from public.webhooks_inbox where id = _inbox_id for update;
  if not found then
    return jsonb_build_object('estado', 'entrega_inexistente');
  end if;
  if v_row.organization_id is distinct from _org then
    return jsonb_build_object('estado', 'organizacao_divergente');
  end if;
  if v_row.processed_at is not null or v_row.status = 'processado' then
    return jsonb_build_object('estado', 'ja_processado', 'contact_id', v_row.contact_id, 'created', false);
  end if;
  if v_row.status <> 'a_processar' or v_row.attempts is distinct from _fence then
    return jsonb_build_object('estado', 'reserva_expirada');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(_org::text || ':' || coalesce(_ghl_contact_id, ''), 0));

  select id, ghl_synced_at into v_contact_id, v_synced_at
  from public.contacts
  where organization_id = _org and ghl_contact_id = _ghl_contact_id;

  if v_contact_id is not null
     and _last_interaction is not null
     and v_synced_at is not null
     and _last_interaction < v_synced_at then
    update public.webhooks_inbox set
      status = 'processado',
      processed_at = now(),
      error_message = null,
      locked_at = null,
      contact_id = v_contact_id,
      source_version = coalesce(_source_version, source_version)
    where id = _inbox_id and attempts = _fence;
    return jsonb_build_object('estado', 'versao_antiga_ignorada', 'contact_id', v_contact_id, 'created', false);
  end if;

  if v_phone_norm is not null then
    select id into v_conflict
    from public.contacts
    where organization_id = _org
      and phone_normalized = v_phone_norm
      and (v_contact_id is null or id <> v_contact_id)
    limit 1;
    if v_conflict is not null then
      v_phone_norm := null;
    end if;
  end if;

  if v_contact_id is null then
    select key into v_stage
    from public.journey_stages
    where organization_id = _org
    order by position asc
    limit 1;

    insert into public.contacts (
      organization_id, ghl_contact_id, full_name, phone, phone_normalized,
      email, tags, source, stage_key, last_interaction_at, is_demo,
      ghl_synced_version, ghl_synced_at
    ) values (
      _org, _ghl_contact_id, _full_name, _phone, v_phone_norm,
      _email, coalesce(_tags, '{}'::text[]), _source,
      coalesce(v_stage, 'novo_lead'), _last_interaction, false,
      _source_version, coalesce(_last_interaction, now())
    )
    returning id into v_contact_id;
    v_created := true;
  else
    update public.contacts set
      full_name = _full_name,
      phone = _phone,
      phone_normalized = v_phone_norm,
      email = _email,
      tags = coalesce(_tags, '{}'::text[]),
      source = coalesce(_source, source),
      last_interaction_at = coalesce(_last_interaction, last_interaction_at),
      is_demo = false,
      ghl_synced_version = _source_version,
      ghl_synced_at = coalesce(_last_interaction, now())
    where id = v_contact_id;
  end if;

  insert into public.audit_logs (organization_id, actor_name, action, entity, entity_id, metadata)
  values (
    _org, 'GoHighLevel (webhook)',
    case when v_created then 'ghl.webhook.contacto_criado' else 'ghl.webhook.contacto_atualizado' end,
    'contact', v_contact_id::text,
    jsonb_build_object('event_type', _event_type, 'ghl_contact_id', _ghl_contact_id, 'source_version', _source_version)
  );

  update public.webhooks_inbox set
    status = 'processado',
    processed_at = now(),
    error_message = null,
    locked_at = null,
    contact_id = v_contact_id,
    source_version = coalesce(_source_version, source_version)
  where id = _inbox_id and attempts = _fence;

  return jsonb_build_object('estado', 'processado', 'contact_id', v_contact_id, 'created', v_created);
end;
$$;

create or replace function public.ghl_mark_delivery_failed(
  _inbox_id uuid,
  _fence integer,
  _org uuid,
  _message text
) returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_updated integer;
begin
  update public.webhooks_inbox set
    status = 'falhado',
    error_message = left(coalesce(_message, 'erro desconhecido'), 500),
    locked_at = null
  where id = _inbox_id
    and organization_id = _org
    and attempts = _fence
    and status = 'a_processar'
    and processed_at is null;
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

create or replace function public.ghl_record_failed_receive(
  _org uuid,
  _location text,
  _key text,
  _event_type text,
  _event_id text,
  _payload jsonb,
  _message text
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_bound uuid;
  v_id uuid;
begin
  select organization_id into v_bound from public.ghl_location_bindings where location_id = _location;
  if v_bound is null or v_bound <> _org then
    return null;
  end if;

  insert into public.webhooks_inbox (
    organization_id, idempotency_key, event_type, event_id, location_id,
    payload, signature_valid, status, attempts, error_message, locked_at
  ) values (
    _org, _key, _event_type, _event_id, _location,
    coalesce(_payload, '{}'::jsonb), true, 'falhado', 1,
    left(coalesce(_message, 'erro desconhecido'), 500), null
  )
  on conflict (idempotency_key) do update set
    status = case when public.webhooks_inbox.processed_at is null then 'falhado' else public.webhooks_inbox.status end,
    error_message = case when public.webhooks_inbox.processed_at is null
      then left(coalesce(_message, 'erro desconhecido'), 500) else public.webhooks_inbox.error_message end,
    attempts = public.webhooks_inbox.attempts + 1,
    locked_at = null
  where public.webhooks_inbox.organization_id = _org
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.ghl_claim_delivery(uuid, text, text, text, text, text, jsonb, text, boolean, integer) from public, anon, authenticated;
revoke all on function public.ghl_apply_contact_event_v2(uuid, integer, uuid, text, text, text, text, text, text[], text, timestamptz, text, text) from public, anon, authenticated;
revoke all on function public.ghl_mark_delivery_failed(uuid, integer, uuid, text) from public, anon, authenticated;
revoke all on function public.ghl_record_failed_receive(uuid, text, text, text, text, jsonb, text) from public, anon, authenticated;

grant execute on function public.ghl_claim_delivery(uuid, text, text, text, text, text, jsonb, text, boolean, integer) to service_role;
grant execute on function public.ghl_apply_contact_event_v2(uuid, integer, uuid, text, text, text, text, text, text[], text, timestamptz, text, text) to service_role;
grant execute on function public.ghl_mark_delivery_failed(uuid, integer, uuid, text) to service_role;
grant execute on function public.ghl_record_failed_receive(uuid, text, text, text, text, jsonb, text) to service_role;

revoke all on function public.ghl_apply_contact_event(uuid, uuid, text, text, text, text, text, text[], text, timestamptz, text, text) from public, anon, authenticated, service_role;