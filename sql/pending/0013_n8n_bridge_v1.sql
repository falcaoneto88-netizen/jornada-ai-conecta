-- n8n bridge v1 (n8n -> Jornada -> GoHighLevel).
-- ESTADO: PENDENTE. Não aplicado em produção. Fonte única desta migração.
-- Aplicação manual documentada em docs/n8n-bridge-v1.md.
-- Tudo nasce desligado: bridge_enabled=false, live_send_enabled=false, simulation=true,
-- morada vazia, canal por definir, sem vendedor de reserva.

CREATE TABLE IF NOT EXISTS public.n8n_bridge_settings (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id),
  bridge_enabled boolean NOT NULL DEFAULT false,
  live_send_enabled boolean NOT NULL DEFAULT false,
  simulation boolean NOT NULL DEFAULT true,
  calendar_id text CHECK (calendar_id IS NULL OR calendar_id ~ '^[A-Za-z0-9_-]{6,64}$'),
  channel text CHECK (channel IS NULL OR channel IN ('sms','whatsapp_zaptos')),
  clinic_address text NOT NULL DEFAULT '' CHECK (char_length(clinic_address) <= 240),
  fallback_user_id text CHECK (fallback_user_id IS NULL OR fallback_user_id ~ '^[A-Za-z0-9_-]{6,64}$'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
REVOKE ALL ON public.n8n_bridge_settings FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.n8n_bridge_settings TO service_role;
ALTER TABLE public.n8n_bridge_settings ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.n8n_bridge_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  ghl_appointment_id text NOT NULL,
  start_time timestamptz NOT NULL,
  kind text NOT NULL CHECK (kind IN ('booking','req24','req12','confirm','escalation','handoff')),
  state text NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved','accepted','rejected','unknown')),
  message_id text,
  error_code text CHECK (error_code IS NULL OR error_code ~ '^[a-z_]{1,40}$'),
  reserved_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT n8n_bridge_sends_once UNIQUE (organization_id, ghl_appointment_id, start_time, kind),
  CONSTRAINT n8n_bridge_sends_accepted_id CHECK (state <> 'accepted' OR message_id IS NOT NULL)
);
REVOKE ALL ON public.n8n_bridge_sends FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.n8n_bridge_sends TO service_role;
ALTER TABLE public.n8n_bridge_sends ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.n8n_bridge_rate (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  window_start timestamptz NOT NULL,
  hits integer NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, window_start)
);
REVOKE ALL ON public.n8n_bridge_rate FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.n8n_bridge_rate TO service_role;
ALTER TABLE public.n8n_bridge_rate ENABLE ROW LEVEL SECURITY;

-- Quota por minuto. Devolve true se o pedido cabe na janela.
CREATE OR REPLACE FUNCTION public.n8n_bridge_hit(_org uuid, _limit integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _n integer;
BEGIN
  IF _org IS NULL OR _limit IS NULL OR _limit < 1 THEN RAISE EXCEPTION 'invalid' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.n8n_bridge_rate AS r (organization_id, window_start, hits)
  VALUES (_org, date_trunc('minute', now()), 1)
  ON CONFLICT (organization_id, window_start) DO UPDATE SET hits = r.hits + 1
  RETURNING hits INTO _n;
  DELETE FROM public.n8n_bridge_rate WHERE organization_id = _org AND window_start < now() - interval '1 hour';
  RETURN _n <= _limit;
END $$;

-- Reserva atómica ANTES do POST externo. A UNIQUE garante no máximo uma reserva
-- por organização + consulta + horário normalizado + tipo, mesmo em concorrência.
CREATE OR REPLACE FUNCTION public.n8n_bridge_claim_send(
  _org uuid, _appointment text, _start timestamptz, _kind text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _id uuid; _row public.n8n_bridge_sends;
BEGIN
  IF _org IS NULL OR _appointment IS NULL OR _start IS NULL OR _kind IS NULL
     OR _appointment !~ '^[A-Za-z0-9_-]{6,64}$' THEN
    RAISE EXCEPTION 'invalid' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ghl_location_bindings WHERE organization_id = _org) THEN
    RAISE EXCEPTION 'no binding' USING ERRCODE = '28000';
  END IF;
  INSERT INTO public.n8n_bridge_sends (organization_id, ghl_appointment_id, start_time, kind)
  VALUES (_org, _appointment, date_trunc('second', _start), _kind)
  ON CONFLICT ON CONSTRAINT n8n_bridge_sends_once DO NOTHING
  RETURNING id INTO _id;
  IF _id IS NOT NULL THEN
    RETURN jsonb_build_object('reserved', true, 'id', _id);
  END IF;
  SELECT * INTO _row FROM public.n8n_bridge_sends
   WHERE organization_id = _org AND ghl_appointment_id = _appointment
     AND start_time = date_trunc('second', _start) AND kind = _kind;
  RETURN jsonb_build_object('reserved', false, 'id', _row.id, 'state', _row.state,
    'message_id', CASE WHEN _row.state = 'accepted' THEN _row.message_id ELSE NULL END);
END $$;

-- Conclui uma reserva uma única vez (só a partir de 'reserved').
CREATE OR REPLACE FUNCTION public.n8n_bridge_finish_send(
  _org uuid, _id uuid, _state text, _message_id text, _error text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _n integer;
BEGIN
  IF _org IS NULL OR _id IS NULL OR _state NOT IN ('accepted','rejected','unknown')
     OR (_state = 'accepted' AND (_message_id IS NULL OR _message_id = '')) THEN
    RAISE EXCEPTION 'invalid' USING ERRCODE = '22023';
  END IF;
  UPDATE public.n8n_bridge_sends
     SET state = _state, message_id = CASE WHEN _state = 'accepted' THEN _message_id ELSE NULL END,
         error_code = _error, finished_at = now()
   WHERE id = _id AND organization_id = _org AND state = 'reserved';
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN jsonb_build_object('persisted', _n = 1, 'state', _state,
    'message_id', CASE WHEN _state = 'accepted' THEN _message_id ELSE NULL END);
END $$;

REVOKE ALL ON FUNCTION public.n8n_bridge_hit(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.n8n_bridge_claim_send(uuid, text, timestamptz, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.n8n_bridge_finish_send(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.n8n_bridge_hit(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.n8n_bridge_claim_send(uuid, text, timestamptz, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.n8n_bridge_finish_send(uuid, uuid, text, text, text) TO service_role;
