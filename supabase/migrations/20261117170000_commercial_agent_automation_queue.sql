begin;
-- Read-only V2 projection, additive to the existing supervised RPC.
-- Recognizes the separate automatic policy without placing it in human approval.
-- Does not activate automation, change rows, purge payloads or send messages.
-- Apply this Supabase migration OR its identical Drizzle mirror, never both.
create function public.commercial_agent_queue_read_v2(
  _org uuid, _location text, _actor uuid, _kind text default 'drafts',
  _category text default 'review', _query text default '', _page integer default 1,
  _page_size integer default 25, _as_of timestamptz default null, _policy_hash text default '',
  _automation_policy_hash text default ''
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare cfg public.commercial_agent_settings%rowtype;
  anchor timestamptz := coalesce(_as_of, statement_timestamp());
  needle text := lower(btrim(coalesce(_query,'')));
  result jsonb;
begin
  if _actor is null or not exists (
    select 1 from public.profiles p join public.user_roles r
      on r.user_id=p.id and r.organization_id=p.organization_id
    where p.id=_actor and p.organization_id=_org
      and r.role in ('administrador','gestor','comercial')
  ) then return jsonb_build_object('error','forbidden'); end if;
  select * into cfg from public.commercial_agent_settings where organization_id=_org;
  if not found then return jsonb_build_object('error','not_configured'); end if;
  if cfg.location_id is distinct from _location or not exists (
    select 1 from public.ghl_location_bindings where organization_id=_org and location_id=_location
  ) then return jsonb_build_object('error','scope_mismatch'); end if;
  if _kind is null or _kind not in ('drafts','manual')
    or _category is null or _category not in ('review','team','uncertain','history')
    or _page is null or _page not between 1 and 10000
    or _page_size is null or _page_size not between 1 and 50
    or length(needle)>100 or not isfinite(anchor) or anchor>statement_timestamp()
    or (_kind='drafts' and (_policy_hash is null or _policy_hash !~ '^[a-f0-9]{64}$'
      or _automation_policy_hash is null or _automation_policy_hash !~ '^[a-f0-9]{64}$'
      or _automation_policy_hash=_policy_hash))
  then return jsonb_build_object('error','invalid_request'); end if;

  if _kind='manual' then
    with latest as materialized (
      select distinct on (i.contact_id,i.event->>'conversationId')
        i.contact_id, i.event->>'conversationId' as conversation_id,
        i.created_at, i.id
      from public.commercial_agent_inbox i
      where i.organization_id=_org and i.event->>'locationId'=_location
        and i.event->>'contactId'=i.contact_id
        and i.event->>'conversationId' ~ '^[A-Za-z0-9_-]{1,100}$'
        and i.created_at<=anchor
      order by i.contact_id,i.event->>'conversationId',i.created_at desc,i.id desc
    ), scoped as materialized (
      select l.*, s.version,s.paused,s.opt_out,
        nullif(btrim(c.full_name),'') as contact_name
      from latest l join public.commercial_agent_sessions s
        on s.organization_id=_org and s.contact_id=l.contact_id
      left join public.contacts c on c.organization_id=_org
        and c.ghl_contact_id=l.contact_id and not c.is_demo
      where needle='' or strpos(lower(coalesce(c.full_name,'')),needle)>0
        or strpos(lower(l.contact_id),needle)>0
    ), selected as (
      select * from scoped order by created_at desc,id desc
      limit _page_size offset ((_page-1)*_page_size)
    ) select jsonb_build_object(
      'settings',to_jsonb(cfg), 'asOf',anchor,
      'total',(select count(*) from scoped),
      'items',coalesce((select jsonb_agg(jsonb_build_object(
        'locationId',_location,'contactId',contact_id,'conversationId',conversation_id,
        'sessionVersion',version,'paused',paused,'optOut',opt_out,
        -- Inbox created_at is receipt time, not the canonical GHL message timestamp.
        'lastMessageAt',null,'contactName',contact_name,'channel',null
      ) order by created_at desc,id desc) from selected),'[]'::jsonb)
    ) into result;
    return result;
  end if;

  with scoped as materialized (
    select d.id,d.organization_id,d.event_id,d.contact_id,d.conversation_id,d.location_id,
      d.message_id,d.contact_version,d.version,d.state,d.reply_hash,d.policy_hash,
      d.approved_at,d.result_message_id,d.error_code,d.created_at,d.expires_at,
      d.dispatch_origin,d.automation_authorized_by,d.automation_authorized_at,
      -- Preserve the existing seven-day visibility boundary without turning a GET
      -- into a purge. Unknown/in-flight sends retain evidence for reconciliation.
      case when d.created_at<statement_timestamp()-interval '7 days'
        and d.state not in ('sending','unknown') then '' else d.payload end as payload,
      coalesce(s.paused,true) as paused,coalesce(s.opt_out,true) as opt_out,
      coalesce(s.version,0) as session_version,nullif(btrim(c.full_name),'') as contact_name,
      case
        when d.state in ('sending','unknown') then 'uncertain'
        -- automation_block intentionally invalidates the send and bumps the session
        -- version. Its audited handoff must remain visible while the team owns it.
        when d.state='invalidated' and d.error_code is not null and s.paused
          and d.payload<>'' and d.created_at>=statement_timestamp()-interval '7 days'
          and exists (select 1 from public.commercial_agent_audit a
            where a.organization_id=d.organization_id and a.draft_id=d.id
              and a.code='automatic_blocked') then 'team'
        when d.state<>'pending' or d.payload='' or d.expires_at<=statement_timestamp()
          or d.created_at<statement_timestamp()-interval '7 days'
          or s.contact_id is null or d.contact_version<>s.version
          or d.policy_hash not in (_policy_hash,_automation_policy_hash) then 'history'
        -- A current automatic draft is never a human approval candidate.
        when d.policy_hash=_automation_policy_hash or s.paused or s.opt_out or cardinality(d.flags)>0 then 'team'
        else 'review'
      end as category
    from public.commercial_agent_drafts d
    left join public.commercial_agent_sessions s
      on s.organization_id=d.organization_id and s.contact_id=d.contact_id
    left join public.contacts c on c.organization_id=d.organization_id
      and c.ghl_contact_id=d.contact_id and not c.is_demo
    where d.organization_id=_org and d.location_id=_location and d.created_at<=anchor
      and (needle='' or strpos(lower(coalesce(c.full_name,'')),needle)>0
        or strpos(lower(d.contact_id),needle)>0)
  ), selected as (
    select * from scoped where category=_category order by created_at desc,id desc
    limit _page_size offset ((_page-1)*_page_size)
  ), events as materialized (
    select i.id,i.state,i.error_code,i.attempts,i.created_at
    from public.commercial_agent_inbox i
    left join public.contacts c on c.organization_id=i.organization_id
      and c.ghl_contact_id=i.contact_id and not c.is_demo
    where i.organization_id=_org and i.event->>'locationId'=_location
      and i.event->>'contactId'=i.contact_id and i.created_at<=anchor
      and (needle='' or strpos(lower(coalesce(c.full_name,'')),needle)>0
        or strpos(lower(i.contact_id),needle)>0)
  ) select jsonb_build_object(
    'settings',to_jsonb(cfg),'asOf',anchor,
    'counts',jsonb_build_object(
      'review',(select count(*) from scoped where category='review'),
      'team',(select count(*) from scoped where category='team'),
      'uncertain',(select count(*) from scoped where category='uncertain'),
      'history',(select count(*) from scoped where category='history')
    ),
    'items',coalesce((select jsonb_agg(to_jsonb(selected) order by created_at desc,id desc) from selected),'[]'::jsonb),
    'errors',coalesce((select jsonb_agg(to_jsonb(e) order by created_at desc,id desc)
      from (select * from events where state='failed' and error_code is not null
        order by created_at desc,id desc limit 20) e),'[]'::jsonb),
    'failedEventCount',(select count(*) from events where state='failed' and error_code is not null),
    'ignoredEventCount',(select count(*) from events where state='ignored')
  ) into result;
  return result;
end $$;
revoke all on function public.commercial_agent_queue_read_v2(uuid,text,uuid,text,text,text,integer,integer,timestamptz,text,text) from public,anon,authenticated;
grant execute on function public.commercial_agent_queue_read_v2(uuid,text,uuid,text,text,text,integer,integer,timestamptz,text,text) to service_role;
create index commercial_agent_automatic_handoff_read on public.commercial_agent_audit(organization_id,draft_id) where code='automatic_blocked';
commit;
