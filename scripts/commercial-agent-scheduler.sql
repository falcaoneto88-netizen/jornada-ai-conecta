-- Reviewed deployment template, NOT automatically applied by migrations.
-- Prerequisite: existing pg_cron + pg_net + Supabase Vault.
-- Set vault entries in the provider's secure UI, never in chat or Git:
-- commercial_agent_worker_url: validated HTTPS URL of the deployed worker
-- commercial_agent_worker_secret: same server-only COMMERCIAL_AGENT_WORKER_SECRET
-- This transaction creates a DISABLED job. No activation is included.
begin;
do $$
declare target text; token text; job_id bigint;
begin
  select decrypted_secret into target from vault.decrypted_secrets where name='commercial_agent_worker_url';
  select decrypted_secret into token from vault.decrypted_secrets where name='commercial_agent_worker_secret';
  if target is null or target !~ '^https://[a-zA-Z0-9.-]+/api/public/commercial-agent-worker$' or length(coalesce(token,''))<32 then
    raise exception 'commercial_agent_vault_not_configured';
  end if;
  if exists(select 1 from cron.job where jobname='commercial-agent-v02-worker') then
    raise exception 'commercial_agent_job_already_exists';
  end if;
  select cron.schedule('commercial-agent-v02-worker','* * * * *',
    $job$select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name='commercial_agent_worker_url'),
      headers := jsonb_build_object('Content-Type','application/json','x-worker-secret',
        (select decrypted_secret from vault.decrypted_secrets where name='commercial_agent_worker_secret')),
      body := '{}'::jsonb,
      timeout_milliseconds := 110000
    );$job$) into job_id;
  perform cron.alter_job(job_id, active := false);
end $$;
commit;
-- Future activation is a separate reviewed step after real homologation.
-- Rollback/kill switch: cron.alter_job(job_id, active := false),
-- COMMERCIAL_AGENT_SEND_ENABLED=false, settings.mode='off'. Keep history.
