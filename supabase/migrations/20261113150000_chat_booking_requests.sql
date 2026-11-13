-- Durable command ledger for supervised booking of an existing CRM contact.
-- Does not activate providers, change integration settings, or create appointments remotely.
create table public.chat_booking_requests (
  organization_id uuid not null references public.organizations(id),
  request_id uuid not null,
  actor_id uuid not null references public.profiles(id),
  contact_id uuid not null references public.contacts(id),
  ghl_contact_id text not null,
  location_id text not null,
  calendar_id text not null,
  calendar_name text not null,
  timezone text not null,
  start_at timestamptz not null,
  end_at timestamptz not null check (end_at>start_at),
  notify boolean not null default false,
  dispatch_id uuid not null,
  input jsonb not null,
  state text not null check (state in ('pending','unknown','rejected','confirmed')),
  appointment_id text,
  cache_synced boolean not null default false,
  error_code text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (organization_id,request_id),
  check (not cache_synced or (state='confirmed' and appointment_id is not null)),
  check (state<>'confirmed' or appointment_id is not null)
);
create unique index chat_booking_single_slot on public.chat_booking_requests
  (organization_id,calendar_id,ghl_contact_id,start_at) where state<>'rejected';
alter table public.chat_booking_requests enable row level security;
revoke all on public.chat_booking_requests from public,anon,authenticated;
grant all on public.chat_booking_requests to service_role;

-- Cancels only a request that has not claimed a dispatch yet. A delayed HTTP handler
-- sees this tombstone under the same request lock and cannot create an appointment.
create table public.chat_booking_abandoned_requests (
  organization_id uuid not null references public.organizations(id),
  request_id uuid not null,
  actor_id uuid not null references public.profiles(id),
  ghl_contact_id text not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (organization_id,request_id)
);
alter table public.chat_booking_abandoned_requests enable row level security;
revoke all on public.chat_booking_abandoned_requests from public,anon,authenticated;
grant all on public.chat_booking_abandoned_requests to service_role;

create function public.chat_booking_snapshot(r public.chat_booking_requests)
returns jsonb language sql stable set search_path='' set timezone='UTC' as $$
  select jsonb_build_object('requestId',r.request_id,'ghlContactId',r.ghl_contact_id,
    'contactId',r.contact_id,'locationId',r.location_id,'calendarId',r.calendar_id,
    'calendarName',r.calendar_name,'timezone',r.timezone,'startAt',r.start_at,'endAt',r.end_at,
    'notify',r.notify,'dispatchId',r.dispatch_id,'state',r.state,
    'appointmentId',r.appointment_id,'cacheSynced',r.cache_synced,'errorCode',r.error_code)
$$;
revoke all on function public.chat_booking_snapshot(public.chat_booking_requests) from public,anon,authenticated;

create function public.chat_booking_command(_op text,_org uuid,_actor uuid,_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare r public.chat_booking_requests%rowtype; abandoned public.chat_booking_abandoned_requests%rowtype;
  rid uuid; dispatch uuid; cid uuid;
  starts timestamptz; ends timestamptz; canonical jsonb; target_state text; remote_id text;
  cached_id uuid; synced boolean; actor_name text; old_state text;
  uuid_pattern constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  provider_pattern constant text := '^[A-Za-z0-9_-]{1,100}$';
begin
  -- Even the service-only entrypoint must revalidate the actual actor's membership.
  if _org is null or _actor is null or not exists(select 1 from public.profiles p
    join public.user_roles u on u.user_id=p.id and u.organization_id=p.organization_id
    where p.id=_actor and p.organization_id=_org and u.role in ('administrador','gestor','comercial'))
    then return jsonb_build_object('error','forbidden'); end if;
  if _op not in ('read','claim','ack','finish','abandon') or _op is null
    or jsonb_typeof(_data) is distinct from 'object'
    or jsonb_typeof(_data->'requestId') is distinct from 'string'
    or coalesce(_data->>'requestId','')!~*uuid_pattern
    or jsonb_typeof(_data->'ghlContactId') is distinct from 'string'
    or coalesce(_data->>'ghlContactId','')!~provider_pattern
    then return jsonb_build_object('error','invalid_input'); end if;
  rid:=(_data->>'requestId')::uuid;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('chat-booking-request:'||_org::text||':'||rid::text,0));
  select * into r from public.chat_booking_requests where organization_id=_org and request_id=rid for update;
  if found and (r.actor_id<>_actor or r.ghl_contact_id<>_data->>'ghlContactId')
    then return jsonb_build_object('error','request_mismatch'); end if;
  select * into abandoned from public.chat_booking_abandoned_requests
    where organization_id=_org and request_id=rid for update;
  if found and (abandoned.actor_id<>_actor or abandoned.ghl_contact_id<>_data->>'ghlContactId')
    then return jsonb_build_object('error','request_mismatch'); end if;

  if _op in ('read','abandon') then
    if (_data-array['requestId','ghlContactId'])<>'{}'::jsonb
      then return jsonb_build_object('error','invalid_input'); end if;
    -- Never cancel/reclaim a real dispatch, even if it appears stale or its outcome is unknown.
    if r.request_id is not null then
      return jsonb_build_object('request',public.chat_booking_snapshot(r));
    end if;
    if abandoned.request_id is not null then return jsonb_build_object('request',null,'abandoned',true); end if;
    if _op='abandon' then
      if not exists(select 1 from public.ghl_location_bindings where organization_id=_org)
        or (select count(*) from public.contacts where organization_id=_org and ghl_contact_id=_data->>'ghlContactId' and not is_demo)<>1
        then return jsonb_build_object('error','contact_not_found'); end if;
      insert into public.chat_booking_abandoned_requests(organization_id,request_id,actor_id,ghl_contact_id)
        values(_org,rid,_actor,_data->>'ghlContactId');
      insert into public.audit_logs(organization_id,actor_id,action,entity,entity_id,metadata,verified)
        values(_org,_actor,'appointment.booking.abandoned','chat_booking_requests',rid::text,
          jsonb_build_object('request_id',rid,'provider_dispatch_claimed',false),true);
      return jsonb_build_object('request',null,'abandoned',true);
    end if;
    return jsonb_build_object('request',case when r.request_id is null then null else public.chat_booking_snapshot(r) end);
  end if;
  if abandoned.request_id is not null then return jsonb_build_object('error','request_abandoned'); end if;

  if jsonb_typeof(_data->'dispatchId') is distinct from 'string'
    or coalesce(_data->>'dispatchId','')!~*uuid_pattern
    then return jsonb_build_object('error','invalid_input'); end if;
  dispatch:=(_data->>'dispatchId')::uuid;

  if _op='claim' then
    if (_data-array['requestId','ghlContactId','contactId','locationId','calendarId','calendarName','timezone','startAt','endAt','notify','dispatchId'])<>'{}'::jsonb
      or jsonb_typeof(_data->'contactId') is distinct from 'string' or coalesce(_data->>'contactId','')!~*uuid_pattern
      or jsonb_typeof(_data->'locationId') is distinct from 'string' or coalesce(_data->>'locationId','')!~provider_pattern
      or jsonb_typeof(_data->'calendarId') is distinct from 'string' or coalesce(_data->>'calendarId','')!~provider_pattern
      or jsonb_typeof(_data->'calendarName') is distinct from 'string' or length(btrim(coalesce(_data->>'calendarName','')))=0 or length(_data->>'calendarName')>200
      or jsonb_typeof(_data->'timezone') is distinct from 'string' or length(coalesce(_data->>'timezone','')) not between 1 and 100
      or jsonb_typeof(_data->'notify') is distinct from 'boolean'
      or jsonb_typeof(_data->'startAt') is distinct from 'string' or coalesce(_data->>'startAt','')!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$'
      or jsonb_typeof(_data->'endAt') is distinct from 'string' or coalesce(_data->>'endAt','')!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$'
      then return jsonb_build_object('error','invalid_input'); end if;
    begin
      starts:=(_data->>'startAt')::timestamptz; ends:=(_data->>'endAt')::timestamptz;
    exception when invalid_datetime_format or datetime_field_overflow then
      return jsonb_build_object('error','invalid_input');
    end;
    if ends<=starts or ends-starts>interval '24 hours' then return jsonb_build_object('error','invalid_input'); end if;
    cid:=(_data->>'contactId')::uuid;
    canonical:=(_data-'dispatchId')||jsonb_build_object('startAt',starts,'endAt',ends);
    -- An existing request is never reclaimed, including unknown outcomes and changed flags.
    if r.request_id is not null then
      if r.input<>canonical then return jsonb_build_object('error','request_mismatch'); end if;
      return jsonb_build_object('request',public.chat_booking_snapshot(r),'claimed',false);
    end if;
    if starts<=clock_timestamp() then return jsonb_build_object('error','invalid_input'); end if;
    if not exists(select 1 from public.ghl_location_bindings b join public.ghl_connections g using(organization_id)
      join public.organizations o on o.id=b.organization_id
      where b.organization_id=_org and b.location_id=_data->>'locationId'
        and g.calendar_id=_data->>'calendarId' and o.timezone=_data->>'timezone' and g.status='conectada')
      then return jsonb_build_object('error','configuration_changed'); end if;
    if not exists(select 1 from public.ghl_connections where organization_id=_org and write_enabled)
      then return jsonb_build_object('error','write_disabled'); end if;
    perform 1 from public.contacts where id=cid and organization_id=_org
      and ghl_contact_id=_data->>'ghlContactId' and not is_demo for share;
    if not found then return jsonb_build_object('error','contact_not_found'); end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('chat-booking-slot:'||_org::text||':'||(_data->>'calendarId')||':'||(_data->>'ghlContactId')||':'||starts::text,0));
    if exists(select 1 from public.chat_booking_requests where organization_id=_org
      and calendar_id=_data->>'calendarId' and ghl_contact_id=_data->>'ghlContactId' and start_at=starts and state<>'rejected')
      then return jsonb_build_object('error','duplicate_slot'); end if;
    insert into public.chat_booking_requests(organization_id,request_id,actor_id,contact_id,ghl_contact_id,
      location_id,calendar_id,calendar_name,timezone,start_at,end_at,notify,dispatch_id,input,state)
      values(_org,rid,_actor,cid,_data->>'ghlContactId',_data->>'locationId',_data->>'calendarId',
        _data->>'calendarName',_data->>'timezone',starts,ends,(_data->>'notify')::boolean,dispatch,canonical,'pending') returning * into r;
    insert into public.audit_logs(organization_id,actor_id,action,entity,entity_id,metadata,verified)
      values(_org,_actor,'appointment.booking.claimed','chat_booking_requests',rid::text,
        jsonb_build_object('request_id',rid,'calendar_id',r.calendar_id,'notify',r.notify,'provider_created',false),true);
    return jsonb_build_object('request',public.chat_booking_snapshot(r),'claimed',true);
  end if;

  if r.request_id is null then return jsonb_build_object('error','not_found'); end if;
  if r.dispatch_id<>dispatch then return jsonb_build_object('error','request_mismatch'); end if;
  if _data ? 'appointmentId' and (jsonb_typeof(_data->'appointmentId') is distinct from 'string'
    or coalesce(_data->>'appointmentId','')!~provider_pattern)
    then return jsonb_build_object('error','invalid_input'); end if;
  remote_id:=coalesce(_data->>'appointmentId',r.appointment_id);
  if r.appointment_id is not null and remote_id<>r.appointment_id
    then return jsonb_build_object('error','request_mismatch'); end if;

  if _op='ack' then
    if (_data-array['requestId','ghlContactId','dispatchId','appointmentId'])<>'{}'::jsonb
      or remote_id is null then return jsonb_build_object('error','invalid_input'); end if;
    if r.state='rejected' then return jsonb_build_object('error','request_mismatch'); end if;
    if r.state<>'confirmed' then
      update public.chat_booking_requests set appointment_id=remote_id,state='unknown',updated_at=clock_timestamp()
        where organization_id=_org and request_id=rid returning * into r;
    end if;
    return jsonb_build_object('request',public.chat_booking_snapshot(r));
  end if;

  if (_data-array['requestId','ghlContactId','dispatchId','state','appointmentId','errorCode','rawStatus'])<>'{}'::jsonb
    or jsonb_typeof(_data->'state') is distinct from 'string' or (_data->>'state') not in ('unknown','rejected','confirmed')
    or (_data ? 'errorCode' and (jsonb_typeof(_data->'errorCode') is distinct from 'string'
      or coalesce(_data->>'errorCode','')!~'^[a-z][a-z0-9_]{0,79}$'))
    or (_data ? 'rawStatus' and (jsonb_typeof(_data->'rawStatus') is distinct from 'string'
      or (_data->>'rawStatus') not in ('new','confirmed','active')))
    then return jsonb_build_object('error','invalid_input'); end if;
  target_state:=_data->>'state';
  -- Unknown may carry a newly discovered ID, but confirmation requires a preceding durable ack.
  if target_state='confirmed' and (r.appointment_id is null or remote_id<>r.appointment_id)
    then return jsonb_build_object('error','request_mismatch'); end if;
  if (r.state='confirmed' and target_state<>'confirmed') or (r.state='rejected' and target_state<>'rejected')
    or (target_state='rejected' and r.appointment_id is not null)
    then return jsonb_build_object('error','request_mismatch'); end if;
  old_state:=r.state; synced:=r.cache_synced;
  if target_state='confirmed' and not synced then
    -- Keep the durable remote receipt even when a local cache conflict/failure needs repair.
    begin
      perform 1 from public.contacts where id=r.contact_id and organization_id=_org
        and ghl_contact_id=r.ghl_contact_id and not is_demo for share;
      if found then
        insert into public.appointments(organization_id,contact_id,ghl_appointment_id,ghl_calendar_id,
          title,start_at,end_at,status,is_demo)
          values(_org,r.contact_id,r.appointment_id,r.calendar_id,r.calendar_name,r.start_at,r.end_at,'confirmada',false)
          on conflict (organization_id,ghl_appointment_id) where ghl_appointment_id is not null
          do update set title=excluded.title,start_at=excluded.start_at,end_at=excluded.end_at,status=excluded.status
            where appointments.contact_id=excluded.contact_id and appointments.ghl_calendar_id=excluded.ghl_calendar_id
              and not appointments.is_demo
          returning id into cached_id;
        synced:=cached_id is not null;
      end if;
    exception when others then synced:=false;
    end;
  end if;
  update public.chat_booking_requests set state=target_state,appointment_id=remote_id,cache_synced=synced,
    error_code=case when target_state='confirmed' then null else _data->>'errorCode' end,updated_at=clock_timestamp()
    where organization_id=_org and request_id=rid returning * into r;
  if old_state<>target_state or target_state='confirmed' then
    -- One success audit per request even if a later read repairs the cache.
    if not exists(select 1 from public.audit_logs where organization_id=_org and entity='chat_booking_requests'
      and entity_id=rid::text and action='appointment.booking.'||target_state) then
      select p.full_name into actor_name from public.profiles p where p.id=_actor and p.organization_id=_org;
      insert into public.audit_logs(organization_id,actor_id,actor_name,action,entity,entity_id,metadata,verified)
        values(_org,_actor,actor_name,'appointment.booking.'||target_state,'chat_booking_requests',rid::text,
          jsonb_build_object('request_id',rid,'ghl_appointment_id',r.appointment_id,'cache_synced',r.cache_synced,
            'notify',r.notify,'patient_confirmation_verified',false),true);
    end if;
  end if;
  return jsonb_build_object('request',public.chat_booking_snapshot(r));
end $$;
revoke all on function public.chat_booking_command(text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.chat_booking_command(text,uuid,uuid,jsonb) to service_role;
