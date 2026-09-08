-- 1. Trusted server-only binding location -> organization
CREATE TABLE IF NOT EXISTS public.ghl_location_bindings (
  location_id text PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.ghl_location_bindings TO service_role;

ALTER TABLE public.ghl_location_bindings ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: anon/authenticated cannot read or modify this binding.

CREATE TRIGGER trg_ghl_bindings_updated
BEFORE UPDATE ON public.ghl_location_bindings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.ghl_location_bindings (location_id, organization_id)
VALUES ('ok2UHC2QMZsd8UHsAgEa', 'f07ab3be-7419-4779-a901-ef71c5fc27f0')
ON CONFLICT (location_id) DO NOTHING;

-- 2. Additive columns on webhooks_inbox
ALTER TABLE public.webhooks_inbox
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'recebido',
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS event_id text,
  ADD COLUMN IF NOT EXISTS source_version text,
  ADD COLUMN IF NOT EXISTS location_id text,
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_webhooks_status ON public.webhooks_inbox (organization_id, status, created_at DESC);

DROP TRIGGER IF EXISTS trg_webhooks_updated ON public.webhooks_inbox;
CREATE TRIGGER trg_webhooks_updated
BEFORE UPDATE ON public.webhooks_inbox
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Transactional processing routine (contact + audit + inbox state)
CREATE OR REPLACE FUNCTION public.ghl_apply_contact_event(
  _inbox_id uuid,
  _org uuid,
  _ghl_contact_id text,
  _full_name text,
  _phone text,
  _phone_normalized text,
  _email text,
  _tags text[],
  _source text,
  _last_interaction timestamptz,
  _event_type text,
  _source_version text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact_id uuid;
  v_created boolean := false;
  v_stage text;
  v_phone_norm text := _phone_normalized;
  v_conflict uuid;
BEGIN
  SELECT id INTO v_contact_id
  FROM public.contacts
  WHERE organization_id = _org AND ghl_contact_id = _ghl_contact_id;

  IF v_phone_norm IS NOT NULL THEN
    SELECT id INTO v_conflict
    FROM public.contacts
    WHERE organization_id = _org
      AND phone_normalized = v_phone_norm
      AND (v_contact_id IS NULL OR id <> v_contact_id);
  END IF;

  IF v_contact_id IS NULL AND v_conflict IS NOT NULL THEN
    -- same person already known by phone: link the GHL id instead of duplicating
    v_contact_id := v_conflict;
    v_conflict := NULL;
    UPDATE public.contacts SET ghl_contact_id = _ghl_contact_id WHERE id = v_contact_id;
  END IF;

  IF v_conflict IS NOT NULL THEN
    v_phone_norm := NULL; -- avoid violating the partial unique phone index
  END IF;

  IF v_contact_id IS NULL THEN
    SELECT key INTO v_stage
    FROM public.journey_stages
    WHERE organization_id = _org
    ORDER BY position ASC
    LIMIT 1;

    INSERT INTO public.contacts (
      organization_id, ghl_contact_id, full_name, phone, phone_normalized,
      email, tags, source, stage_key, last_interaction_at, is_demo
    ) VALUES (
      _org, _ghl_contact_id, _full_name, _phone, v_phone_norm,
      _email, coalesce(_tags, '{}'::text[]), _source,
      coalesce(v_stage, 'novo_lead'), _last_interaction, false
    )
    RETURNING id INTO v_contact_id;
    v_created := true;
  ELSE
    UPDATE public.contacts SET
      full_name = _full_name,
      phone = coalesce(_phone, phone),
      phone_normalized = coalesce(v_phone_norm, phone_normalized),
      email = coalesce(_email, email),
      tags = coalesce(_tags, tags),
      source = coalesce(_source, source),
      last_interaction_at = coalesce(_last_interaction, last_interaction_at),
      is_demo = false
      -- stage_key deliberately preserved
    WHERE id = v_contact_id;
  END IF;

  INSERT INTO public.audit_logs (organization_id, actor_name, action, entity, entity_id, metadata)
  VALUES (
    _org, 'GoHighLevel (webhook)',
    CASE WHEN v_created THEN 'ghl.webhook.contacto_criado' ELSE 'ghl.webhook.contacto_atualizado' END,
    'contact', v_contact_id::text,
    jsonb_build_object('event_type', _event_type, 'ghl_contact_id', _ghl_contact_id, 'source_version', _source_version)
  );

  UPDATE public.webhooks_inbox SET
    status = 'processado',
    processed_at = now(),
    error_message = NULL,
    locked_at = NULL,
    contact_id = v_contact_id,
    source_version = coalesce(_source_version, source_version)
  WHERE id = _inbox_id;

  RETURN jsonb_build_object('contact_id', v_contact_id, 'created', v_created);
END;
$$;

REVOKE ALL ON FUNCTION public.ghl_apply_contact_event(uuid, uuid, text, text, text, text, text, text[], text, timestamptz, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ghl_apply_contact_event(uuid, uuid, text, text, text, text, text, text[], text, timestamptz, text, text) TO service_role;