begin;
create table public.appointment_followup_events (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity unique,
  organization_id uuid not null references public.organizations(id),
  appointment_id uuid not null references public.appointments(id),
  contact_id uuid not null references public.contacts(id),
  request_id uuid not null,
  state text not null check (state in ('aguardando_resposta','presenca_confirmada','remarcacao_solicitada','falha')),
  message_id text not null,
  conversation_id text not null,
  message_at timestamptz not null,
  message_text text not null check (length(message_text) between 1 and 2000),
  message_type text not null,
  message_status text,
  deadline_at timestamptz,
  appointment_start_at timestamptz not null,
  appointment_end_at timestamptz,
  ghl_appointment_id text not null,
  ghl_contact_id text not null,
  actor_id uuid not null references auth.users(id),
  actor_name text not null,
  recorded_at timestamptz not null default now(),
  previous_id uuid references public.appointment_followup_events(id),
  evidence jsonb not null,
  unique(organization_id,request_id),
  unique(organization_id,message_id),
  check ((state='aguardando_resposta' and deadline_at > message_at) or (state<>'aguardando_resposta' and deadline_at is null))
);
create index appointment_followup_history on public.appointment_followup_events(organization_id,appointment_id,seq desc);
alter table public.appointment_followup_events enable row level security;
revoke all on public.appointment_followup_events from public, anon, authenticated;
grant select on public.appointment_followup_events to authenticated;
create policy appointment_followup_read on public.appointment_followup_events for select to authenticated
  using (organization_id=public.current_org_id() and public.tem_papel(array['administrador','gestor','comercial','visualizador']::public.app_role[]));

-- Somente o backend, após consultar a mensagem e a consulta na API oficial.
-- Não concede ao navegador a possibilidade de fabricar evidências verificadas.
create function public.record_appointment_followup(_actor uuid,_org uuid,_appointment uuid,_request uuid,_event jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare a public.appointments%rowtype; prev public.appointment_followup_events%rowtype;
  old public.appointment_followup_events%rowtype; new_id uuid; actor_name text; cid text; loc text;
  st text; dt timestamptz; deadline timestamptz;
begin
  select p.full_name into actor_name from public.profiles p where p.id=_actor and p.organization_id=_org;
  if not found or not exists(select 1 from public.user_roles where user_id=_actor and organization_id=_org and role in ('administrador','gestor','comercial')) then
    raise exception using errcode='42501',message='Sem permissão para registrar acompanhamento.';
  end if;
  select * into a from public.appointments where id=_appointment and organization_id=_org and not is_demo for update;
  if not found or a.contact_id is null or a.ghl_appointment_id is null then raise exception using errcode='23503',message='Consulta indisponível.'; end if;
  select ghl_contact_id into cid from public.contacts where id=a.contact_id and organization_id=_org and not is_demo;
  select location_id into loc from public.ghl_location_bindings where organization_id=_org;
  if cid is null or loc is null or _event->>'location_id' is distinct from loc or _event->>'ghl_contact_id' is distinct from cid
    or (_event->>'contact_id')::uuid is distinct from a.contact_id or _event->>'ghl_appointment_id' is distinct from a.ghl_appointment_id then
    raise exception using errcode='23503',message='Vínculo de evidência inválido.';
  end if;
  if jsonb_typeof(_event) is distinct from 'object' or (_event - array['state','message_id','conversation_id','message_at','message_text','message_type','message_status','message_direction','deadline_at','appointment_start_at','appointment_end_at','ghl_appointment_id','contact_id','ghl_contact_id','location_id','previous_id']) <> '{}'::jsonb
    or coalesce(_event->>'message_id','') !~ '^[A-Za-z0-9_-]{1,100}$' or coalesce(_event->>'conversation_id','') !~ '^[A-Za-z0-9_-]{1,100}$'
    or coalesce(_event->>'message_type','') ~* 'ACTIVITY|CALL|VOICEMAIL' then
    raise exception using errcode='22023',message='Evidência inválida.';
  end if;
  select * into old from public.appointment_followup_events where organization_id=_org and request_id=_request;
  if found then
    if old.appointment_id is distinct from _appointment or old.actor_id is distinct from _actor or old.evidence is distinct from _event then raise exception using errcode='23505',message='Repetição divergente.'; end if;
    return old.id;
  end if;
  if (_event->>'appointment_start_at')::timestamptz is distinct from a.start_at or (_event->>'appointment_end_at')::timestamptz is distinct from a.end_at
    or a.status in ('cancelada','cancelled','canceled','invalid','realizada','faltou') then raise exception using errcode='40001',message='Consulta alterada; atualize a agenda.'; end if;
  select * into prev from public.appointment_followup_events where organization_id=_org and appointment_id=_appointment order by seq desc limit 1;
  if prev.id is distinct from (_event->>'previous_id')::uuid then raise exception using errcode='40001',message='Acompanhamento alterado; atualize.'; end if;
  st := _event->>'state'; dt := (_event->>'message_at')::timestamptz; deadline := (_event->>'deadline_at')::timestamptz;
  if st is null or st not in ('aguardando_resposta','presenca_confirmada','remarcacao_solicitada','falha') or dt is null or dt > now()+interval '1 minute' or (prev.id is not null and dt < prev.message_at) then raise exception using errcode='22023',message='Estado ou data inválidos.'; end if;
  if st='aguardando_resposta' then
    if _event->>'message_direction' is distinct from 'outbound' or coalesce(_event->>'message_status','') not in ('sent','delivered','read','opened','clicked') or deadline is null or extract(epoch from deadline-dt) not in (3600,10800,43200,86400,172800) then raise exception using errcode='22023',message='Solicitação sem envio ou prazo válido.'; end if;
  elsif st='falha' then
    if _event->>'message_direction' is distinct from 'outbound' or coalesce(_event->>'message_status','') not in ('failed','undelivered') or deadline is not null then raise exception using errcode='22023',message='Falha sem evidência do provedor.'; end if;
  else
    if _event->>'message_direction' is distinct from 'inbound' or deadline is not null or prev.id is null or prev.state<>'aguardando_resposta' or dt<=prev.message_at or prev.conversation_id is distinct from _event->>'conversation_id'
      or prev.appointment_start_at is distinct from a.start_at or prev.appointment_end_at is distinct from a.end_at or prev.contact_id is distinct from a.contact_id or prev.ghl_appointment_id is distinct from a.ghl_appointment_id then raise exception using errcode='22023',message='Resposta sem solicitação vinculada válida.'; end if;
  end if;
  insert into public.appointment_followup_events(organization_id,appointment_id,contact_id,request_id,state,message_id,conversation_id,message_at,message_text,message_type,message_status,deadline_at,appointment_start_at,appointment_end_at,ghl_appointment_id,ghl_contact_id,actor_id,actor_name,previous_id,evidence)
    values(_org,_appointment,a.contact_id,_request,st,_event->>'message_id',_event->>'conversation_id',dt,_event->>'message_text',_event->>'message_type',_event->>'message_status',deadline,a.start_at,a.end_at,a.ghl_appointment_id,cid,_actor,coalesce(actor_name,'Equipe'),prev.id,_event) returning id into new_id;
  insert into public.audit_logs(organization_id,actor_id,actor_name,action,entity,entity_id,metadata,verified)
    values(_org,_actor,coalesce(actor_name,'Equipe'),'appointment.followup.linked','appointments',_appointment::text,jsonb_build_object('followup_id',new_id,'state',st,'message_id',_event->>'message_id','correlation','human_reviewed','ghl_modified',false),true);
  return new_id;
end $$;
revoke all on function public.record_appointment_followup(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.record_appointment_followup(uuid,uuid,uuid,uuid,jsonb) to service_role;
comment on table public.appointment_followup_events is 'Evidências consultadas no GHL e associadas a consultas por revisão humana. Somente leitura para clientes; sem alteração do GHL.';
commit;
