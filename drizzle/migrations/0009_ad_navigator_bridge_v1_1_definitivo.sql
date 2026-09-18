-- Ponte Jornada -> Ad Navigator (v1.1) — definição autoritativa.
--
-- O ficheiro 0008_ad_navigator_bridge_v1_1.sql ficou com o texto da v1 antiga
-- (baseada em site_integrations). Esta migração regista, de forma idempotente,
-- exatamente o estado corrigido já aplicado: vínculo pela ligação real ao
-- GoHighLevel, agregados numa única consulta e limite de abuso com teto por rota.
--
-- Ordem de travas, igual em criar/trocar/revogar:
--   (1) trava consultiva por organização -> (2) pareamento FOR UPDATE
--   (3) concessão FOR SHARE na leitura.

CREATE TABLE IF NOT EXISTS public.ad_navigator_pairings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by uuid NOT NULL,
  code_sha256 text NOT NULL UNIQUE CHECK (code_sha256 ~ '^[0-9a-f]{64}$'),
  location_id text NOT NULL CHECK (btrim(location_id) <> ''),
  pipeline_id text NOT NULL CHECK (btrim(pipeline_id) <> ''),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ad_navigator_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pairing_id uuid NOT NULL UNIQUE REFERENCES public.ad_navigator_pairings(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  issuer_user_id uuid NOT NULL,
  receiver_tenant_id uuid NOT NULL,
  credential_hash text NOT NULL UNIQUE CHECK (credential_hash ~ '^[0-9a-f]{64}$'),
  location_id text NOT NULL,
  pipeline_id text NOT NULL,
  scope text NOT NULL DEFAULT 'commercial_summary:read' CHECK (scope = 'commercial_summary:read'),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_used_at timestamptz,
  use_count bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ad_navigator_rate_limits (
  bucket_key text NOT NULL CHECK (bucket_key ~ '^[0-9a-f]{64}$'),
  window_start timestamptz NOT NULL,
  hits bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_key, window_start)
);

-- Teto por rota: avaliado antes de criar qualquer balde, para que chaves
-- aleatórias inventadas por um atacante não façam a tabela crescer.
CREATE TABLE IF NOT EXISTS public.ad_navigator_route_limits (
  route text NOT NULL CHECK (route IN ('exchange','summary')),
  window_start timestamptz NOT NULL,
  hits bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (route, window_start)
);

ALTER TABLE public.ad_navigator_pairings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_navigator_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_navigator_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_navigator_route_limits ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.ad_navigator_pairings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ad_navigator_grants FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ad_navigator_rate_limits FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ad_navigator_route_limits FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ad_navigator_pairings TO service_role;
GRANT ALL ON public.ad_navigator_grants TO service_role;
GRANT ALL ON public.ad_navigator_rate_limits TO service_role;
GRANT ALL ON public.ad_navigator_route_limits TO service_role;

-- Vínculo real: ligação GHL conectada, organização não-demo, location e funil
-- padrão explícitos e não vazios. A integração de site não participa.
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
    AND coalesce(btrim(c.location_id), '') <> ''
    AND coalesce(btrim(c.default_pipeline_id), '') <> ''
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.ad_navigator_create_pairing(
  _code_sha256 text, _ttl_seconds integer, _confirm boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  org uuid;
  loc text;
  funil text;
  p public.ad_navigator_pairings;
  nome text;
BEGIN
  org := public.current_org_id();
  IF auth.uid() IS NULL OR org IS NULL
    OR NOT public.tem_papel(array['administrador']::public.app_role[]) THEN
    RAISE EXCEPTION USING errcode='42501', message='Acesso restrito ao administrador da organização.';
  END IF;
  IF _confirm IS DISTINCT FROM true
    OR _code_sha256 IS NULL OR _code_sha256 !~ '^[0-9a-f]{64}$'
    OR _ttl_seconds IS NULL OR _ttl_seconds < 60 OR _ttl_seconds > 900 THEN
    RAISE EXCEPTION USING errcode='22023', message='Pedido inválido ou não confirmado.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('ad_navigator:' || org::text, 0));

  SELECT v.location_id, v.pipeline_id INTO loc, funil FROM public.ad_navigator_vinculo(org) v;
  IF loc IS NULL OR funil IS NULL THEN
    RAISE EXCEPTION USING errcode='42501', message='Ligação do GoHighLevel indisponível nesta conta.';
  END IF;

  UPDATE public.ad_navigator_pairings
    SET revoked_at = now()
    WHERE organization_id = org AND consumed_at IS NULL AND revoked_at IS NULL;

  INSERT INTO public.ad_navigator_pairings
    (organization_id, created_by, code_sha256, location_id, pipeline_id, expires_at)
    VALUES (org, auth.uid(), _code_sha256, loc, funil,
            now() + make_interval(secs => _ttl_seconds))
    RETURNING * INTO p;

  SELECT o.name INTO nome FROM public.organizations o WHERE o.id = org;

  INSERT INTO public.audit_logs (organization_id, actor_id, action, entity, entity_id, metadata)
    VALUES (org, auth.uid(), 'ad_navigator_pareamento_criado', 'ad_navigator_pairing', p.id::text,
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

CREATE OR REPLACE FUNCTION public.ad_navigator_state()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  org uuid;
  nome text;
  loc text;
  funil text;
  ligacao boolean;
  pendente jsonb;
  concessoes jsonb;
BEGIN
  org := public.current_org_id();
  IF auth.uid() IS NULL OR org IS NULL
    OR NOT public.tem_papel(array['administrador']::public.app_role[]) THEN
    RAISE EXCEPTION USING errcode='42501', message='Acesso restrito ao administrador da organização.';
  END IF;

  SELECT o.name INTO nome FROM public.organizations o WHERE o.id = org;
  SELECT v.location_id, v.pipeline_id INTO loc, funil FROM public.ad_navigator_vinculo(org) v;
  ligacao := loc IS NOT NULL AND funil IS NOT NULL;

  SELECT to_jsonb(x) INTO pendente FROM (
    SELECT p.id AS pairing_id, p.expires_at, p.created_at
    FROM public.ad_navigator_pairings p
    WHERE p.organization_id = org AND p.consumed_at IS NULL AND p.revoked_at IS NULL AND p.expires_at > now()
    ORDER BY p.created_at DESC LIMIT 1
  ) x;

  SELECT coalesce(jsonb_agg(to_jsonb(y) ORDER BY y.created_at DESC), '[]'::jsonb) INTO concessoes FROM (
    SELECT g.id AS grant_id, g.receiver_tenant_id, g.created_at, g.expires_at,
           g.revoked_at, g.last_used_at, g.use_count, g.scope
    FROM public.ad_navigator_grants g WHERE g.organization_id = org
  ) y;

  RETURN jsonb_build_object(
    'organization_id', org,
    'organization_name', nome,
    'location_id', loc,
    'pipeline_id', funil,
    'binding_ok', ligacao,
    'connection_ok', ligacao,
    'scope', 'commercial_summary:read',
    'pending_pairing', pendente,
    'grants', concessoes
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.ad_navigator_revoke_access(_confirm boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  org uuid;
  pares integer;
  concessoes integer;
BEGIN
  org := public.current_org_id();
  IF auth.uid() IS NULL OR org IS NULL
    OR NOT public.tem_papel(array['administrador']::public.app_role[]) THEN
    RAISE EXCEPTION USING errcode='42501', message='Acesso restrito ao administrador da organização.';
  END IF;
  IF _confirm IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING errcode='22023', message='Pedido inválido ou não confirmado.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('ad_navigator:' || org::text, 0));

  UPDATE public.ad_navigator_pairings SET revoked_at = now()
    WHERE organization_id = org AND consumed_at IS NULL AND revoked_at IS NULL;
  GET DIAGNOSTICS pares = ROW_COUNT;

  UPDATE public.ad_navigator_grants SET revoked_at = now()
    WHERE organization_id = org AND revoked_at IS NULL;
  GET DIAGNOSTICS concessoes = ROW_COUNT;

  INSERT INTO public.audit_logs (organization_id, actor_id, action, entity, metadata)
    VALUES (org, auth.uid(), 'ad_navigator_acesso_revogado', 'ad_navigator_grant',
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

  SELECT organization_id INTO org FROM public.ad_navigator_pairings WHERE code_sha256 = _code_sha256;
  IF org IS NULL THEN
    RAISE EXCEPTION USING errcode='22023', message='pareamento_invalido';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ad_navigator:' || org::text, 0));

  SELECT * INTO p FROM public.ad_navigator_pairings
    WHERE code_sha256 = _code_sha256 FOR UPDATE;
  IF NOT FOUND OR p.consumed_at IS NOT NULL OR p.revoked_at IS NOT NULL OR p.expires_at <= now() THEN
    RAISE EXCEPTION USING errcode='22023', message='pareamento_invalido';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.user_roles r
      WHERE r.user_id = p.created_by AND r.organization_id = p.organization_id
        AND r.role = 'administrador'::public.app_role)
    OR NOT EXISTS (SELECT 1 FROM public.profiles pr
      WHERE pr.id = p.created_by AND pr.organization_id = p.organization_id) THEN
    RAISE EXCEPTION USING errcode='42501', message='autorizacao_indisponivel';
  END IF;

  SELECT v.location_id, v.pipeline_id INTO loc, funil
    FROM public.ad_navigator_vinculo(p.organization_id) v;
  IF loc IS NULL OR funil IS NULL
    OR loc IS DISTINCT FROM p.location_id OR funil IS DISTINCT FROM p.pipeline_id THEN
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

  SELECT * INTO g FROM public.ad_navigator_grants
    WHERE credential_hash = _credential_hash FOR SHARE;
  IF NOT FOUND OR g.revoked_at IS NOT NULL OR g.expires_at <= now() THEN
    RAISE EXCEPTION USING errcode='42501', message='credencial_invalida';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.user_roles r
      WHERE r.user_id = g.issuer_user_id AND r.organization_id = g.organization_id
        AND r.role = 'administrador'::public.app_role)
    OR NOT EXISTS (SELECT 1 FROM public.profiles pr
      WHERE pr.id = g.issuer_user_id AND pr.organization_id = g.organization_id) THEN
    RAISE EXCEPTION USING errcode='42501', message='autorizacao_indisponivel';
  END IF;

  SELECT v.location_id, v.pipeline_id INTO loc, funil
    FROM public.ad_navigator_vinculo(g.organization_id) v;
  IF loc IS NULL OR funil IS NULL
    OR loc IS DISTINCT FROM g.location_id OR funil IS DISTINCT FROM g.pipeline_id THEN
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

CREATE OR REPLACE FUNCTION public.ad_navigator_rate_hit_v2(
  _route text, _bucket_key text, _limit integer, _route_limit integer, _window_seconds integer)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  inicio timestamptz;
  rota bigint;
  atual bigint;
BEGIN
  IF _route IS NULL OR _route NOT IN ('exchange','summary')
    OR _bucket_key IS NULL OR _bucket_key !~ '^[0-9a-f]{64}$'
    OR _limit IS NULL OR _limit < 1
    OR _route_limit IS NULL OR _route_limit < 1
    OR _window_seconds IS NULL OR _window_seconds < 1 THEN
    RAISE EXCEPTION USING errcode='22023', message='pedido_invalido';
  END IF;
  inicio := to_timestamp(floor(extract(epoch FROM now()) / _window_seconds) * _window_seconds);

  INSERT INTO public.ad_navigator_route_limits (route, window_start, hits)
    VALUES (_route, inicio, 1)
    ON CONFLICT (route, window_start)
    DO UPDATE SET hits = public.ad_navigator_route_limits.hits + 1
    RETURNING hits INTO rota;
  IF rota > _route_limit THEN
    RETURN false;
  END IF;

  INSERT INTO public.ad_navigator_rate_limits (bucket_key, window_start, hits)
    VALUES (_bucket_key, inicio, 1)
    ON CONFLICT (bucket_key, window_start)
    DO UPDATE SET hits = public.ad_navigator_rate_limits.hits + 1
    RETURNING hits INTO atual;

  DELETE FROM public.ad_navigator_rate_limits r
    WHERE r.ctid IN (
      SELECT x.ctid FROM public.ad_navigator_rate_limits x
      WHERE x.window_start < now() - interval '1 day' LIMIT 200);
  DELETE FROM public.ad_navigator_route_limits r
    WHERE r.ctid IN (
      SELECT x.ctid FROM public.ad_navigator_route_limits x
      WHERE x.window_start < now() - interval '1 day' LIMIT 200);

  RETURN atual <= _limit;
END;
$function$;

REVOKE ALL ON FUNCTION public.ad_navigator_vinculo(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ad_navigator_exchange(text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ad_navigator_summary(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ad_navigator_rate_hit_v2(text, text, integer, integer, integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.ad_navigator_create_pairing(text, integer, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ad_navigator_state() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ad_navigator_revoke_access(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ad_navigator_vinculo(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ad_navigator_exchange(text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ad_navigator_summary(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ad_navigator_rate_hit_v2(text, text, integer, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.ad_navigator_create_pairing(text, integer, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.ad_navigator_state() TO service_role;
GRANT EXECUTE ON FUNCTION public.ad_navigator_revoke_access(boolean) TO service_role;