-- Atribuição interna consentida, vinculada ao recibo real no mesmo commit.
-- Não envia eventos à Meta, não escreve no GHL e não muda flags de integração.

create table public.site_lead_attributions (
  submission_id uuid primary key references public.site_lead_submissions(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  integration_id uuid not null references public.site_integrations(id) on delete cascade,
  attribution jsonb not null check (jsonb_typeof(attribution) = 'object'),
  provenance text not null default 'site_declared_unverified'
    check (provenance = 'site_declared_unverified'),
  created_at timestamptz not null default now()
);
create index site_lead_attributions_org_created
  on public.site_lead_attributions (organization_id, created_at desc);
alter table public.site_lead_attributions enable row level security;
revoke all on public.site_lead_attributions from public, anon, authenticated, service_role;
-- Escrita apenas pelo RPC. Não há política de leitura autenticada nem API pública.
grant select on public.site_lead_attributions to service_role;

comment on table public.site_lead_attributions is
  'Atribuição interna declarada pelo site; IDs não validados pela Meta. Sem URLs, click IDs ou conteúdo clínico. Eliminada em cascata com o recibo.';

create function public.ingest_site_lead_v3(
  _source text, _request_id uuid, _payload_hash text, _full_name text,
  _phone text, _phone_normalized text, _email text,
  _consent_version text, _consent_at timestamptz,
  _quota_phone text, _quota_email text, _attribution jsonb default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  recibo_json jsonb;
  recibo public.site_lead_submissions;
  atribuicao_anterior public.site_lead_attributions;
  campo text;
  instante timestamptz;
begin
  if _attribution is not null then
    if jsonb_typeof(_attribution) is distinct from 'object' then
      raise exception using errcode='22023', message='Atribuição inválida.';
    end if;
    if not (_attribution ?& array['version','source','medium','campaign','campaignId','adsetId','adId','capturedAt','consent'])
      or (select count(*) from jsonb_object_keys(_attribution)) <> 9 then
      raise exception using errcode='22023', message='Atribuição inválida.';
    end if;
    foreach campo in array array['version','source','medium','campaign','campaignId','adsetId','adId','capturedAt'] loop
      if jsonb_typeof(_attribution -> campo) is distinct from 'string' then
        raise exception using errcode='22023', message='Atribuição inválida.';
      end if;
    end loop;
    if (_attribution ->> 'version') is distinct from '2026-11-09.attribution.v1'
      or (_attribution ->> 'source') not in ('fb','ig','an','msg','meta')
      or (_attribution ->> 'medium') is distinct from 'paid_social'
      or (_attribution ->> 'campaign') !~ '^(pt|be)-s[0-9]{2}-[0-9]{3}$'
      or (_attribution ->> 'campaignId') !~ '^[0-9]{5,30}$'
      or (_attribution ->> 'adsetId') !~ '^[0-9]{5,30}$'
      or (_attribution ->> 'adId') !~ '^[0-9]{5,30}$'
      or (_attribution ->> 'capturedAt') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]+)?)?(Z|[+-][0-9]{2}:[0-9]{2})$'
      or jsonb_typeof(_attribution -> 'consent') is distinct from 'object' then
      raise exception using errcode='22023', message='Atribuição inválida.';
    end if;
    if (_attribution -> 'consent') is distinct from
      '{"analytics":true,"version":"2026-11-09.analytics.v1"}'::jsonb then
      raise exception using errcode='22023', message='Consentimento de análise inválido.';
    end if;
    begin
      instante := (_attribution ->> 'capturedAt')::timestamptz;
    exception when datetime_field_overflow or invalid_datetime_format then
      raise exception using errcode='22023', message='Atribuição inválida.';
    end;
  end if;

  -- v2 conserva os seus locks, quotas, identidade e isolamento. A transação
  -- inclui o novo registo: falhar aqui reverte também todo o ingresso v2.
  recibo_json := public.ingest_site_lead_v2(
    _source, _request_id, _payload_hash, _full_name, _phone, _phone_normalized,
    _email, _consent_version, _consent_at, _quota_phone, _quota_email
  );
  select s.* into recibo from public.site_lead_submissions s
    join public.site_integrations i on i.id = s.integration_id
      and i.organization_id = s.organization_id
    where s.id = (recibo_json ->> 'receipt_id')::uuid
      and s.request_id = _request_id and s.payload_hash = _payload_hash
      and i.source = _source
    for share of s;
  if not found then
    raise exception using errcode='42501', message='Recibo não autorizado.';
  end if;

  if (recibo_json ->> 'duplicate')::boolean then
    select * into atribuicao_anterior from public.site_lead_attributions
      where submission_id = recibo.id;
    -- Nada de acrescentar atribuição a recibos antigos ou substituir a origem.
    if (found and (_attribution is null or atribuicao_anterior.attribution is distinct from _attribution
        or atribuicao_anterior.organization_id is distinct from recibo.organization_id
        or atribuicao_anterior.integration_id is distinct from recibo.integration_id))
      or (not found and _attribution is not null) then
      raise exception using errcode='23505', message='Pedido já registado com outros dados.';
    end if;
  elsif _attribution is not null then
    -- Só uma nova captura precisa estar na janela. Reenvio idêntico de um
    -- recibo já persistido não perde idempotência ao ultrapassar as 24 horas.
    if instante < now() - interval '24 hours' or instante > now() + interval '5 minutes' then
      raise exception using errcode='22023', message='Atribuição fora da janela.';
    end if;
    insert into public.site_lead_attributions
      (submission_id, organization_id, integration_id, attribution)
    values (recibo.id, recibo.organization_id, recibo.integration_id, _attribution);
  end if;
  return recibo_json;
end $$;
revoke all on function public.ingest_site_lead_v3(text,uuid,text,text,text,text,text,text,timestamptz,text,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.ingest_site_lead_v3(text,uuid,text,text,text,text,text,text,timestamptz,text,text,jsonb)
  to service_role;
