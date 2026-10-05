begin;
-- No activation or contact seed. Deployment alone cannot enable this service.
create table public.commercial_agent_settings (
  organization_id uuid primary key references public.organizations(id),
  location_id text not null unique,
  mode text not null default 'off' check(mode in ('off','supervised')),
  allowed_contacts text[] not null default '{}',
  allowed_channels text[] not null default '{}',
  monthly_draft_limit integer not null default 3000 check(monthly_draft_limit between 1 and 10000)
);
create table public.commercial_agent_sessions (
  organization_id uuid not null references public.organizations(id),
  contact_id text not null,
  version integer not null default 0,
  paused boolean not null default false,
  opt_out boolean not null default false,
  primary key(organization_id,contact_id)
);
create table public.commercial_agent_inbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  event jsonb not null,
  contact_id text not null,
  message_id text not null,
  event_type text not null check(event_type in ('InboundMessage','OutboundMessage')),
  contact_version integer not null,
  state text not null default 'pending' check(state in ('pending','processing','ready','failed','ignored')),
  attempts integer not null default 0,
  lease uuid,
  lease_until timestamptz,
  retry_at timestamptz not null default now(),
  error_code text,
  created_at timestamptz not null default now(),
  unique(organization_id,event_type,message_id)
);
create index commercial_agent_pending on public.commercial_agent_inbox(organization_id,state,retry_at);
create table public.commercial_agent_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  event_id uuid not null unique references public.commercial_agent_inbox(id),
  contact_id text not null,
  conversation_id text not null,
  location_id text not null,
  message_id text not null,
  contact_version integer not null,
  version integer not null default 1,
  state text not null default 'pending' check(state in ('pending','sending','sent','unknown','rejected','invalidated')),
  payload text not null, -- AES-256-GCM, key server-only; no patient text in logs.
  reply_hash text not null check(reply_hash ~ '^[a-f0-9]{64}$'),
  flags text[] not null default '{}',
  policy_hash text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  dispatch_id uuid,
  result_message_id text,
  error_code text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '15 minutes'
);
create table public.commercial_agent_audit (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id),
  draft_id uuid,
  actor_id uuid references auth.users(id),
  code text not null check(code ~ '^[a-z_]{1,60}$'),
  created_at timestamptz not null default now()
);
-- Sensitive content can only be accessed through authenticated server functions.
alter table public.commercial_agent_settings enable row level security;
alter table public.commercial_agent_sessions enable row level security;
alter table public.commercial_agent_inbox enable row level security;
alter table public.commercial_agent_drafts enable row level security;
alter table public.commercial_agent_audit enable row level security;
revoke all on public.commercial_agent_settings,public.commercial_agent_sessions,public.commercial_agent_inbox,public.commercial_agent_drafts,public.commercial_agent_audit from public,anon,authenticated;
grant all on public.commercial_agent_settings,public.commercial_agent_sessions,public.commercial_agent_inbox,public.commercial_agent_drafts,public.commercial_agent_audit to service_role;
grant usage,select on sequence public.commercial_agent_audit_id_seq to service_role;

create function public.commercial_agent_command(_op text,_org uuid,_data jsonb default '{}',_actor uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg public.commercial_agent_settings%rowtype;
  sess public.commercial_agent_sessions%rowtype;
  job public.commercial_agent_inbox%rowtype;
  draft public.commercial_agent_drafts%rowtype;
  cid text; result jsonb; new_id uuid; code text;
begin
  -- Recheck the server-owned binding even for service-role writes.
  select * into cfg from public.commercial_agent_settings where organization_id=_org for update;
  if not found then return jsonb_build_object('error','not_configured'); end if;
  if not exists(select 1 from public.ghl_location_bindings where organization_id=_org and location_id=cfg.location_id) then
    return jsonb_build_object('error','scope_mismatch');
  end if;
  if _op in ('list','detail','pause','resume','start_send','reject','reconcile') then
    if _actor is null or not exists(select 1 from public.profiles p join public.user_roles r on r.user_id=p.id and r.organization_id=p.organization_id
      where p.id=_actor and p.organization_id=_org and r.role in ('administrador','gestor','comercial')) then
      return jsonb_build_object('error','forbidden');
    end if;
  end if;
  if _op='settings' then return to_jsonb(cfg); end if;
  if _op='ingress' then
    if cfg.mode<>'supervised' then return jsonb_build_object('status','disabled'); end if;
    if _data->>'locationId' is distinct from cfg.location_id or not ((_data->>'contactId')=any(cfg.allowed_contacts)) then return jsonb_build_object('error','contact_not_allowed'); end if;
    if (_data - array['type','locationId','contactId','conversationId','messageId'])<>'{}'::jsonb
      or coalesce(_data->>'messageId','') !~ '^[A-Za-z0-9_-]{1,100}$'
      or coalesce(_data->>'conversationId','') !~ '^[A-Za-z0-9_-]{1,100}$'
      or coalesce(_data->>'contactId','') !~ '^[A-Za-z0-9_-]{1,100}$'
      or coalesce(_data->>'type','') not in ('InboundMessage','OutboundMessage') then return jsonb_build_object('error','invalid_event'); end if;
    select * into job from public.commercial_agent_inbox where organization_id=_org and event_type=_data->>'type' and message_id=_data->>'messageId';
    if found then
      if job.event is distinct from _data then return jsonb_build_object('error','duplicate_mismatch'); end if;
      return jsonb_build_object('status','duplicate','id',job.id);
    end if;
    cid := _data->>'contactId';
    insert into public.commercial_agent_sessions(organization_id,contact_id) values(_org,cid) on conflict do nothing;
    select * into sess from public.commercial_agent_sessions where organization_id=_org and contact_id=cid for update;
    if _data->>'type'='OutboundMessage' and exists(select 1 from public.commercial_agent_drafts where organization_id=_org and contact_id=cid and result_message_id=_data->>'messageId') then
      insert into public.commercial_agent_inbox(organization_id,event,contact_id,message_id,event_type,contact_version,state) values(_org,_data,cid,_data->>'messageId',_data->>'type',sess.version,'ignored');
      return jsonb_build_object('status','own_message');
    end if;
    update public.commercial_agent_sessions set version=version+1,paused=paused or _data->>'type'='OutboundMessage' where organization_id=_org and contact_id=cid returning * into sess;
    update public.commercial_agent_drafts set state='invalidated',version=version+1 where organization_id=_org and contact_id=cid and state='pending';
    insert into public.commercial_agent_inbox(organization_id,event,contact_id,message_id,event_type,contact_version,state)
      values(_org,_data,cid,_data->>'messageId',_data->>'type',sess.version,case when sess.paused or sess.opt_out then 'ignored' else 'pending' end) returning id into new_id;
    insert into public.commercial_agent_audit(organization_id,code) values(_org,case when sess.paused then 'human_paused' else 'message_received' end);
    return jsonb_build_object('status','accepted','id',new_id);
  elsif _op='claim' then
    if cfg.mode<>'supervised' then return null; end if;
    -- A process crash after dispatch must never make a send retriable.
    with uncertain as (update public.commercial_agent_drafts set state='unknown',error_code='dispatch_interrupted' where organization_id=_org and state='sending' and approved_at<now()-interval '2 minutes' returning contact_id)
      update public.commercial_agent_sessions set paused=true,version=version+1 where organization_id=_org and contact_id in(select contact_id from uncertain);
    with exhausted as (update public.commercial_agent_inbox set state='failed',error_code='processing_interrupted' where organization_id=_org and state='processing' and attempts>=3 and lease_until<now() returning id)
      insert into public.commercial_agent_audit(organization_id,code) select _org,'processing_interrupted' from exhausted;
    select * into job from public.commercial_agent_inbox where organization_id=_org and attempts<3 and
      ((state='pending' and retry_at<=now()) or (state='processing' and lease_until<now())) order by created_at,id limit 1 for update skip locked;
    if not found then return null; end if;
    select * into sess from public.commercial_agent_sessions where organization_id=_org and contact_id=job.contact_id;
    if sess.paused or sess.opt_out or sess.version<>job.contact_version then
      update public.commercial_agent_inbox set state='ignored' where id=job.id; return null;
    end if;
    if (select count(*) from public.commercial_agent_drafts where organization_id=_org and created_at>=date_trunc('month',now())) >= cfg.monthly_draft_limit then return null; end if;
    update public.commercial_agent_inbox set state='processing',attempts=attempts+1,lease=gen_random_uuid(),lease_until=now()+interval '2 minutes' where id=job.id returning * into job;
    return jsonb_build_object('id',job.id,'lease',job.lease,'contact_version',job.contact_version,'event',job.event);
  elsif _op in ('ready','fail') then
    select * into job from public.commercial_agent_inbox where id=(_data->>'id')::uuid and organization_id=_org for update;
    if not found or job.state<>'processing' or job.lease is distinct from (_data->>'lease')::uuid or job.lease_until<now() then return jsonb_build_object('error','lease_lost'); end if;
    if _op='fail' then
      code:=_data->>'code'; if code !~ '^[a-z_]{1,60}$' then code:='internal_error'; end if;
      update public.commercial_agent_inbox set state=case when attempts>=3 then 'failed' else 'pending' end,error_code=code,retry_at=now()+interval '30 seconds'*attempts where id=job.id;
      insert into public.commercial_agent_audit(organization_id,code) values(_org,code);
      return jsonb_build_object('status','failed');
    end if;
    select * into sess from public.commercial_agent_sessions where organization_id=_org and contact_id=job.contact_id for update;
    if sess.version<>job.contact_version or sess.paused or sess.opt_out then
      update public.commercial_agent_inbox set state='ignored' where id=job.id; return jsonb_build_object('status','stale');
    end if;
    update public.commercial_agent_sessions set paused=coalesce((_data->>'pause')::boolean,false),opt_out=coalesce((_data->>'optOut')::boolean,false) where organization_id=_org and contact_id=job.contact_id;
    insert into public.commercial_agent_drafts(organization_id,event_id,contact_id,conversation_id,location_id,message_id,contact_version,payload,reply_hash,policy_hash,flags,input_tokens,output_tokens)
      values(_org,job.id,job.contact_id,job.event->>'conversationId',cfg.location_id,job.message_id,job.contact_version,_data->>'payload',_data->>'replyHash',_data->>'policyHash',array(select jsonb_array_elements_text(_data->'flags')),coalesce((_data->>'inputTokens')::integer,0),coalesce((_data->>'outputTokens')::integer,0)) returning id into new_id;
    update public.commercial_agent_inbox set state='ready' where id=job.id;
    insert into public.commercial_agent_audit(organization_id,draft_id,code) values(_org,new_id,'draft_ready');
    return jsonb_build_object('status','ready','id',new_id);
  elsif _op in ('pause','resume') then
    cid:=_data->>'contactId';
    select * into sess from public.commercial_agent_sessions where organization_id=_org and contact_id=cid for update;
    if not found or sess.version is distinct from (_data->>'expectedVersion')::integer then return jsonb_build_object('error','version_conflict'); end if;
    if _op='resume' and sess.opt_out then return jsonb_build_object('error','do_not_contact'); end if;
    if _op='resume' and exists(select 1 from public.commercial_agent_drafts where organization_id=_org and contact_id=cid and state in ('sending','unknown')) then return jsonb_build_object('error','reconciliation_required'); end if;
    update public.commercial_agent_sessions set paused=_op='pause',version=version+1 where organization_id=_org and contact_id=cid returning * into sess;
    update public.commercial_agent_drafts set state='invalidated',version=version+1 where organization_id=_org and contact_id=cid and state='pending';
    insert into public.commercial_agent_audit(organization_id,actor_id,code) values(_org,_actor,case when _op='pause' then 'human_paused' else 'human_resumed' end);
    return to_jsonb(sess);
  elsif _op='list' then
    return jsonb_build_object('settings',to_jsonb(cfg),'items',coalesce((select jsonb_agg(x) from (select d.*,s.paused,s.opt_out,s.version as session_version from public.commercial_agent_drafts d join public.commercial_agent_sessions s on s.organization_id=d.organization_id and s.contact_id=d.contact_id where d.organization_id=_org order by d.created_at desc limit 100) x),'[]'::jsonb),
      'errors',coalesce((select jsonb_agg(x) from (select id,state,error_code,attempts,created_at from public.commercial_agent_inbox where organization_id=_org and error_code is not null order by created_at desc limit 20) x),'[]'::jsonb));
  elsif _op='purge' then
    -- Keep deduplication tombstones and opt-out; erase only old encrypted content.
    update public.commercial_agent_drafts set payload='',state=case when state='pending' then 'invalidated' else state end where organization_id=_org and created_at<now()-interval '7 days' and state not in ('sending','unknown');
    return jsonb_build_object('status','purged');
  end if;
  select * into draft from public.commercial_agent_drafts where id=(_data->>'draftId')::uuid and organization_id=_org for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  select * into sess from public.commercial_agent_sessions where organization_id=_org and contact_id=draft.contact_id for update;
  if _op='detail' then return to_jsonb(draft)||jsonb_build_object('paused',sess.paused,'opt_out',sess.opt_out,'session_version',sess.version); end if;
  if _op in ('start_send','reject') then
    if draft.state<>'pending' or draft.version is distinct from (_data->>'version')::integer or draft.reply_hash is distinct from _data->>'replyHash' then return jsonb_build_object('error','version_conflict'); end if;
    if _op='reject' then
      update public.commercial_agent_drafts set state='rejected',version=version+1 where id=draft.id;
      insert into public.commercial_agent_audit(organization_id,draft_id,actor_id,code) values(_org,draft.id,_actor,'draft_rejected');
      return jsonb_build_object('status','rejected');
    end if;
    if cfg.mode<>'supervised' or not(draft.contact_id=any(cfg.allowed_contacts)) or cardinality(draft.flags)>0 or draft.expires_at<=now() or sess.version<>draft.contact_version or sess.paused or sess.opt_out then return jsonb_build_object('error','dispatch_blocked'); end if;
    if not exists(select 1 from public.ghl_connections where organization_id=_org and write_enabled=true) then return jsonb_build_object('error','send_disabled'); end if;
    update public.commercial_agent_drafts set state='sending',approved_by=_actor,approved_at=now(),dispatch_id=gen_random_uuid(),version=version+1 where id=draft.id returning * into draft;
    insert into public.commercial_agent_audit(organization_id,draft_id,actor_id,code) values(_org,draft.id,_actor,'human_approved');
    return to_jsonb(draft);
  elsif _op='check_dispatch' then
    if draft.state<>'sending' or draft.dispatch_id is distinct from (_data->>'dispatchId')::uuid or sess.version<>draft.contact_version or sess.paused or sess.opt_out or cfg.mode<>'supervised' then return jsonb_build_object('error','dispatch_blocked'); end if;
    return jsonb_build_object('status','allowed');
  elsif _op='finish_send' then
    if draft.state<>'sending' or draft.dispatch_id is distinct from (_data->>'dispatchId')::uuid then return jsonb_build_object('error','dispatch_lost'); end if;
    if _data->>'state' not in ('sent','unknown','rejected') then return jsonb_build_object('error','invalid_state'); end if;
    update public.commercial_agent_drafts set state=_data->>'state',result_message_id=_data->>'messageId',error_code=_data->>'code' where id=draft.id;
    if _data->>'state'='unknown' then update public.commercial_agent_sessions set paused=true,version=version+1 where organization_id=_org and contact_id=draft.contact_id; end if;
    insert into public.commercial_agent_audit(organization_id,draft_id,actor_id,code) values(_org,draft.id,draft.approved_by,case when _data->>'state'='sent' then 'provider_accepted' when _data->>'state'='unknown' then 'send_unknown' else 'send_rejected' end);
    return jsonb_build_object('status',_data->>'state');
  elsif _op='reconcile' then
    if draft.state not in ('unknown','sending') or coalesce(_data->>'messageId','') !~ '^[A-Za-z0-9_-]{1,100}$' then return jsonb_build_object('error','reconcile_blocked'); end if;
    if exists(select 1 from public.commercial_agent_drafts where organization_id=_org and result_message_id=_data->>'messageId' and id<>draft.id) then return jsonb_build_object('error','message_already_linked'); end if;
    update public.commercial_agent_drafts set state='sent',result_message_id=_data->>'messageId',error_code=null where id=draft.id;
    insert into public.commercial_agent_audit(organization_id,draft_id,actor_id,code) values(_org,draft.id,_actor,'provider_reconciled');
    return jsonb_build_object('status','sent');
  end if;
  return jsonb_build_object('error','unsupported_command');
end $$;
revoke all on function public.commercial_agent_command(text,uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.commercial_agent_command(text,uuid,jsonb,uuid) to service_role;
commit;
