begin;

-- Exclusiva do backend: a identidade/location do detalhe é verificada antes da chamada.
create function public.ghl_apply_contact_snapshot(_org uuid, _location text, _actor uuid, _contact jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; v_at timestamptz; v_existing_at timestamptz;
  v_ghl text := nullif(_contact->>'id', '');
  v_phone text := nullif(regexp_replace(coalesce(_contact->>'phone', ''), '\D', '', 'g'), '');
  v_stage text; v_created boolean := false; v_nome text; v_actor_name text;
begin
  if not exists (select 1 from public.ghl_location_bindings where organization_id = _org and location_id = _location)
    or not exists (select 1 from public.user_roles where user_id = _actor and organization_id = _org and role = 'administrador')
    or not exists (select 1 from public.profiles where id = _actor and organization_id = _org)
    or not exists (select 1 from public.ghl_connections where organization_id = _org and status = 'conectada') then
    raise exception 'Sincronizacao nao autorizada';
  end if;
  if v_ghl is null or _contact->>'locationId' is distinct from _location then
    raise exception 'Identidade ou location invalida';
  end if;
  v_at := (_contact->>'dateUpdated')::timestamptz;
  if v_at is null or not isfinite(v_at) then raise exception 'Versao de contacto invalida'; end if;

  -- A mesma chave usada pelo recetor de webhooks serializa escritas no mesmo contacto.
  perform pg_advisory_xact_lock(hashtextextended(_org::text || ':' || v_ghl, 0));
  select id, ghl_synced_at into v_id, v_existing_at from public.contacts
    where organization_id = _org and ghl_contact_id = v_ghl for update;
  if v_id is not null and v_existing_at is not null and v_at <= v_existing_at then
    return jsonb_build_object('estado', 'ignorado');
  end if;

  -- Nunca associar pessoas pelo telefone nem descartar a colisão sem informar.
  if v_phone is not null and exists (select 1 from public.contacts
    where organization_id = _org and phone_normalized = v_phone and id is distinct from v_id) then
    return jsonb_build_object('estado', 'conflito_telefone');
  end if;
  v_nome := coalesce(nullif(trim(concat_ws(' ', nullif(_contact->>'firstName', ''), nullif(_contact->>'lastName', ''))), ''),
    nullif(_contact->>'contactName', ''), nullif(_contact->>'email', ''), 'Sem nome');
  begin
    if v_id is null then
      select key into v_stage from public.journey_stages where organization_id = _org order by position, key limit 1;
      if v_stage is null then raise exception 'Organizacao sem etapa inicial'; end if;
      insert into public.contacts (organization_id, ghl_contact_id, full_name, phone, phone_normalized, email,
        tags, source, stage_key, last_interaction_at, is_demo, ghl_synced_at, ghl_synced_version)
      values (_org, v_ghl, v_nome, _contact->>'phone', v_phone, _contact->>'email',
        array(select jsonb_array_elements_text(coalesce(nullif(_contact->'tags', 'null'::jsonb), '[]'::jsonb))),
        coalesce(_contact->>'source', 'GoHighLevel'), v_stage, v_at, false, v_at, 'v:' || (_contact->>'dateUpdated'))
      returning id into v_id;
      v_created := true;
    else
      update public.contacts set full_name = v_nome, phone = _contact->>'phone', phone_normalized = v_phone,
        email = _contact->>'email',
        tags = array(select jsonb_array_elements_text(coalesce(nullif(_contact->'tags', 'null'::jsonb), '[]'::jsonb))),
        source = coalesce(_contact->>'source', source), last_interaction_at = v_at, is_demo = false,
        ghl_synced_at = v_at, ghl_synced_version = 'v:' || (_contact->>'dateUpdated')
      where id = v_id;
      -- A etapa definida pela equipa é preservada.
    end if;
  exception when unique_violation then
    -- Outra transação pode ter ocupado o telefone depois da verificação.
    return jsonb_build_object('estado', 'conflito_concorrente');
  end;
  select full_name into v_actor_name from public.profiles where id = _actor;
  insert into public.audit_logs (organization_id, actor_id, actor_name, action, entity, entity_id, metadata, verified)
  values (_org, _actor, v_actor_name, 'ghl.sync.contacto', 'contacts', v_id::text,
    jsonb_build_object('created', v_created, 'source_updated_at', v_at), true);
  return jsonb_build_object('estado', 'aplicado');
end $$;
revoke all on function public.ghl_apply_contact_snapshot(uuid, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ghl_apply_contact_snapshot(uuid, text, uuid, jsonb) to service_role;

-- Resumo e carimbo de conclusão são atómicos, emitidos só após concluir todas as páginas.
create function public.ghl_finish_contact_sync(_org uuid, _location text, _actor uuid, _importados integer, _ignorados integer)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare v_agora timestamptz := now(); v_nome text;
begin
  if not exists (select 1 from public.ghl_location_bindings where organization_id = _org and location_id = _location)
    or not exists (select 1 from public.user_roles where organization_id = _org and user_id = _actor and role = 'administrador')
    or not exists (select 1 from public.profiles where id = _actor and organization_id = _org)
    or _importados is null or _ignorados is null or _importados < 0 or _ignorados < 0 then
    raise exception 'Conclusao de sincronizacao nao autorizada';
  end if;
  update public.ghl_connections set last_sync_at = v_agora where organization_id = _org and status = 'conectada';
  if not found then raise exception 'Ligacao indisponivel'; end if;
  select full_name into v_nome from public.profiles where id = _actor;
  insert into public.audit_logs (organization_id, actor_id, actor_name, action, entity, metadata, verified)
    values (_org, _actor, v_nome, 'ghl.sync.leitura', 'ghl',
      jsonb_build_object('importados', _importados, 'ignorados', _ignorados), true);
  return v_agora;
end $$;
revoke all on function public.ghl_finish_contact_sync(uuid, text, uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.ghl_finish_contact_sync(uuid, text, uuid, integer, integer) to service_role;

commit;
