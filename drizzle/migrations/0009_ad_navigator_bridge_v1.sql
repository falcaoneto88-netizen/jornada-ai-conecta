-- Ponte Jornada -> Ad Navigator (v1): APENAS indicadores comerciais agregados.
--
-- Princípios:
--  * O pareamento é criado por um administrador autenticado da própria
--    organização; guardamos só o SHA256 do código (nunca o código).
--  * A troca consome o código exatamente uma vez, em transação, revalidando
--    papel do emissor, organização, vínculo de location, funil e ligação.
--  * O resumo devolve só contagens agregadas de oportunidades não-demo do
--    funil vinculado. Nunca nomes, telefones, emails, tags, conversas ou
--    qualquer dado clínico.
--  * Nenhum segredo (código, bearer) é persistido em claro nem registado.

-- ============ TABELAS ============

CREATE TABLE IF NOT EXISTS public.ad_navigator_pairings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by uuid NOT NULL,
  code_sha256 text NOT NULL UNIQUE CHECK (code_sha256 ~ '^[0-9a-f]{64}$'),
  location_id text NOT NULL,
  pipeline_id text NOT NULL,
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

-- Limite de abuso persistente, com chave derivada (hash) - nunca IP nem PII.
CREATE TABLE IF NOT EXISTS public.ad_navigator_rate_limits (
  bucket_key text NOT NULL CHECK (bucket_key ~ '^[0-9a-f]{64}$'),
  window_start timestamptz NOT NULL,
  hits integer NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_key, window_start)
);

CREATE INDEX IF NOT EXISTS idx_ad_nav_pairings_org ON public.ad_navigator_pairings(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ad_nav_grants_org ON public.ad_navigator_grants(organization_id, created_at DESC);

-- Acesso negado a anon/authenticated: só as funções autorizadas abaixo tocam nestas tabelas.
REVOKE ALL ON public.ad_navigator_pairings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ad_navigator_grants FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ad_navigator_rate_limits FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ad_navigator_pairings TO service_role;
GRANT ALL ON public.ad_navigator_grants TO service_role;
GRANT ALL ON public.ad_navigator_rate_limits TO service_role;

ALTER TABLE public.ad_navigator_pairings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_navigator_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_navigator_rate_limits ENABLE ROW LEVEL SECURITY;

-- ============ CRIAÇÃO DO PAREAMENTO (administrador autenticado) ============

CREATE OR REPLACE FUNCTION public.ad_navigator_create_pairing(
  _code_sha256 text,
  _ttl_seconds integer,
  _confirm boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  org uuid;
  i public.site_integrations;
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

  SELECT * INTO i FROM public.site_integrations
    WHERE organization_id = org AND slug = 'experiencia-falcao' AND source = 'experiencia-falcao'
    FOR UPDATE;
  IF NOT FOUND OR i.ghl_location_id IS NULL OR i.ghl_pipeline_id IS NULL THEN
    RAISE EXCEPTION USING errcode='22023', message='Integração por configurar.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ghl_location_bindings b
      WHERE b.organization_id = org AND b.location_id = i.ghl_location_id)
    OR NOT EXISTS (SELECT 1 FROM public.ghl_connections g
      WHERE g.organization_id = org AND g.location_id = i.ghl_location_id AND g.status = 'conectada') THEN
    RAISE EXCEPTION USING errcode='42501', message='Vínculo do GoHighLevel indisponível nesta conta.';
  END IF;

  -- Um único código por emitir de cada vez.
  UPDATE public.ad_navigator_pairings
    SET revoked_at = now()
    WHERE organization_id = org AND consumed_at IS NULL AND revoked_at IS NULL;

  INSERT INTO public.ad_navigator_pairings
    (organization_id, created_by, code_sha256, location_id, pipeline_id, expires_at)
    VALUES (org, auth.uid(), _code_sha256, i.ghl_location_id, i.ghl_pipeline_id,
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
$$;

-- ============ ESTADO PARA O CARTÃO (administrador autenticado) ============

CREATE OR REPLACE FUNCTION public.ad_navigator_state()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  org uuid;
  i public.site_integrations;
  nome text;
  vinculo boolean;
  ligacao boolean;
  pendente jsonb;
  concessoes jsonb;
BEGIN
  org := public.current_org_id();
  IF auth.uid() IS NULL OR org IS NULL
    OR NOT public.tem_papel(array['administrador']::public.app_role[]) THEN
    RAISE EXCEPTION USING errcode='42501', message='Acesso restrito ao administrador da organização.';
  END IF;

  SELECT * INTO i FROM public.site_integrations
    WHERE organization_id = org AND slug = 'experiencia-falcao' AND source = 'experiencia-falcao';
  SELECT o.name INTO nome FROM public.organizations o WHERE o.id = org;

  vinculo := EXISTS (SELECT 1 FROM public.ghl_location_bindings b
    WHERE b.organization_id = org AND b.location_id = i.ghl_location_id);
  ligacao := EXISTS (SELECT 1 FROM public.ghl_connections g
    WHERE g.organization_id = org AND g.location_id = i.ghl_location_id AND g.status = 'conectada');

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
    'location_id', i.ghl_location_id,
    'pipeline_id', i.ghl_pipeline_id,
    'binding_ok', coalesce(vinculo, false),
    'connection_ok', coalesce(ligacao, false),
    'scope', 'commercial_summary:read',
    'pending_pairing', pendente,
    'grants', concessoes
  );
END;
$$;

-- ============ REVOGAÇÃO (administrador autenticado; nunca depende do externo) ============

CREATE OR REPLACE FUNCTION public.ad_navigator_revoke_access(_confirm boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
$$;

-- ============ TROCA DO CÓDIGO (servidor de confiança) ============

CREATE OR REPLACE FUNCTION public.ad_navigator_exchange(
  _code_sha256 text,
  _receiver_tenant_id uuid,
  _credential_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  p public.ad_navigator_pairings;
  i public.site_integrations;
  g public.ad_navigator_grants;
  nome text;
BEGIN
  IF _code_sha256 IS NULL OR _code_sha256 !~ '^[0-9a-f]{64}$'
    OR _receiver_tenant_id IS NULL
    OR _credential_hash IS NULL OR _credential_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING errcode='22023', message='pedido_invalido';
  END IF;

  -- Consumo exatamente uma vez: a linha fica bloqueada até ao fim da transação.
  SELECT * INTO p FROM public.ad_navigator_pairings
    WHERE code_sha256 = _code_sha256 FOR UPDATE;
  IF NOT FOUND OR p.consumed_at IS NOT NULL OR p.revoked_at IS NOT NULL OR p.expires_at <= now() THEN
    RAISE EXCEPTION USING errcode='22023', message='pareamento_invalido';
  END IF;

  -- O emissor tem de continuar administrador real desta organização.
  IF NOT EXISTS (SELECT 1 FROM public.user_roles r
      WHERE r.user_id = p.created_by AND r.organization_id = p.organization_id
        AND r.role = 'administrador'::public.app_role) THEN
    RAISE EXCEPTION USING errcode='42501', message='autorizacao_indisponivel';
  END IF;

  SELECT * INTO i FROM public.site_integrations
    WHERE organization_id = p.organization_id AND slug = 'experiencia-falcao' AND source = 'experiencia-falcao';
  IF NOT FOUND
    OR i.ghl_location_id IS DISTINCT FROM p.location_id
    OR i.ghl_pipeline_id IS DISTINCT FROM p.pipeline_id
    OR NOT EXISTS (SELECT 1 FROM public.ghl_location_bindings b
      WHERE b.organization_id = p.organization_id AND b.location_id = p.location_id)
    OR NOT EXISTS (SELECT 1 FROM public.ghl_connections c
      WHERE c.organization_id = p.organization_id AND c.location_id = p.location_id AND c.status = 'conectada') THEN
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
$$;

-- ============ RESUMO AGREGADO (servidor de confiança) ============

CREATE OR REPLACE FUNCTION public.ad_navigator_summary(_credential_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  g public.ad_navigator_grants;
  i public.site_integrations;
  etapas text[] := array[
    'novo_lead','em_atendimento','consulta_agendada','consulta_confirmada','consulta_realizada',
    'orcamento_enviado','procedimento_agendado','pos_procedimento','follow_up','reativacao',
    'consulta_nao_paga','consulta_paga','nao_compareceu','follow_up_2','depoimento_indicacao',
    'perdido_desqualificado','procedimento_realizado'];
  total bigint;
  ligados bigint;
  soltos bigint;
  estados jsonb;
  fases jsonb;
  ultimo timestamptz;
  sincronizado timestamptz;
BEGIN
  IF _credential_hash IS NULL OR _credential_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING errcode='22023', message='pedido_invalido';
  END IF;

  SELECT * INTO g FROM public.ad_navigator_grants WHERE credential_hash = _credential_hash;
  IF NOT FOUND OR g.revoked_at IS NOT NULL OR g.expires_at <= now() THEN
    RAISE EXCEPTION USING errcode='42501', message='credencial_invalida';
  END IF;

  -- Revalidação em TODA a leitura: emissor, organização, vínculo, funil e ligação.
  IF NOT EXISTS (SELECT 1 FROM public.user_roles r
      WHERE r.user_id = g.issuer_user_id AND r.organization_id = g.organization_id
        AND r.role = 'administrador'::public.app_role) THEN
    RAISE EXCEPTION USING errcode='42501', message='autorizacao_indisponivel';
  END IF;

  SELECT * INTO i FROM public.site_integrations
    WHERE organization_id = g.organization_id AND slug = 'experiencia-falcao' AND source = 'experiencia-falcao';
  IF NOT FOUND
    OR i.ghl_location_id IS DISTINCT FROM g.location_id
    OR i.ghl_pipeline_id IS DISTINCT FROM g.pipeline_id
    OR NOT EXISTS (SELECT 1 FROM public.ghl_location_bindings b
      WHERE b.organization_id = g.organization_id AND b.location_id = g.location_id)
    OR NOT EXISTS (SELECT 1 FROM public.ghl_connections c
      WHERE c.organization_id = g.organization_id AND c.location_id = g.location_id AND c.status = 'conectada') THEN
    RAISE EXCEPTION USING errcode='42501', message='autorizacao_indisponivel';
  END IF;

  -- Só colunas técnicas de oportunidades: nenhum join a contactos/conversas.
  WITH base AS (
    SELECT o.contact_id,
           CASE lower(coalesce(o.status, ''))
             WHEN 'aberta' THEN 'open' WHEN 'aberto' THEN 'open' WHEN 'open' THEN 'open'
             WHEN 'ganha' THEN 'won' WHEN 'ganho' THEN 'won' WHEN 'won' THEN 'won'
             WHEN 'perdida' THEN 'lost' WHEN 'perdido' THEN 'lost' WHEN 'lost' THEN 'lost'
             WHEN 'abandonada' THEN 'abandoned' WHEN 'abandonado' THEN 'abandoned' WHEN 'abandoned' THEN 'abandoned'
             ELSE 'unknown' END AS estado,
           greatest(o.created_at, o.updated_at) AS marco
    FROM public.opportunities o
    WHERE o.organization_id = g.organization_id
      AND o.pipeline_id = g.pipeline_id
      AND o.is_demo = false
  )
  SELECT count(*), count(DISTINCT b.contact_id) FILTER (WHERE b.contact_id IS NOT NULL),
         count(*) FILTER (WHERE b.contact_id IS NULL), max(b.marco),
         jsonb_build_object(
           'open', count(*) FILTER (WHERE b.estado = 'open'),
           'won', count(*) FILTER (WHERE b.estado = 'won'),
           'lost', count(*) FILTER (WHERE b.estado = 'lost'),
           'abandoned', count(*) FILTER (WHERE b.estado = 'abandoned'),
           'unknown', count(*) FILTER (WHERE b.estado = 'unknown'))
    INTO total, ligados, soltos, ultimo, estados
    FROM base b;

  WITH base AS (
    SELECT CASE WHEN o.stage_key = ANY(etapas) THEN o.stage_key ELSE 'unknown' END AS etapa
    FROM public.opportunities o
    WHERE o.organization_id = g.organization_id
      AND o.pipeline_id = g.pipeline_id
      AND o.is_demo = false
  )
  SELECT coalesce(jsonb_object_agg(t.etapa, t.n), '{}'::jsonb) INTO fases
    FROM (SELECT b.etapa, count(*) AS n FROM base b GROUP BY b.etapa) t;

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
      'latest_record_at', ultimo,
      'reason', 'upstream_coverage_not_verified'),
    'counts', jsonb_build_object(
      'opportunities', total,
      'linked_contacts', ligados,
      'unlinked_opportunities', soltos,
      'by_status', estados,
      'by_stage', fases),
    'attribution', jsonb_build_object('status', 'unavailable', 'reason', 'campaign_link_not_available'),
    'revenue', jsonb_build_object('value', null, 'reason', 'financial_source_not_connected')
  );
END;
$$;

-- ============ LIMITE DE ABUSO PERSISTENTE (servidor de confiança) ============

CREATE OR REPLACE FUNCTION public.ad_navigator_rate_hit(
  _bucket_key text,
  _limit integer,
  _window_seconds integer
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  inicio timestamptz;
  atual integer;
BEGIN
  IF _bucket_key IS NULL OR _bucket_key !~ '^[0-9a-f]{64}$'
    OR _limit IS NULL OR _limit < 1 OR _window_seconds IS NULL OR _window_seconds < 1 THEN
    RAISE EXCEPTION USING errcode='22023', message='pedido_invalido';
  END IF;
  inicio := to_timestamp(floor(extract(epoch FROM now()) / _window_seconds) * _window_seconds);

  INSERT INTO public.ad_navigator_rate_limits (bucket_key, window_start, hits)
    VALUES (_bucket_key, inicio, 1)
    ON CONFLICT (bucket_key, window_start)
    DO UPDATE SET hits = public.ad_navigator_rate_limits.hits + 1
    RETURNING hits INTO atual;

  DELETE FROM public.ad_navigator_rate_limits
    WHERE window_start < now() - interval '1 day';

  RETURN atual <= _limit;
END;
$$;

-- ============ PERMISSÕES DE EXECUÇÃO ============

REVOKE ALL ON FUNCTION public.ad_navigator_create_pairing(text, integer, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ad_navigator_state() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ad_navigator_revoke_access(boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ad_navigator_exchange(text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ad_navigator_summary(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ad_navigator_rate_hit(text, integer, integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.ad_navigator_create_pairing(text, integer, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ad_navigator_state() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ad_navigator_revoke_access(boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ad_navigator_exchange(text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ad_navigator_summary(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ad_navigator_rate_hit(text, integer, integer) TO service_role;
