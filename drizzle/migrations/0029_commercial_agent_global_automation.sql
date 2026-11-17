-- Additive capability only: existing organizations remain disabled. No activation or send.
-- The Drizzle file is an identical mirror; apply one migration, never both.
alter table public.commercial_agent_settings
  add column automation_enabled boolean not null default false,
  add column automation_version bigint not null default 0 check (automation_version >= 0),
  add column automation_since timestamptz,
  add column automation_policy_hash text check (automation_policy_hash is null or automation_policy_hash ~ '^[a-f0-9]{64}$'),
  add column automation_channels text[] not null default '{}',
  add column automation_enabled_by uuid references auth.users(id),
  add column automation_enabled_at timestamptz,
  add constraint commercial_agent_automation_complete check (
    not automation_enabled or (
      automation_version > 0 and automation_since is not null and isfinite(automation_since)
      and automation_policy_hash is not null and cardinality(automation_channels) between 1 and 4
      and automation_enabled_by is not null and automation_enabled_at is not null
    )
  );

alter table public.commercial_agent_drafts
  add column dispatch_origin text not null default 'supervised' check (dispatch_origin in ('supervised','automatic')),
  add column automation_version bigint,
  add column automation_channel text,
  add column automation_authorized_by uuid references auth.users(id),
  add column automation_authorized_at timestamptz,
  add constraint commercial_agent_automatic_dispatch_complete check (
    (dispatch_origin='supervised' and automation_version is null and automation_channel is null and automation_authorized_by is null and automation_authorized_at is null)
    or (dispatch_origin='automatic' and automation_version is not null and automation_version>0 and automation_channel is not null and automation_channel in ('SMS','WhatsApp','IG','FB') and approved_by is null and automation_authorized_by is not null and automation_authorized_at is not null and isfinite(automation_authorized_at))
  );

create function public.commercial_agent_automation_command(_op text,_org uuid,_data jsonb default '{}',_actor uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg public.commercial_agent_settings%rowtype;
  sess public.commercial_agent_sessions%rowtype;
  draft public.commercial_agent_drafts%rowtype;
  job public.commercial_agent_inbox%rowtype;
  requested_enabled boolean; requested_channels text[]; requested_version bigint;
  draft_id uuid; inbound_time timestamptz; now_at timestamptz := clock_timestamp(); can_manage boolean; block_code text;
begin
  -- Same lock order as both existing dispatch RPCs; no network calls under these locks.
  select * into cfg from public.commercial_agent_settings where organization_id=_org for update;
  if not found then return jsonb_build_object('error','not_configured'); end if;
  if not exists(select 1 from public.ghl_location_bindings where organization_id=_org and location_id=cfg.location_id) then
    return jsonb_build_object('error','scope_mismatch');
  end if;
  if _op in ('automation_state','automation_set') then
    if _actor is null or not exists(
      select 1 from public.profiles p join public.user_roles r on r.user_id=p.id and r.organization_id=p.organization_id
      where p.id=_actor and p.organization_id=_org
        and (r.role in ('administrador','gestor') or (_op='automation_state' and r.role='comercial'))
    ) then return jsonb_build_object('error','forbidden'); end if;
    select exists(select 1 from public.profiles p join public.user_roles r on r.user_id=p.id and r.organization_id=p.organization_id
      where p.id=_actor and p.organization_id=_org and r.role in ('administrador','gestor')) into can_manage;
    if _op='automation_state' then return to_jsonb(cfg)||jsonb_build_object('canManage',can_manage); end if;
    if jsonb_typeof(_data) is distinct from 'object'
      or (_data-array['enabled','expectedVersion','policyHash','channels'])<>'{}'::jsonb
      or jsonb_typeof(_data->'enabled') is distinct from 'boolean'
      or jsonb_typeof(_data->'expectedVersion') is distinct from 'number'
      or coalesce(_data->>'expectedVersion','') !~ '^[0-9]{1,15}$'
      then return jsonb_build_object('error','invalid_automation'); end if;
    requested_version:=(_data->>'expectedVersion')::bigint;
    if requested_version<>cfg.automation_version then return jsonb_build_object('error','version_conflict'); end if;
    requested_enabled:=(_data->>'enabled')::boolean;
    if requested_enabled then
      if cfg.mode<>'supervised' or not cfg.receive_all_contacts
        or not exists(select 1 from public.ghl_connections where organization_id=_org and write_enabled=true)
        then return jsonb_build_object('error','send_disabled'); end if;
      if jsonb_typeof(_data->'policyHash') is distinct from 'string' or coalesce(_data->>'policyHash','') !~ '^[a-f0-9]{64}$'
        or jsonb_typeof(_data->'channels') is distinct from 'array'
        then return jsonb_build_object('error','invalid_automation'); end if;
      if jsonb_array_length(_data->'channels') not between 1 and 4
        or exists(select 1 from jsonb_array_elements(_data->'channels') as c(value) where jsonb_typeof(value)<>'string')
        then return jsonb_build_object('error','unsupported_channel'); end if;
      select array_agg(distinct value order by value) into requested_channels from jsonb_array_elements_text(_data->'channels');
      if not (requested_channels <@ array['SMS','WhatsApp','IG','FB']::text[])
        or not (requested_channels <@ cfg.allowed_channels)
        then return jsonb_build_object('error','unsupported_channel'); end if;
      if cfg.automation_enabled and cfg.automation_policy_hash=_data->>'policyHash'
        and cfg.automation_channels=requested_channels then return to_jsonb(cfg)||jsonb_build_object('canManage',true); end if;
      -- Each new authorization starts at server time, never at a client-supplied historical date.
      update public.commercial_agent_settings set automation_enabled=true,
        automation_version=automation_version+1,automation_since=now_at,
        automation_policy_hash=_data->>'policyHash',automation_channels=requested_channels,
        automation_enabled_by=_actor,automation_enabled_at=now_at
        where organization_id=_org returning * into cfg;
    else
      -- The kill switch is available even when CRM write permission has disappeared.
      if not cfg.automation_enabled then return to_jsonb(cfg)||jsonb_build_object('canManage',true); end if;
      update public.commercial_agent_settings set automation_enabled=false,
        automation_version=automation_version+1,automation_since=null,
        automation_policy_hash=null,automation_channels='{}'
        where organization_id=_org returning * into cfg;
    end if;
    insert into public.commercial_agent_audit(organization_id,actor_id,code)
      values(_org,_actor,case when requested_enabled then 'automation_enabled' else 'automation_disabled' end);
    return to_jsonb(cfg)||jsonb_build_object('canManage',true);
  end if;
  -- Internal worker operations are service-only, never impersonate a human approver.
  if _actor is not null then return jsonb_build_object('error','forbidden'); end if;
  if _op='automation_ingress' then
    if jsonb_typeof(_data) is distinct from 'object' then return jsonb_build_object('error','invalid_event'); end if;
    if _data->>'locationId' is distinct from cfg.location_id then return jsonb_build_object('error','scope_mismatch'); end if;
    -- GHL may expose the outgoing message before finish_send records its receipt.
    -- Defer observation briefly, without inserting a tombstone or pausing a person.
    -- The observer must retry the same range. This does not label any unknown ID as ours.
    now_at:=clock_timestamp();
    if _data->>'type'='OutboundMessage' and cfg.mode='supervised'
      and (cfg.receive_all_contacts or coalesce((_data->>'contactId')=any(cfg.allowed_contacts),false))
      and (_data-array['type','locationId','contactId','conversationId','messageId','observedAt'])='{}'::jsonb
      and coalesce(_data->>'contactId','') ~ '^[A-Za-z0-9_-]{1,100}$'
      and coalesce(_data->>'conversationId','') ~ '^[A-Za-z0-9_-]{1,100}$'
      and coalesce(_data->>'messageId','') ~ '^[A-Za-z0-9_-]{1,100}$'
      and exists(select 1 from public.commercial_agent_drafts d
        where d.organization_id=_org and d.location_id=cfg.location_id
          and d.contact_id=_data->>'contactId' and d.conversation_id=_data->>'conversationId'
          and d.dispatch_origin='automatic' and d.state='sending' and d.result_message_id is null
          and d.approved_at>now_at-interval '2 minutes' and d.approved_at<=now_at)
      then return jsonb_build_object('error','receipt_pending'); end if;
    -- Once receipt persistence completes (or the watchdog window expires), the
    -- original ID-based ownership, duplicate and human-pause rules remain authoritative.
    return public.commercial_agent_command('ingress',_org,_data,null);
  end if;
  if _op not in ('automation_detail','automation_start','automation_check','automation_block') then
    return jsonb_build_object('error','unsupported_command'); end if;
  if jsonb_typeof(_data) is distinct from 'object' then return jsonb_build_object('error','invalid_automation'); end if;
  begin draft_id:=(_data->>'draftId')::uuid;
  exception when others then return jsonb_build_object('error','invalid_automation'); end;
  select * into draft from public.commercial_agent_drafts where organization_id=_org and id=draft_id;
  if not found then return jsonb_build_object('error','not_found'); end if;
  select * into sess from public.commercial_agent_sessions where organization_id=_org and contact_id=draft.contact_id for update;
  if not found then return jsonb_build_object('error','scope_mismatch'); end if;
  select * into draft from public.commercial_agent_drafts where organization_id=_org and id=draft_id for update;
  if _op='automation_detail' then
    return to_jsonb(draft)||jsonb_build_object('paused',sess.paused,'opt_out',sess.opt_out,'session_version',sess.version);
  end if;
  if _op='automation_block' then
    block_code:=_data->>'code';
    if block_code is null or block_code !~ '^[a-z_]{1,60}$' then
      return jsonb_build_object('error','invalid_automation'); end if;
    -- Ineligibility/kill-switch races do not transfer every affected contact to a human.
    if block_code in ('send_disabled','automation_disabled','automation_policy_changed','before_automation_since','version_conflict','human_paused','reconciliation_required')
      or draft.state<>'pending' or draft.contact_version<>sess.version or sess.paused or sess.opt_out then
      return jsonb_build_object('status','unchanged'); end if;
    update public.commercial_agent_sessions set paused=true,version=version+1
      where organization_id=_org and contact_id=draft.contact_id;
    update public.commercial_agent_drafts set state='invalidated',version=version+1,
      error_code=case when id=draft.id then block_code else error_code end
      where organization_id=_org and contact_id=draft.contact_id and state='pending';
    insert into public.commercial_agent_audit(organization_id,draft_id,code)
      values(_org,draft.id,'automatic_blocked');
    return jsonb_build_object('status','blocked','code',block_code);
  end if;
  if not cfg.automation_enabled or cfg.mode<>'supervised' or not cfg.receive_all_contacts
    or not exists(select 1 from public.ghl_connections where organization_id=_org and write_enabled=true)
    then return jsonb_build_object('error','send_disabled'); end if;
  if jsonb_typeof(_data->'automationVersion') is distinct from 'number'
    or coalesce(_data->>'automationVersion','') !~ '^[0-9]{1,15}$' then return jsonb_build_object('error','version_conflict'); end if;
  if cfg.automation_version is distinct from (_data->>'automationVersion')::bigint then return jsonb_build_object('error','version_conflict'); end if;
  if cfg.automation_policy_hash is distinct from _data->>'policyHash'
    or draft.policy_hash is distinct from cfg.automation_policy_hash
    then return jsonb_build_object('error','draft_stale'); end if;
  if draft.location_id<>cfg.location_id then return jsonb_build_object('error','scope_mismatch'); end if;
  if sess.opt_out then return jsonb_build_object('error','do_not_contact'); end if;
  if sess.paused then return jsonb_build_object('error','human_paused'); end if;
  if draft.contact_version<>sess.version or draft.expires_at<=now_at or draft.payload='' then
    return jsonb_build_object('error','draft_stale'); end if;
  if cardinality(draft.flags)>0 then return jsonb_build_object('error','review_required'); end if;
  select * into job from public.commercial_agent_inbox where id=draft.event_id and organization_id=_org;
  if not found or job.event_type<>'InboundMessage' or job.state<>'ready'
    or job.contact_id<>draft.contact_id or job.message_id<>draft.message_id
    or job.event->>'conversationId' is distinct from draft.conversation_id
    or job.event->>'locationId' is distinct from cfg.location_id
    then return jsonb_build_object('error','scope_mismatch'); end if;
  if job.observed_at is null or not isfinite(job.observed_at) or job.observed_at<cfg.automation_since
    then return jsonb_build_object('error','before_automation_since'); end if;
  if job.observed_at>now_at or job.observed_at<=now_at-interval '23 hours' then
    return jsonb_build_object('error','channel_window'); end if;
  if exists(select 1 from public.commercial_agent_drafts where organization_id=_org and contact_id=draft.contact_id and id<>draft.id and state in ('sending','unknown'))
    or exists(select 1 from public.commercial_agent_manual_dispatches where organization_id=_org and contact_id=draft.contact_id and state in ('prepared','sending','unknown'))
    then return jsonb_build_object('error','reconciliation_required'); end if;
  if _op='automation_start' then
    if jsonb_typeof(_data->'version') is distinct from 'number'
      or coalesce(_data->>'version','') !~ '^[0-9]{1,9}$' then return jsonb_build_object('error','version_conflict'); end if;
    if draft.version is distinct from (_data->>'version')::integer
      or draft.reply_hash is distinct from _data->>'replyHash'
      or draft.state<>'pending' or draft.dispatch_origin<>'supervised'
      then return jsonb_build_object('error','version_conflict'); end if;
    if not coalesce((_data->>'channel')=any(cfg.automation_channels),false)
      or not coalesce((_data->>'channel')=any(cfg.allowed_channels),false)
      then return jsonb_build_object('error','unsupported_channel'); end if;
    begin inbound_time:=(_data->>'inboundAt')::timestamptz;
    exception when others then return jsonb_build_object('error','channel_window'); end;
    if inbound_time is distinct from job.observed_at then return jsonb_build_object('error','inbound_not_verified'); end if;
    -- approved_at is the legacy dispatch/watchdog timestamp, NOT a human approval.
    -- Human attribution stays NULL and automatic origin/epoch are immutable on this reservation.
    update public.commercial_agent_drafts set state='sending',dispatch_origin='automatic',
      automation_version=cfg.automation_version,automation_channel=_data->>'channel',
      automation_authorized_by=cfg.automation_enabled_by,automation_authorized_at=cfg.automation_enabled_at,
      approved_by=null,approved_at=now_at,dispatch_id=gen_random_uuid(),version=version+1
      where id=draft.id returning * into draft;
    insert into public.commercial_agent_audit(organization_id,draft_id,code)
      values(_org,draft.id,'automatic_dispatch');
    return to_jsonb(draft);
  end if;
  if draft.state<>'sending' or draft.dispatch_origin<>'automatic'
    or draft.automation_version<>cfg.automation_version
    or draft.dispatch_id::text is distinct from _data->>'dispatchId'
    then return jsonb_build_object('error','dispatch_blocked'); end if;
  if not (draft.automation_channel=any(cfg.automation_channels))
    or not (draft.automation_channel=any(cfg.allowed_channels)) then
    return jsonb_build_object('error','unsupported_channel'); end if;
  return jsonb_build_object('status','allowed');
end $$;
revoke all on function public.commercial_agent_automation_command(text,uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.commercial_agent_automation_command(text,uuid,jsonb,uuid) to service_role;
-- Existing settings/drafts RLS and client revocations remain in force. No scheduler or flag changes.