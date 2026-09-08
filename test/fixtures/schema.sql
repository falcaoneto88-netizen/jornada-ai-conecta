-- Esquema mínimo sintético (espelha as colunas reais usadas pelo recetor de webhooks).
-- Usado apenas na base de dados efémera de testes; nunca toca em dados reais.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
end $$;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.journey_stages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  key text not null,
  name text not null,
  position integer not null default 0
);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  ghl_contact_id text,
  full_name text not null,
  phone text,
  phone_normalized text,
  email text,
  stage_key text not null default 'novo_lead',
  tags text[] not null default '{}'::text[],
  source text,
  last_interaction_at timestamptz,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index uq_contacts_ghl on public.contacts (organization_id, ghl_contact_id) where ghl_contact_id is not null;
create unique index uq_contacts_phone on public.contacts (organization_id, phone_normalized) where phone_normalized is not null;

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  actor_id uuid,
  actor_name text,
  action text not null,
  entity text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.webhooks_inbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id),
  idempotency_key text not null unique,
  event_type text,
  payload jsonb not null default '{}'::jsonb,
  signature_valid boolean not null default false,
  processed_at timestamptz,
  error_message text,
  status text not null default 'recebido',
  attempts integer not null default 0,
  locked_at timestamptz,
  event_id text,
  source_version text,
  location_id text,
  contact_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ghl_location_bindings (
  location_id text primary key,
  organization_id uuid not null references public.organizations(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
