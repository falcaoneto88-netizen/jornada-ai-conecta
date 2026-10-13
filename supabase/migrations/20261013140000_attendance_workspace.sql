-- Read-only local workspace. No new task table, GHL write, message or automation.
-- Counts and the selected page share one PostgreSQL statement snapshot.
begin;
create function public.attendance_workspace_read(
  _org uuid,_actor uuid,_owner text default 'mine',_view text default 'all',
  _page integer default 0,_size integer default 25,_at timestamptz default statement_timestamp()
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare zone text; local_day date; day_start timestamptz; day_end timestamptz; result jsonb;
begin
  if _actor is null or not exists(select 1 from public.profiles p join public.user_roles r
    on r.user_id=p.id and r.organization_id=p.organization_id where p.id=_actor and p.organization_id=_org
    and r.role in ('administrador','gestor','comercial','visualizador')) then return jsonb_build_object('error','forbidden'); end if;
  if _owner is null or _owner not in ('mine','all','unassigned') or _view is null
    or _view not in ('all','returns_today','overdue','appointments_today')
    or _page is null or _page not between 0 and 100000 or _size is null or _size not in (25,50)
    or _at is null or not isfinite(_at) then return jsonb_build_object('error','invalid_input'); end if;
  select timezone into zone from public.organizations where id=_org;
  local_day:=(_at at time zone zone)::date;
  day_start:=local_day::timestamp at time zone zone;
  day_end:=(local_day+1)::timestamp at time zone zone;
  with eligible as materialized (
    select c.id,c.ghl_contact_id,c.full_name,c.attendance_owner_id,c.next_action,c.next_action_at,c.updated_at,
      p.full_name as owner_name
    from public.contacts c left join public.profiles p on p.id=c.attendance_owner_id and p.organization_id=_org
    where c.organization_id=_org and not c.is_demo and c.ghl_contact_id ~ '^[A-Za-z0-9_-]{1,100}$'
      and (_owner='all' or (_owner='mine' and c.attendance_owner_id=_actor) or (_owner='unassigned' and c.attendance_owner_id is null))
  ), returns as materialized (
    select c.* from eligible c where c.next_action is not null and btrim(c.next_action)<>'' and c.next_action_at is not null
  ), appointments as materialized (
    select a.id,a.title,a.status,a.start_at,a.updated_at,a.ghl_appointment_id,c.id as contact_id,c.ghl_contact_id,c.full_name,c.attendance_owner_id,c.owner_name
    from public.appointments a join eligible c on c.id=a.contact_id
    where a.organization_id=_org and not a.is_demo and a.start_at>=day_start and a.start_at<day_end
      and a.status in ('pendente','confirmada','new','booked','confirmed')
  ), items as (
    select 'return:'||c.id::text as id,case when c.next_action_at<_at then 0 else 1 end as rank,c.next_action_at as due,
      jsonb_build_object('id','return:'||c.id::text,'kind','return',
        'reason',case when c.next_action_at<_at then 'return_overdue' else 'return_today' end,
        'contact',jsonb_build_object('id',c.id,'ghlContactId',c.ghl_contact_id,'name',c.full_name),
        'owner',case when c.attendance_owner_id is null then null else jsonb_build_object('id',c.attendance_owner_id,'name',coalesce(nullif(btrim(c.owner_name),''),'Membro da equipe')) end,
        'dueAt',c.next_action_at,'nextAction',c.next_action,'appointment',null,
        'evidence',jsonb_build_object('source','jornada','updatedAt',c.updated_at)) as item
    from returns c where
      (_view='all' and c.next_action_at<day_end)
      or (_view='returns_today' and c.next_action_at>=day_start and c.next_action_at<day_end)
      or (_view='overdue' and c.next_action_at<_at)
    union all
    select 'appointment:'||a.id::text,2,a.start_at,
      jsonb_build_object('id','appointment:'||a.id::text,'kind','appointment','reason','appointment_today',
        'contact',jsonb_build_object('id',a.contact_id,'ghlContactId',a.ghl_contact_id,'name',a.full_name),
        'owner',case when a.attendance_owner_id is null then null else jsonb_build_object('id',a.attendance_owner_id,'name',coalesce(nullif(btrim(a.owner_name),''),'Membro da equipe')) end,
        'dueAt',a.start_at,'nextAction',null,'appointment',jsonb_build_object('id',a.id,'title',a.title,'status',a.status),
        'evidence',jsonb_build_object('source',case when a.ghl_appointment_id is not null then 'ghl_cache' else 'jornada' end,'updatedAt',a.updated_at))
    from appointments a where _view in ('all','appointments_today')
  ), page_items as (
    select * from items order by rank,due,id offset (_page::bigint*_size) limit _size
  ) select jsonb_build_object(
    'organizationId',_org,'timezone',zone,'checkedAt',_at,
    'day',jsonb_build_object('date',local_day::text,'startAt',day_start,'endAt',day_end),
    'source',jsonb_build_object('kind','local','coverage','linked_contacts','lastContactSyncAt',(select last_sync_at from public.ghl_connections where organization_id=_org)),
    'counts',jsonb_build_object('awaitingResponse',null,
      'returnsToday',(select count(*) from returns where next_action_at>=day_start and next_action_at<day_end),
      'returnsOverdue',(select count(*) from returns where next_action_at<_at),
      'appointmentsToday',(select count(*) from appointments)),
    'awaitingResponseUnavailableReason','message_coverage_unavailable',
    'page',jsonb_build_object('index',_page,'size',_size,'totalItems',(select count(*) from items),'hasMore',(select count(*) from items) > ((_page::bigint+1)*_size)),
    'rows',coalesce((select jsonb_agg(item order by rank,due,id) from page_items),'[]'::jsonb)
  ) into result;
  return result;
end $$;
revoke all on function public.attendance_workspace_read(uuid,uuid,text,text,integer,integer,timestamptz) from public,anon,authenticated;
grant execute on function public.attendance_workspace_read(uuid,uuid,text,text,integer,integer,timestamptz) to service_role;
create index if not exists idx_contacts_attendance_due on public.contacts(organization_id,attendance_owner_id,next_action_at,id)
  where not is_demo and next_action is not null and next_action_at is not null;
commit;
