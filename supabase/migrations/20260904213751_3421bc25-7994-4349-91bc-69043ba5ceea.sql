
-- ============ ENUMS ============
create type public.app_role as enum ('administrador','gestor','comercial','visualizador');
create type public.automation_status as enum ('rascunho','ativa','pausada');
create type public.run_mode as enum ('simulacao','real');
create type public.channel_type as enum ('whatsapp','instagram','facebook','email','sms');

-- ============ UPDATED AT ============
create or replace function public.update_updated_at_column()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end; $$;

-- ============ ORGANIZATIONS ============
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'Europe/Lisbon',
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.organizations to authenticated;
grant all on public.organizations to service_role;
alter table public.organizations enable row level security;

-- ============ PROFILES ============
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  full_name text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
create index idx_profiles_org on public.profiles(organization_id);

create or replace function public.current_org_id()
returns uuid language sql stable security definer set search_path = public as $$
  select organization_id from public.profiles where id = auth.uid()
$$;

create policy "profiles_select_own_org" on public.profiles for select to authenticated
  using (organization_id = public.current_org_id());
create policy "profiles_update_self" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy "orgs_select_member" on public.organizations for select to authenticated
  using (id = public.current_org_id());
create policy "orgs_update_member" on public.organizations for update to authenticated
  using (id = public.current_org_id()) with check (id = public.current_org_id());

-- ============ USER ROLES ============
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create policy "roles_select_own_org" on public.user_roles for select to authenticated
  using (organization_id = public.current_org_id());

-- ============ SIGNUP TRIGGER ============
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare new_org uuid;
begin
  insert into public.organizations (name)
  values (coalesce(new.raw_user_meta_data->>'clinic_name', 'Clínica Dr. João Falcão'))
  returning id into new_org;

  insert into public.profiles (id, organization_id, full_name, email)
  values (new.id, new_org, coalesce(new.raw_user_meta_data->>'full_name', new.email), new.email);

  insert into public.user_roles (user_id, organization_id, role)
  values (new.id, new_org, 'administrador');

  insert into public.journey_stages (organization_id, key, name, position, color)
  values
    (new_org,'novo_lead','Novo Lead',1,'#c5a880'),
    (new_org,'em_atendimento','Em Atendimento',2,'#c5a880'),
    (new_org,'consulta_agendada','Consulta Agendada',3,'#c5a880'),
    (new_org,'consulta_confirmada','Consulta Confirmada',4,'#c5a880'),
    (new_org,'consulta_realizada','Consulta Realizada',5,'#c5a880'),
    (new_org,'orcamento_enviado','Orçamento Enviado',6,'#c5a880'),
    (new_org,'procedimento_agendado','Procedimento Agendado',7,'#c5a880'),
    (new_org,'pos_procedimento','Pós-Procedimento',8,'#c5a880'),
    (new_org,'follow_up','Follow-up',9,'#c5a880'),
    (new_org,'reativacao','Reativação',10,'#c5a880');

  insert into public.ghl_connections (organization_id) values (new_org);
  return new;
end; $$;

-- ============ JOURNEY STAGES ============
create table public.journey_stages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  name text not null,
  position integer not null default 0,
  color text not null default '#c5a880',
  ghl_pipeline_id text,
  ghl_stage_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, key)
);
grant select, insert, update, delete on public.journey_stages to authenticated;
grant all on public.journey_stages to service_role;
alter table public.journey_stages enable row level security;
create policy "stages_all_own_org" on public.journey_stages for all to authenticated
  using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id());
create index idx_stages_org on public.journey_stages(organization_id, position);
create trigger trg_stages_updated before update on public.journey_stages for each row execute function public.update_updated_at_column();

-- ============ GHL CONNECTIONS ============
create table public.ghl_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  api_base_url text not null default 'https://services.leadconnectorhq.com',
  api_version text not null default '2021-07-28',
  location_id text,
  default_pipeline_id text,
  calendar_id text,
  mode text not null default 'demo',
  status text not null default 'nao_testada',
  last_test_at timestamptz,
  last_test_message text,
  last_sync_at timestamptz,
  write_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.ghl_connections to authenticated;
grant all on public.ghl_connections to service_role;
alter table public.ghl_connections enable row level security;
create policy "ghl_select_own_org" on public.ghl_connections for select to authenticated
  using (organization_id = public.current_org_id());
create policy "ghl_write_own_org" on public.ghl_connections for all to authenticated
  using (organization_id = public.current_org_id() and public.has_role(auth.uid(),'administrador'))
  with check (organization_id = public.current_org_id() and public.has_role(auth.uid(),'administrador'));
create trigger trg_ghl_updated before update on public.ghl_connections for each row execute function public.update_updated_at_column();

-- ============ CONTACTS ============
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ghl_contact_id text,
  full_name text not null,
  phone text,
  phone_normalized text,
  email text,
  stage_key text not null default 'novo_lead',
  tags text[] not null default '{}',
  source text,
  owner_name text,
  next_action text,
  next_action_at timestamptz,
  last_interaction_at timestamptz,
  notes text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.contacts to authenticated;
grant all on public.contacts to service_role;
alter table public.contacts enable row level security;
create policy "contacts_all_own_org" on public.contacts for all to authenticated
  using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id());
create unique index uq_contacts_ghl on public.contacts(organization_id, ghl_contact_id) where ghl_contact_id is not null;
create unique index uq_contacts_phone on public.contacts(organization_id, phone_normalized) where phone_normalized is not null;
create index idx_contacts_org_stage on public.contacts(organization_id, stage_key);
create trigger trg_contacts_updated before update on public.contacts for each row execute function public.update_updated_at_column();

-- ============ OPPORTUNITIES ============
create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete cascade,
  ghl_opportunity_id text,
  name text not null,
  pipeline_id text,
  stage_id text,
  stage_key text,
  monetary_value numeric(12,2),
  status text not null default 'aberta',
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.opportunities to authenticated;
grant all on public.opportunities to service_role;
alter table public.opportunities enable row level security;
create policy "opps_all_own_org" on public.opportunities for all to authenticated
  using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id());
create index idx_opps_org on public.opportunities(organization_id);
create unique index uq_opps_ghl on public.opportunities(organization_id, ghl_opportunity_id) where ghl_opportunity_id is not null;
create trigger trg_opps_updated before update on public.opportunities for each row execute function public.update_updated_at_column();

-- ============ CONVERSATIONS ============
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete cascade,
  ghl_conversation_id text,
  channel public.channel_type not null default 'whatsapp',
  summary text,
  intent text,
  sentiment text,
  priority text default 'media',
  unread boolean not null default false,
  last_message_at timestamptz,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.conversations to authenticated;
grant all on public.conversations to service_role;
alter table public.conversations enable row level security;
create policy "convs_all_own_org" on public.conversations for all to authenticated
  using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id());
create index idx_convs_org on public.conversations(organization_id, last_message_at desc);
create trigger trg_convs_updated before update on public.conversations for each row execute function public.update_updated_at_column();

-- ============ MESSAGES ============
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  direction text not null default 'inbound',
  channel public.channel_type not null default 'whatsapp',
  body text not null,
  author_name text,
  external_id text,
  sent_at timestamptz not null default now(),
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.messages to authenticated;
grant all on public.messages to service_role;
alter table public.messages enable row level security;
create policy "messages_all_own_org" on public.messages for all to authenticated
  using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id());
create index idx_messages_conv on public.messages(conversation_id, sent_at);

-- ============ AUTOMATIONS ============
create table public.automations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  status public.automation_status not null default 'rascunho',
  trigger_type text not null default 'contato_criado',
  trigger_config jsonb not null default '{}'::jsonb,
  steps jsonb not null default '[]'::jsonb,
  current_version integer not null default 1,
  last_run_at timestamptz,
  runs_total integer not null default 0,
  runs_success integer not null default 0,
  runs_error integer not null default 0,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.automations to authenticated;
grant all on public.automations to service_role;
alter table public.automations enable row level security;
create policy "autos_all_own_org" on public.automations for all to authenticated
  using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id());
create index idx_autos_org on public.automations(organization_id);
create trigger trg_autos_updated before update on public.automations for each row execute function public.update_updated_at_column();

create table public.automation_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  automation_id uuid not null references public.automations(id) on delete cascade,
  version integer not null,
  definition jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (automation_id, version)
);
grant select, insert on public.automation_versions to authenticated;
grant all on public.automation_versions to service_role;
alter table public.automation_versions enable row level security;
create policy "autov_all_own_org" on public.automation_versions for all to authenticated
  using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id());

create table public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  automation_id uuid not null references public.automations(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  mode public.run_mode not null default 'simulacao',
  status text not null default 'sucesso',
  log jsonb not null default '[]'::jsonb,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now()
);
grant select, insert on public.automation_runs to authenticated;
grant all on public.automation_runs to service_role;
alter table public.automation_runs enable row level security;
create policy "autoruns_all_own_org" on public.automation_runs for all to authenticated
  using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id());
create index idx_autoruns_org on public.automation_runs(organization_id, started_at desc);

-- ============ MESSAGE TEMPLATES ============
create table public.message_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  stage_key text,
  channel public.channel_type not null default 'whatsapp',
  language text not null default 'pt-BR',
  body text not null,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.message_templates to authenticated;
grant all on public.message_templates to service_role;
alter table public.message_templates enable row level security;
create policy "templates_all_own_org" on public.message_templates for all to authenticated
  using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id());
create index idx_templates_org on public.message_templates(organization_id, language);
create trigger trg_templates_updated before update on public.message_templates for each row execute function public.update_updated_at_column();

-- ============ WEBHOOKS INBOX ============
create table public.webhooks_inbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  idempotency_key text not null unique,
  event_type text,
  payload jsonb not null default '{}'::jsonb,
  signature_valid boolean not null default false,
  processed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now()
);
grant select on public.webhooks_inbox to authenticated;
grant all on public.webhooks_inbox to service_role;
alter table public.webhooks_inbox enable row level security;
create policy "webhooks_select_own_org" on public.webhooks_inbox for select to authenticated
  using (organization_id = public.current_org_id());
create index idx_webhooks_created on public.webhooks_inbox(created_at desc);

-- ============ AUDIT LOGS ============
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid,
  actor_name text,
  action text not null,
  entity text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
grant select, insert on public.audit_logs to authenticated;
grant all on public.audit_logs to service_role;
alter table public.audit_logs enable row level security;
create policy "audit_select_own_org" on public.audit_logs for select to authenticated
  using (organization_id = public.current_org_id());
create policy "audit_insert_own_org" on public.audit_logs for insert to authenticated
  with check (organization_id = public.current_org_id());
create index idx_audit_org on public.audit_logs(organization_id, created_at desc);

-- ============ AUTH TRIGGER ============
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
