-- Administrative figures attached to an existing CRM appointment. Not a payment ledger.
-- No changes to appointments, contacts, providers, messages or automation settings.
create table public.appointment_finances (
  organization_id uuid not null references public.organizations(id),
  appointment_id uuid not null references public.appointments(id),
  total_cents integer not null check (total_cents between 0 and 100000000),
  deposit_cents integer not null check (deposit_cents between 0 and total_cents),
  currency text not null default 'EUR' check (currency='EUR'),
  revision integer not null check (revision>0),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null references public.profiles(id),
  primary key (organization_id,appointment_id)
);

create table public.appointment_finance_requests (
  organization_id uuid not null references public.organizations(id),
  request_id uuid not null,
  appointment_id uuid not null references public.appointments(id),
  actor_id uuid not null references public.profiles(id),
  input jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (organization_id,request_id)
);

-- Defense in depth for the administrative overlay; writes must use the audited CAS command.
alter table public.appointment_finances enable row level security;
alter table public.appointment_finance_requests enable row level security;
revoke all on public.appointment_finances,public.appointment_finance_requests from public,anon,authenticated;
grant select on public.appointment_finances to authenticated;
grant all on public.appointment_finances,public.appointment_finance_requests to service_role;
create policy appointment_finances_read on public.appointment_finances for select to authenticated
  using (organization_id=public.current_org_id()
    and public.tem_papel(array['administrador'::public.app_role,'gestor'::public.app_role,'comercial'::public.app_role])
    and exists(select 1 from public.appointments a join public.contacts c on c.id=a.contact_id
      where a.id=appointment_id and a.organization_id=appointment_finances.organization_id
        and c.organization_id=a.organization_id and not a.is_demo and not c.is_demo
        and nullif(btrim(a.ghl_appointment_id),'') is not null
        and nullif(btrim(a.ghl_calendar_id),'') is not null
        and nullif(btrim(c.ghl_contact_id),'') is not null));

create function public.appointment_finance_validate_parent()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' and (new.organization_id is distinct from old.organization_id
    or new.appointment_id is distinct from old.appointment_id) then
    raise exception 'Administrative finance scope is immutable' using errcode='23514';
  end if;
  if not exists(select 1 from public.appointments a join public.contacts c on c.id=a.contact_id
    where a.id=new.appointment_id and a.organization_id=new.organization_id
      and c.organization_id=a.organization_id and not a.is_demo and not c.is_demo
      and nullif(btrim(a.ghl_appointment_id),'') is not null
      and nullif(btrim(a.ghl_calendar_id),'') is not null
      and nullif(btrim(c.ghl_contact_id),'') is not null) then
    raise exception 'Administrative finance requires an existing scoped CRM appointment' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function public.appointment_finance_validate_parent() from public,anon,authenticated;
create trigger appointment_finances_parent before insert or update on public.appointment_finances
  for each row execute function public.appointment_finance_validate_parent();
create trigger appointment_finance_requests_parent before insert or update on public.appointment_finance_requests
  for each row execute function public.appointment_finance_validate_parent();

create function public.appointment_finance_command(_op text,_org uuid,_actor uuid,_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare ids uuid[]; aid uuid; rid uuid; total integer; deposit integer; expected integer;
  existing public.appointment_finances%rowtype; replay public.appointment_finance_requests%rowtype;
  response jsonb; actor_name text;
begin
  if _org is null or _actor is null or not exists(select 1 from public.profiles p
    join public.user_roles r on r.user_id=p.id and r.organization_id=p.organization_id
    where p.id=_actor and p.organization_id=_org and r.role in ('administrador','gestor','comercial'))
    or not exists(select 1 from public.ghl_location_bindings where organization_id=_org)
    then return jsonb_build_object('error','forbidden'); end if;
  if jsonb_typeof(_data) is distinct from 'object' then return jsonb_build_object('error','invalid_input'); end if;

  if _op='read' then
    if (_data-'appointmentIds')<>'{}'::jsonb or jsonb_typeof(_data->'appointmentIds') is distinct from 'array'
      then return jsonb_build_object('error','invalid_input'); end if;
    if jsonb_array_length(_data->'appointmentIds')>200
      or exists(select 1 from jsonb_array_elements(_data->'appointmentIds') v
        where jsonb_typeof(v) is distinct from 'string' or (v#>>'{}')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
      then return jsonb_build_object('error','invalid_input'); end if;
    select coalesce(array_agg(distinct value::uuid),'{}'::uuid[]) into ids
      from jsonb_array_elements_text(_data->'appointmentIds');
    return jsonb_build_object('available',true,'canEdit',true,'entries',coalesce((
      select jsonb_agg(jsonb_build_object('appointmentId',f.appointment_id,'totalCents',f.total_cents,
        'depositCents',f.deposit_cents,'currency',f.currency,'revision',f.revision,
        'updatedAt',f.updated_at,'updatedBy',f.updated_by) order by f.appointment_id)
      from public.appointment_finances f join public.appointments a on a.id=f.appointment_id
        join public.contacts c on c.id=a.contact_id
      where f.organization_id=_org and a.organization_id=_org and c.organization_id=_org
        and f.appointment_id=any(ids) and not a.is_demo and not c.is_demo
        and nullif(btrim(a.ghl_appointment_id),'') is not null
        and nullif(btrim(a.ghl_calendar_id),'') is not null
        and nullif(btrim(c.ghl_contact_id),'') is not null),'[]'::jsonb));
  end if;
  if _op is distinct from 'save' then return jsonb_build_object('error','invalid_input'); end if;
  if (_data-array['appointmentId','requestId','totalCents','depositCents','expectedRevision'])<>'{}'::jsonb
    or jsonb_typeof(_data->'appointmentId') is distinct from 'string'
    or coalesce(_data->>'appointmentId','')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or jsonb_typeof(_data->'requestId') is distinct from 'string'
    or coalesce(_data->>'requestId','')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or jsonb_typeof(_data->'totalCents') is distinct from 'number'
    or coalesce(_data->>'totalCents','')!~'^(0|[1-9][0-9]{0,8})$'
    or jsonb_typeof(_data->'depositCents') is distinct from 'number'
    or coalesce(_data->>'depositCents','')!~'^(0|[1-9][0-9]{0,8})$'
    or jsonb_typeof(_data->'expectedRevision') is distinct from 'number'
    or coalesce(_data->>'expectedRevision','')!~'^(0|[1-9][0-9]{0,9})$'
    then return jsonb_build_object('error','invalid_input'); end if;
  if (_data->>'totalCents')::numeric>100000000 or (_data->>'depositCents')::numeric>(_data->>'totalCents')::numeric
    or (_data->>'expectedRevision')::numeric>2147483646 then return jsonb_build_object('error','invalid_input'); end if;
  aid:=(_data->>'appointmentId')::uuid; rid:=(_data->>'requestId')::uuid;
  total:=(_data->>'totalCents')::integer; deposit:=(_data->>'depositCents')::integer;
  expected:=(_data->>'expectedRevision')::integer;

  -- Fixed lock order serializes both a reused request and competing first saves of one appointment.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('appointment-finance-request:'||_org::text||':'||rid::text,0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('appointment-finance:'||_org::text||':'||aid::text,0));
  perform 1 from public.appointments a join public.contacts c on c.id=a.contact_id
    where a.id=aid and a.organization_id=_org and c.organization_id=_org
      and not a.is_demo and not c.is_demo and nullif(btrim(a.ghl_appointment_id),'') is not null
      and nullif(btrim(a.ghl_calendar_id),'') is not null and nullif(btrim(c.ghl_contact_id),'') is not null
    for share of a,c;
  if not found then return jsonb_build_object('error','appointment_not_found'); end if;

  select * into replay from public.appointment_finance_requests where organization_id=_org and request_id=rid;
  if found then
    if replay.actor_id<>_actor or replay.appointment_id<>aid or replay.input<>_data
      then return jsonb_build_object('error','request_mismatch'); end if;
    return replay.result;
  end if;
  select * into existing from public.appointment_finances where organization_id=_org and appointment_id=aid for update;
  if coalesce(existing.revision,0)<>expected then return jsonb_build_object('error','conflict'); end if;
  insert into public.appointment_finances(organization_id,appointment_id,total_cents,deposit_cents,revision,updated_by)
    values(_org,aid,total,deposit,expected+1,_actor)
    on conflict(organization_id,appointment_id) do update set total_cents=excluded.total_cents,
      deposit_cents=excluded.deposit_cents,revision=excluded.revision,updated_at=clock_timestamp(),updated_by=excluded.updated_by
    returning * into existing;
  response:=jsonb_build_object('entry',jsonb_build_object('appointmentId',existing.appointment_id,
    'totalCents',existing.total_cents,'depositCents',existing.deposit_cents,'currency',existing.currency,
    'revision',existing.revision,'updatedAt',existing.updated_at,'updatedBy',existing.updated_by));
  insert into public.appointment_finance_requests(organization_id,request_id,appointment_id,actor_id,input,result)
    values(_org,rid,aid,_actor,_data,response);
  select p.full_name into actor_name from public.profiles p where p.id=_actor and p.organization_id=_org;
  insert into public.audit_logs(organization_id,actor_id,actor_name,action,entity,entity_id,metadata,verified)
    values(_org,_actor,coalesce(actor_name,'Equipe'),'appointment.finance.saved','appointment_finances',aid::text,
      jsonb_build_object('revision',existing.revision,'request_id',rid,'source','administrative_entry','payment_verified',false,'ghl_modified',false),true);
  return response;
end $$;
revoke all on function public.appointment_finance_command(text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.appointment_finance_command(text,uuid,uuid,jsonb) to service_role;
