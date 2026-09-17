-- Correção mínima: NULL não é recusado por NOT IN (lógica trivalente), pelo que
-- _scope=NULL caía no ramo do acolhimento. Guard explícito para NULL.
CREATE OR REPLACE FUNCTION public.set_site_integration_flags_v2(_scope text, _state text, _confirm boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  org uuid;
  i public.site_integrations;
  novo_remote text;
  novo_welcome text;
BEGIN
  org := public.current_org_id();
  IF auth.uid() IS NULL OR org IS NULL
    OR NOT public.tem_papel(array['administrador']::public.app_role[]) THEN
    RAISE EXCEPTION USING errcode='42501', message='Acesso restrito ao administrador da organização.';
  END IF;
  IF _confirm IS DISTINCT FROM true
    OR _scope IS NULL OR _state IS NULL
    OR _scope NOT IN ('remote_write','welcome_channel')
    OR _state NOT IN ('ligado','desligado') THEN
    RAISE EXCEPTION USING errcode='22023', message='Pedido inválido ou não confirmado.';
  END IF;

  SELECT * INTO i FROM public.site_integrations
    WHERE organization_id = org AND slug = 'experiencia-falcao' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING errcode='22023', message='Integração por configurar.';
  END IF;

  novo_remote := i.remote_write_state;
  novo_welcome := i.welcome_channel_state;

  IF _state = 'ligado' THEN
    IF i.source IS DISTINCT FROM 'experiencia-falcao'
      OR i.ghl_location_id IS DISTINCT FROM 'ok2UHC2QMZsd8UHsAgEa'
      OR i.ghl_pipeline_id IS DISTINCT FROM '2QGyurvcmwhNhRgq0jCq'
      OR i.ghl_stage_id IS DISTINCT FROM 'c23ea507-33f5-41b6-933b-fd532ccbb773'
      OR NOT EXISTS (SELECT 1 FROM public.ghl_location_bindings b
        WHERE b.organization_id = org AND b.location_id = i.ghl_location_id)
      OR NOT EXISTS (SELECT 1 FROM public.ghl_connections g
        WHERE g.organization_id = org AND g.location_id = i.ghl_location_id
          AND g.status = 'conectada' AND g.write_enabled = true) THEN
      RAISE EXCEPTION USING errcode='42501',
        message='Destino não autorizado ou escrita no GoHighLevel desativada nesta conta.';
    END IF;
    IF _scope = 'remote_write' THEN
      novo_remote := 'habilitado';
    ELSE
      IF i.remote_write_state IS DISTINCT FROM 'habilitado' THEN
        RAISE EXCEPTION USING errcode='42501',
          message='Ative primeiro a escrita no GoHighLevel.';
      END IF;
      novo_welcome := 'configurado';
    END IF;
  ELSE
    IF _scope = 'remote_write' THEN
      novo_remote := 'pendente';
      novo_welcome := 'pendente';
    ELSE
      novo_welcome := 'pendente';
    END IF;
  END IF;

  UPDATE public.site_integrations
    SET remote_write_state = novo_remote, welcome_channel_state = novo_welcome, updated_at = now()
    WHERE id = i.id RETURNING * INTO i;

  INSERT INTO public.audit_logs(organization_id,actor_id,actor_name,action,entity,entity_id,metadata,verified)
    VALUES(org, auth.uid(), 'Administrador', 'site_integration.flags_v2', 'site_integration', i.id::text,
      jsonb_build_object('scope', _scope, 'state', _state,
        'remote_write_state', i.remote_write_state,
        'welcome_channel_state', i.welcome_channel_state), true);

  RETURN jsonb_build_object('remote_write_state', i.remote_write_state,
    'welcome_channel_state', i.welcome_channel_state);
END $$;

REVOKE ALL ON FUNCTION public.set_site_integration_flags_v2(text,text,boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_site_integration_flags_v2(text,text,boolean) TO authenticated;
