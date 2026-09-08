-- ============================================================
-- Isolamento entre organizações e autorização por papel (aditivo)
-- ============================================================

-- ---------- 1. Identidade / perfis ----------

revoke insert on public.profiles from authenticated;
revoke insert on public.organizations from authenticated;

create or replace function public.proteger_perfil()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.id is distinct from old.id or new.organization_id is distinct from old.organization_id then
      raise exception 'alteracao de identidade ou de organizacao nao permitida';
    end if;
    new.email := old.email;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;

drop trigger if exists trg_profiles_guard on public.profiles;
create trigger trg_profiles_guard before update on public.profiles
  for each row execute function public.proteger_perfil();

drop trigger if exists trg_profiles_updated on public.profiles;
create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.update_updated_at_column();

-- ---------- 2. Papéis ligados à organização ----------

create or replace function public.has_org_role(_user_id uuid, _org uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and organization_id = _org and role = _role
  )
$$;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.profiles p on p.id = ur.user_id and p.organization_id = ur.organization_id
    where ur.user_id = _user_id and ur.role = _role
  )
$$;

-- Papel do utilizador autenticado, na organização dele.
create or replace function public.tem_papel(_papeis public.app_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.profiles p on p.id = ur.user_id and p.organization_id = ur.organization_id
    where ur.user_id = auth.uid() and ur.role = any(_papeis)
  )
$$;

grant execute on function public.has_org_role(uuid, uuid, public.app_role) to authenticated, service_role;
grant execute on function public.tem_papel(public.app_role[]) to authenticated, service_role;

-- Só os próprios papéis ficam visíveis.
drop policy if exists "roles_select_own_org" on public.user_roles;
create policy "roles_select_self" on public.user_roles for select to authenticated
  using (user_id = auth.uid() and organization_id = public.current_org_id());

-- ---------- 3. Coerência de organização nas relações ----------

create or replace function public.verificar_org_pai()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_tabela text := tg_argv[0];
  v_coluna text := tg_argv[1];
  v_id uuid;
  v_org uuid;
begin
  v_id := nullif(to_jsonb(new) ->> v_coluna, '')::uuid;
  if v_id is null then return new; end if;
  execute format('select organization_id from public.%I where id = $1', v_tabela)
    into v_org using v_id;
  if v_org is null or v_org is distinct from new.organization_id then
    raise exception 'relacao invalida entre organizacoes (%.%)', v_tabela, v_coluna;
  end if;
  return new;
end $$;

create or replace function public.bloquear_troca_org()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception 'nao e permitido mudar o registo de organizacao';
  end if;
  return new;
end $$;

drop trigger if exists trg_opps_pai on public.opportunities;
create trigger trg_opps_pai before insert or update on public.opportunities
  for each row execute function public.verificar_org_pai('contacts', 'contact_id');

drop trigger if exists trg_convs_pai on public.conversations;
create trigger trg_convs_pai before insert or update on public.conversations
  for each row execute function public.verificar_org_pai('contacts', 'contact_id');

drop trigger if exists trg_messages_pai on public.messages;
create trigger trg_messages_pai before insert or update on public.messages
  for each row execute function public.verificar_org_pai('conversations', 'conversation_id');

drop trigger if exists trg_autov_pai on public.automation_versions;
create trigger trg_autov_pai before insert or update on public.automation_versions
  for each row execute function public.verificar_org_pai('automations', 'automation_id');

drop trigger if exists trg_autoruns_pai_auto on public.automation_runs;
create trigger trg_autoruns_pai_auto before insert or update on public.automation_runs
  for each row execute function public.verificar_org_pai('automations', 'automation_id');

drop trigger if exists trg_autoruns_pai_contacto on public.automation_runs;
create trigger trg_autoruns_pai_contacto before insert or update on public.automation_runs
  for each row execute function public.verificar_org_pai('contacts', 'contact_id');

drop trigger if exists trg_contacts_org on public.contacts;
create trigger trg_contacts_org before update on public.contacts
  for each row execute function public.bloquear_troca_org();
drop trigger if exists trg_convs_org on public.conversations;
create trigger trg_convs_org before update on public.conversations
  for each row execute function public.bloquear_troca_org();
drop trigger if exists trg_messages_org on public.messages;
create trigger trg_messages_org before update on public.messages
  for each row execute function public.bloquear_troca_org();
drop trigger if exists trg_opps_org on public.opportunities;
create trigger trg_opps_org before update on public.opportunities
  for each row execute function public.bloquear_troca_org();
drop trigger if exists trg_autos_org on public.automations;
create trigger trg_autos_org before update on public.automations
  for each row execute function public.bloquear_troca_org();
drop trigger if exists trg_templates_org on public.message_templates;
create trigger trg_templates_org before update on public.message_templates
  for each row execute function public.bloquear_troca_org();
drop trigger if exists trg_stages_org on public.journey_stages;
create trigger trg_stages_org before update on public.journey_stages
  for each row execute function public.bloquear_troca_org();

-- ---------- 4. Políticas de leitura por organização e escrita por papel ----------

-- Etapas: gestão por administrador/gestor
drop policy if exists "stages_all_own_org" on public.journey_stages;
create policy "stages_select" on public.journey_stages for select to authenticated
  using (organization_id = public.current_org_id());
create policy "stages_insert" on public.journey_stages for insert to authenticated
  with check (organization_id = public.current_org_id()
    and public.tem_papel(array['administrador','gestor']::public.app_role[]));
create policy "stages_update" on public.journey_stages for update to authenticated
  using (organization_id = public.current_org_id()
    and public.tem_papel(array['administrador','gestor']::public.app_role[]))
  with check (organization_id = public.current_org_id()
    and public.tem_papel(array['administrador','gestor']::public.app_role[]));
create policy "stages_delete" on public.journey_stages for delete to authenticated
  using (organization_id = public.current_org_id()
    and public.tem_papel(array['administrador','gestor']::public.app_role[]));

-- Modelos: administrador/gestor
drop policy if exists "templates_all_own_org" on public.message_templates;
create policy "templates_select" on public.message_templates for select to authenticated
  using (organization_id = public.current_org_id());
create policy "templates_insert" on public.message_templates for insert to authenticated
  with check (organization_id = public.current_org_id()
    and public.tem_papel(array['administrador','gestor']::public.app_role[]));
create policy "templates_update" on public.message_templates for update to authenticated
  using (organization_id = public.current_org_id()
    and public.tem_papel(array['administrador','gestor']::public.app_role[]))
  with check (organization_id = public.current_org_id()
    and public.tem_papel(array['administrador','gestor']::public.app_role[]));
create policy "templates_delete" on public.message_templates for delete to authenticated
  using (organization_id = public.current_org_id()
    and public.tem_papel(array['administrador','gestor']::public.app_role[]));

-- Automações e versões/execuções: administrador/gestor
drop policy if exists "autos_all_own_org" on public.automations;
create policy "autos_select" on public.automations for select to authenticated
  using (organization_id = public.current_org_id());
create policy "autos_insert" on public.automations for insert to authenticated
  with check (organization_id = public.current_org_id()
    and public.tem_papel(array['administrador','gestor']::public.app_role[]));
create policy "autos_update" on public.automations for update to authenticated
  using (organization_id = public.current_org_id()
    and public.tem_papel(array['administrador','gestor']::public.app_role[]))
  with check (organization_id = public.current_org_id()
    and public.tem_papel(array['administrador','gestor']::public.app_role[]));
create policy "autos_delete" on public.automations for delete to authenticated
  using (organization_id = public.current_org_id()
    and public.tem_papel(array['administrador','gestor']::public.app_role[]));

drop policy if exists "autov_all_own_org" on public.automation_versions;
create policy "autov_select" on public.automation_versions for select to authenticated
  using (organization_id = public.current_org_id());
create policy "autov_insert" on public.automation_versions for insert to authenticated
  with check (organization_id = public.current_org_id()
    and public.tem_papel(array['administrador','gestor']::public.app_role[]));

drop policy if exists "autoruns_all_own_org" on public.automation_runs;
create policy "autoruns_select" on public.automation_runs for select to authenticated
  using (organization_id = public.current_org_id());
create policy "autoruns_insert" on public.automation_runs for insert to authenticated
  with check (organization_id = public.current_org_id()
    and public.tem_papel(array['administrador','gestor','comercial']::public.app_role[]));

-- Clientes, conversas, mensagens e oportunidades: administrador/gestor/comercial
drop policy if exists "contacts_all_own_org" on public.contacts;
create policy "contacts_select" on public.contacts for select to authenticated
  using (organization_id = public.current_org_id());
create policy "contacts_insert" on public.contacts for insert to authenticated
  with check (organization_id = public.current_org_id()
    and public.tem_papel(array['administrador','gestor','comercial']::public.app_role[]));
create policy "contacts_update" on public.contacts for update to authenticated
  using (organization_id = public.current_org_id()
    and public.tem_papel(array['administrador','gestor','comercial']::public.app_role[]))
  with check (organization_id = public.current_org_id()
    and public.tem_papel(array['administrador','gestor','comercial']::public.app_role[]));
create policy "contacts_delete" on public.contacts for delete to authenticated
  using (organization_id = public.current_org_id()
    and public.tem_papel(array['administrador','gestor']::public.app_role[]));

drop policy if exists "convs_all_own_org" on public.conversations;
create policy "convs_select" on public.conversations for select to authenticated
  using (organization_id = public.current_org_id());
create policy "convs_insert" on public.conversations for insert to authenticated
  with check (organization_id = public.current_org_id()
    and public.tem_papel(array['administrador','gestor','comercial']::public.app_role[]));
create policy "convs_update" on public.conversations for update to authenticated
  using (organization_id = public.current_org_id()
    and public.tem_papel(array['administrador','gestor','comercial']::public.app_role[]))
  with check (organization_id = public.current_org_id()
    and public.tem_papel(array['administrador','gestor','comercial']::public.app_role[]));
create policy "convs_delete" on public.conversations for delete to authenticated
  using (organization_id = public.current_org_id()
    and public.tem_papel(array['administrador','gestor']::public.app_role[]));

drop policy if exists "messages_all_own_org" on public.messages;
create policy "messages_select" on public.messages for select to authenticated
  using (organization_id = public.current_org_id());
create policy "messages_insert" on public.messages for insert to authenticated
  with check (organization_id = public.current_org_id()
    and public.tem_papel(array['administrador','gestor','comercial']::public.app_role[]));
create policy "messages_update" on public.messages for update to authenticated
  using (organization_id = public.current_org_id()
    and public.tem_papel(array['administrador','gestor','comercial']::public.app_role[]))
  with check (organization_id = public.current_org_id()
    and public.tem_papel(array['administrador','gestor','comercial']::public.app_role[]));
create policy "messages_delete" on public.messages for delete to authenticated
  using (organization_id = public.current_org_id()
    and public.tem_papel(array['administrador','gestor']::public.app_role[]));

drop policy if exists "opps_all_own_org" on public.opportunities;
create policy "opps_select" on public.opportunities for select to authenticated
  using (organization_id = public.current_org_id());
create policy "opps_insert" on public.opportunities for insert to authenticated
  with check (organization_id = public.current_org_id()
    and public.tem_papel(array['administrador','gestor','comercial']::public.app_role[]));
create policy "opps_update" on public.opportunities for update to authenticated
  using (organization_id = public.current_org_id()
    and public.tem_papel(array['administrador','gestor','comercial']::public.app_role[]))
  with check (organization_id = public.current_org_id()
    and public.tem_papel(array['administrador','gestor','comercial']::public.app_role[]));
create policy "opps_delete" on public.opportunities for delete to authenticated
  using (organization_id = public.current_org_id()
    and public.tem_papel(array['administrador','gestor']::public.app_role[]));

-- Organização: apenas administrador altera
drop policy if exists "orgs_update_member" on public.organizations;
create policy "orgs_update_admin" on public.organizations for update to authenticated
  using (id = public.current_org_id()
    and public.tem_papel(array['administrador']::public.app_role[]))
  with check (id = public.current_org_id()
    and public.tem_papel(array['administrador']::public.app_role[]));

-- Auditoria: identidade não pode ser inventada
drop policy if exists "audit_insert_own_org" on public.audit_logs;
create policy "audit_insert_own_org" on public.audit_logs for insert to authenticated
  with check (organization_id = public.current_org_id()
    and (actor_id is null or actor_id = auth.uid()));

-- ---------- 5. Integração GoHighLevel imutável do lado do cliente ----------

create or replace function public.proteger_ligacao_ghl()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.api_base_url := old.api_base_url;
    new.api_version := old.api_version;
    new.location_id := old.location_id;
    new.organization_id := old.organization_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_ghl_conn_guard on public.ghl_connections;
create trigger trg_ghl_conn_guard before update on public.ghl_connections
  for each row execute function public.proteger_ligacao_ghl();
