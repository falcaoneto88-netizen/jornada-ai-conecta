CREATE OR REPLACE FUNCTION public.ghl_apply_contact_event_v2(_inbox_id uuid, _fence integer, _org uuid, _ghl_contact_id text, _full_name text, _phone text, _phone_normalized text, _email text, _tags text[], _source text, _last_interaction timestamp with time zone, _event_type text, _source_version text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.webhooks_inbox%rowtype;
  v_contact_id uuid;
  v_synced_at timestamptz;
  v_created boolean := false;
  v_stage text;
  v_phone_norm text := _phone_normalized;
  v_conflict uuid;
begin
  select * into v_row from public.webhooks_inbox where id = _inbox_id for update;
  if not found then
    return jsonb_build_object('estado', 'entrega_inexistente');
  end if;
  if v_row.organization_id is distinct from _org then
    return jsonb_build_object('estado', 'organizacao_divergente');
  end if;
  if v_row.processed_at is not null or v_row.status = 'processado' then
    return jsonb_build_object('estado', 'ja_processado', 'contact_id', v_row.contact_id, 'created', false);
  end if;
  if v_row.status <> 'a_processar' or v_row.attempts is distinct from _fence then
    return jsonb_build_object('estado', 'reserva_expirada');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(_org::text || ':' || coalesce(_ghl_contact_id, ''), 0));

  select id, ghl_synced_at into v_contact_id, v_synced_at
  from public.contacts
  where organization_id = _org and ghl_contact_id = _ghl_contact_id;

  if v_contact_id is not null
     and _last_interaction is not null
     and v_synced_at is not null
     and _last_interaction < v_synced_at then
    update public.webhooks_inbox set
      status = 'processado',
      processed_at = now(),
      error_message = null,
      locked_at = null,
      contact_id = v_contact_id,
      source_version = coalesce(_source_version, source_version)
    where id = _inbox_id and attempts = _fence;
    return jsonb_build_object('estado', 'versao_antiga_ignorada', 'contact_id', v_contact_id, 'created', false);
  end if;

  if v_phone_norm is not null then
    select id into v_conflict
    from public.contacts
    where organization_id = _org
      and phone_normalized = v_phone_norm
      and (v_contact_id is null or id <> v_contact_id)
    limit 1;
    if v_conflict is not null and v_contact_id is null and _source = 'experiencia-falcao' then
      -- O retorno pode chegar antes do vínculo final do pedido do site.
      -- Não fundir identidades nem criar uma segunda ficha com telefone nulo.
      -- A transação fica sem efeitos; a entrega pode ser repetida após a reconciliação.
      raise exception using errcode='23505',
        message='Contacto do site aguarda vinculo remoto; reconciliar antes de repetir o webhook.';
    end if;
    if v_conflict is not null then
      v_phone_norm := null;
    end if;
  end if;

  if v_contact_id is null then
    select key into v_stage
    from public.journey_stages
    where organization_id = _org
    order by position asc
    limit 1;

    insert into public.contacts (
      organization_id, ghl_contact_id, full_name, phone, phone_normalized,
      email, tags, source, stage_key, last_interaction_at, is_demo,
      ghl_synced_version, ghl_synced_at
    ) values (
      _org, _ghl_contact_id, _full_name, _phone, v_phone_norm,
      _email, coalesce(_tags, '{}'::text[]), _source,
      coalesce(v_stage, 'novo_lead'), _last_interaction, false,
      _source_version, coalesce(_last_interaction, now())
    )
    returning id into v_contact_id;
    v_created := true;
  else
    update public.contacts set
      full_name = _full_name,
      phone = _phone,
      phone_normalized = v_phone_norm,
      email = _email,
      tags = coalesce(_tags, '{}'::text[]),
      source = coalesce(_source, source),
      last_interaction_at = coalesce(_last_interaction, last_interaction_at),
      is_demo = false,
      ghl_synced_version = _source_version,
      ghl_synced_at = coalesce(_last_interaction, now())
    where id = v_contact_id;
  end if;

  insert into public.audit_logs (organization_id, actor_name, action, entity, entity_id, metadata)
  values (
    _org, 'GoHighLevel (webhook)',
    case when v_created then 'ghl.webhook.contacto_criado' else 'ghl.webhook.contacto_atualizado' end,
    'contact', v_contact_id::text,
    jsonb_build_object('event_type', _event_type, 'ghl_contact_id', _ghl_contact_id, 'source_version', _source_version)
  );

  update public.webhooks_inbox set
    status = 'processado',
    processed_at = now(),
    error_message = null,
    locked_at = null,
    contact_id = v_contact_id,
    source_version = coalesce(_source_version, source_version)
  where id = _inbox_id and attempts = _fence;

  return jsonb_build_object('estado', 'processado', 'contact_id', v_contact_id, 'created', v_created);
end;
$function$;
