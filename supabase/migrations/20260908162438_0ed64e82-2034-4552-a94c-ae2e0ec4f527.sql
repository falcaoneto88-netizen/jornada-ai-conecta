-- Fecho da revisão: a UI só pode ATUALIZAR colunas autorizadas de ghl_connections.
revoke insert, delete, truncate on public.ghl_connections from authenticated, anon;

drop policy if exists "ghl_write_own_org" on public.ghl_connections;
create policy "ghl_update_own_org" on public.ghl_connections
  for update to authenticated
  using (organization_id = public.current_org_id() and public.tem_papel(array['administrador']::app_role[]))
  with check (organization_id = public.current_org_id() and public.tem_papel(array['administrador']::app_role[]));

-- Papéis: leitura própria apenas; escrita exclusivamente pelo backend.
revoke insert, update, delete, truncate on public.user_roles from authenticated, anon;
grant all on public.user_roles to service_role;

-- Vínculo de localização: server-only em todas as operações.
revoke all on public.ghl_location_bindings from authenticated, anon;
grant all on public.ghl_location_bindings to service_role;
grant all on public.ghl_connections to service_role;