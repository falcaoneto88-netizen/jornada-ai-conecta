-- Acolhimento pelo canal SMS existente do GoHighLevel (rota do provedor predefinido da conta).
-- Envio e entrega são estados distintos: "entregue" exige recibo real do provedor.

alter table public.site_lead_submissions
  add column if not exists welcome_intent_at timestamptz,
  add column if not exists welcome_sent_at timestamptz,
  add column if not exists welcome_delivered_at timestamptz,
  add column if not exists welcome_message_id text,
  add column if not exists welcome_consent_version text;

alter table public.site_lead_submissions drop constraint if exists site_lead_submissions_acolhimento;
alter table public.site_lead_submissions add constraint site_lead_submissions_acolhimento
  check (welcome_state in ('pendente','preparado','a_enviar','enviado','entregue','bloqueado'));

alter table public.site_integrations drop constraint if exists site_integrations_canal_estado;
alter table public.site_integrations add constraint site_integrations_canal_estado
  check (welcome_channel_state in ('pendente','configurado','bloqueado'));

-- Interruptores explícitos do administrador; permanecem desligados por omissão.
create function public.set_site_integration_flags(
  _organization_id uuid, _remote_write_state text, _welcome_channel_state text, _confirm boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  registo public.site_integrations;
begin
  if auth.uid() is null
    or not public.tem_papel(array['administrador']::public.app_role[])
    or public.current_org_id() is distinct from _organization_id then
    raise exception using errcode='42501', message='Acesso restrito ao administrador da organização.';
  end if;
  if _confirm is distinct from true
    or _remote_write_state not in ('pendente','habilitado','bloqueado')
    or _welcome_channel_state not in ('pendente','configurado','bloqueado') then
    raise exception using errcode='22023', message='Pedido inválido ou não confirmado.';
  end if;
  update public.site_integrations set
    remote_write_state = _remote_write_state,
    welcome_channel_state = _welcome_channel_state
    where organization_id = _organization_id and slug = 'experiencia-falcao'
    returning * into registo;
  if not found then
    raise exception using errcode='22023', message='Integração por configurar.';
  end if;
  insert into public.audit_logs(organization_id,actor_id,actor_name,action,entity,entity_id,metadata,verified)
    values(_organization_id, auth.uid(), 'Administrador', 'site_integration.flags',
      'site_integration', registo.id::text,
      jsonb_build_object('remote_write_state', registo.remote_write_state,
        'welcome_channel_state', registo.welcome_channel_state), true);
  return jsonb_build_object('remote_write_state', registo.remote_write_state,
    'welcome_channel_state', registo.welcome_channel_state);
end $$;
revoke all on function public.set_site_integration_flags(uuid,text,text,boolean) from public, anon, authenticated;
grant execute on function public.set_site_integration_flags(uuid,text,text,boolean) to authenticated;

-- Outbox durável: uma única tentativa por recibo, com intenção auditada antes do envio.
create function public.claim_site_lead_welcome(_submission uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.site_lead_submissions;
  i public.site_integrations;
  c public.contacts;
begin
  select * into s from public.site_lead_submissions where id = _submission for update;
  if not found then
    raise exception using errcode='22023', message='Recibo inexistente.';
  end if;
  select * into i from public.site_integrations where id = s.integration_id;
  if not found or i.enabled is distinct from true
    or i.welcome_channel_state is distinct from 'configurado' then
    raise exception using errcode='42501', message='Canal de acolhimento não configurado.';
  end if;
  if not exists (select 1 from public.ghl_connections
    where organization_id = s.organization_id and write_enabled = true) then
    raise exception using errcode='42501', message='Escrita no GoHighLevel desativada.';
  end if;
  if s.remote_state is distinct from 'confirmado' or s.ghl_contact_id is null then
    raise exception using errcode='42501', message='Contacto no GoHighLevel por confirmar.';
  end if;
  if s.consent_version is null or s.consent_at is null then
    raise exception using errcode='42501', message='Consentimento por documentar.';
  end if;
  if s.welcome_state is distinct from 'pendente' then
    raise exception using errcode='42501', message='Acolhimento já tentado ou bloqueado.';
  end if;
  select * into c from public.contacts where id = s.contact_id;

  update public.site_lead_submissions set
    welcome_state = 'a_enviar',
    welcome_intent_at = now(),
    welcome_consent_version = s.consent_version
    where id = _submission;

  insert into public.audit_logs(organization_id,actor_id,actor_name,action,entity,entity_id,metadata,verified)
    values(s.organization_id, auth.uid(), 'Integração de site', 'site_lead.welcome_intent',
      'site_lead_submission', s.id::text,
      jsonb_build_object('consent_version', s.consent_version, 'consent_at', s.consent_at,
        'channel', 'sms_ghl'), true);

  return jsonb_build_object('submission_id', s.id, 'organization_id', s.organization_id,
    'ghl_contact_id', s.ghl_contact_id, 'first_name', split_part(coalesce(c.full_name,''), ' ', 1),
    'consent_version', s.consent_version);
end $$;
revoke all on function public.claim_site_lead_welcome(uuid) from public, anon, authenticated;
grant execute on function public.claim_site_lead_welcome(uuid) to service_role;

-- Conclusão da tentativa: "enviado" é apenas aceitação da API, nunca entrega.
create function public.finish_site_lead_welcome(
  _submission uuid, _state text, _reason text, _message_id text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.site_lead_submissions;
begin
  if _state not in ('enviado','bloqueado') then
    raise exception using errcode='22023', message='Estado inválido.';
  end if;
  if _message_id is not null and _message_id !~ '^[A-Za-z0-9_-]{1,128}$' then
    raise exception using errcode='22023', message='Identificador de mensagem inválido.';
  end if;
  select * into s from public.site_lead_submissions where id = _submission for update;
  if not found or s.welcome_state is distinct from 'a_enviar' then
    raise exception using errcode='42501', message='Acolhimento não está em envio.';
  end if;
  update public.site_lead_submissions set
    welcome_state = _state,
    welcome_reason = left(coalesce(_reason,''), 200),
    welcome_message_id = _message_id,
    welcome_sent_at = case when _state = 'enviado' then now() else welcome_sent_at end
    where id = _submission
    returning * into s;
  insert into public.audit_logs(organization_id,actor_id,actor_name,action,entity,entity_id,metadata,verified)
    values(s.organization_id, auth.uid(), 'Integração de site', 'site_lead.welcome_' || _state,
      'site_lead_submission', s.id::text,
      jsonb_build_object('reason', left(coalesce(_reason,''), 200),
        'has_message_id', _message_id is not null, 'delivered', false), true);
  return jsonb_build_object('submission_id', s.id, 'welcome_state', s.welcome_state,
    'welcome_message_id', s.welcome_message_id, 'delivered', false);
end $$;
revoke all on function public.finish_site_lead_welcome(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.finish_site_lead_welcome(uuid,text,text,text) to service_role;

-- Entrega só com recibo real do provedor, para a mesma mensagem já aceite.
create function public.record_site_lead_welcome_delivery(
  _submission uuid, _message_id text, _delivered_at timestamptz
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.site_lead_submissions;
begin
  select * into s from public.site_lead_submissions where id = _submission for update;
  if not found or s.welcome_state is distinct from 'enviado'
    or s.welcome_message_id is null or s.welcome_message_id is distinct from _message_id then
    raise exception using errcode='42501', message='Sem envio aceite para esta mensagem.';
  end if;
  update public.site_lead_submissions set
    welcome_state = 'entregue',
    welcome_delivered_at = coalesce(_delivered_at, now())
    where id = _submission
    returning * into s;
  insert into public.audit_logs(organization_id,actor_id,actor_name,action,entity,entity_id,metadata,verified)
    values(s.organization_id, null, 'Integração de site', 'site_lead.welcome_delivered',
      'site_lead_submission', s.id::text,
      jsonb_build_object('delivered', true, 'delivered_at', s.welcome_delivered_at), true);
  return jsonb_build_object('submission_id', s.id, 'welcome_state', s.welcome_state, 'delivered', true);
end $$;
revoke all on function public.record_site_lead_welcome_delivery(uuid,text,timestamptz) from public, anon, authenticated;
grant execute on function public.record_site_lead_welcome_delivery(uuid,text,timestamptz) to service_role;