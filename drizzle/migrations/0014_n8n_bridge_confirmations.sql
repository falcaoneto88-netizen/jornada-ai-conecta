-- Local implementation. Apply before enabling appointment.confirm; no activation flags change.
-- New requests retain the authenticated contact ID. Old sends stay unlinked and cannot prove a reply.
ALTER TABLE public.n8n_bridge_sends ADD COLUMN IF NOT EXISTS contact_id text
  CHECK (contact_id IS NULL OR contact_id ~ '^[A-Za-z0-9_-]{6,64}$');
CREATE OR REPLACE FUNCTION public.n8n_bridge_claim_send(
  _org uuid, _appointment text, _start timestamptz, _kind text, _contact text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _id uuid; _row public.n8n_bridge_sends;
BEGIN
  IF _org IS NULL OR _appointment IS NULL OR _start IS NULL OR _kind IS NULL
    OR _appointment !~ '^[A-Za-z0-9_-]{6,64}$' OR _contact IS NULL OR _contact !~ '^[A-Za-z0-9_-]{6,64}$' THEN
    RAISE EXCEPTION 'invalid' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ghl_location_bindings WHERE organization_id = _org) THEN
    RAISE EXCEPTION 'no binding' USING ERRCODE = '28000';
  END IF;
  INSERT INTO public.n8n_bridge_sends (organization_id, ghl_appointment_id, start_time, kind, contact_id)
  VALUES (_org, _appointment, date_trunc('second', _start), _kind, _contact)
  ON CONFLICT ON CONSTRAINT n8n_bridge_sends_once DO NOTHING RETURNING id INTO _id;
  IF _id IS NOT NULL THEN RETURN jsonb_build_object('reserved', true, 'id', _id); END IF;
  SELECT * INTO _row FROM public.n8n_bridge_sends WHERE organization_id = _org
    AND ghl_appointment_id = _appointment AND start_time = date_trunc('second', _start) AND kind = _kind;
  RETURN jsonb_build_object('reserved', false, 'id', _row.id,
    'state', CASE WHEN _row.contact_id = _contact THEN _row.state ELSE 'contact_mismatch' END,
    'message_id', CASE WHEN _row.state = 'accepted' AND _row.contact_id = _contact THEN _row.message_id ELSE NULL END);
END $$;
REVOKE ALL ON FUNCTION public.n8n_bridge_claim_send(uuid,text,timestamptz,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.n8n_bridge_claim_send(uuid,text,timestamptz,text,text) TO service_role;

CREATE TABLE IF NOT EXISTS public.n8n_bridge_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  request_send_id uuid NOT NULL REFERENCES public.n8n_bridge_sends(id),
  ghl_appointment_id text NOT NULL,
  start_time timestamptz NOT NULL,
  inbound_message_id text NOT NULL CHECK (inbound_message_id ~ '^[A-Za-z0-9_-]{6,64}$'),
  reply_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved','confirmed','rejected','unknown')),
  error_code text CHECK (error_code IS NULL OR error_code ~ '^[a-z_]{1,40}$'),
  reserved_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (organization_id, inbound_message_id),
  UNIQUE (organization_id, ghl_appointment_id, start_time)
);
REVOKE ALL ON public.n8n_bridge_confirmations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.n8n_bridge_confirmations TO service_role;
ALTER TABLE public.n8n_bridge_confirmations ENABLE ROW LEVEL SECURITY;

-- Return 51 rather than silently dropping ambiguity. The server accepts at most 50.
-- No body/contact data is stored; each message is fetched and verified from GHL.
CREATE OR REPLACE FUNCTION public.n8n_bridge_confirmation_requests(_org uuid, _contact text, _reply_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF _org IS NULL OR _contact IS NULL OR _contact !~ '^[A-Za-z0-9_-]{6,64}$' OR _reply_at IS NULL OR _reply_at > now() OR NOT EXISTS
    (SELECT 1 FROM public.ghl_location_bindings WHERE organization_id = _org) THEN
    RAISE EXCEPTION 'invalid scope' USING ERRCODE = '28000';
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', s.id, 'appointment_id', s.ghl_appointment_id, 'start_time', s.start_time,
      'message_id', s.message_id, 'accepted_at', s.finished_at))
    FROM (SELECT * FROM public.n8n_bridge_sends
      WHERE organization_id = _org AND contact_id = _contact AND kind IN ('req24','req12') AND state = 'accepted'
        AND message_id IS NOT NULL AND finished_at < _reply_at AND start_time > _reply_at
      ORDER BY finished_at DESC, id LIMIT 51) s), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.n8n_bridge_claim_confirmation(
  _org uuid, _request uuid, _inbound text, _reply_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _source public.n8n_bridge_sends; _id uuid; _row public.n8n_bridge_confirmations;
BEGIN
  IF _org IS NULL OR _request IS NULL OR _inbound IS NULL OR _inbound !~ '^[A-Za-z0-9_-]{6,64}$'
    OR _reply_at IS NULL OR _reply_at > now() OR NOT EXISTS
      (SELECT 1 FROM public.ghl_location_bindings WHERE organization_id = _org) THEN
    RAISE EXCEPTION 'invalid scope' USING ERRCODE = '28000';
  END IF;
  SELECT * INTO _source FROM public.n8n_bridge_sends WHERE id = _request AND organization_id = _org
    AND contact_id IS NOT NULL AND kind IN ('req24','req12') AND state = 'accepted' AND message_id IS NOT NULL
    AND finished_at < _reply_at AND start_time > _reply_at AND start_time > now();
  IF _source.id IS NULL THEN RAISE EXCEPTION 'invalid evidence' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.n8n_bridge_confirmations
    (organization_id, request_send_id, ghl_appointment_id, start_time, inbound_message_id, reply_at)
  VALUES (_org, _request, _source.ghl_appointment_id, _source.start_time, _inbound, _reply_at)
  ON CONFLICT DO NOTHING RETURNING id INTO _id;
  IF _id IS NOT NULL THEN RETURN jsonb_build_object('reserved', true, 'id', _id); END IF;
  SELECT * INTO _row FROM public.n8n_bridge_confirmations WHERE organization_id = _org AND
    (inbound_message_id = _inbound OR (ghl_appointment_id = _source.ghl_appointment_id AND start_time = _source.start_time))
    ORDER BY reserved_at LIMIT 1;
  -- A message already used for a different appointment can never assert this appointment confirmed.
  RETURN jsonb_build_object('reserved', false, 'id', _row.id, 'state', CASE
    WHEN _row.ghl_appointment_id = _source.ghl_appointment_id AND _row.start_time = _source.start_time
      THEN _row.state ELSE 'message_already_used' END);
END $$;

CREATE OR REPLACE FUNCTION public.n8n_bridge_finish_confirmation(_org uuid, _id uuid, _state text, _error text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _count integer;
BEGIN
  IF _org IS NULL OR _id IS NULL OR _state IS NULL OR _state NOT IN ('confirmed','rejected','unknown') THEN
    RAISE EXCEPTION 'invalid' USING ERRCODE = '22023';
  END IF;
  UPDATE public.n8n_bridge_confirmations SET state = _state, error_code = _error, finished_at = now()
    WHERE organization_id = _org AND id = _id AND state = 'reserved';
  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN jsonb_build_object('persisted', _count = 1, 'state', _state);
END $$;
REVOKE ALL ON FUNCTION public.n8n_bridge_confirmation_requests(uuid,text,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.n8n_bridge_claim_confirmation(uuid,uuid,text,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.n8n_bridge_finish_confirmation(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.n8n_bridge_confirmation_requests(uuid,text,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.n8n_bridge_claim_confirmation(uuid,uuid,text,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.n8n_bridge_finish_confirmation(uuid,uuid,text,text) TO service_role;
