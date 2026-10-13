-- Bind a personal draft snapshot to the existing manual send ledger BEFORE external dispatch.
-- No plaintext, new sending path, job, provider credential, or scheduler is introduced.
alter table public.commercial_agent_manual_dispatches
  add column if not exists attendance_draft_revision uuid,
  add column if not exists attendance_draft_text_hash text;
alter table public.commercial_agent_manual_dispatches
  add constraint manual_attendance_draft_binding check (
    (attendance_draft_revision is null and attendance_draft_text_hash is null)
    or (attendance_draft_revision is not null and attendance_draft_text_hash is not null
        and attendance_draft_text_hash ~ '^[a-f0-9]{64}$')
  );
create index if not exists manual_attendance_draft_recovery
  on public.commercial_agent_manual_dispatches(organization_id,prepared_by,contact_id,conversation_id,attendance_draft_revision)
  where attendance_draft_revision is not null and state='sent';

-- Same result contract as attendance_draft_command('load'). The existing command performs
-- authorization, scope validation, expiry, and obtains the personal-draft lock for this transaction.
create or replace function public.attendance_draft_load_reconciled(
  _op text,_org uuid,_actor uuid,_location text,_contact text,_conversation text,_data jsonb default '{}'
) returns jsonb language plpgsql security definer set search_path='' as $$
declare response jsonb; item public.attendance_drafts%rowtype;
begin
  if _op is distinct from 'load' then return jsonb_build_object('error','invalid_input'); end if;
  response:=public.attendance_draft_command('load',_org,_actor,_location,_contact,_conversation,'{}');
  if response ? 'error' or response->'row'='null'::jsonb then return response; end if;
  select * into item from public.attendance_drafts
    where organization_id=_org and user_id=_actor and contact_id=_contact and conversation_id=_conversation;
  if item.payload is not null and exists (
    select 1 from public.commercial_agent_manual_dispatches d
    where d.organization_id=_org and d.prepared_by=_actor and d.approved_by=_actor
      and d.location_id=_location and d.contact_id=_contact and d.conversation_id=_conversation
      and d.attendance_draft_revision=item.revision and d.attendance_draft_text_hash=item.text_hash
      and d.created_at>=item.updated_at and d.approved_at is not null
      and d.state='sent' and nullif(btrim(d.result_message_id),'') is not null
  ) then
    -- CAS under the same advisory + row lock as load/save/clear. A later revision is untouched.
    update public.attendance_drafts set payload=null,text_hash=null,expires_at=null,
      revision=gen_random_uuid(),updated_at=clock_timestamp()
      where organization_id=_org and user_id=_actor and contact_id=_contact and conversation_id=_conversation
        and revision=item.revision and text_hash=item.text_hash returning * into item;
    response:=jsonb_build_object('row',to_jsonb(item));
  end if;
  return response;
end $$;
revoke all on function public.attendance_draft_load_reconciled(text,uuid,uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.attendance_draft_load_reconciled(text,uuid,uuid,text,text,text,jsonb) to service_role;

create or replace function public.attendance_draft_bind_dispatch(
  _org uuid,_actor uuid,_location text,_contact text,_conversation text,
  _manual uuid,_request uuid,_revision uuid,_text_hash text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare response jsonb; item public.attendance_drafts%rowtype;
  dispatch public.commercial_agent_manual_dispatches%rowtype;
begin
  if _manual is null or _request is null or _revision is null or coalesce(_text_hash,'') !~ '^[a-f0-9]{64}$'
    then return jsonb_build_object('error','invalid_input'); end if;
  response:=public.attendance_draft_load_reconciled('load',_org,_actor,_location,_contact,_conversation,'{}');
  if response ? 'error' then return response; end if;
  select * into item from public.attendance_drafts
    where organization_id=_org and user_id=_actor and contact_id=_contact and conversation_id=_conversation;
  if not found or item.payload is null or item.revision is distinct from _revision
    or item.text_hash is distinct from _text_hash then return jsonb_build_object('error','draft_conflict'); end if;
  -- Lock ordering: personal draft first, manual row second. Reconciliation only reads the ledger;
  -- existing sending RPCs do not lock attendance_drafts, so no reverse lock dependency is introduced.
  select * into dispatch from public.commercial_agent_manual_dispatches
    where organization_id=_org and id=_manual for update;
  if not found or dispatch.request_id is distinct from _request or dispatch.prepared_by is distinct from _actor
    or dispatch.location_id is distinct from _location or dispatch.contact_id is distinct from _contact
    or dispatch.conversation_id is distinct from _conversation then return jsonb_build_object('error','scope_mismatch'); end if;
  if dispatch.state<>'prepared' or dispatch.expires_at<=clock_timestamp()
    or dispatch.created_at<item.updated_at then return jsonb_build_object('error','draft_conflict'); end if;
  if dispatch.attendance_draft_revision is not null and (
    dispatch.attendance_draft_revision is distinct from _revision or dispatch.attendance_draft_text_hash is distinct from _text_hash
  ) then return jsonb_build_object('error','draft_conflict'); end if;
  update public.commercial_agent_manual_dispatches set attendance_draft_revision=_revision,attendance_draft_text_hash=_text_hash
    where organization_id=_org and id=_manual;
  return jsonb_build_object('bound',true);
end $$;
revoke all on function public.attendance_draft_bind_dispatch(uuid,uuid,text,text,text,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.attendance_draft_bind_dispatch(uuid,uuid,text,text,text,uuid,uuid,uuid,text) to service_role;

-- Retention is unchanged: expired payload is physically cleared on scoped access, or by the
-- existing service-only attendance_draft_purge_expired() maintenance function. This migration
-- does not schedule it. Without maintenance, inactive scopes can retain expired ciphertext.
-- Manual ledger binding metadata follows that ledger's retention; it contains no plaintext.
