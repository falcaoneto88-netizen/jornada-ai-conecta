CREATE TABLE public.appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  contact_id uuid REFERENCES public.contacts(id),
  ghl_appointment_id text,
  ghl_calendar_id text,
  title text NOT NULL DEFAULT 'Marcação',
  start_at timestamptz NOT NULL,
  end_at timestamptz,
  status text NOT NULL DEFAULT 'confirmada',
  assigned_user_name text,
  notes text,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_appointments_ghl
  ON public.appointments (organization_id, ghl_appointment_id)
  WHERE ghl_appointment_id IS NOT NULL;
CREATE INDEX idx_appointments_org_start ON public.appointments (organization_id, start_at DESC);
CREATE INDEX idx_appointments_contact ON public.appointments (contact_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.appointments TO authenticated;
GRANT ALL ON public.appointments TO service_role;

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

CREATE POLICY appointments_select ON public.appointments
  FOR SELECT TO authenticated
  USING (organization_id = public.current_org_id());

CREATE POLICY appointments_insert ON public.appointments
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.current_org_id()
    AND public.tem_papel(ARRAY['administrador'::app_role, 'gestor'::app_role, 'comercial'::app_role]));

CREATE POLICY appointments_update ON public.appointments
  FOR UPDATE TO authenticated
  USING (organization_id = public.current_org_id()
    AND public.tem_papel(ARRAY['administrador'::app_role, 'gestor'::app_role, 'comercial'::app_role]))
  WITH CHECK (organization_id = public.current_org_id()
    AND public.tem_papel(ARRAY['administrador'::app_role, 'gestor'::app_role, 'comercial'::app_role]));

CREATE POLICY appointments_delete ON public.appointments
  FOR DELETE TO authenticated
  USING (organization_id = public.current_org_id()
    AND public.tem_papel(ARRAY['administrador'::app_role, 'gestor'::app_role]));

CREATE TRIGGER update_appointments_updated_at
  BEFORE UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER appointments_org_pai
  BEFORE INSERT OR UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.verificar_org_pai();