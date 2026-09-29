CREATE TABLE public.n8n_appointment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  event_id text NOT NULL,
  ghl_appointment_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('confirmada','cancelada','reagendamento_pedido','sem_resposta')),
  occurred_at timestamptz NOT NULL,
  resultado text NOT NULL,
  appointment_id uuid REFERENCES public.appointments(id),
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, event_id)
);
CREATE INDEX idx_n8n_appt_events_appt ON public.n8n_appointment_events (organization_id, ghl_appointment_id, occurred_at DESC);
REVOKE ALL ON public.n8n_appointment_events FROM anon, authenticated;
GRANT ALL ON public.n8n_appointment_events TO service_role;
ALTER TABLE public.n8n_appointment_events ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.record_n8n_appointment_event(
  _org uuid, _event_id text, _ghl_appointment_id text, _status text, _occurred_at timestamptz)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _appt uuid; _newer boolean; _res text;
BEGIN
  IF _org IS NULL OR _event_id IS NULL OR _ghl_appointment_id IS NULL OR _status IS NULL OR _occurred_at IS NULL THEN
    RAISE EXCEPTION 'invalid' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ghl_location_bindings WHERE organization_id = _org) THEN
    RAISE EXCEPTION 'no binding' USING ERRCODE = '28000';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(_org::text || ':' || _ghl_appointment_id, 0));
  IF EXISTS (SELECT 1 FROM public.n8n_appointment_events WHERE organization_id = _org AND event_id = _event_id) THEN
    RETURN jsonb_build_object('ok', true, 'resultado', 'duplicado');
  END IF;
  SELECT id INTO _appt FROM public.appointments
   WHERE organization_id = _org AND ghl_appointment_id = _ghl_appointment_id AND is_demo = false
   FOR UPDATE;
  SELECT EXISTS (SELECT 1 FROM public.n8n_appointment_events
     WHERE organization_id = _org AND ghl_appointment_id = _ghl_appointment_id AND occurred_at > _occurred_at) INTO _newer;
  IF _appt IS NULL THEN _res := 'consulta_desconhecida';
  ELSIF _newer THEN _res := 'ignorado_mais_antigo';
  ELSIF _status IN ('confirmada','cancelada') THEN
    UPDATE public.appointments SET status = _status, updated_at = now()
     WHERE id = _appt AND status IS DISTINCT FROM _status;
    _res := 'atualizado';
  ELSE _res := 'registado';
  END IF;
  INSERT INTO public.n8n_appointment_events (organization_id, event_id, ghl_appointment_id, status, occurred_at, resultado, appointment_id)
  VALUES (_org, _event_id, _ghl_appointment_id, _status, _occurred_at, _res, _appt);
  RETURN jsonb_build_object('ok', true, 'resultado', _res);
END $$;
REVOKE ALL ON FUNCTION public.record_n8n_appointment_event(uuid,text,text,text,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_n8n_appointment_event(uuid,text,text,text,timestamptz) TO service_role;