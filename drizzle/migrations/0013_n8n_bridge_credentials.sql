CREATE TABLE IF NOT EXISTS public.n8n_bridge_credentials (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id),
  key_sha256 text NOT NULL CHECK (key_sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.n8n_bridge_credentials FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.n8n_bridge_credentials TO service_role;
ALTER TABLE public.n8n_bridge_credentials ENABLE ROW LEVEL SECURITY;