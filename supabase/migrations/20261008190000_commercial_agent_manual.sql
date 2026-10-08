begin;
-- A separate human-send permission; receipt and AI allowlists are unchanged.
alter table public.commercial_agent_settings add column manual_send_all_contacts boolean not null default false;
alter table public.commercial_agent_inbox add column observed_at timestamptz check(observed_at is null or isfinite(observed_at));
create table public.commercial_agent_manual_dispatches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  request_id uuid not null,
  contact_id text not null,
  conversation_id text not null,
  location_id text not null,
  session_version integer not null,
  inbound_id text not null,
  inbound_at timestamptz not null,
  channel text not null check(channel='SMS'),
  history_hash text not null check(history_hash ~ '^[a-f0-9]{64}$'),
  payload text not null,
  reply_hash text not null check(reply_hash ~ '^[a-f0-9]{64}$'),
  state text not null default 'prepared' check(state in ('prepared','sending','sent','unknown','rejected','invalidated')),
  prepared_by uuid not null references auth.users(id),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  dispatch_id uuid,
  result_message_id text,
  error_code text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '15 minutes',
  unique(organization_id,request_id)
);
create index commercial_agent_manual_contact on public.commercial_agent_manual_dispatches(organization_id,contact_id,state);
alter table public.commercial_agent_manual_dispatches enable row level security;
revoke all on public.commercial_agent_manual_dispatches from public,anon,authenticated;
grant all on public.commercial_agent_manual_dispatches to service_role;

create or replace function public.commercial_agent_command(_op text,_org uuid,_data jsonb default '{}',_actor uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg public.commercial_agent_settings%rowtype;
  sess public.commercial_agent_sessions%rowtype;
  job public.commercial_agent_inbox%rowtype;
  draft public.commercial_agent_drafts%rowtype;
  cid text; result jsonb; new_id uuid; code text;
  event_data jsonb; observed_at timestamptz; advance_until timestamptz;
  ambiguous_order boolean := false;
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
    if jsonb_typeof(_data) is distinct from 'object' then return jsonb_build_object('error','invalid_event'); end if;
    if _data->>'locationId' is distinct from cfg.location_id then return jsonb_build_object('error','scope_mismatch'); end if;
    if not (cfg.receive_all_contacts or coalesce((_data->>'contactId')=any(cfg.allowed_contacts),false)) then return jsonb_build_object('error','contact_not_allowed'); end if;
    -- observedAt is trusted transport metadata, never part of event identity.
    event_data := _data - 'observedAt';
    if (event_data - array['type','locationId','contactId','conversationId','messageId'])<>'{}'::jsonb
      or coalesce(_data->>'messageId','') !~ '^[A-Za-z0-9_-]{1,100}$'
      or coalesce(_data->>'conversationId','') !~ '^[A-Za-z0-9_-]{1,100}$'
      or coalesce(_data->>'contactId','') !~ '^[A-Za-z0-9_-]{1,100}$'
      or coalesce(_data->>'type','') not in ('InboundMessage','OutboundMessage') then return jsonb_build_object('error','invalid_event'); end if;
    if cfg.receive_all_contacts or _data ? 'observedAt' then
      if jsonb_typeof(_data->'observedAt') is distinct from 'string'
        or (_data->>'observedAt') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?(Z|[+-][0-9]{2}:[0-9]{2})$' then return jsonb_build_object('error','observed_at_invalid'); end if;
      begin
        observed_at := (_data->>'observedAt')::timestamptz;
      exception when others then return jsonb_build_object('error','observed_at_invalid'); end;
      if not isfinite(observed_at) or observed_at>now() then return jsonb_build_object('error','observed_at_invalid'); end if;
    end if;
    if cfg.receive_all_contacts then
      if cfg.receive_since is null or not isfinite(cfg.receive_since) or cfg.receive_since>now() then return jsonb_build_object('error','receive_since_invalid'); end if;
      if observed_at<cfg.receive_since then return jsonb_build_object('error','before_receive_since'); end if;
    end if;
    select * into job from public.commercial_agent_inbox where organization_id=_org and event_type=_data->>'type' and message_id=_data->>'messageId';
    if found then
      if job.event is distinct from event_data then return jsonb_build_object('error','duplicate_mismatch'); end if;
      return jsonb_build_object('status','duplicate','id',job.id);
    end if;
    cid := _data->>'contactId';
    insert into public.commercial_agent_sessions(organization_id,contact_id) values(_org,cid) on conflict do nothing;
    select * into sess from public.commercial_agent_sessions where organization_id=_org and contact_id=cid for update;
    if _data->>'type'='OutboundMessage' and (exists(select 1 from public.commercial_agent_drafts where organization_id=_org and contact_id=cid and result_message_id=_data->>'messageId') or exists(select 1 from public.commercial_agent_manual_dispatches where organization_id=_org and contact_id=cid and conversation_id=_data->>'conversationId' and result_message_id=_data->>'messageId')) then
      if observed_at is not null and (sess.last_event_at is null or observed_at>sess.last_event_at) then
        update public.commercial_agent_sessions set last_event_at=observed_at,last_event_id=_data->>'messageId' where organization_id=_org and contact_id=cid;
      end if;
      insert into public.commercial_agent_inbox(organization_id,event,contact_id,message_id,event_type,contact_version,state,observed_at) values(_org,event_data,cid,_data->>'messageId',_data->>'type',sess.version,'ignored',observed_at);
      return jsonb_build_object('status','own_message');
    end if;
    if _data->>'type'='InboundMessage' and observed_at is not null and sess.last_event_at is not null then
      if observed_at<sess.last_event_at then
        -- Delayed indexing cannot supersede a newer canonical message. Retain
        -- the tombstone without invalidating its draft or incrementing version.
        insert into public.commercial_agent_inbox(organization_id,event,contact_id,message_id,event_type,contact_version,state,observed_at)
          values(_org,event_data,cid,_data->>'messageId',_data->>'type',sess.version,'ignored',observed_at) returning id into new_id;
        insert into public.commercial_agent_audit(organization_id,code) values(_org,'message_ignored_stale');
        return jsonb_build_object('status','accepted','id',new_id);
      end if;
      -- Equal timestamps do not establish a portable ordering of provider IDs.
      -- Pause for a reviewer instead of silently choosing an arbitrary reply.
      ambiguous_order := observed_at=sess.last_event_at and sess.last_event_id is distinct from _data->>'messageId';
    end if;
    update public.commercial_agent_sessions set version=version+1,
      paused=paused or _data->>'type'='OutboundMessage' or ambiguous_order,
      last_event_at=case when observed_at is not null and (last_event_at is null or observed_at>last_event_at) then observed_at else last_event_at end,
      last_event_id=case when observed_at is not null and (last_event_at is null or observed_at>last_event_at) then _data->>'messageId' else last_event_id end
      where organization_id=_org and contact_id=cid returning * into sess;
    update public.commercial_agent_drafts set state='invalidated',version=version+1 where organization_id=_org and contact_id=cid and state='pending';
    insert into public.commercial_agent_inbox(organization_id,event,contact_id,message_id,event_type,contact_version,state,error_code,observed_at)
      values(_org,event_data,cid,_data->>'messageId',_data->>'type',sess.version,case when sess.paused or sess.opt_out then 'ignored' else 'pending' end,case when ambiguous_order then 'message_order_ambiguous' end,observed_at) returning id into new_id;
    insert into public.commercial_agent_audit(organization_id,code) values(_org,case when ambiguous_order then 'message_order_ambiguous' when sess.paused then 'human_paused' else 'message_received' end);
    return jsonb_build_object('status','accepted','id',new_id);
  elsif _op='receive_advance' then
    -- Only the server worker invokes this after a complete canonical export.
    -- This operation never adds contacts/channels or changes send permissions.
    if cfg.mode<>'supervised' or not cfg.receive_all_contacts then return jsonb_build_object('status','disabled'); end if;
    if cfg.receive_since is null or not isfinite(cfg.receive_since) or cfg.receive_since>now() then return jsonb_build_object('error','receive_since_invalid'); end if;
    if jsonb_typeof(_data) is distinct from 'object' or (_data - 'until')<>'{}'::jsonb
      or jsonb_typeof(_data->'until') is distinct from 'string'
      or (_data->>'until') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?(Z|[+-][0-9]{2}:[0-9]{2})$' then return jsonb_build_object('error','receive_cursor_invalid'); end if;
    begin
      advance_until := (_data->>'until')::timestamptz;
    exception when others then return jsonb_build_object('error','receive_cursor_invalid'); end;
    if not isfinite(advance_until) or advance_until>now() or advance_until<cfg.receive_since then return jsonb_build_object('error','receive_cursor_invalid'); end if;
    if cfg.receive_cursor_until is not null and advance_until<=cfg.receive_cursor_until then return jsonb_build_object('status','unchanged'); end if;
    update public.commercial_agent_settings set receive_cursor_until=advance_until where organization_id=_org;
    return jsonb_build_object('status','advanced');
  elsif _op='claim' then
    if cfg.mode<>'supervised' then return null; end if;
    update public.commercial_agent_manual_dispatches set state='unknown',error_code='dispatch_interrupted' where organization_id=_org and state='sending' and approved_at<now()-interval '2 minutes';
    -- A process crash after dispatch must never make a send retriable.
    with uncertain as (update public.commercial_agent_drafts set state='unknown',error_code='dispatch_interrupted' where organization_id=_org and state='sending' and approved_at<now()-interval '2 minutes' returning contact_id)
      update public.commercial_agent_sessions set paused=true,version=version+1 where organization_id=_org and contact_id in(select contact_id from uncertain);
    with exhausted as (update public.commercial_agent_inbox set state='failed',error_code='processing_interrupted' where organization_id=_org and state='processing' and attempts>=3 and lease_until<now() returning id)
      insert into public.commercial_agent_audit(organization_id,code) select _org,'processing_interrupted' from exhausted;
    -- Drain all eligible stale jobs in one pass, so an old backlog cannot hide
    -- the first valid job for one scheduler interval per stale item.
    update public.commercial_agent_inbox i set state='ignored'
      where i.organization_id=_org and i.attempts<3
      and ((i.state='pending' and i.retry_at<=now()) or (i.state='processing' and i.lease_until<now()))
      and (i.event->>'locationId' is distinct from cfg.location_id
        or not (cfg.receive_all_contacts or i.contact_id=any(cfg.allowed_contacts))
        or not exists(select 1 from public.commercial_agent_sessions s where s.organization_id=i.organization_id and s.contact_id=i.contact_id and not s.paused and not s.opt_out and s.version=i.contact_version));
    select * into job from public.commercial_agent_inbox where organization_id=_org and attempts<3 and
      ((state='pending' and retry_at<=now()) or (state='processing' and lease_until<now())) order by created_at,id limit 1 for update skip locked;
    if not found then return null; end if;
    select * into sess from public.commercial_agent_sessions where organization_id=_org and contact_id=job.contact_id;
    if sess.paused or sess.opt_out or sess.version<>job.contact_version
      or job.event->>'locationId' is distinct from cfg.location_id
      or not (cfg.receive_all_contacts or job.contact_id=any(cfg.allowed_contacts)) then
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
    -- The cutoff can change while generation is outside this transaction.
    -- Revalidate canonical server metadata before persisting that draft.
    if cfg.receive_all_contacts then
      if jsonb_typeof(_data->'observedAt')='string'
        and (_data->>'observedAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?(Z|[+-][0-9]{2}:[0-9]{2})$' then
        begin
          observed_at := (_data->>'observedAt')::timestamptz;
        exception when others then observed_at := null; end;
      end if;
      if cfg.receive_since is null or not isfinite(cfg.receive_since) or cfg.receive_since>now()
        or observed_at is null or not isfinite(observed_at) or observed_at>now() or observed_at<cfg.receive_since then
        update public.commercial_agent_inbox set state='ignored' where id=job.id; return jsonb_build_object('status','stale');
      end if;
    end if;
    if cfg.mode<>'supervised' or sess.version<>job.contact_version or sess.paused or sess.opt_out
      or job.event->>'locationId' is distinct from cfg.location_id
      or not (cfg.receive_all_contacts or job.contact_id=any(cfg.allowed_contacts)) then
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
    if _op='resume' and exists(select 1 from public.commercial_agent_manual_dispatches where organization_id=_org and contact_id=cid and state in ('sending','unknown')) then return jsonb_build_object('error','reconciliation_required'); end if;
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
    update public.commercial_agent_manual_dispatches set payload='',state=case when state='prepared' then 'invalidated' else state end where organization_id=_org and created_at<now()-interval '7 days' and state not in ('sending','unknown');
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
    if exists(select 1 from public.commercial_agent_manual_dispatches where organization_id=_org and contact_id=draft.contact_id and state in ('sending','unknown')) then return jsonb_build_object('error','reconciliation_required'); end if;
    if not exists(select 1 from public.ghl_connections where organization_id=_org and write_enabled=true) then return jsonb_build_object('error','send_disabled'); end if;
    update public.commercial_agent_drafts set state='sending',approved_by=_actor,approved_at=now(),dispatch_id=gen_random_uuid(),version=version+1 where id=draft.id returning * into draft;
    insert into public.commercial_agent_audit(organization_id,draft_id,actor_id,code) values(_org,draft.id,_actor,'human_approved');
    return to_jsonb(draft);
  elsif _op='check_dispatch' then
    if draft.state<>'sending' or draft.dispatch_id is distinct from (_data->>'dispatchId')::uuid or sess.version<>draft.contact_version or sess.paused or sess.opt_out or cfg.mode<>'supervised' then return jsonb_build_object('error','dispatch_blocked'); end if;
    if exists(select 1 from public.commercial_agent_manual_dispatches where organization_id=_org and contact_id=draft.contact_id and state in ('sending','unknown')) then return jsonb_build_object('error','dispatch_blocked'); end if;
    return jsonb_build_object('status','allowed');
  elsif _op='finish_send' then
    if draft.state<>'sending' or draft.dispatch_id is distinct from (_data->>'dispatchId')::uuid then return jsonb_build_object('error','dispatch_lost'); end if;
    if _data->>'state' not in ('sent','unknown','rejected') then return jsonb_build_object('error','invalid_state'); end if;
    if _data->>'messageId' is not null and exists(select 1 from public.commercial_agent_manual_dispatches where organization_id=_org and result_message_id=_data->>'messageId') then return jsonb_build_object('error','message_already_linked'); end if;
    update public.commercial_agent_drafts set state=_data->>'state',result_message_id=_data->>'messageId',error_code=_data->>'code' where id=draft.id;
    if _data->>'state'='unknown' then update public.commercial_agent_sessions set paused=true,version=version+1 where organization_id=_org and contact_id=draft.contact_id; end if;
    insert into public.commercial_agent_audit(organization_id,draft_id,actor_id,code) values(_org,draft.id,draft.approved_by,case when _data->>'state'='sent' then 'provider_accepted' when _data->>'state'='unknown' then 'send_unknown' else 'send_rejected' end);
    return jsonb_build_object('status',_data->>'state');
  elsif _op='reconcile' then
    if draft.state not in ('unknown','sending') or coalesce(_data->>'messageId','') !~ '^[A-Za-z0-9_-]{1,100}$' then return jsonb_build_object('error','reconcile_blocked'); end if;
    if exists(select 1 from public.commercial_agent_drafts where organization_id=_org and result_message_id=_data->>'messageId' and id<>draft.id) then return jsonb_build_object('error','message_already_linked'); end if;
    if exists(select 1 from public.commercial_agent_manual_dispatches where organization_id=_org and result_message_id=_data->>'messageId') then return jsonb_build_object('error','message_already_linked'); end if;
    update public.commercial_agent_drafts set state='sent',result_message_id=_data->>'messageId',error_code=null where id=draft.id;
    insert into public.commercial_agent_audit(organization_id,draft_id,actor_id,code) values(_org,draft.id,_actor,'provider_reconciled');
    return jsonb_build_object('status','sent');
  end if;
  return jsonb_build_object('error','unsupported_command');
end $$;
revoke all on function public.commercial_agent_command(text,uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.commercial_agent_command(text,uuid,jsonb,uuid) to service_role;

create function public.commercial_agent_manual_command(_op text,_org uuid,_data jsonb default '{}',_actor uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg public.commercial_agent_settings%rowtype;
  sess public.commercial_agent_sessions%rowtype;
  item public.commercial_agent_manual_dispatches%rowtype;
  cid text; vid text; inbound_time timestamptz; busy boolean; latest jsonb; code text;
begin
  -- Use the same lock order as the AI RPC: organization settings, session, dispatch.
  select * into cfg from public.commercial_agent_settings where organization_id=_org for update;
  if not found then return jsonb_build_object('error','not_configured'); end if;
  if not exists(select 1 from public.ghl_location_bindings where organization_id=_org and location_id=cfg.location_id) then return jsonb_build_object('error','scope_mismatch'); end if;
  if _actor is null or not exists(select 1 from public.profiles p join public.user_roles r on r.user_id=p.id and r.organization_id=p.organization_id where p.id=_actor and p.organization_id=_org and r.role in ('administrador','gestor','comercial')) then return jsonb_build_object('error','forbidden'); end if;
  update public.commercial_agent_manual_dispatches set state='unknown',error_code='dispatch_interrupted' where organization_id=_org and state='sending' and approved_at<now()-interval '2 minutes';
  if _op='manual_list' then
    return coalesce((select jsonb_agg(x order by x."lastMessageAt" desc nulls last,x."contactId",x."conversationId") from (
      select i.contact_id as "contactId",i.event->>'conversationId' as "conversationId",cfg.location_id as "locationId",s.version as "sessionVersion",s.paused,s.opt_out as "optOut",max(i.observed_at) as "lastMessageAt"
      from public.commercial_agent_inbox i join public.commercial_agent_sessions s on s.organization_id=i.organization_id and s.contact_id=i.contact_id
      where i.organization_id=_org and i.event->>'locationId'=cfg.location_id group by i.contact_id,i.event->>'conversationId',s.version,s.paused,s.opt_out
    ) x),'[]'::jsonb);
  end if;
  if _op='manual_lookup' then
    select * into item from public.commercial_agent_manual_dispatches where organization_id=_org and request_id=(_data->>'requestId')::uuid;
    if not found then return null; end if;
    if item.prepared_by<>_actor then return jsonb_build_object('error','forbidden'); end if;
    return to_jsonb(item);
  end if;
  if _op in ('manual_context','manual_prepare') then
    cid:=_data->>'contactId'; vid:=_data->>'conversationId';
    if coalesce(cid,'') !~ '^[A-Za-z0-9_-]{1,100}$' or coalesce(vid,'') !~ '^[A-Za-z0-9_-]{1,100}$'
      or not exists(select 1 from public.commercial_agent_inbox where organization_id=_org and contact_id=cid and event->>'conversationId'=vid and event->>'locationId'=cfg.location_id) then return jsonb_build_object('error','scope_mismatch'); end if;
    select * into sess from public.commercial_agent_sessions where organization_id=_org and contact_id=cid for update;
    if not found then return jsonb_build_object('error','scope_mismatch'); end if;
    busy:=exists(select 1 from public.commercial_agent_drafts where organization_id=_org and contact_id=cid and state in ('sending','unknown'))
      or exists(select 1 from public.commercial_agent_manual_dispatches where organization_id=_org and contact_id=cid and state in ('sending','unknown'));
    if _op='manual_context' then
      select jsonb_build_object('id',id,'state',state,'replyHash',reply_hash,'messageId',result_message_id,'errorCode',error_code) into latest from public.commercial_agent_manual_dispatches where organization_id=_org and contact_id=cid and conversation_id=vid order by created_at desc,id desc limit 1;
      return jsonb_build_object('contactId',cid,'conversationId',vid,'locationId',cfg.location_id,'sessionVersion',sess.version,'paused',sess.paused,'optOut',sess.opt_out,'busy',busy)||case when latest is null then '{}'::jsonb else jsonb_build_object('lastDispatch',latest) end;
    end if;
    select * into item from public.commercial_agent_manual_dispatches where organization_id=_org and request_id=(_data->>'requestId')::uuid;
    if found then
      if item.prepared_by<>_actor or item.contact_id<>cid or item.conversation_id<>vid or item.reply_hash is distinct from _data->>'replyHash' then return jsonb_build_object('error','manual_request_mismatch'); end if;
      return to_jsonb(item);
    end if;
    if busy then return jsonb_build_object('error','reconciliation_required'); end if;
    if cfg.mode<>'supervised' or not cfg.manual_send_all_contacts or not exists(select 1 from public.ghl_connections where organization_id=_org and write_enabled=true) then return jsonb_build_object('error','send_disabled'); end if;
    if _data->>'locationId' is distinct from cfg.location_id then return jsonb_build_object('error','scope_mismatch'); end if;
    if sess.version is distinct from (_data->>'expectedVersion')::integer then return jsonb_build_object('error','version_conflict'); end if;
    if jsonb_typeof(_data->'dnd') is distinct from 'boolean' or jsonb_typeof(_data->'stop') is distinct from 'boolean' then return jsonb_build_object('error','invalid_manual'); end if;
    if sess.opt_out or (_data->>'dnd')::boolean or (_data->>'stop')::boolean then return jsonb_build_object('error','do_not_contact'); end if;
    if _data->>'channel' is distinct from 'SMS' then return jsonb_build_object('error','unsupported_channel'); end if;
    if coalesce(_data->>'inboundId','') !~ '^[A-Za-z0-9_-]{1,100}$' or coalesce(_data->>'historyHash','') !~ '^[a-f0-9]{64}$' or coalesce(_data->>'replyHash','') !~ '^[a-f0-9]{64}$' or coalesce(_data->>'payload','')='' then return jsonb_build_object('error','invalid_manual'); end if;
    if jsonb_typeof(_data->'inboundAt') is distinct from 'string' or (_data->>'inboundAt') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?(Z|[+-][0-9]{2}:[0-9]{2})$' then return jsonb_build_object('error','channel_window'); end if;
    begin inbound_time:=(_data->>'inboundAt')::timestamptz; exception when others then return jsonb_build_object('error','channel_window'); end;
    if inbound_time is null or not isfinite(inbound_time) or inbound_time>now() or inbound_time<=now()-interval '23 hours' then return jsonb_build_object('error','channel_window'); end if;
    update public.commercial_agent_sessions set paused=true,version=version+1 where organization_id=_org and contact_id=cid returning * into sess;
    update public.commercial_agent_drafts set state='invalidated',version=version+1 where organization_id=_org and contact_id=cid and state='pending';
    update public.commercial_agent_manual_dispatches set state='invalidated' where organization_id=_org and contact_id=cid and state='prepared';
    insert into public.commercial_agent_manual_dispatches(organization_id,request_id,contact_id,conversation_id,location_id,session_version,inbound_id,inbound_at,channel,history_hash,payload,reply_hash,prepared_by)
      values(_org,(_data->>'requestId')::uuid,cid,vid,cfg.location_id,sess.version,_data->>'inboundId',inbound_time,'SMS',_data->>'historyHash',_data->>'payload',_data->>'replyHash',_actor) returning * into item;
    insert into public.commercial_agent_audit(organization_id,draft_id,actor_id,code) values(_org,item.id,_actor,'manual_prepared');
    return to_jsonb(item);
  end if;
  select * into item from public.commercial_agent_manual_dispatches where organization_id=_org and id=(_data->>'manualId')::uuid for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  select * into sess from public.commercial_agent_sessions where organization_id=_org and contact_id=item.contact_id for update;
  if _op='manual_detail' then return to_jsonb(item); end if;
  if _op='manual_start_send' then
    if item.prepared_by<>_actor or item.reply_hash is distinct from _data->>'replyHash' then return jsonb_build_object('error','version_conflict'); end if;
    if item.state in ('sent','unknown','rejected') then return to_jsonb(item); end if;
    if item.state='sending' then return jsonb_build_object('error','reconciliation_required'); end if;
    if item.state<>'prepared' or item.expires_at<=now() or item.payload='' or sess.version<>item.session_version or not sess.paused or item.history_hash is distinct from _data->>'historyHash' then return jsonb_build_object('error','draft_stale'); end if;
    if sess.opt_out then return jsonb_build_object('error','do_not_contact'); end if;
    if cfg.mode<>'supervised' or not cfg.manual_send_all_contacts or item.location_id<>cfg.location_id or not exists(select 1 from public.ghl_connections where organization_id=_org and write_enabled=true) then return jsonb_build_object('error','send_disabled'); end if;
    if item.channel<>'SMS' or item.inbound_at>now() or item.inbound_at<=now()-interval '23 hours' then return jsonb_build_object('error','channel_window'); end if;
    if exists(select 1 from public.commercial_agent_drafts where organization_id=_org and contact_id=item.contact_id and state in ('sending','unknown')) or exists(select 1 from public.commercial_agent_manual_dispatches where organization_id=_org and contact_id=item.contact_id and id<>item.id and state in ('sending','unknown')) then return jsonb_build_object('error','reconciliation_required'); end if;
    update public.commercial_agent_manual_dispatches set state='sending',approved_by=_actor,approved_at=now(),dispatch_id=gen_random_uuid() where id=item.id returning * into item;
    insert into public.commercial_agent_audit(organization_id,draft_id,actor_id,code) values(_org,item.id,_actor,'manual_approved');
    return to_jsonb(item);
  elsif _op='manual_check_dispatch' then
    if item.state<>'sending' or item.dispatch_id is distinct from (_data->>'dispatchId')::uuid or item.approved_by<>_actor or sess.version<>item.session_version or not sess.paused or sess.opt_out or cfg.mode<>'supervised' or not cfg.manual_send_all_contacts or not exists(select 1 from public.ghl_connections where organization_id=_org and write_enabled=true) then return jsonb_build_object('error','dispatch_blocked'); end if;
    if item.channel<>'SMS' or item.inbound_at>now() or item.inbound_at<=now()-interval '23 hours' then return jsonb_build_object('error','dispatch_blocked'); end if;
    if exists(select 1 from public.commercial_agent_drafts where organization_id=_org and contact_id=item.contact_id and state in ('sending','unknown')) or exists(select 1 from public.commercial_agent_manual_dispatches where organization_id=_org and contact_id=item.contact_id and id<>item.id and state in ('sending','unknown')) then return jsonb_build_object('error','dispatch_blocked'); end if;
    return jsonb_build_object('status','allowed');
  elsif _op='manual_finish_send' then
    if item.state<>'sending' or item.dispatch_id is distinct from (_data->>'dispatchId')::uuid or item.approved_by<>_actor then return jsonb_build_object('error','dispatch_lost'); end if;
    if _data->>'state' not in ('sent','unknown','rejected') then return jsonb_build_object('error','invalid_state'); end if;
    if _data->>'messageId' is not null and (exists(select 1 from public.commercial_agent_drafts where organization_id=_org and result_message_id=_data->>'messageId') or exists(select 1 from public.commercial_agent_manual_dispatches where organization_id=_org and id<>item.id and result_message_id=_data->>'messageId')) then return jsonb_build_object('error','message_already_linked'); end if;
    code:=_data->>'code'; if code is not null and code !~ '^[a-z_]{1,60}$' then code:='internal_error'; end if;
    update public.commercial_agent_manual_dispatches set state=_data->>'state',result_message_id=_data->>'messageId',error_code=code where id=item.id;
    -- Keep human ownership even when a newer callback arrived during the POST.
    update public.commercial_agent_sessions set paused=true where organization_id=_org and contact_id=item.contact_id;
    insert into public.commercial_agent_audit(organization_id,draft_id,actor_id,code) values(_org,item.id,_actor,case when _data->>'state'='sent' then 'manual_provider_accepted' when _data->>'state'='unknown' then 'manual_send_unknown' else 'manual_send_rejected' end);
    return jsonb_build_object('status',_data->>'state');
  elsif _op='manual_reconcile' then
    if item.state not in ('unknown','sending') or coalesce(_data->>'messageId','') !~ '^[A-Za-z0-9_-]{1,100}$' then return jsonb_build_object('error','reconcile_blocked'); end if;
    if exists(select 1 from public.commercial_agent_drafts where organization_id=_org and result_message_id=_data->>'messageId') or exists(select 1 from public.commercial_agent_manual_dispatches where organization_id=_org and id<>item.id and result_message_id=_data->>'messageId') then return jsonb_build_object('error','message_already_linked'); end if;
    update public.commercial_agent_manual_dispatches set state='sent',result_message_id=_data->>'messageId',error_code=null where id=item.id;
    insert into public.commercial_agent_audit(organization_id,draft_id,actor_id,code) values(_org,item.id,_actor,'manual_provider_reconciled');
    return jsonb_build_object('status','sent');
  end if;
  return jsonb_build_object('error','unsupported_command');
end $$;
revoke all on function public.commercial_agent_manual_command(text,uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.commercial_agent_manual_command(text,uuid,jsonb,uuid) to service_role;
commit;
