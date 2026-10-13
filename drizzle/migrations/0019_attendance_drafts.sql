create table if not exists public.attendance_drafts (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_id text not null check (contact_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  conversation_id text not null check (conversation_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  location_id text not null check (location_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  revision uuid not null default gen_random_uuid(),
  payload text,
  text_hash text,
  updated_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz,
  primary key (organization_id,user_id,contact_id,conversation_id),
  constraint attendance_draft_content check (
    (payload is null and text_hash is null and expires_at is null)
    or (payload is not null and text_hash is not null and payload like 'v1.%' and octet_length(payload) <= 20000 and text_hash ~ '^[a-f0-9]{64}$'
        and expires_at is not null and expires_at > updated_at and expires_at <= updated_at + interval '7 days')
  )
);
create index if not exists attendance_drafts_expiry on public.attendance_drafts(expires_at) where payload is not null;
alter table public.attendance_drafts enable row level security;
alter table public.attendance_drafts force row level security;
revoke all on public.attendance_drafts from public,anon,authenticated;
grant select,insert,update,delete on public.attendance_drafts to service_role;

create or replace function public.attendance_draft_command(
  _op text,_org uuid,_actor uuid,_location text,_contact text,_conversation text,_data jsonb default '{}'
) returns jsonb language plpgsql security definer set search_path='' as $$
declare item public.attendance_drafts%rowtype;
  expected uuid; next_revision uuid; now_at timestamptz; found_item boolean;
begin
  if _actor is null or not exists (
    select 1 from public.profiles p join public.user_roles r
      on r.user_id=p.id and r.organization_id=p.organization_id
    where p.id=_actor and p.organization_id=_org and r.role in ('administrador','gestor','comercial')
  ) then return jsonb_build_object('error','forbidden'); end if;
  if not exists(select 1 from public.ghl_location_bindings where organization_id=_org and location_id=_location)
    or coalesce(_contact,'') !~ '^[A-Za-z0-9_-]{1,100}$'
    or coalesce(_conversation,'') !~ '^[A-Za-z0-9_-]{1,100}$'
    then return jsonb_build_object('error','scope_mismatch'); end if;
  if _op not in ('load','save','clear') then return jsonb_build_object('error','invalid_input'); end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(jsonb_build_array(_org,_actor,_contact,_conversation)::text,0));
  select * into item from public.attendance_drafts where organization_id=_org and user_id=_actor
    and contact_id=_contact and conversation_id=_conversation for update;
  found_item:=found;
  if found_item and item.location_id<>_location then return jsonb_build_object('error','scope_mismatch'); end if;
  now_at:=clock_timestamp();
  if found_item and item.payload is not null and item.expires_at<=now_at then
    update public.attendance_drafts set payload=null,text_hash=null,expires_at=null,revision=gen_random_uuid(),updated_at=now_at
      where organization_id=_org and user_id=_actor and contact_id=_contact and conversation_id=_conversation returning * into item;
  end if;
  if _op='load' then return jsonb_build_object('row',case when found_item then to_jsonb(item) else null end); end if;
  if not (_data ? 'expectedRevision') or (jsonb_typeof(_data->'expectedRevision') not in ('null','string')) then return jsonb_build_object('error','invalid_input'); end if;
  begin expected:=(_data->>'expectedRevision')::uuid;
  exception when others then return jsonb_build_object('error','invalid_input'); end;
  if (found_item and item.revision is distinct from expected) or (not found_item and expected is not null) then
    return jsonb_build_object('error','draft_conflict','row',case when found_item then to_jsonb(item) else null end);
  end if;
  if _op='clear' then
    if coalesce(_data->>'expectedTextHash','') !~ '^[a-f0-9]{64}$' then return jsonb_build_object('error','invalid_input'); end if;
    if found_item and item.payload is not null and item.text_hash is distinct from _data->>'expectedTextHash' then
      return jsonb_build_object('error','draft_conflict','row',to_jsonb(item));
    end if;
    if not found_item or item.payload is null then return jsonb_build_object('row',case when found_item then to_jsonb(item) else null end); end if;
    update public.attendance_drafts set payload=null,text_hash=null,expires_at=null,revision=gen_random_uuid(),updated_at=now_at
      where organization_id=_org and user_id=_actor and contact_id=_contact and conversation_id=_conversation returning * into item;
  else
    begin next_revision:=(_data->>'revision')::uuid;
    exception when others then return jsonb_build_object('error','invalid_input'); end;
    if next_revision is null or next_revision=expected then return jsonb_build_object('error','invalid_input'); end if;
    if coalesce((_data->>'empty')::boolean,false) then
      insert into public.attendance_drafts(organization_id,user_id,location_id,contact_id,conversation_id,revision,updated_at)
        values(_org,_actor,_location,_contact,_conversation,next_revision,now_at)
        on conflict(organization_id,user_id,contact_id,conversation_id) do update set revision=excluded.revision,payload=null,text_hash=null,expires_at=null,updated_at=excluded.updated_at returning * into item;
    else
      if coalesce(_data->>'payload','') not like 'v1.%' or octet_length(_data->>'payload')>20000 or coalesce(_data->>'textHash','') !~ '^[a-f0-9]{64}$' then return jsonb_build_object('error','invalid_input'); end if;
      insert into public.attendance_drafts(organization_id,user_id,location_id,contact_id,conversation_id,revision,payload,text_hash,updated_at,expires_at)
        values(_org,_actor,_location,_contact,_conversation,next_revision,_data->>'payload',_data->>'textHash',now_at,now_at+interval '7 days')
        on conflict(organization_id,user_id,contact_id,conversation_id) do update set revision=excluded.revision,payload=excluded.payload,text_hash=excluded.text_hash,updated_at=excluded.updated_at,expires_at=excluded.expires_at returning * into item;
    end if;
  end if;
  return jsonb_build_object('row',to_jsonb(item));
end $$;
revoke all on function public.attendance_draft_command(text,uuid,uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.attendance_draft_command(text,uuid,uuid,text,text,text,jsonb) to service_role;

create or replace function public.attendance_draft_purge_expired()
returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
  update public.attendance_drafts set payload=null,text_hash=null,expires_at=null,revision=gen_random_uuid(),updated_at=clock_timestamp()
    where payload is not null and expires_at<=clock_timestamp();
  get diagnostics n=row_count;
  return n;
end $$;
revoke all on function public.attendance_draft_purge_expired() from public,anon,authenticated;
grant execute on function public.attendance_draft_purge_expired() to service_role;