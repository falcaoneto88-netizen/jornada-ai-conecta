begin;

-- Cadastro explícito do administrador da própria organização. Não concede
-- leitura da chave nem escrita direta nas tabelas; não utiliza service role.
create function public.configure_bioreport_integration(
  _organization_id uuid, _key_id text, _secret text, _location_id text, _confirm boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  matches boolean;
  inserted integer;
begin
  if auth.uid() is null
    or not public.tem_papel(array['administrador']::public.app_role[])
    or public.current_org_id() is distinct from _organization_id then
    raise exception using errcode='42501', message='Acesso restrito ao administrador da organização.';
  end if;
  if _confirm is distinct from true
    or coalesce(_key_id,'') !~ '^[A-Za-z0-9_-]{1,64}$'
    or coalesce(_secret,'') !~ '^[a-f0-9]{64}$'
    or coalesce(_location_id,'') !~ '^[A-Za-z0-9_-]{1,128}$' then
    raise exception using errcode='22023', message='Configuração inválida ou não confirmada.';
  end if;
  if not exists (select 1 from public.ghl_location_bindings
    where organization_id=_organization_id and location_id=_location_id) then
    raise exception using errcode='42501', message='Destino não autorizado.';
  end if;
  insert into bioreport_private.signing_keys(organization_id,key_id,secret)
    values(_organization_id,_key_id,_secret) on conflict do nothing;
  get diagnostics inserted = row_count;
  select secret=_secret and enabled into matches from bioreport_private.signing_keys
    where organization_id=_organization_id and key_id=_key_id;
  if matches is distinct from true then
    raise exception using errcode='23505', message='Identificação de chave ocupada ou revogada.';
  end if;
  if inserted > 0 then
    insert into public.audit_logs(organization_id,actor_id,actor_name,action,entity,entity_id,metadata,verified)
      values(_organization_id,auth.uid(),'Administrador','bioreport.integration_configured',
        'bioreport_integration',_key_id,jsonb_build_object('key_id',_key_id),true);
  end if;
  return jsonb_build_object('configured',true);
end $$;
revoke all on function public.configure_bioreport_integration(uuid,text,text,text,boolean) from public, anon, authenticated;
grant execute on function public.configure_bioreport_integration(uuid,text,text,text,boolean) to authenticated;

commit;
