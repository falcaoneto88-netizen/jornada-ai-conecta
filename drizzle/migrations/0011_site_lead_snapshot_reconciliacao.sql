-- Corrige o bloqueio permanente em 'a_processar' quando o espelho local da
-- oportunidade está desatualizado face ao estado REAL lido no GoHighLevel.
-- Nada é escrito no GoHighLevel; estados fechados são preservados; espelho
-- sem prova de versão (remote_attempted_at nulo) ou mais recente do que a
-- reserva nunca é sobrescrito: vai para reconciliação auditável.

CREATE OR REPLACE FUNCTION public.finish_site_lead_remote_v2(
  _submission uuid, _state text, _reason text, _ghl_contact text, _ghl_opportunity text,
  _opp_name text, _opp_pipeline text, _opp_stage text, _opp_status text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  s public.site_lead_submissions;
  i public.site_integrations;
  c public.contacts;
  o public.opportunities;
  chave text;
  estado_ledger text;
  motivo_bloqueio text;
  estado_bloqueio text;
  alterou boolean := false;
  etapa_antes text;
  estado_antes text;
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
    SELECT * INTO c FROM public.contacts WHERE id=s.contact_id AND organization_id=s.organization_id FOR UPDATE;
    IF c.id IS NULL THEN
      motivo_bloqueio := 'contacto_local_ausente'; estado_bloqueio := 'blocked';
    ELSIF c.ghl_contact_id IS NOT NULL AND c.ghl_contact_id IS DISTINCT FROM _ghl_contact THEN
      motivo_bloqueio := 'contacto_local_com_identidade_externa_divergente'; estado_bloqueio := 'blocked';
    END IF;

    IF motivo_bloqueio IS NULL THEN
      SELECT * INTO o FROM public.opportunities
        WHERE organization_id=s.organization_id AND ghl_opportunity_id=_ghl_opportunity FOR UPDATE;
      IF o.id IS NOT NULL THEN
        IF o.contact_id IS DISTINCT FROM s.contact_id OR o.pipeline_id IS DISTINCT FROM _opp_pipeline OR o.is_demo IS DISTINCT FROM false THEN
          motivo_bloqueio := 'espelho_local_de_outra_identidade'; estado_bloqueio := 'blocked';
        ELSIF (o.stage_id IS DISTINCT FROM _opp_stage OR o.status IS DISTINCT FROM _opp_status
               OR o.name IS DISTINCT FROM coalesce(nullif(_opp_name,''), o.name))
              AND (s.remote_attempted_at IS NULL OR o.updated_at > s.remote_attempted_at) THEN
          motivo_bloqueio := 'reconciliacao_snapshot_concorrente'; estado_bloqueio := 'uncertain';
        END IF;
      END IF;
    END IF;

    IF motivo_bloqueio IS NOT NULL THEN
      UPDATE public.site_lead_submissions
        SET status='em_revisao', local_state='em_revisao', review_reason=motivo_bloqueio,
            remote_state='bloqueado', remote_reason=motivo_bloqueio,
            remote_observed_contact_id=_ghl_contact, remote_observed_opportunity_id=_ghl_opportunity
        WHERE id=s.id RETURNING * INTO s;
      UPDATE public.site_lead_execution_ledger SET state=estado_bloqueio, external_id=_ghl_opportunity, updated_at=now()
        WHERE organization_id=s.organization_id AND integration_id=s.integration_id AND scope='remote'
          AND channel='ghl_contact_opportunity' AND identity_key=chave AND first_submission_id=s.id;
      IF NOT FOUND THEN RAISE EXCEPTION USING errcode='23514',message='Ledger remoto não persistido.'; END IF;
      INSERT INTO public.audit_logs(organization_id,actor_id,actor_name,action,entity,entity_id,metadata,verified)
        VALUES(s.organization_id,auth.uid(),'Integração de site','site_lead.remote_reconciliation_required','site_lead_submission',s.id::text,
          jsonb_build_object('reason',motivo_bloqueio,'ledger_state',estado_bloqueio,
            'ghl_opportunity_id',_ghl_opportunity,'observed_stage_id',_opp_stage,'observed_status',_opp_status),true);
      RETURN jsonb_build_object('submission_id',s.id,'remote_state',s.remote_state,'blocked',true,'reason',motivo_bloqueio,
        'ghl_contact_id',s.ghl_contact_id,'ghl_opportunity_id',s.ghl_opportunity_id,
        'observed_contact_id',s.remote_observed_contact_id,'observed_opportunity_id',s.remote_observed_opportunity_id,
        'persisted',true);
    END IF;

    UPDATE public.site_lead_submissions SET remote_state='confirmado',remote_reason=left(coalesce(_reason,''),200),
      ghl_contact_id=_ghl_contact,ghl_opportunity_id=_ghl_opportunity,
      remote_observed_contact_id=NULL,remote_observed_opportunity_id=NULL WHERE id=s.id RETURNING * INTO s;
    UPDATE public.contacts SET ghl_contact_id=_ghl_contact
      WHERE id=s.contact_id AND organization_id=s.organization_id
        AND (ghl_contact_id IS NULL OR ghl_contact_id=_ghl_contact);

    IF o.id IS NULL THEN
      INSERT INTO public.opportunities(organization_id,contact_id,ghl_opportunity_id,name,pipeline_id,stage_id,status,is_demo)
        VALUES(s.organization_id,s.contact_id,_ghl_opportunity,coalesce(nullif(_opp_name,''),'Oportunidade'),_opp_pipeline,_opp_stage,_opp_status,false)
        ON CONFLICT (organization_id,ghl_opportunity_id) WHERE ghl_opportunity_id IS NOT NULL DO NOTHING;
    ELSE
      etapa_antes := o.stage_id; estado_antes := o.status;
      IF o.stage_id IS DISTINCT FROM _opp_stage OR o.status IS DISTINCT FROM _opp_status
         OR o.name IS DISTINCT FROM coalesce(nullif(_opp_name,''), o.name) THEN
        UPDATE public.opportunities
          SET stage_id=_opp_stage, status=_opp_status, name=coalesce(nullif(_opp_name,''), name)
          WHERE id=o.id;
        alterou := true;
        INSERT INTO public.audit_logs(organization_id,actor_id,actor_name,action,entity,entity_id,metadata,verified)
          VALUES(s.organization_id,auth.uid(),'Integração de site','site_lead.remote_snapshot_reconciled','opportunity',o.id::text,
            jsonb_build_object('ghl_opportunity_id',_ghl_opportunity,'pipeline_id',_opp_pipeline,
              'stage_before',etapa_antes,'stage_after',_opp_stage,
              'status_before',estado_antes,'status_after',_opp_status,
              'submission_id',s.id::text),true);
      END IF;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.opportunities x
      WHERE x.organization_id=s.organization_id AND x.ghl_opportunity_id=_ghl_opportunity
        AND x.contact_id=s.contact_id AND x.pipeline_id=_opp_pipeline
        AND x.stage_id=_opp_stage AND x.status=_opp_status AND x.is_demo=false) THEN
      UPDATE public.site_lead_submissions
        SET status='em_revisao', local_state='em_revisao', review_reason='reconciliacao_snapshot_concorrente',
            remote_state='bloqueado', remote_reason='reconciliacao_snapshot_concorrente',
            remote_observed_contact_id=_ghl_contact, remote_observed_opportunity_id=_ghl_opportunity,
            ghl_contact_id=NULL, ghl_opportunity_id=NULL
        WHERE id=s.id RETURNING * INTO s;
      UPDATE public.site_lead_execution_ledger SET state='uncertain', external_id=_ghl_opportunity, updated_at=now()
        WHERE organization_id=s.organization_id AND integration_id=s.integration_id AND scope='remote'
          AND channel='ghl_contact_opportunity' AND identity_key=chave AND first_submission_id=s.id;
      INSERT INTO public.audit_logs(organization_id,actor_id,actor_name,action,entity,entity_id,metadata,verified)
        VALUES(s.organization_id,auth.uid(),'Integração de site','site_lead.remote_reconciliation_required','site_lead_submission',s.id::text,
          jsonb_build_object('reason','reconciliacao_snapshot_concorrente','ledger_state','uncertain',
            'ghl_opportunity_id',_ghl_opportunity,'observed_stage_id',_opp_stage,'observed_status',_opp_status),true);
      RETURN jsonb_build_object('submission_id',s.id,'remote_state',s.remote_state,'blocked',true,
        'reason','reconciliacao_snapshot_concorrente','ghl_contact_id',s.ghl_contact_id,
        'ghl_opportunity_id',s.ghl_opportunity_id,'observed_contact_id',s.remote_observed_contact_id,
        'observed_opportunity_id',s.remote_observed_opportunity_id,'persisted',true);
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
      jsonb_build_object('remote_state',s.remote_state,'reason',left(coalesce(_reason,''),200),
        'has_contact',_ghl_contact is not null,'has_opportunity',_ghl_opportunity is not null,
        'snapshot_reconciled',alterou),true);
  RETURN jsonb_build_object('submission_id',s.id,'remote_state',s.remote_state,'ghl_contact_id',s.ghl_contact_id,
    'ghl_opportunity_id',s.ghl_opportunity_id,'observed_contact_id',s.remote_observed_contact_id,
    'observed_opportunity_id',s.remote_observed_opportunity_id,'snapshot_reconciled',alterou,'persisted',true);
END $function$;

REVOKE ALL ON FUNCTION public.finish_site_lead_remote_v2(uuid,text,text,text,text,text,text,text,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_site_lead_remote_v2(uuid,text,text,text,text,text,text,text,text) TO service_role;
