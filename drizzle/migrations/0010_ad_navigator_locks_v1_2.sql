-- Ponte Ad Navigator v1.2 — correção de travas.
--
-- Defeitos corrigidos:
--   (a) `ad_navigator_summary` segurava a concessão em FOR SHARE e depois
--       convertia para UPDATE: duas leituras simultâneas podiam bloquear-se
--       mutuamente (deadlock). Passa a FOR UPDATE desde o início.
--   (b) Papel do emissor, pertença à organização, vínculo e ligação eram
--       revalidados sem trava: uma remoção de papel ou troca de funil a meio
--       da operação escapava. Passam a ser lidos FOR SHARE, depois da espera,
--       e ficam protegidos até ao commit.
--   (c) `ad_navigator_vinculo` não verificava o modo real da ligação.
--       Agora exige `mode = 'conectado'` e organização não-demo.
--
-- Ordem única em TODAS as operações (elimina deadlocks por ordem cruzada):
--   1. trava consultiva por organização  -> serializa a organização
--   2. organização (não-demo) FOR SHARE
--   3. perfil do emissor FOR SHARE
--   4. papel de administrador FOR SHARE
--   5. ligação GoHighLevel FOR SHARE  -> 6. vínculo de location FOR SHARE
--   7. pareamento / concessão FOR UPDATE

CREATE OR REPLACE FUNCTION public.ad_navigator_membro(_org uuid, _user uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
  IF _org IS NULL OR _user IS NULL THEN
    RETURN false;
  END IF;
  PERFORM 1 FROM public.organizations o
    WHERE o.id = _org AND o.is_demo = false FOR SHARE;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM 1 FROM public.profiles pr
    WHERE pr.id = _user AND pr.organization_id = _org FOR SHARE;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM 1 FROM public.user_roles r
    WHERE r.user_id = _user AND r.organization_id = _org
      AND r.role = 'administrador'::public.app_role FOR SHARE;
  RETURN FOUND;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ad_navigator_vinculo_travado(_org uuid)
RETURNS TABLE(location_id text, pipeline_id text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  loc text;
  funil text;
BEGIN
  IF _org IS NULL THEN RETURN; END IF;
  SELECT c.location_id, c.default_pipeline_id INTO loc, funil
    FROM public.ghl_connections c
    WHERE c.organization_id = _org
      AND c.status = 'conectada'
      AND c.mode = 'conectado'
      AND coalesce(btrim(c.location_id), '') <> ''
      AND coalesce(btrim(c.default_pipeline_id), '') <> ''
    ORDER BY c.location_id
    LIMIT 1
    FOR SHARE;
  IF loc IS NULL OR funil IS NULL THEN RETURN; END IF;
  PERFORM 1 FROM public.ghl_location_bindings b
    WHERE b.organization_id = _org AND b.location_id = loc FOR SHARE;
  IF NOT FOUND THEN RETURN; END IF;
  RETURN QUERY SELECT loc, funil;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ad_navigator_vinculo(_org uuid)
RETURNS TABLE(location_id text, pipeline_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
  SELECT c.location_id, c.default_pipeline_id
  FROM public.ghl_connections c
  JOIN public.organizations o
    ON o.id = c.organization_id AND o.is_demo = false
  JOIN public.ghl_location_bindings b
    ON b.organization_id = c.organization_id AND b.location_id = c.location_id
  WHERE c.organization_id = _org
    AND c.status = 'conectada'
    AND c.mode = 'conectado'
    AND coalesce(btrim(c.location_id), '') <> ''
    AND coalesce(btrim(c.default_pipeline_id), '') <> ''
  ORDER BY c.location_id
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.ad_navigator_create_pairing(
  _code_sha256 text, _ttl_seconds integer, _confirm boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  org uuid;
  emissor uuid;
  loc text;
  funil text;
  p public.ad_navigator_pairings;
  nome text;
BEGIN
  emissor := auth.uid();
  org := public.current_org_id();
  IF emissor IS NULL OR org IS NULL THEN
    RAISE EXCEPTION USING errcode='42501', message='Acesso restrito ao administrador da organização.';
  END IF;
  IF _confirm IS DISTINCT FROM true
    OR _code_sha256 IS NULL OR _code_sha256 !~ '^[0-9a-f]{64}$'
    OR _ttl_seconds IS NULL OR _ttl_seconds < 60 OR _ttl_seconds > 900 THEN
    RAISE EXCEPTION USING errcode='22023', message='Pedido inválido ou não confirmado.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('ad_navigator:' || org::text, 0));

  IF NOT public.ad_navigator_membro(org, emissor) THEN
    RAISE EXCEPTION USING errcode='42501', message='Acesso restrito ao administrador da organização.';
  END IF;

  SELECT v.location_id, v.pipeline_id INTO loc, funil
    FROM public.ad_navigator_vinculo_travado(org) v;
  IF loc IS NULL OR funil IS NULL THEN
    RAISE EXCEPTION USING errcode='42501', message='Ligação do GoHighLevel indisponível nesta conta.';
  END IF;

  UPDATE public.ad_navigator_pairings
    SET revoked_at = now()
    WHERE organization_id = org AND consumed_at IS NULL AND revoked_at IS NULL;

  INSERT INTO public.ad_navigator_pairings
    (organization_id, created_by, code_sha256, location_id, pipeline_id, expires_at)
    VALUES (org, emissor, _code_sha256, loc, funil,
            now() + make_interval(secs => _ttl_seconds))
    RETURNING * INTO p;

  SELECT o.name INTO nome FROM public.organizations o WHERE o.id = org;

  INSERT INTO public.audit_logs (organization_id, actor_id, action, entity, entity_id, metadata)
    VALUES (org, emissor, 'ad_navigator_pareamento_criado', 'ad_navigator_pairing', p.id::text,
      jsonb_build_object('location_id', p.location_id, 'pipeline_id', p.pipeline_id,
                         'expires_at', p.expires_at, 'scope', 'commercial_summary:read'));

  RETURN jsonb_build_object(
    'pairing_id', p.id,
    'organization_id', org,
    'organization_name', nome,
    'location_id', p.location_id,
    'pipeline_id', p.pipeline_id,
    'scope', 'commercial_summary:read',
    'expires_at', p.expires_at
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.ad_navigator_revoke_access(_confirm boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  org uuid;
  emissor uuid;
  pares integer;
  concessoes integer;
BEGIN
  emissor := auth.uid();
  org := public.current_org_id();
  IF emissor IS NULL OR org IS NULL THEN
    RAISE EXCEPTION USING errcode='42501', message='Acesso restrito ao administrador da organização.';
  END IF;
  IF _confirm IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING errcode='22023', message='Pedido inválido ou não confirmado.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('ad_navigator:' || org::text, 0));

  IF NOT public.ad_navigator_membro(org, emissor) THEN
    RAISE EXCEPTION USING errcode='42501', message='Acesso restrito ao administrador da organização.';
  END IF;

  UPDATE public.ad_navigator_pairings SET revoked_at = now()
    WHERE organization_id = org AND consumed_at IS NULL AND revoked_at IS NULL;
  GET DIAGNOSTICS pares = ROW_COUNT;

  UPDATE public.ad_navigator_grants SET revoked_at = now()
    WHERE organization_id = org AND revoked_at IS NULL;
  GET DIAGNOSTICS concessoes = ROW_COUNT;

  INSERT INTO public.audit_logs (organization_id, actor_id, action, entity, metadata)
    VALUES (org, emissor, 'ad_navigator_acesso_revogado', 'ad_navigator_grant',
      jsonb_build_object('pairings_revoked', pares, 'grants_revoked', concessoes));

  RETURN jsonb_build_object('pairings_revoked', pares, 'grants_revoked', concessoes);
END;
$function$;

CREATE OR REPLACE FUNCTION public.ad_navigator_exchange(
  _code_sha256 text, _receiver_tenant_id uuid, _credential_hash text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  org uuid;
  emissor uuid;
  loc text;
  funil text;
  p public.ad_navigator_pairings;
  g public.ad_navigator_grants;
  nome text;
BEGIN
  IF _code_sha256 IS NULL OR _code_sha256 !~ '^[0-9a-f]{64}$'
    OR _receiver_tenant_id IS NULL
    OR _credential_hash IS NULL OR _credential_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING errcode='22023', message='pedido_invalido';
  END IF;

  SELECT organization_id, created_by INTO org, emissor
    FROM public.ad_navigator_pairings WHERE code_sha256 = _code_sha256;
  IF org IS NULL THEN
    RAISE EXCEPTION USING errcode='22023', message='pareamento_invalido';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('ad_navigator:' || org::text, 0));

  IF NOT public.ad_navigator_membro(org, emissor) THEN
    RAISE EXCEPTION USING errcode='42501', message='autorizacao_indisponivel';
  END IF;

  SELECT v.location_id, v.pipeline_id INTO loc, funil
    FROM public.ad_navigator_vinculo_travado(org) v;
  IF loc IS NULL OR funil IS NULL THEN
    RAISE EXCEPTION USING errcode='42501', message='autorizacao_indisponivel';
  END IF;

  SELECT * INTO p FROM public.ad_navigator_pairings
    WHERE code_sha256 = _code_sha256 FOR UPDATE;
  IF NOT FOUND OR p.consumed_at IS NOT NULL OR p.revoked_at IS NOT NULL OR p.expires_at <= now()
    OR p.organization_id IS DISTINCT FROM org OR p.created_by IS DISTINCT FROM emissor THEN
    RAISE EXCEPTION USING errcode='22023', message='pareamento_invalido';
  END IF;
  IF loc IS DISTINCT FROM p.location_id OR funil IS DISTINCT FROM p.pipeline_id THEN
    RAISE EXCEPTION USING errcode='42501', message='autorizacao_indisponivel';
  END IF;

  INSERT INTO public.ad_navigator_grants
    (pairing_id, organization_id, issuer_user_id, receiver_tenant_id, credential_hash,
     location_id, pipeline_id, expires_at)
    VALUES (p.id, p.organization_id, p.created_by, _receiver_tenant_id, _credential_hash,
            p.location_id, p.pipeline_id, now() + interval '90 days')
    RETURNING * INTO g;

  UPDATE public.ad_navigator_pairings SET consumed_at = now() WHERE id = p.id;

  SELECT o.name INTO nome FROM public.organizations o WHERE o.id = p.organization_id;

  INSERT INTO public.audit_logs (organization_id, actor_id, action, entity, entity_id, metadata)
    VALUES (p.organization_id, p.created_by, 'ad_navigator_concessao_criada', 'ad_navigator_grant', g.id::text,
      jsonb_build_object('receiver_tenant_id', g.receiver_tenant_id, 'expires_at', g.expires_at,
                         'scope', g.scope));

  RETURN jsonb_build_object(
    'schema_version', 1,
    'grant_id', g.id,
    'organization_id', g.organization_id,
    'organization_name', nome,
    'location_id', g.location_id,
    'pipeline_id', g.pipeline_id,
    'scope', g.scope,
    'expires_at', g.expires_at
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.ad_navigator_summary(_credential_hash text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  org uuid;
  emissor uuid;
  g public.ad_navigator_grants;
  loc text;
  funil text;
  etapas text[] := array[
    'novo_lead','em_atendimento','consulta_agendada','consulta_confirmada','consulta_realizada',
    'orcamento_enviado','procedimento_agendado','pos_procedimento','follow_up','reativacao',
    'consulta_nao_paga','consulta_paga','nao_compareceu','follow_up_2','depoimento_indicacao',
    'perdido_desqualificado','procedimento_realizado'];
  agregado jsonb;
  sincronizado timestamptz;
BEGIN
  IF _credential_hash IS NULL OR _credential_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING errcode='22023', message='pedido_invalido';
  END IF;

  SELECT organization_id, issuer_user_id INTO org, emissor
    FROM public.ad_navigator_grants WHERE credential_hash = _credential_hash;
  IF org IS NULL THEN
    RAISE EXCEPTION USING errcode='42501', message='credencial_invalida';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('ad_navigator:' || org::text, 0));

  IF NOT public.ad_navigator_membro(org, emissor) THEN
    RAISE EXCEPTION USING errcode='42501', message='autorizacao_indisponivel';
  END IF;

  SELECT v.location_id, v.pipeline_id INTO loc, funil
    FROM public.ad_navigator_vinculo_travado(org) v;
  IF loc IS NULL OR funil IS NULL THEN
    RAISE EXCEPTION USING errcode='42501', message='autorizacao_indisponivel';
  END IF;

  SELECT * INTO g FROM public.ad_navigator_grants
    WHERE credential_hash = _credential_hash FOR UPDATE;
  IF NOT FOUND OR g.revoked_at IS NOT NULL OR g.expires_at <= now()
    OR g.organization_id IS DISTINCT FROM org OR g.issuer_user_id IS DISTINCT FROM emissor THEN
    RAISE EXCEPTION USING errcode='42501', message='credencial_invalida';
  END IF;
  IF loc IS DISTINCT FROM g.location_id OR funil IS DISTINCT FROM g.pipeline_id THEN
    RAISE EXCEPTION USING errcode='42501', message='autorizacao_indisponivel';
  END IF;

  WITH base AS MATERIALIZED (
    SELECT o.contact_id,
           CASE lower(coalesce(o.status, ''))
             WHEN 'aberta' THEN 'open' WHEN 'aberto' THEN 'open' WHEN 'open' THEN 'open'
             WHEN 'ganha' THEN 'won' WHEN 'ganho' THEN 'won' WHEN 'won' THEN 'won'
             WHEN 'perdida' THEN 'lost' WHEN 'perdido' THEN 'lost' WHEN 'lost' THEN 'lost'
             WHEN 'abandonada' THEN 'abandoned' WHEN 'abandonado' THEN 'abandoned' WHEN 'abandoned' THEN 'abandoned'
             ELSE 'unknown' END AS estado,
           CASE WHEN o.stage_key = ANY(etapas) THEN o.stage_key ELSE 'unknown' END AS etapa,
           greatest(o.created_at, o.updated_at) AS marco
    FROM public.opportunities o
    WHERE o.organization_id = g.organization_id
      AND o.pipeline_id = g.pipeline_id
      AND o.is_demo = false
  ),
  etapas_agg AS (
    SELECT coalesce(jsonb_object_agg(t.etapa, t.n), '{}'::jsonb) AS fases
    FROM (SELECT b.etapa, count(*) AS n FROM base b GROUP BY b.etapa) t
  )
  SELECT jsonb_build_object(
    'opportunities', count(*),
    'linked_contacts', count(DISTINCT b.contact_id) FILTER (WHERE b.contact_id IS NOT NULL),
    'unlinked_opportunities', count(*) FILTER (WHERE b.contact_id IS NULL),
    'latest_record_at', max(b.marco),
    'by_status', jsonb_build_object(
      'open', count(*) FILTER (WHERE b.estado = 'open'),
      'won', count(*) FILTER (WHERE b.estado = 'won'),
      'lost', count(*) FILTER (WHERE b.estado = 'lost'),
      'abandoned', count(*) FILTER (WHERE b.estado = 'abandoned'),
      'unknown', count(*) FILTER (WHERE b.estado = 'unknown')),
    'by_stage', (SELECT fases FROM etapas_agg))
    INTO agregado
    FROM base b;

  SELECT c.last_sync_at INTO sincronizado FROM public.ghl_connections c
    WHERE c.organization_id = g.organization_id AND c.location_id = g.location_id;

  UPDATE public.ad_navigator_grants
    SET last_used_at = now(), use_count = use_count + 1 WHERE id = g.id;

  RETURN jsonb_build_object(
    'schema_version', 1,
    'grant_id', g.id,
    'organization_id', g.organization_id,
    'location_id', g.location_id,
    'pipeline_id', g.pipeline_id,
    'scope', g.scope,
    'source', 'jornada_local',
    'coverage', jsonb_build_object(
      'kind', 'local_snapshot',
      'upstream_complete', false,
      'last_synced_at', sincronizado,
      'latest_record_at', agregado -> 'latest_record_at',
      'reason', 'upstream_coverage_not_verified'),
    'counts', jsonb_build_object(
      'opportunities', agregado -> 'opportunities',
      'linked_contacts', agregado -> 'linked_contacts',
      'unlinked_opportunities', agregado -> 'unlinked_opportunities',
      'by_status', agregado -> 'by_status',
      'by_stage', agregado -> 'by_stage'),
    'attribution', jsonb_build_object('status', 'unavailable', 'reason', 'campaign_link_not_available'),
    'revenue', jsonb_build_object('value', null, 'reason', 'financial_source_not_connected')
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.ad_navigator_membro(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ad_navigator_vinculo_travado(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ad_navigator_vinculo(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ad_navigator_exchange(text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ad_navigator_summary(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_navigator_membro(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ad_navigator_vinculo_travado(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ad_navigator_vinculo(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ad_navigator_exchange(text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ad_navigator_summary(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ad_navigator_create_pairing(text, integer, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ad_navigator_revoke_access(boolean) TO authenticated;