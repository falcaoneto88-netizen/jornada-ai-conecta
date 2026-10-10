-- Manual inbox send: conversations opened in the GHL inbox without a prior queue row.
-- Additive: legacy manual_context/manual_prepare keep the queue requirement and SMS-only channel.
-- The AI agent settings (allowed_channels) and all flags are untouched.
alter table public.commercial_agent_manual_dispatches drop constraint commercial_agent_manual_dispatches_channel_check;
alter table public.commercial_agent_manual_dispatches add constraint commercial_agent_manual_dispatches_channel_check check(channel in ('SMS','IG','FB','WhatsApp'));
create or replace function public.commercial_agent_manual_command(_op text,_org uuid,_data jsonb default '{}',_actor uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg public.commercial_agent_settings%rowtype;
  sess public.commercial_agent_sessions%rowtype;
  item public.commercial_agent_manual_dispatches%rowtype;
  cid text; vid text; inbound_time timestamptz; busy boolean; latest jsonb; code text; virtual boolean:=false; n integer; inbox_op boolean:=_op in ('manual_inbox_context','manual_inbox_prepare');
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
  if _op in ('manual_context','manual_prepare','manual_inbox_context','manual_inbox_prepare') then
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
    if inbox_op and (jsonb_typeof(_data->'notAfter') is distinct from 'string' or (_data->>'notAfter') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$' or now()>(_data->>'notAfter')::timestamptz) then return jsonb_build_object('error','request_expired'); end if;
    if cfg.mode<>'supervised' or not cfg.manual_send_all_contacts or not exists(select 1 from public.ghl_connections where organization_id=_org and write_enabled=true) then return jsonb_build_object('error','send_disabled'); end if;
    if _data->>'locationId' is distinct from cfg.location_id then return jsonb_build_object('error','scope_mismatch'); end if;
    if sess.version is distinct from (_data->>'expectedVersion')::integer then return jsonb_build_object('error','version_conflict'); end if;
    if jsonb_typeof(_data->'dnd') is distinct from 'boolean' or jsonb_typeof(_data->'stop') is distinct from 'boolean' then return jsonb_build_object('error','invalid_manual'); end if;
    if sess.opt_out or (_data->>'dnd')::boolean or (_data->>'stop')::boolean then return jsonb_build_object('error','do_not_contact'); end if;
    if _data->>'channel' is null or not (_data->>'channel'=any(case when inbox_op then array['SMS','IG','FB','WhatsApp'] else array['SMS'] end)) then return jsonb_build_object('error','unsupported_channel'); end if;
    if coalesce(_data->>'inboundId','') !~ '^[A-Za-z0-9_-]{1,100}$' or coalesce(_data->>'historyHash','') !~ '^[a-f0-9]{64}$' or coalesce(_data->>'replyHash','') !~ '^[a-f0-9]{64}$' or coalesce(_data->>'payload','')='' then return jsonb_build_object('error','invalid_manual'); end if;
    if jsonb_typeof(_data->'inboundAt') is distinct from 'string' or (_data->>'inboundAt') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?(Z|[+-][0-9]{2}:[0-9]{2})$' then return jsonb_build_object('error','channel_window'); end if;
    begin inbound_time:=(_data->>'inboundAt')::timestamptz; exception when others then return jsonb_build_object('error','channel_window'); end;
    if inbound_time is null or not isfinite(inbound_time) or inbound_time>now() or inbound_time<=now()-interval '23 hours' then return jsonb_build_object('error','channel_window'); end if;
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
    insert into public.commercial_agent_manual_dispatches(organization_id,request_id,contact_id,conversation_id,location_id,session_version,inbound_id,inbound_at,channel,history_hash,payload,reply_hash,prepared_by)
      values(_org,(_data->>'requestId')::uuid,cid,vid,cfg.location_id,sess.version,_data->>'inboundId',inbound_time,_data->>'channel',_data->>'historyHash',_data->>'payload',_data->>'replyHash',_actor) returning * into item;
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
    if _data ? 'notAfter' and (jsonb_typeof(_data->'notAfter') is distinct from 'string' or (_data->>'notAfter') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$' or now()>(_data->>'notAfter')::timestamptz) then return jsonb_build_object('error','request_expired'); end if;
    if item.state<>'prepared' or item.expires_at<=now() or item.payload='' or sess.version<>item.session_version or not sess.paused or item.history_hash is distinct from _data->>'historyHash' then return jsonb_build_object('error','draft_stale'); end if;
    if sess.opt_out then return jsonb_build_object('error','do_not_contact'); end if;
    if cfg.mode<>'supervised' or not cfg.manual_send_all_contacts or item.location_id<>cfg.location_id or not exists(select 1 from public.ghl_connections where organization_id=_org and write_enabled=true) then return jsonb_build_object('error','send_disabled'); end if;
    if item.channel not in ('SMS','IG','FB','WhatsApp') or item.inbound_at>now() or item.inbound_at<=now()-interval '23 hours' then return jsonb_build_object('error','channel_window'); end if;
    if exists(select 1 from public.commercial_agent_drafts where organization_id=_org and contact_id=item.contact_id and state in ('sending','unknown')) or exists(select 1 from public.commercial_agent_manual_dispatches where organization_id=_org and contact_id=item.contact_id and id<>item.id and state in ('sending','unknown')) then return jsonb_build_object('error','reconciliation_required'); end if;
    update public.commercial_agent_manual_dispatches set state='sending',approved_by=_actor,approved_at=now(),dispatch_id=gen_random_uuid() where id=item.id returning * into item;
    insert into public.commercial_agent_audit(organization_id,draft_id,actor_id,code) values(_org,item.id,_actor,'manual_approved');
    return to_jsonb(item);
  elsif _op='manual_check_dispatch' then
    if item.state<>'sending' or item.dispatch_id is distinct from (_data->>'dispatchId')::uuid or item.approved_by<>_actor or sess.version<>item.session_version or not sess.paused or sess.opt_out or cfg.mode<>'supervised' or not cfg.manual_send_all_contacts or not exists(select 1 from public.ghl_connections where organization_id=_org and write_enabled=true) then return jsonb_build_object('error','dispatch_blocked'); end if;
    if item.channel not in ('SMS','IG','FB','WhatsApp') or item.inbound_at>now() or item.inbound_at<=now()-interval '23 hours' then return jsonb_build_object('error','dispatch_blocked'); end if;
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