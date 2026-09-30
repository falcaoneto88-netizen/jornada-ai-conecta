-- n8n bridge: credencial por organização (chave criada pelo administrador no cartão).
-- ESTADO: PENDENTE — NÃO APLICADO. Aditivo; não altera 0013 nem dados existentes.
-- Guarda apenas o SHA-256 (hex minúsculo) de uma chave aleatória de 32 bytes gerada no servidor.
-- Nenhum texto em claro é guardado. Chave primária = organização: criação única e atómica
-- (INSERT simples; um segundo INSERT falha com 23505; sem upsert/sobrescrita).
-- Só service_role acede. Se N8N_JORNADA_BRIDGE_TOKEN (ambiente) existir, tem precedência e
-- a criação pela interface fica indisponível.

CREATE TABLE IF NOT EXISTS public.n8n_bridge_credentials (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id),
  key_sha256 text NOT NULL CHECK (key_sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.n8n_bridge_credentials FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.n8n_bridge_credentials TO service_role;
ALTER TABLE public.n8n_bridge_credentials ENABLE ROW LEVEL SECURITY;
