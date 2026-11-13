-- Reviewed inbox suggestions: additive local migration; existing manual flows retain their guards.
-- Preserve immutable original payload; link source version/hash to the audited manual ledger.
alter table public.commercial_agent_manual_dispatches
  add column source_agent_draft_id uuid,
  add column source_agent_version integer,
  add column source_agent_reply_hash text,
  add constraint commercial_agent_manual_source_complete check (
    (source_agent_draft_id is null and source_agent_version is null and source_agent_reply_hash is null)
    or (source_agent_draft_id is not null and source_agent_version is not null and source_agent_version>0 and source_agent_reply_hash is not null and source_agent_reply_hash ~ '^[a-f0-9]{64}$')
  );
create index commercial_agent_manual_source_idx on public.commercial_agent_manual_dispatches(organization_id,source_agent_draft_id) where source_agent_draft_id is not null;

create or replace function public.commercial_agent_manual_command(_op text,_org uuid,_data jsonb default '{}',_actor uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg public.commercial_agent_settings%rowtype;
  sess public.commercial_agent_sessions%rowtype;
  item public.commercial_agent_manual_dispatches%rowtype;
  source public.commercial_agent_drafts%rowtype;
  reviewed boolean:=_op='manual_inbox_review_prepare';
  cid text; vid text; inbound_time timestamptz; busy boolean; latest jsonb; code text; virtual boolean:=false; n integer; inbox_op boolean:=_op in ('manual_inbox_context','manual_inbox_prepare','manual_inbox_review_prepare');
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
  if _op='manual_source_retry' then
    -- Recovery evidence is per actor, immutable source and unchanged paused session.
    -- A failed/unknown provider outcome is deliberately not eligible here.
    select m.* into item from public.commercial_agent_manual_dispatches m
      join public.commercial_agent_sessions s on s.organization_id=m.organization_id and s.contact_id=m.contact_id
      where m.organization_id=_org and m.prepared_by=_actor
        and m.source_agent_draft_id=(_data->'sourceAgentDraft'->>'draftId')::uuid
        and m.source_agent_version=(_data->'sourceAgentDraft'->>'version')::integer
        and m.source_agent_reply_hash=_data->'sourceAgentDraft'->>'replyHash'
        and m.state='invalidated' and m.error_code='review_retry_required'
        and m.approved_at is null and m.dispatch_id is null
        and m.session_version=s.version and s.paused and not s.opt_out
      order by m.created_at desc,m.id desc limit 1;
    if not found then return null; end if;
    return to_jsonb(item);
  end if;
  if _op='manual_lookup' then
    select * into item from public.commercial_agent_manual_dispatches where organization_id=_org and request_id=(_data->>'requestId')::uuid;
    if not found then return null; end if;
    if item.prepared_by<>_actor then return jsonb_build_object('error','forbidden'); end if;
    return to_jsonb(item);
  end if;
  if _op in ('manual_context','manual_prepare','manual_inbox_context','manual_inbox_prepare','manual_inbox_review_prepare') then
    cid:=_data->>'contactId'; vid:=_data->>'conversationId';
    -- Inbox variants: the authenticated server proved organization/location/contact/conversation
    -- against canonical GHL reads before calling; no prior queue row is required.
    if coalesce(cid,'') !~ '^[A-Za-z0-9_-]{1,100}$' or coalesce(vid,'') !~ '^[A-Za-z0-9_-]{1,100}$'
      or (inbox_op and _data->>'locationId' is distinct from cfg.location_id)
      or (not inbox_op and not exists(select 1 from public.commercial_agent_inbox where organization_id=_org and contact_id=cid and event->>'conversationId'=vid and event->>'locationId'=cfg.location_id)) then return jsonb_build_object('error','scope_mismatch'); end if;
    select * into sess from public.commercial_agent_sessions where organization_id=_org and contact_id=cid for update;
    if not found then
      if not inbox_op then return jsonb_build_object('error','scope_mismatch'); end if;
      -- Virtual session (version 0); context never writes, prepare creates it atomically below.
      virtual:=true; sess.version:=0; sess.paused:=false; sess.opt_out:=false;
    end if;
    busy:=exists(select 1 from public.commercial_agent_drafts where organization_id=_org and contact_id=cid and state in ('sending','unknown'))
      or exists(select 1 from public.commercial_agent_manual_dispatches where organization_id=_org and contact_id=cid and state in ('sending','unknown'));
    if _op in ('manual_context','manual_inbox_context') then
      select jsonb_build_object('id',id,'state',state,'replyHash',reply_hash,'messageId',result_message_id,'errorCode',error_code) into latest from public.commercial_agent_manual_dispatches where organization_id=_org and contact_id=cid and conversation_id=vid order by created_at desc,id desc limit 1;
      return jsonb_build_object('contactId',cid,'conversationId',vid,'locationId',cfg.location_id,'sessionVersion',sess.version,'paused',sess.paused,'optOut',sess.opt_out,'busy',busy)||case when latest is null then '{}'::jsonb else jsonb_build_object('lastDispatch',latest) end;
    end if;
    select * into item from public.commercial_agent_manual_dispatches where organization_id=_org and request_id=(_data->>'requestId')::uuid;
    if found then
      if item.prepared_by<>_actor or item.contact_id<>cid or item.conversation_id<>vid or item.reply_hash is distinct from _data->>'replyHash' then return jsonb_build_object('error','manual_request_mismatch'); end if;
      return to_jsonb(item);
    end if;
    if busy then return jsonb_build_object('error','reconciliation_required'); end if;
    if inbox_op and (jsonb_typeof(_data->'notAfter') is distinct from 'string' or (_data->>'notAfter') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$' or clock_timestamp()>(_data->>'notAfter')::timestamptz) then return jsonb_build_object('error','request_expired'); end if;
    if cfg.mode<>'supervised' or not cfg.manual_send_all_contacts or not exists(select 1 from public.ghl_connections where organization_id=_org and write_enabled=true) then return jsonb_build_object('error','send_disabled'); end if;
    if _data->>'locationId' is distinct from cfg.location_id then return jsonb_build_object('error','scope_mismatch'); end if;
    if sess.version is distinct from (_data->>'expectedVersion')::integer then return jsonb_build_object('error','version_conflict'); end if;
    if jsonb_typeof(_data->'dnd') is distinct from 'boolean' or jsonb_typeof(_data->'stop') is distinct from 'boolean' then return jsonb_build_object('error','invalid_manual'); end if;
    if sess.opt_out or (_data->>'dnd')::boolean or (_data->>'stop')::boolean then return jsonb_build_object('error','do_not_contact'); end if;
    if _data->>'channel' is null or not (_data->>'channel'=any(case when inbox_op then array['SMS','IG','FB','WhatsApp'] else array['SMS'] end)) then return jsonb_build_object('error','unsupported_channel'); end if;
    if coalesce(_data->>'inboundId','') !~ '^[A-Za-z0-9_-]{1,100}$' or coalesce(_data->>'historyHash','') !~ '^[a-f0-9]{64}$' or coalesce(_data->>'replyHash','') !~ '^[a-f0-9]{64}$' or coalesce(_data->>'payload','')='' then return jsonb_build_object('error','invalid_manual'); end if;
    if jsonb_typeof(_data->'inboundAt') is distinct from 'string' or (_data->>'inboundAt') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?(Z|[+-][0-9]{2}:[0-9]{2})$' then return jsonb_build_object('error','channel_window'); end if;
    begin inbound_time:=(_data->>'inboundAt')::timestamptz; exception when others then return jsonb_build_object('error','channel_window'); end;
    if inbound_time is null or not isfinite(inbound_time) or inbound_time>now() or inbound_time<=now()-(case when inbox_op then interval '24 hours' else interval '23 hours' end) then return jsonb_build_object('error','channel_window'); end if;
    -- An edited AI proposal is a distinct audited manual dispatch, never a replacement of its payload.
    -- Validate under the same organization/session locks as approval/rejection/pause.
    if reviewed then
      if jsonb_typeof(_data->'sourceAgentDraft') is distinct from 'object'
        or coalesce(_data->'sourceAgentDraft'->>'draftId','') !~ '^[0-9a-fA-F-]{36}$'
        or coalesce(_data->'sourceAgentDraft'->>'version','') !~ '^[1-9][0-9]{0,8}$'
        or coalesce(_data->'sourceAgentDraft'->>'replyHash','') !~ '^[a-f0-9]{64}$'
        then return jsonb_build_object('error','invalid_manual'); end if;
      select * into source from public.commercial_agent_drafts where organization_id=_org and id=(_data->'sourceAgentDraft'->>'draftId')::uuid for update;
      if not found then return jsonb_build_object('error','not_found'); end if;
      if source.contact_id<>cid or source.conversation_id<>vid or source.location_id<>cfg.location_id or source.message_id<>_data->>'inboundId' then return jsonb_build_object('error','scope_mismatch'); end if;
      if source.reply_hash<>_data->'sourceAgentDraft'->>'replyHash' then return jsonb_build_object('error','version_conflict'); end if;
      if source.state='pending' then
        if source.version<>(_data->'sourceAgentDraft'->>'version')::integer then return jsonb_build_object('error','version_conflict'); end if;
        if source.contact_version<>sess.version then return jsonb_build_object('error','draft_stale'); end if;
        if sess.paused then return jsonb_build_object('error','human_paused'); end if;
      elsif source.state='invalidated' and source.version=(_data->'sourceAgentDraft'->>'version')::integer+1 then
        if not sess.paused or not exists(select 1 from public.commercial_agent_manual_dispatches m where m.organization_id=_org and m.prepared_by=_actor and m.contact_id=cid and m.conversation_id=vid and m.location_id=cfg.location_id and m.source_agent_draft_id=source.id and m.source_agent_version=source.version-1 and m.source_agent_reply_hash=source.reply_hash and m.session_version=sess.version and m.state='invalidated' and m.error_code='review_retry_required' and m.approved_at is null and m.dispatch_id is null) then return jsonb_build_object('error','version_conflict'); end if;
      else return jsonb_build_object('error','version_conflict'); end if;
      if cardinality(source.flags)>0 then return jsonb_build_object('error','review_required'); end if;
      if virtual or source.expires_at<=clock_timestamp() or source.payload='' then return jsonb_build_object('error','draft_stale'); end if;
      if not (cid=any(cfg.allowed_contacts)) or not ((_data->>'channel')=any(cfg.allowed_channels)) then return jsonb_build_object('error','send_disabled'); end if;
      if inbound_time<=clock_timestamp()-interval '23 hours' then return jsonb_build_object('error','channel_window'); end if;
    elsif _data ? 'sourceAgentDraft' then return jsonb_build_object('error','invalid_manual'); end if;
    if virtual then
      insert into public.commercial_agent_sessions(organization_id,contact_id,version,paused) values(_org,cid,1,true) on conflict do nothing;
      get diagnostics n=row_count;
      if n=0 then return jsonb_build_object('error','version_conflict'); end if;
      select * into sess from public.commercial_agent_sessions where organization_id=_org and contact_id=cid for update;
    else
      update public.commercial_agent_sessions set paused=true,version=version+1 where organization_id=_org and contact_id=cid returning * into sess;
    end if;
    update public.commercial_agent_drafts set state='invalidated',version=version+1 where organization_id=_org and contact_id=cid and state='pending';
    update public.commercial_agent_manual_dispatches set state='invalidated' where organization_id=_org and contact_id=cid and state='prepared';
    insert into public.commercial_agent_manual_dispatches(organization_id,request_id,contact_id,conversation_id,location_id,session_version,inbound_id,inbound_at,channel,history_hash,payload,reply_hash,prepared_by,source_agent_draft_id,source_agent_version,source_agent_reply_hash)
      values(_org,(_data->>'requestId')::uuid,cid,vid,cfg.location_id,sess.version,_data->>'inboundId',inbound_time,_data->>'channel',_data->>'historyHash',_data->>'payload',_data->>'replyHash',_actor,source.id,case when reviewed then (_data->'sourceAgentDraft'->>'version')::integer else null end,source.reply_hash) returning * into item;
    insert into public.commercial_agent_audit(organization_id,draft_id,actor_id,code) values(_org,item.id,_actor,'manual_prepared');
    if reviewed then insert into public.commercial_agent_audit(organization_id,draft_id,actor_id,code) values(_org,source.id,_actor,'inbox_edited_manual_prepared'); end if;
    return to_jsonb(item);
  end if;
  select * into item from public.commercial_agent_manual_dispatches where organization_id=_org and id=(_data->>'manualId')::uuid for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  select * into sess from public.commercial_agent_sessions where organization_id=_org and contact_id=item.contact_id for update;
  if _op='manual_detail' then return to_jsonb(item); end if;
  if _op='manual_cancel_prepared' then
    if item.prepared_by<>_actor then return jsonb_build_object('error','forbidden'); end if;
    if item.state='invalidated' and item.error_code='review_retry_required' and item.approved_at is null and item.dispatch_id is null then return jsonb_build_object('status','invalidated'); end if;
    if item.source_agent_draft_id is null or item.state<>'prepared' or item.approved_at is not null or item.dispatch_id is not null then return jsonb_build_object('error','reconciliation_required'); end if;
    update public.commercial_agent_manual_dispatches set state='invalidated',error_code='review_retry_required' where id=item.id;
    insert into public.commercial_agent_audit(organization_id,draft_id,actor_id,code) values(_org,item.id,_actor,'inbox_review_prepost_cancelled');
    return jsonb_build_object('status','invalidated');
  end if;
  if _op in ('manual_start_send','manual_check_dispatch') and item.source_agent_draft_id is not null and item.state in ('prepared','sending') then
    select * into source from public.commercial_agent_drafts where organization_id=_org and id=item.source_agent_draft_id for update;
    if not found or source.contact_id<>item.contact_id or source.conversation_id<>item.conversation_id or source.location_id<>item.location_id or source.state<>'invalidated' or source.version<>item.source_agent_version+1 or source.reply_hash<>item.source_agent_reply_hash or source.expires_at<=clock_timestamp() or source.payload='' then return jsonb_build_object('error','draft_stale'); end if;
    if cardinality(source.flags)>0 then return jsonb_build_object('error','review_required'); end if;
    if not (item.contact_id=any(cfg.allowed_contacts)) or not (item.channel=any(cfg.allowed_channels)) then return jsonb_build_object('error','send_disabled'); end if;
    if item.inbound_at<=clock_timestamp()-interval '23 hours' then return jsonb_build_object('error','channel_window'); end if;
  end if;
  if _op='manual_start_send' then
    if item.prepared_by<>_actor or item.reply_hash is distinct from _data->>'replyHash' then return jsonb_build_object('error','version_conflict'); end if;
    if item.state in ('sent','unknown','rejected') then return to_jsonb(item); end if;
    if item.state='sending' then return jsonb_build_object('error','reconciliation_required'); end if;
    if _data ? 'notAfter' and (jsonb_typeof(_data->'notAfter') is distinct from 'string' or (_data->>'notAfter') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$' or clock_timestamp()>(_data->>'notAfter')::timestamptz) then return jsonb_build_object('error','request_expired'); end if;
    if item.state<>'prepared' or item.expires_at<=now() or item.payload='' or sess.version<>item.session_version or not sess.paused or item.history_hash is distinct from _data->>'historyHash' then return jsonb_build_object('error','draft_stale'); end if;
    if sess.opt_out then return jsonb_build_object('error','do_not_contact'); end if;
    if cfg.mode<>'supervised' or not cfg.manual_send_all_contacts or item.location_id<>cfg.location_id or not exists(select 1 from public.ghl_connections where organization_id=_org and write_enabled=true) then return jsonb_build_object('error','send_disabled'); end if;
    if item.channel not in ('SMS','IG','FB','WhatsApp') or item.inbound_at>now() or item.inbound_at<=now()-(case when _data ? 'notAfter' then interval '24 hours' else interval '23 hours' end) then return jsonb_build_object('error','channel_window'); end if;
    if exists(select 1 from public.commercial_agent_drafts where organization_id=_org and contact_id=item.contact_id and state in ('sending','unknown')) or exists(select 1 from public.commercial_agent_manual_dispatches where organization_id=_org and contact_id=item.contact_id and id<>item.id and state in ('sending','unknown')) then return jsonb_build_object('error','reconciliation_required'); end if;
    update public.commercial_agent_manual_dispatches set state='sending',approved_by=_actor,approved_at=now(),dispatch_id=gen_random_uuid() where id=item.id returning * into item;
    insert into public.commercial_agent_audit(organization_id,draft_id,actor_id,code) values(_org,item.id,_actor,'manual_approved');
    return to_jsonb(item);
  elsif _op='manual_check_dispatch' then
    if item.state<>'sending' or item.dispatch_id is distinct from (_data->>'dispatchId')::uuid or item.approved_by<>_actor or sess.version<>item.session_version or not sess.paused or sess.opt_out or cfg.mode<>'supervised' or not cfg.manual_send_all_contacts or not exists(select 1 from public.ghl_connections where organization_id=_org and write_enabled=true) then return jsonb_build_object('error','dispatch_blocked'); end if;
    if item.channel not in ('SMS','IG','FB','WhatsApp') or item.inbound_at>now() or item.inbound_at<=now()-(case when _data ? 'notAfter' then interval '24 hours' else interval '23 hours' end) then return jsonb_build_object('error','dispatch_blocked'); end if;
    if _data ? 'notAfter' and (jsonb_typeof(_data->'notAfter') is distinct from 'string' or (_data->>'notAfter') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$' or clock_timestamp()>(_data->>'notAfter')::timestamptz) then return jsonb_build_object('error','dispatch_blocked'); end if;
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
