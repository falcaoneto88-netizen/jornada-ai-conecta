-- Additive extension: 0027 stays immutable. Existing policy selections and flags are preserved.
-- Confirmation keeps exact reply/appointment evidence; production ACK never ignores unowned activity.
alter table public.n8n_bridge_runtime_policies
  drop constraint n8n_bridge_runtime_policies_check;
alter table public.n8n_bridge_runtime_policies
  add constraint n8n_bridge_runtime_production_check check (
    mode<>'production' or (location_id is not null and calendar_id is not null and
      channel is not null and zaptos_provider_id is not null and verified_at is not null
      and cardinality(allowed_kinds)>0 and
      allowed_kinds <@ array['booking','req24','req12','appointment.confirm','confirm']::text[])
  );

create or replace function public.n8n_bridge_set_runtime_policy(
  _actor uuid, _mode text, _expected_revision bigint, _allowed_kinds text[],
  _location text default null, _calendar text default null,
  _provider text default null, _verified_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare org uuid; old public.n8n_bridge_runtime_policies%rowtype;
  cfg public.n8n_bridge_settings%rowtype; next_revision bigint; stamp timestamptz;
  location text; calendar text; provider text; channel text; verified timestamptz;
begin
  if _actor is null then return jsonb_build_object('error','forbidden'); end if;
  select p.organization_id into org from public.profiles p where p.id=_actor for share;
  if org is null then return jsonb_build_object('error','forbidden'); end if;
  perform 1 from public.user_roles u where u.user_id=_actor and u.organization_id=org
    and u.role='administrador' for share;
  if not found then return jsonb_build_object('error','forbidden'); end if;
  if _mode is null or _mode not in ('off','pilot','production') or _expected_revision is null
    or _expected_revision<0 or _expected_revision>=9007199254740991 or _allowed_kinds is null
    or coalesce(array_ndims(_allowed_kinds),1)<>1 or cardinality(_allowed_kinds)>5
    or array_position(_allowed_kinds,null) is not null
    or not (_allowed_kinds <@ array['booking','req24','req12','confirm','appointment.confirm']::text[])
    or cardinality(_allowed_kinds)<>(select count(distinct x) from unnest(_allowed_kinds) x)
    or (_mode='production' and (cardinality(_allowed_kinds)=0 or
      not (_allowed_kinds <@ array['booking','req24','req12','appointment.confirm','confirm']::text[])))
    then return jsonb_build_object('error','invalid_request'); end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('n8n-runtime:'||org::text,0));
  select * into old from public.n8n_bridge_runtime_policies where organization_id=org for update;
  if coalesce(old.revision,0)<>_expected_revision
    then return jsonb_build_object('error','revision_conflict'); end if;
  select * into cfg from public.n8n_bridge_settings where organization_id=org for update;

  if _mode='production' then
    if cfg.organization_id is null or cfg.channel is distinct from 'whatsapp_zaptos'
      or cfg.calendar_id is null or cfg.zaptos_provider_id is null
      or cfg.calendar_id is distinct from _calendar or cfg.zaptos_provider_id is distinct from _provider
      then return jsonb_build_object('error','configuration_changed'); end if;
    perform 1 from public.ghl_location_bindings b where b.organization_id=org and b.location_id=_location for share;
    if not found then return jsonb_build_object('error','binding_unavailable'); end if;
    perform 1 from public.ghl_connections c where c.organization_id=org and c.location_id=_location
      and c.status='conectada' and c.write_enabled=true for share;
    if not found then return jsonb_build_object('error','binding_unavailable'); end if;
    if 'confirm'=any(_allowed_kinds) and btrim(coalesce(cfg.clinic_address,''))=''
      then return jsonb_build_object('error','address_not_configured'); end if;
    stamp:=clock_timestamp();
    if _verified_at is null or _verified_at>stamp or _verified_at<stamp-interval '2 minutes'
      then return jsonb_build_object('error','verification_expired'); end if;
    location:=_location; calendar:=cfg.calendar_id; provider:=cfg.zaptos_provider_id;
    channel:='whatsapp_zaptos'; verified:=_verified_at;
  else
    -- Revocation never depends on GHL availability or on the old tuple still being valid.
    location:=old.location_id; calendar:=old.calendar_id; provider:=old.zaptos_provider_id;
    channel:=old.channel; verified:=null;
  end if;
  stamp:=clock_timestamp(); next_revision:=coalesce(old.revision,0)+1;
  insert into public.n8n_bridge_runtime_policies as p
    (organization_id,mode,location_id,calendar_id,channel,zaptos_provider_id,allowed_kinds,revision,verified_at,updated_by,updated_at)
    values(org,_mode,location,calendar,channel,provider,case when _mode='off' then '{}'::text[] else _allowed_kinds end,
      next_revision,verified,_actor,stamp)
    on conflict(organization_id) do update set mode=excluded.mode,location_id=excluded.location_id,
      calendar_id=excluded.calendar_id,channel=excluded.channel,zaptos_provider_id=excluded.zaptos_provider_id,
      allowed_kinds=excluded.allowed_kinds,revision=excluded.revision,verified_at=excluded.verified_at,
      updated_by=excluded.updated_by,updated_at=excluded.updated_at;
  insert into public.n8n_bridge_settings as s
    (organization_id,bridge_enabled,live_send_enabled,simulation,channel_verified,updated_by,updated_at)
    values(org,_mode<>'off',_mode='production',_mode<>'production',_mode='production',_actor,stamp)
    on conflict(organization_id) do update set bridge_enabled=excluded.bridge_enabled,
      live_send_enabled=excluded.live_send_enabled,simulation=excluded.simulation,
      channel_verified=case when _mode='production' then true else s.channel_verified end,
      updated_by=excluded.updated_by,updated_at=excluded.updated_at;
  insert into public.audit_logs(organization_id,actor_id,action,entity,entity_id,metadata,verified)
    values(org,_actor,'n8n.runtime.policy.changed','n8n_bridge_runtime_policies',org::text,
      jsonb_build_object('previous_mode',coalesce(old.mode,'pilot'),'mode',_mode,
        'previous_revision',coalesce(old.revision,0),'revision',next_revision,
        'location_id',location,'calendar_id',calendar,'channel',channel,'provider_id',provider,
        'allowed_kinds',case when _mode='off' then '{}'::text[] else _allowed_kinds end,
        'live_send_enabled',_mode='production','simulation',_mode<>'production'),true);
  return jsonb_build_object('revision',next_revision);
end $$;
revoke all on function public.n8n_bridge_set_runtime_policy(uuid,text,bigint,text[],text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.n8n_bridge_set_runtime_policy(uuid,text,bigint,text[],text,text,text,timestamptz) to service_role;
