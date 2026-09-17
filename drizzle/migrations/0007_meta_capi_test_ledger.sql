-- Preparação do teste controlado da API de Conversões da Meta (Experiência Falcão).
-- Aditiva: nova tabela de registo durável e duas funções. Não altera integrações,
-- interruptores, contactos, oportunidades nem o ledger de leads do site.

CREATE TABLE public.meta_capi_test_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  integration_id uuid NOT NULL REFERENCES public.site_integrations(id) ON DELETE CASCADE,
  dataset_id text NOT NULL,
  test_event_code text NOT NULL,
  request_id uuid NOT NULL,
  event_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('in_progress','api_accepted','rejected','uncertain')),
  events_received integer,
  fbtrace_id text,
  diagnostic text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meta_capi_attempt_ledger_key UNIQUE (organization_id, integration_id, dataset_id, test_event_code),
  CONSTRAINT meta_capi_attempt_request_key UNIQUE (organization_id, request_id),
  CONSTRAINT meta_capi_attempt_event_key UNIQUE (organization_id, event_id)
);

GRANT SELECT ON public.meta_capi_test_attempts TO authenticated;
GRANT ALL ON public.meta_capi_test_attempts TO service_role;
ALTER TABLE public.meta_capi_test_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY meta_capi_test_attempts_admin_read ON public.meta_capi_test_attempts
  FOR SELECT TO authenticated
  USING (
    organization_id = public.current_org_id()
    AND public.tem_papel(array['administrador']::public.app_role[])
  );

-- Reserva atómica: um único registo por organização+integração+dataset+código de
-- teste. Nunca é libertado, qualquer que seja o desfecho (aceite, erro ou incerto).
CREATE OR REPLACE FUNCTION public.meta_capi_test_reserve(
  _dataset text, _test_code text, _request uuid, _event_id text, _confirm boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  org uuid;
  i public.site_integrations;
  novo public.meta_capi_test_attempts;
BEGIN
  org := public.current_org_id();
  IF auth.uid() IS NULL OR org IS NULL
    OR NOT public.tem_papel(array['administrador']::public.app_role[]) THEN
    RAISE EXCEPTION USING errcode='42501', message='Acesso restrito ao administrador da organização.';
  END IF;
  IF _confirm IS DISTINCT FROM true
    OR _dataset IS NULL OR _test_code IS NULL OR _request IS NULL OR _event_id IS NULL
    OR _dataset IS DISTINCT FROM '1810411136960763'
    OR _test_code !~ '^TEST[0-9A-Z]{1,16}$'
    OR _event_id !~ '^[A-Za-z0-9_-]{8,128}$' THEN
    RAISE EXCEPTION USING errcode='22023', message='Pedido inválido ou não confirmado.';
  END IF;

  SELECT * INTO i FROM public.site_integrations
    WHERE organization_id = org AND slug = 'experiencia-falcao' AND source = 'experiencia-falcao';
  IF NOT FOUND OR i.ghl_location_id IS DISTINCT FROM 'ok2UHC2QMZsd8UHsAgEa'
    OR NOT EXISTS (SELECT 1 FROM public.ghl_location_bindings b
      WHERE b.organization_id = org AND b.location_id = i.ghl_location_id) THEN
    RAISE EXCEPTION USING errcode='42501', message='Integração Experiência Falcão não disponível nesta organização.';
  END IF;

  INSERT INTO public.meta_capi_test_attempts(
    organization_id, integration_id, dataset_id, test_event_code, request_id, event_id, status
  ) VALUES (org, i.id, _dataset, _test_code, _request, _event_id, 'in_progress')
  ON CONFLICT DO NOTHING
  RETURNING * INTO novo;

  IF novo.id IS NULL THEN
    RAISE EXCEPTION USING errcode='42501',
      message='Já existe uma tentativa registada para este conjunto de dados e código de teste.';
  END IF;

  INSERT INTO public.audit_logs(organization_id,actor_id,actor_name,action,entity,entity_id,metadata,verified)
    VALUES(org, auth.uid(), 'Administrador', 'meta_capi.test_reserved', 'meta_capi_test_attempt',
      novo.id::text, jsonb_build_object('dataset_id', _dataset, 'test_event_code', _test_code,
      'request_id', _request, 'event_id', _event_id, 'status', 'in_progress'), true);

  RETURN jsonb_build_object('attempt_id', novo.id, 'organization_id', org, 'integration_id', i.id,
    'dataset_id', novo.dataset_id, 'test_event_code', novo.test_event_code,
    'request_id', novo.request_id, 'event_id', novo.event_id, 'status', novo.status);
END $$;

REVOKE ALL ON FUNCTION public.meta_capi_test_reserve(text,text,uuid,text,boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.meta_capi_test_reserve(text,text,uuid,text,boolean) TO authenticated;

-- Finalização: só o servidor de confiança pode declarar o desfecho. Nenhuma
-- sessão autenticada pode forjar uma aceitação.
CREATE OR REPLACE FUNCTION public.meta_capi_test_finish(
  _attempt uuid, _status text, _events_received integer, _fbtrace text, _diagnostic text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a public.meta_capi_test_attempts;
BEGIN
  IF _attempt IS NULL OR _status IS NULL
    OR _status NOT IN ('api_accepted','rejected','uncertain') THEN
    RAISE EXCEPTION USING errcode='22023', message='Pedido inválido.';
  END IF;
  IF _status = 'api_accepted' AND _events_received IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION USING errcode='22023', message='Aceitação exige events_received igual a 1.';
  END IF;
  IF _fbtrace IS NOT NULL AND _fbtrace !~ '^[A-Za-z0-9_-]{1,64}$' THEN
    RAISE EXCEPTION USING errcode='22023', message='Identificador de diagnóstico inválido.';
  END IF;

  SELECT * INTO a FROM public.meta_capi_test_attempts WHERE id = _attempt FOR UPDATE;
  IF NOT FOUND OR a.status IS DISTINCT FROM 'in_progress' THEN
    RAISE EXCEPTION USING errcode='42501', message='Tentativa inexistente ou já finalizada.';
  END IF;

  UPDATE public.meta_capi_test_attempts
    SET status = _status, events_received = _events_received, fbtrace_id = _fbtrace,
        diagnostic = left(coalesce(_diagnostic,''), 200), updated_at = now()
    WHERE id = a.id RETURNING * INTO a;

  INSERT INTO public.audit_logs(organization_id,actor_id,actor_name,action,entity,entity_id,metadata,verified)
    VALUES(a.organization_id, NULL, 'Servidor Jornada', 'meta_capi.test_' || _status,
      'meta_capi_test_attempt', a.id::text,
      jsonb_build_object('dataset_id', a.dataset_id, 'test_event_code', a.test_event_code,
        'events_received', a.events_received, 'fbtrace_id', a.fbtrace_id,
        'diagnostic', a.diagnostic), true);

  RETURN jsonb_build_object('attempt_id', a.id, 'status', a.status,
    'events_received', a.events_received, 'fbtrace_id', a.fbtrace_id,
    'diagnostic', a.diagnostic, 'persisted', true);
END $$;

REVOKE ALL ON FUNCTION public.meta_capi_test_finish(uuid,text,integer,text,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.meta_capi_test_finish(uuid,text,integer,text,text) TO service_role;