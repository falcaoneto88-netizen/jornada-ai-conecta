create or replace function public.pedido_de_cliente()
returns boolean language sql stable set search_path = public as $$
  select current_user in ('authenticated', 'anon')
      or nullif(current_setting('request.jwt.claim.sub', true), '') is not null
      or coalesce(
           nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
           ''
         ) in ('authenticated', 'anon')
$$;

revoke all on function public.pedido_de_cliente() from public, anon, authenticated;

create or replace function public.proteger_perfil()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.pedido_de_cliente() then
    if new.id is distinct from old.id or new.organization_id is distinct from old.organization_id then
      raise exception 'alteracao de identidade ou de organizacao nao permitida';
    end if;
    new.email := old.email;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;

create or replace function public.proteger_ligacao_ghl()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.pedido_de_cliente() then
    new.api_base_url := old.api_base_url;
    new.api_version := old.api_version;
    new.location_id := old.location_id;
    new.organization_id := old.organization_id;
  end if;
  return new;
end $$;

revoke all on function public.proteger_perfil() from public, anon, authenticated;
revoke all on function public.proteger_ligacao_ghl() from public, anon, authenticated;