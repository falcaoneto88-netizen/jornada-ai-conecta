-- Candidate only. No seed, secret, flags, existing grants or workflows are changed.
-- Apply before the backend guard. One explicit, expiring pilot per server-resolved organization.
CREATE TABLE public.n8n_bridge_pilot_grants (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id),
  enabled boolean NOT NULL DEFAULT false,
  contact_id text NOT NULL CHECK (contact_id ~ '^[A-Za-z0-9_-]{6,64}$'),
  ghl_appointment_id text NOT NULL CHECK (ghl_appointment_id ~ '^[A-Za-z0-9_-]{6,64}$'),
  start_time timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  allowed_kinds text[] NOT NULL DEFAULT '{}'
    CHECK (array_ndims(allowed_kinds) IS NULL OR array_ndims(allowed_kinds) = 1)
    CHECK (cardinality(allowed_kinds) <= 5 AND array_position(allowed_kinds, NULL) IS NULL)
    CHECK (allowed_kinds <@ ARRAY['booking','req24','req12','confirm','appointment.confirm']::text[]),
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT enabled OR (cardinality(allowed_kinds) > 0 AND expires_at > updated_at)),
  CHECK (expires_at <= start_time AND expires_at <= updated_at + interval '24 hours')
);
REVOKE ALL ON public.n8n_bridge_pilot_grants FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.n8n_bridge_pilot_grants TO service_role;
ALTER TABLE public.n8n_bridge_pilot_grants ENABLE ROW LEVEL SECURITY;