-- 1) Invariantes por coluna (não dependem de detetar o chamador)
revoke update on public.profiles from authenticated;
grant update (full_name) on public.profiles to authenticated;

revoke update on public.ghl_connections from authenticated;
grant update (
  default_pipeline_id, calendar_id, write_enabled, mode, status,
  last_test_at, last_test_message, last_sync_at, updated_at
) on public.ghl_connections to authenticated;

grant all on public.profiles to service_role;
grant all on public.ghl_connections to service_role;

-- 2) Consultas de papéis limitadas à identidade autenticada
create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when public.pedido_de_cliente() and _user_id is distinct from auth.uid() then false
    else exists (
      select 1
      from public.user_roles ur
      join public.profiles p on p.id = ur.user_id and p.organization_id = ur.organization_id
      where ur.user_id = _user_id and ur.role = _role
    )
  end
$$;

create or replace function public.has_org_role(_user_id uuid, _org uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when public.pedido_de_cliente()
      and (_user_id is distinct from auth.uid() or _org is distinct from public.current_org_id())
      then false
    else exists (
      select 1 from public.user_roles
      where user_id = _user_id and organization_id = _org and role = _role
    )
  end
$$;

revoke all on function public.has_org_role(uuid, uuid, public.app_role) from public, anon;
grant execute on function public.has_org_role(uuid, uuid, public.app_role) to authenticated, service_role;
revoke all on function public.has_role(uuid, public.app_role) from public, anon;
grant execute on function public.has_role(uuid, public.app_role) to authenticated, service_role;