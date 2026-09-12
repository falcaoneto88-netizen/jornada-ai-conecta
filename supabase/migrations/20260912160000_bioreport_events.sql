begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists bioreport_private;
revoke all on schema bioreport_private from public, anon, authenticated;
create table bioreport_private.signing_keys (
  organization_id uuid not null references public.organizations(id),
  key_id text not null check (key_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  secret text not null check (secret ~ '^[a-f0-9]{64}$'),
  enabled boolean not null default true,
  primary key (organization_id, key_id)
);
alter table bioreport_private.signing_keys enable row level security;
revoke all on bioreport_private.signing_keys from public, anon, authenticated;

create table public.bioreport_patient_links (
  organization_id uuid not null references public.organizations(id),
  patient_id uuid not null,
  contact_id uuid not null references public.contacts(id),
  ghl_contact_id text not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, patient_id),
  unique (organization_id, contact_id),
  unique (organization_id, ghl_contact_id)
);
create table public.bioreport_consultation_links (
  organization_id uuid not null,
  consultation_id uuid not null,
  patient_id uuid not null,
  primary key (organization_id, consultation_id),
  foreign key (organization_id, patient_id) references public.bioreport_patient_links(organization_id, patient_id)
);
create table public.bioreport_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  event_id text not null,
  event_type text not null check (event_type in ('anamnese_recebida', 'relatorio_disponivel')),
  consultation_id uuid not null,
  patient_id uuid not null,
  record_id uuid not null,
  contact_id uuid not null references public.contacts(id),
  ghl_contact_id text not null,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  event_data jsonb not null,
  unique (organization_id, event_id),
  foreign key (organization_id, consultation_id) references public.bioreport_consultation_links(organization_id, consultation_id)
);
alter table public.bioreport_patient_links enable row level security;
alter table public.bioreport_consultation_links enable row level security;
alter table public.bioreport_events enable row level security;
revoke all on public.bioreport_patient_links, public.bioreport_consultation_links, public.bioreport_events from public, anon, authenticated;
grant select on public.bioreport_patient_links, public.bioreport_consultation_links, public.bioreport_events to authenticated;
create policy bioreport_patients_admin on public.bioreport_patient_links for select to authenticated
  using (organization_id = public.current_org_id() and public.tem_papel(array['administrador']::public.app_role[]));
create policy bioreport_consultations_admin on public.bioreport_consultation_links for select to authenticated
  using (organization_id = public.current_org_id() and public.tem_papel(array['administrador']::public.app_role[]));
create policy bioreport_events_admin on public.bioreport_events for select to authenticated
  using (organization_id = public.current_org_id() and public.tem_papel(array['administrador']::public.app_role[]));

-- Capability estrita: valida a assinatura DENTRO do banco, inclusive quando chamada
-- diretamente pelo REST. Não aceita conteúdo clínico, mensagens, SQL ou URLs livres.
-- SECURITY DEFINER permite somente este ingresso assinado; não usa service role.
create function public.receive_bioreport_event(_body text, _signature text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  p jsonb; org uuid; patient uuid; consultation uuid; source_id uuid;
  key_secret text; expected_signature text; contact uuid; previous jsonb;
  stable_data jsonb; receipt jsonb; issued bigint; occurred timestamptz;
  fields text[] := array['version','issuer','audience','key_id','organization_id','location_id','event_id','event_type','consultation_id','patient_id','record_id','ghl_contact_id','occurred_at','issued_at'];
begin
  if _body is null or octet_length(_body) > 4096 or coalesce(_signature,'') !~ '^[a-f0-9]{64}$' then
    raise exception using errcode='28000', message='Evento não autenticado.';
  end if;
  p := _body::jsonb;
  if jsonb_typeof(p) is distinct from 'object' or not (p ?& fields)
    or (p - fields) <> '{}'::jsonb then
    raise exception using errcode='22023', message='Formato de evento inválido.';
  end if;
  org := (p->>'organization_id')::uuid;
  select secret into key_secret from bioreport_private.signing_keys
    where organization_id=org and key_id=p->>'key_id' and enabled;
  if key_secret is null then raise exception using errcode='28000', message='Evento não autenticado.'; end if;
  expected_signature := encode(extensions.hmac(_body, key_secret, 'sha256'), 'hex');
  if expected_signature is distinct from _signature then
    raise exception using errcode='28000', message='Evento não autenticado.';
  end if;
  if p->'version' is distinct from '1'::jsonb
    or p->>'issuer' is distinct from 'https://jf-bio-insight.lovable.app'
    or p->>'audience' is distinct from 'https://jornada-ai-conecta.lovable.app'
    or coalesce(p->>'event_type','') not in ('anamnese_recebida','relatorio_disponivel')
    or coalesce(p->>'ghl_contact_id','') !~ '^[A-Za-z0-9_-]{1,128}$'
    or coalesce(p->>'issued_at','') !~ '^[0-9]{1,12}$' then
    raise exception using errcode='22023', message='Formato de evento inválido.';
  end if;
  issued := (p->>'issued_at')::bigint;
  if issued < extract(epoch from now()) - 300 or issued > extract(epoch from now()) + 60 then
    raise exception using errcode='28000', message='Assinatura vencida.';
  end if;
  patient := (p->>'patient_id')::uuid;
  consultation := (p->>'consultation_id')::uuid;
  source_id := (p->>'record_id')::uuid;
  occurred := (p->>'occurred_at')::timestamptz;
  if patient is null or consultation is null or source_id is null or occurred is null
    or occurred > now() + interval '1 minute'
    or p->>'event_id' is distinct from ((p->>'event_type') || ':' || source_id::text) then
    raise exception using errcode='22023', message='Identificadores ou data inválidos.';
  end if;
  if not exists (select 1 from public.ghl_location_bindings
    where organization_id=org and location_id=p->>'location_id') then
    raise exception using errcode='28000', message='Destino não autorizado.';
  end if;
  select id into contact from public.contacts where organization_id=org
    and ghl_contact_id=p->>'ghl_contact_id' and not is_demo for update;
  if contact is null then raise exception using errcode='23503', message='Contato não sincronizado.'; end if;
  -- Serializa por paciente, incluindo eventos concorrentes de consultas diferentes.
  perform pg_advisory_xact_lock(hashtextextended(org::text || ':' || patient::text, 0));
  stable_data := p - array['issued_at','key_id'];
  select event_data into previous from public.bioreport_events where organization_id=org and event_id=p->>'event_id';
  receipt := jsonb_build_object('event_id',p->>'event_id','contact_id',contact,'messages_sent',0);
  if previous is not null then
    if previous is distinct from stable_data then raise exception using errcode='23505', message='Evento divergente.'; end if;
    return receipt || jsonb_build_object('status','duplicate');
  end if;
  insert into public.bioreport_patient_links(organization_id,patient_id,contact_id,ghl_contact_id)
    values(org,patient,contact,p->>'ghl_contact_id') on conflict do nothing;
  if not exists (select 1 from public.bioreport_patient_links l where l.organization_id=org
    and l.patient_id=patient and l.contact_id=contact and l.ghl_contact_id=p->>'ghl_contact_id') then
    raise exception using errcode='23505', message='Vínculo do paciente divergente.';
  end if;
  insert into public.bioreport_consultation_links(organization_id,consultation_id,patient_id)
    values(org,consultation,patient) on conflict do nothing;
  if not exists (select 1 from public.bioreport_consultation_links l where l.organization_id=org
    and l.consultation_id=consultation and l.patient_id=patient) then
    raise exception using errcode='23505', message='Vínculo da consulta divergente.';
  end if;
  insert into public.bioreport_events(organization_id,event_id,event_type,consultation_id,patient_id,record_id,contact_id,ghl_contact_id,occurred_at,event_data)
    values(org,p->>'event_id',p->>'event_type',consultation,patient,source_id,contact,p->>'ghl_contact_id',occurred,stable_data);
  insert into public.audit_logs(organization_id,actor_name,action,entity,entity_id,metadata,verified)
    values(org,'BioReport Studio','bioreport.event_received','bioreport_events',p->>'event_id',
      jsonb_build_object('event_type',p->>'event_type','consultation_id',consultation,'contact_id',contact,'messages_sent',0),true);
  return receipt || jsonb_build_object('status','received');
end $$;
revoke all on function public.receive_bioreport_event(text,text) from public, anon, authenticated;
grant execute on function public.receive_bioreport_event(text,text) to anon, authenticated;
comment on function public.receive_bioreport_event(text,text) is 'Ingresso somente com HMAC válido, destino vinculado e validade de cinco minutos. Nenhuma escrita no GHL.';
commit;
