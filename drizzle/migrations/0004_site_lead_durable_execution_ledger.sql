CREATE TABLE public.site_lead_execution_ledger (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  integration_id uuid NOT NULL REFERENCES public.site_integrations(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('remote','welcome')),
  channel text NOT NULL,
  identity_key text NOT NULL,
  first_submission_id uuid NOT NULL REFERENCES public.site_lead_submissions(id) ON DELETE CASCADE,
  state text NOT NULL CHECK (state IN ('reserved','confirmed','blocked','uncertain')),
  external_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, integration_id, scope, channel, identity_key)
);
GRANT ALL ON public.site_lead_execution_ledger TO service_role;
ALTER TABLE public.site_lead_execution_ledger ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.site_lead_submissions
  ADD COLUMN remote_observed_contact_id text,
  ADD COLUMN remote_observed_opportunity_id text;

INSERT INTO public.site_lead_execution_ledger(
  organization_id, integration_id, scope, channel, identity_key,
  first_submission_id, state, external_id, created_at, updated_at
)
SELECT s.organization_id, s.integration_id, 'remote', 'ghl_contact_opportunity',
  'contacto:' || s.contact_id::text, s.id,
  CASE WHEN s.remote_state = 'confirmado' THEN 'confirmed'
       WHEN s.remote_state = 'a_processar' THEN 'uncertain'
       ELSE 'blocked' END,
  s.ghl_opportunity_id, coalesce(s.remote_attempted_at, s.created_at), now()
FROM public.site_lead_submissions s
WHERE s.contact_id IS NOT NULL AND s.remote_state IN ('confirmado','bloqueado','a_processar')
ON CONFLICT DO NOTHING;

INSERT INTO public.site_lead_execution_ledger(
  organization_id, integration_id, scope, channel, identity_key,
  first_submission_id, state, external_id, created_at, updated_at
)
SELECT s.organization_id, s.integration_id, 'welcome', 'sms_ghl_zaptoswpp',
  'contacto:' || s.contact_id::text, s.id,
  CASE WHEN s.welcome_state IN ('enviado','entregue') THEN 'confirmed'
       WHEN s.welcome_state = 'a_enviar' THEN 'uncertain'
       ELSE 'blocked' END,
  s.welcome_message_id, coalesce(s.welcome_intent_at, s.created_at), now()
FROM public.site_lead_submissions s
WHERE s.contact_id IS NOT NULL AND s.welcome_state IN ('enviado','entregue','bloqueado','a_enviar')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.claim_site_lead_remote_v2(_submission uuid, _source text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s public.site_lead_submissions;
  i public.site_integrations;
  c public.contacts;
  ident public.site_lead_identities;
  chave text;
  dono uuid;
BEGIN
  SELECT * INTO s FROM public.site_lead_submissions WHERE id = _submission FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING errcode='22023', message='Recibo inexistente.'; END IF;
  SELECT * INTO i FROM public.site_integrations WHERE id = s.integration_id;
  IF NOT FOUND OR i.organization_id IS DISTINCT FROM s.organization_id
    OR i.source IS DISTINCT FROM _source OR i.enabled IS DISTINCT FROM true
    OR i.remote_write_state IS DISTINCT FROM 'habilitado' THEN
    RAISE EXCEPTION USING errcode='42501', message='Escrita remota não habilitada.';
  END IF;
  IF i.ghl_location_id IS NULL OR i.ghl_pipeline_id IS NULL OR i.ghl_stage_id IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.ghl_location_bindings b
      WHERE b.organization_id=s.organization_id AND b.location_id=i.ghl_location_id)
    OR NOT EXISTS (SELECT 1 FROM public.ghl_connections g
      WHERE g.organization_id=s.organization_id AND g.location_id=i.ghl_location_id
        AND g.write_enabled=true AND g.status='conectada') THEN
    RAISE EXCEPTION USING errcode='42501', message='Destino não autorizado ou escrita desativada.';
  END IF;
  IF s.status IS DISTINCT FROM 'registado' OR s.contact_id IS NULL
    OR s.remote_state IS DISTINCT FROM 'pendente' THEN
    RAISE EXCEPTION USING errcode='42501', message='Recibo não elegível.';
  END IF;
  SELECT * INTO ident FROM public.site_lead_identities
    WHERE submission_id=s.id AND organization_id=s.organization_id AND integration_id=s.integration_id;
  SELECT * INTO c FROM public.contacts WHERE id=s.contact_id AND organization_id=s.organization_id;
  IF ident.submission_id IS NULL OR c.id IS NULL THEN
    UPDATE public.site_lead_submissions SET remote_state='bloqueado', remote_reason='identidade_consentida_ausente' WHERE id=s.id;
    INSERT INTO public.audit_logs(organization_id,actor_id,actor_name,action,entity,entity_id,metadata,verified)
      VALUES(s.organization_id,auth.uid(),'Integração de site','site_lead.remote_blocked_at_claim','site_lead_submission',s.id::text,jsonb_build_object('reason','identidade_consentida_ausente'),true);
    RETURN jsonb_build_object('blocked',true,'reason','identidade_consentida_ausente');
  END IF;
  IF coalesce(c.phone_normalized,'') IS DISTINCT FROM coalesce(ident.phone_normalized,'')
    OR lower(coalesce(c.email,'')) IS DISTINCT FROM lower(coalesce(ident.email,'')) THEN
    UPDATE public.site_lead_submissions SET status='em_revisao',local_state='em_revisao',review_reason='divergencia_com_identidade_consentida',remote_state='bloqueado',remote_reason='divergencia_com_identidade_consentida' WHERE id=s.id;
    INSERT INTO public.audit_logs(organization_id,actor_id,actor_name,action,entity,entity_id,metadata,verified)
      VALUES(s.organization_id,auth.uid(),'Integração de site','site_lead.remote_blocked_at_claim','site_lead_submission',s.id::text,jsonb_build_object('reason','divergencia_com_identidade_consentida'),true);
    RETURN jsonb_build_object('blocked',true,'reason','divergencia_com_identidade_consentida');
  END IF;
  chave := 'contacto:' || s.contact_id::text;
  INSERT INTO public.site_lead_execution_ledger(organization_id,integration_id,scope,channel,identity_key,first_submission_id,state)
    VALUES(s.organization_id,s.integration_id,'remote','ghl_contact_opportunity',chave,s.id,'reserved')
    ON CONFLICT DO NOTHING;
  SELECT first_submission_id INTO dono FROM public.site_lead_execution_ledger
    WHERE organization_id=s.organization_id AND integration_id=s.integration_id
      AND scope='remote' AND channel='ghl_contact_opportunity' AND identity_key=chave;
  IF dono IS DISTINCT FROM s.id THEN
    RETURN jsonb_build_object('blocked',true,'reason','execucao_remota_ja_registada_para_a_mesma_pessoa');
  END IF;
  UPDATE public.site_lead_submissions SET remote_state='a_processar',remote_attempted_at=now() WHERE id=s.id;
  INSERT INTO public.audit_logs(organization_id,actor_id,actor_name,action,entity,entity_id,metadata,verified)
    VALUES(s.organization_id,auth.uid(),'Integração de site','site_lead.remote_intent','site_lead_submission',s.id::text,jsonb_build_object('scope','remote','channel','ghl_contact_opportunity'),true);
  RETURN jsonb_build_object('submission_id',s.id,'organization_id',s.organization_id,'integration_id',s.integration_id,
    'location_id',i.ghl_location_id,'pipeline_id',i.ghl_pipeline_id,'stage_id',i.ghl_stage_id,
    'contact_id',c.id,'full_name',ident.full_name,'phone',ident.phone,'phone_normalized',ident.phone_normalized,
    'email',ident.email,'ghl_contact_id',c.ghl_contact_id,'blocked',false);
END $$;
REVOKE ALL ON FUNCTION public.claim_site_lead_remote_v2(uuid,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_site_lead_remote_v2(uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.finish_site_lead_remote_v2(
  _submission uuid, _state text, _reason text, _ghl_contact text, _ghl_opportunity text,
  _opp_name text, _opp_pipeline text, _opp_stage text, _opp_status text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s public.site_lead_submissions;
  i public.site_integrations;
  chave text;
  estado_ledger text;
BEGIN
  IF _state NOT IN ('confirmado','bloqueado') THEN RAISE EXCEPTION USING errcode='22023',message='Estado inválido.'; END IF;
  IF _ghl_contact IS NOT NULL AND _ghl_contact !~ '^[A-Za-z0-9_-]{1,128}$' THEN RAISE EXCEPTION USING errcode='22023',message='Identificador remoto inválido.'; END IF;
  IF _ghl_opportunity IS NOT NULL AND _ghl_opportunity !~ '^[A-Za-z0-9_-]{1,128}$' THEN RAISE EXCEPTION USING errcode='22023',message='Identificador remoto inválido.'; END IF;
  IF _state='confirmado' AND (_ghl_contact IS NULL OR _ghl_opportunity IS NULL) THEN RAISE EXCEPTION USING errcode='22023',message='Confirmação exige contacto e oportunidade reais.'; END IF;
  IF _ghl_opportunity IS NOT NULL AND (_opp_pipeline IS NULL OR _opp_stage IS NULL OR _opp_status IS NULL) THEN RAISE EXCEPTION USING errcode='22023',message='Oportunidade sem dados reais do GoHighLevel.'; END IF;
  SELECT * INTO s FROM public.site_lead_submissions WHERE id=_submission FOR UPDATE;
  SELECT * INTO i FROM public.site_integrations WHERE id=s.integration_id;
  IF s.id IS NULL OR i.id IS NULL OR i.organization_id IS DISTINCT FROM s.organization_id
    OR s.remote_state IS DISTINCT FROM 'a_processar' OR s.contact_id IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.ghl_location_bindings b WHERE b.organization_id=s.organization_id AND b.location_id=i.ghl_location_id) THEN
    RAISE EXCEPTION USING errcode='42501',message='Recibo ou destino inconsistente.';
  END IF;
  chave := 'contacto:' || s.contact_id::text;
  IF NOT EXISTS (SELECT 1 FROM public.site_lead_execution_ledger l
    WHERE l.organization_id=s.organization_id AND l.integration_id=s.integration_id
      AND l.scope='remote' AND l.channel='ghl_contact_opportunity' AND l.identity_key=chave
      AND l.first_submission_id=s.id AND l.state='reserved') THEN
    RAISE EXCEPTION USING errcode='42501',message='Reserva remota inconsistente.';
  END IF;
  IF _state='confirmado' AND _opp_pipeline IS DISTINCT FROM i.ghl_pipeline_id THEN
    RAISE EXCEPTION USING errcode='22023',message='Oportunidade fora do funil configurado.';
  END IF;
  IF _state='confirmado' THEN
    UPDATE public.site_lead_submissions SET remote_state='confirmado',remote_reason=left(coalesce(_reason,''),200),
      ghl_contact_id=_ghl_contact,ghl_opportunity_id=_ghl_opportunity,
      remote_observed_contact_id=NULL,remote_observed_opportunity_id=NULL WHERE id=s.id RETURNING * INTO s;
    UPDATE public.contacts SET ghl_contact_id=_ghl_contact
      WHERE id=s.contact_id AND organization_id=s.organization_id
        AND (ghl_contact_id IS NULL OR ghl_contact_id=_ghl_contact);
    IF NOT FOUND THEN RAISE EXCEPTION USING errcode='23514',message='Contacto local com identidade externa divergente.'; END IF;
    INSERT INTO public.opportunities(organization_id,contact_id,ghl_opportunity_id,name,pipeline_id,stage_id,status,is_demo)
      VALUES(s.organization_id,s.contact_id,_ghl_opportunity,coalesce(nullif(_opp_name,''),'Oportunidade'),_opp_pipeline,_opp_stage,_opp_status,false)
      ON CONFLICT (organization_id,ghl_opportunity_id) WHERE ghl_opportunity_id IS NOT NULL DO NOTHING;
    IF EXISTS (SELECT 1 FROM public.opportunities o WHERE o.organization_id=s.organization_id AND o.ghl_opportunity_id=_ghl_opportunity
      AND (o.contact_id IS DISTINCT FROM s.contact_id OR o.pipeline_id IS DISTINCT FROM _opp_pipeline OR o.stage_id IS DISTINCT FROM _opp_stage)) THEN
      RAISE EXCEPTION USING errcode='23514',message='Oportunidade persistida inconsistente.';
    END IF;
    estado_ledger := 'confirmed';
  ELSE
    UPDATE public.site_lead_submissions SET remote_state='bloqueado',remote_reason=left(coalesce(_reason,''),200),
      remote_observed_contact_id=_ghl_contact,remote_observed_opportunity_id=_ghl_opportunity WHERE id=s.id RETURNING * INTO s;
    estado_ledger := CASE WHEN lower(coalesce(_reason,'')) ~ '(incert|timeout|network|malformed|reconcili)' THEN 'uncertain' ELSE 'blocked' END;
  END IF;
  UPDATE public.site_lead_execution_ledger SET state=estado_ledger,external_id=_ghl_opportunity,updated_at=now()
    WHERE organization_id=s.organization_id AND integration_id=s.integration_id AND scope='remote'
      AND channel='ghl_contact_opportunity' AND identity_key=chave AND first_submission_id=s.id;
  IF NOT FOUND THEN RAISE EXCEPTION USING errcode='23514',message='Ledger remoto não persistido.'; END IF;
  INSERT INTO public.audit_logs(organization_id,actor_id,actor_name,action,entity,entity_id,metadata,verified)
    VALUES(s.organization_id,auth.uid(),'Integração de site','site_lead.remote_'||_state,'site_lead_submission',s.id::text,
      jsonb_build_object('remote_state',s.remote_state,'reason',left(coalesce(_reason,''),200),'has_contact',_ghl_contact is not null,'has_opportunity',_ghl_opportunity is not null),true);
  RETURN jsonb_build_object('submission_id',s.id,'remote_state',s.remote_state,'ghl_contact_id',s.ghl_contact_id,
    'ghl_opportunity_id',s.ghl_opportunity_id,'observed_contact_id',s.remote_observed_contact_id,
    'observed_opportunity_id',s.remote_observed_opportunity_id,'persisted',true);
END $$;
REVOKE ALL ON FUNCTION public.finish_site_lead_remote_v2(uuid,text,text,text,text,text,text,text,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_site_lead_remote_v2(uuid,text,text,text,text,text,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_site_lead_welcome_v2(_submission uuid, _source text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s public.site_lead_submissions;
  i public.site_integrations;
  c public.contacts;
  ident public.site_lead_identities;
  chave text;
  dono uuid;
BEGIN
  SELECT * INTO s FROM public.site_lead_submissions WHERE id=_submission FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING errcode='22023',message='Recibo inexistente.'; END IF;
  SELECT * INTO i FROM public.site_integrations WHERE id=s.integration_id;
  IF NOT FOUND OR i.organization_id IS DISTINCT FROM s.organization_id OR i.source IS DISTINCT FROM _source
    OR i.enabled IS DISTINCT FROM true OR i.welcome_channel_state IS DISTINCT FROM 'configurado' THEN
    RAISE EXCEPTION USING errcode='42501',message='Canal de acolhimento não configurado.';
  END IF;
  IF i.ghl_location_id IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.ghl_location_bindings b WHERE b.organization_id=s.organization_id AND b.location_id=i.ghl_location_id)
    OR NOT EXISTS (SELECT 1 FROM public.ghl_connections g WHERE g.organization_id=s.organization_id
      AND g.location_id=i.ghl_location_id AND g.write_enabled=true AND g.status='conectada') THEN
    RAISE EXCEPTION USING errcode='42501',message='Destino não autorizado ou escrita desativada.';
  END IF;
  IF s.remote_state IS DISTINCT FROM 'confirmado' OR s.ghl_contact_id IS NULL OR s.contact_id IS NULL
    OR s.consent_version IS NULL OR s.consent_at IS NULL OR s.welcome_state IS DISTINCT FROM 'pendente' THEN
    RAISE EXCEPTION USING errcode='42501',message='Acolhimento não elegível.';
  END IF;
  SELECT * INTO ident FROM public.site_lead_identities WHERE submission_id=s.id
    AND organization_id=s.organization_id AND integration_id=s.integration_id;
  SELECT * INTO c FROM public.contacts WHERE id=s.contact_id AND organization_id=s.organization_id
    AND ghl_contact_id=s.ghl_contact_id;
  IF ident.submission_id IS NULL OR c.id IS NULL OR ident.phone_normalized IS NULL
    OR c.phone_normalized IS DISTINCT FROM ident.phone_normalized
    OR lower(coalesce(c.email,'')) IS DISTINCT FROM lower(coalesce(ident.email,'')) THEN
    UPDATE public.site_lead_submissions SET welcome_state='bloqueado',welcome_reason='divergencia_com_identidade_consentida' WHERE id=s.id;
    INSERT INTO public.audit_logs(organization_id,actor_id,actor_name,action,entity,entity_id,metadata,verified)
      VALUES(s.organization_id,auth.uid(),'Integração de site','site_lead.welcome_blocked_at_claim','site_lead_submission',s.id::text,jsonb_build_object('reason','divergencia_com_identidade_consentida'),true);
    RETURN jsonb_build_object('blocked',true,'reason','divergencia_com_identidade_consentida');
  END IF;
  chave := 'contacto:' || s.contact_id::text;
  INSERT INTO public.site_lead_execution_ledger(organization_id,integration_id,scope,channel,identity_key,first_submission_id,state)
    VALUES(s.organization_id,s.integration_id,'welcome','sms_ghl_zaptoswpp',chave,s.id,'reserved') ON CONFLICT DO NOTHING;
  SELECT first_submission_id INTO dono FROM public.site_lead_execution_ledger
    WHERE organization_id=s.organization_id AND integration_id=s.integration_id AND scope='welcome'
      AND channel='sms_ghl_zaptoswpp' AND identity_key=chave;
  IF dono IS DISTINCT FROM s.id THEN
    RETURN jsonb_build_object('blocked',true,'reason','acolhimento_ja_registado_para_a_mesma_pessoa');
  END IF;
  UPDATE public.site_lead_submissions SET welcome_state='a_enviar',welcome_intent_at=now(),welcome_consent_version=s.consent_version WHERE id=s.id;
  INSERT INTO public.audit_logs(organization_id,actor_id,actor_name,action,entity,entity_id,metadata,verified)
    VALUES(s.organization_id,auth.uid(),'Integração de site','site_lead.welcome_intent','site_lead_submission',s.id::text,
      jsonb_build_object('consent_version',s.consent_version,'consent_at',s.consent_at,'channel','sms_ghl_zaptoswpp'),true);
  RETURN jsonb_build_object('submission_id',s.id,'organization_id',s.organization_id,'integration_id',s.integration_id,
    'location_id',i.ghl_location_id,'ghl_contact_id',s.ghl_contact_id,'first_name',split_part(coalesce(ident.full_name,''),' ',1),
    'phone_normalized',ident.phone_normalized,'email',ident.email,'consent_version',s.consent_version,'blocked',false);
END $$;
REVOKE ALL ON FUNCTION public.claim_site_lead_welcome_v2(uuid,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_site_lead_welcome_v2(uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.finish_site_lead_welcome_v2(_submission uuid, _state text, _reason text, _message_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s public.site_lead_submissions;
  i public.site_integrations;
  chave text;
  estado_ledger text;
BEGIN
  IF _state NOT IN ('enviado','bloqueado') THEN RAISE EXCEPTION USING errcode='22023',message='Estado inválido.'; END IF;
  IF _state='enviado' AND coalesce(_message_id,'') !~ '^[A-Za-z0-9_-]{1,128}$' THEN RAISE EXCEPTION USING errcode='22023',message='Envio aceite exige identificador de mensagem.'; END IF;
  SELECT * INTO s FROM public.site_lead_submissions WHERE id=_submission FOR UPDATE;
  SELECT * INTO i FROM public.site_integrations WHERE id=s.integration_id;
  IF s.id IS NULL OR i.id IS NULL OR i.organization_id IS DISTINCT FROM s.organization_id
    OR s.welcome_state IS DISTINCT FROM 'a_enviar' OR s.contact_id IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.ghl_location_bindings b WHERE b.organization_id=s.organization_id AND b.location_id=i.ghl_location_id) THEN
    RAISE EXCEPTION USING errcode='42501',message='Recibo ou destino inconsistente.';
  END IF;
  chave := 'contacto:' || s.contact_id::text;
  IF NOT EXISTS (SELECT 1 FROM public.site_lead_execution_ledger l WHERE l.organization_id=s.organization_id
    AND l.integration_id=s.integration_id AND l.scope='welcome' AND l.channel='sms_ghl_zaptoswpp'
    AND l.identity_key=chave AND l.first_submission_id=s.id AND l.state='reserved') THEN
    RAISE EXCEPTION USING errcode='42501',message='Reserva de acolhimento inconsistente.';
  END IF;
  UPDATE public.site_lead_submissions SET welcome_state=_state,welcome_reason=left(coalesce(_reason,''),200),
    welcome_message_id=_message_id,welcome_sent_at=CASE WHEN _state='enviado' THEN now() ELSE welcome_sent_at END
    WHERE id=s.id RETURNING * INTO s;
  estado_ledger := CASE WHEN _state='enviado' THEN 'confirmed'
    WHEN lower(coalesce(_reason,'')) ~ '(incert|timeout|network|malformed|reconcili|sem_identificador)' THEN 'uncertain'
    ELSE 'blocked' END;
  UPDATE public.site_lead_execution_ledger SET state=estado_ledger,external_id=_message_id,updated_at=now()
    WHERE organization_id=s.organization_id AND integration_id=s.integration_id AND scope='welcome'
      AND channel='sms_ghl_zaptoswpp' AND identity_key=chave AND first_submission_id=s.id;
  IF NOT FOUND THEN RAISE EXCEPTION USING errcode='23514',message='Ledger de acolhimento não persistido.'; END IF;
  INSERT INTO public.audit_logs(organization_id,actor_id,actor_name,action,entity,entity_id,metadata,verified)
    VALUES(s.organization_id,auth.uid(),'Integração de site','site_lead.welcome_'||_state,'site_lead_submission',s.id::text,
      jsonb_build_object('reason',left(coalesce(_reason,''),200),'has_message_id',_message_id is not null,'delivered',false),true);
  RETURN jsonb_build_object('submission_id',s.id,'welcome_state',s.welcome_state,'welcome_message_id',s.welcome_message_id,'delivered',false,'persisted',true);
END $$;
REVOKE ALL ON FUNCTION public.finish_site_lead_welcome_v2(uuid,text,text,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_site_lead_welcome_v2(uuid,text,text,text) TO service_role;