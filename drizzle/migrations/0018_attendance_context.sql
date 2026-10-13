-- Local attendance only. Reuse the single contacts.next_action/next_action_at pair.
-- No GHL mutation, calendar write, dispatch or automation is installed here.
alter table public.contacts
  add column attendance_owner_id uuid references public.profiles(id) on delete set null,
  add column attendance_version bigint not null default 0 check (attendance_version between 0 and 9007199254740991);
comment on column public.contacts.attendance_owner_id is 'Local responsible profile; not a GHL assignee, send permission, presence indicator or exclusive attendance lease.';

create function public.guard_attendance_context()
returns trigger language plpgsql set search_path='' as $$
declare changed boolean;
begin
  if new.attendance_owner_id is not null and not exists(
    select 1 from public.profiles where id=new.attendance_owner_id and organization_id=new.organization_id
  ) then raise exception 'attendance_owner_scope' using errcode='23514'; end if;
  if tg_op='INSERT' then
    if current_user in ('authenticated','anon') and
      (new.attendance_owner_id is not null or new.attendance_version<>0 or
       (not new.is_demo and (new.next_action is not null or new.next_action_at is not null))) then
      raise exception 'attendance_context_server_only' using errcode='42501';
    end if;
    return new;
  end if;
  changed:=new.attendance_owner_id is distinct from old.attendance_owner_id
    or new.next_action is distinct from old.next_action or new.next_action_at is distinct from old.next_action_at;
  if current_user in ('authenticated','anon') and (changed or new.attendance_version<>old.attendance_version) then
    raise exception 'attendance_context_server_only' using errcode='42501';
  end if;
  if changed then new.attendance_version:=old.attendance_version+1;
  else new.attendance_version:=old.attendance_version; end if;
  return new;
end $$;
revoke all on function public.guard_attendance_context() from public,anon,authenticated;
create trigger contacts_guard_attendance before insert or update on public.contacts
  for each row execute function public.guard_attendance_context();

create function public.attendance_context_command(
  _op text,_org uuid,_actor uuid,_contact text,_data jsonb default '{}'
) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.contacts%rowtype; actor_name text; zone text; editable boolean;
  desired_owner uuid; expected bigint; desired_text text; desired_due timestamptz; action text;
  stage jsonb; appointment jsonb; team jsonb; previous_version bigint;
begin
  if _actor is null or not exists(select 1 from public.profiles where id=_actor and organization_id=_org)
    or not exists(select 1 from public.user_roles where user_id=_actor and organization_id=_org
      and role in ('administrador','gestor','comercial','visualizador'))
    then return jsonb_build_object('error','forbidden'); end if;
  select exists(select 1 from public.user_roles where user_id=_actor and organization_id=_org
    and role in ('administrador','gestor','comercial')) into editable;
  if _op is null or _op not in ('read','save') or coalesce(_contact,'') !~ '^[A-Za-z0-9_-]{1,100}$'
    then return jsonb_build_object('error','invalid_input'); end if;
  if _op='save' and not editable then return jsonb_build_object('error','forbidden'); end if;
  select timezone into zone from public.organizations where id=_org for share;
  if _op='save' then
    select * into c from public.contacts where organization_id=_org and ghl_contact_id=_contact and not is_demo for update;
  else
    select * into c from public.contacts where organization_id=_org and ghl_contact_id=_contact and not is_demo;
  end if;
  if not found then return jsonb_build_object('error','contact_not_synced'); end if;
  if _op='save' then
    if _data is null or jsonb_typeof(_data)<>'object' or not (_data ?& array['ownerId','expectedVersion','returnAction','timezone'])
      or jsonb_typeof(_data->'expectedVersion')<>'number'
      or jsonb_typeof(_data->'ownerId') not in ('null','string')
      or coalesce(_data->>'returnAction','') not in ('keep','set','complete','clear')
      then return jsonb_build_object('error','invalid_input'); end if;
    begin
      expected:=(_data->>'expectedVersion')::bigint;
      desired_owner:=(_data->>'ownerId')::uuid;
    exception when others then return jsonb_build_object('error','invalid_input'); end;
    if expected<0 or expected>9007199254740991 or (expected::text)::numeric<>(_data->>'expectedVersion')::numeric
      then return jsonb_build_object('error','invalid_input'); end if;
    if c.attendance_version<>expected or zone is distinct from _data->>'timezone'
      then return jsonb_build_object('error','conflict'); end if;
    if desired_owner is not null and not exists(
      select 1 from public.profiles p join public.user_roles r on r.user_id=p.id and r.organization_id=p.organization_id
      where p.id=desired_owner and p.organization_id=_org and r.role in ('administrador','gestor','comercial')
    ) then return jsonb_build_object('error','invalid_input'); end if;
    action:=_data->>'returnAction';
    desired_text:=c.next_action; desired_due:=c.next_action_at;
    if action='set' then
      if jsonb_typeof(_data->'returnText') is distinct from 'string'
        or length(btrim(_data->>'returnText')) not between 1 and 500
        or coalesce(_data->>'dueAt','') !~ '^(20[0-9]{2}|2100)-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:00\.000Z$'
        then return jsonb_build_object('error','invalid_input'); end if;
      desired_text:=btrim(_data->>'returnText');
      begin desired_due:=(_data->>'dueAt')::timestamptz;
      exception when others then return jsonb_build_object('error','invalid_input'); end;
    elsif action in ('complete','clear') then
      if c.next_action is null and c.next_action_at is null then return jsonb_build_object('error','conflict'); end if;
      desired_text:=null; desired_due:=null;
    end if;
    if c.attendance_owner_id is distinct from desired_owner or c.next_action is distinct from desired_text
      or c.next_action_at is distinct from desired_due then
      previous_version:=c.attendance_version;
      update public.contacts set attendance_owner_id=desired_owner,next_action=desired_text,next_action_at=desired_due
        where id=c.id and organization_id=_org returning * into c;
      select full_name into actor_name from public.profiles where id=_actor and organization_id=_org;
      insert into public.audit_logs(organization_id,actor_id,actor_name,action,entity,entity_id,metadata,verified)
      values(_org,_actor,actor_name,'attendance.'||action,'contacts',c.id::text,
        jsonb_build_object('previousVersion',previous_version,'version',c.attendance_version,
          'ownerId',c.attendance_owner_id,'hasReturn',c.next_action is not null,'dueAt',c.next_action_at),true);
    end if;
  end if;
  select jsonb_build_object('key',s.key,'name',s.name) into stage from public.journey_stages s
    where s.organization_id=_org and s.key=c.stage_key;
  select jsonb_build_object('id',a.id,'title',a.title,'startAt',a.start_at,'endAt',a.end_at,'status',a.status,'updatedAt',a.updated_at)
    into appointment from public.appointments a where a.organization_id=_org and a.contact_id=c.id and not a.is_demo
      and a.start_at>=statement_timestamp() and a.status in ('pendente','confirmada','new','booked','confirmed')
    order by a.start_at,a.id limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',coalesce(nullif(btrim(p.full_name),''),'Membro da equipe'))
    order by p.full_name nulls last,p.id),'[]'::jsonb) into team from public.profiles p
    where p.organization_id=_org and exists(select 1 from public.user_roles r where r.user_id=p.id
      and r.organization_id=_org and r.role in ('administrador','gestor','comercial'));
  return jsonb_build_object('organizationId',_org,'timezone',zone,'canEdit',editable,'checkedAt',clock_timestamp(),
    'contact',jsonb_build_object('id',c.id,'ghlContactId',c.ghl_contact_id,'name',c.full_name,'phone',c.phone,'email',c.email,'updatedAt',c.updated_at),
    'stage',stage,'nextAppointment',appointment,'team',team,
    'attendance',jsonb_build_object('version',c.attendance_version,'ownerId',c.attendance_owner_id,
      'nextAction',c.next_action,'nextActionAt',c.next_action_at));
end $$;
revoke all on function public.attendance_context_command(text,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.attendance_context_command(text,uuid,uuid,text,jsonb) to service_role;