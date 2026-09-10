begin;

-- Interromper a implantação se houver dados incompatíveis, sem os corrigir silenciosamente.
lock table public.appointments in share row exclusive mode;
do $$ begin
  if exists (select 1 from public.appointments a join public.contacts c on c.id = a.contact_id
    where a.organization_id is distinct from c.organization_id) then
    raise exception 'Existem agendamentos com contactos de outra organizacao; requer revisao.';
  end if;
end $$;

drop trigger appointments_org_pai on public.appointments;
create trigger appointments_org_pai before insert or update on public.appointments
  for each row execute function public.verificar_org_pai('contacts', 'contact_id');
create trigger appointments_org_imutavel before update on public.appointments
  for each row execute function public.bloquear_troca_org();

-- Só eventos emitidos por funções confiáveis recebem esta marca.
-- Registos históricos e os demais registos do cliente continuam não verificados.
alter table public.audit_logs add column verified boolean not null default false;
drop policy audit_insert_own_org on public.audit_logs;
create policy audit_insert_own_org on public.audit_logs for insert to authenticated
  with check (organization_id = public.current_org_id()
    and (actor_id is null or actor_id = auth.uid()) and not verified);

create function public.auditar_movimento_contacto()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_nome text;
begin
  if new.stage_key is not distinct from old.stage_key then return new; end if;
  if not exists (select 1 from public.journey_stages
    where organization_id = new.organization_id and key = new.stage_key) then
    raise exception 'Etapa de destino invalida para esta organizacao';
  end if;
  select full_name into v_nome from public.profiles
    where id = auth.uid() and organization_id = new.organization_id;
  insert into public.audit_logs
    (organization_id, actor_id, actor_name, action, entity, entity_id, metadata, verified)
  values (new.organization_id, auth.uid(), coalesce(v_nome, 'Sistema'),
    'contacto.mover_etapa', 'contacts', new.id::text,
    jsonb_build_object('de', old.stage_key, 'para', new.stage_key), true);
  return new;
end $$;
revoke all on function public.auditar_movimento_contacto() from public, anon, authenticated;
create trigger contacts_auditar_movimento after update of stage_key on public.contacts
  for each row execute function public.auditar_movimento_contacto();

commit;
