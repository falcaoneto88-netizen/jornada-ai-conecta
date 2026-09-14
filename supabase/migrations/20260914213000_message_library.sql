begin;
alter table public.message_templates
 add column lifecycle text not null default 'draft' check(lifecycle in ('draft','archived')),
 add column usage_note text not null default '',
 add column revision integer not null default 1 check(revision>0),
 add column starter_key text;
create unique index message_template_starter_unique on public.message_templates(organization_id,starter_key) where starter_key is not null;

-- Auditoria e revisão acompanham qualquer alteração permitida pela RLS existente.
create function public.stamp_message_template() returns trigger language plpgsql security definer set search_path='' as $$
declare actor_name text;
begin
 if TG_OP='INSERT' then new.revision:=1; else new.revision:=old.revision+1; end if;
 select p.full_name into actor_name from public.profiles p where p.id=auth.uid() and p.organization_id=new.organization_id;
 insert into public.audit_logs(organization_id,actor_id,actor_name,action,entity,entity_id,metadata,verified)
 values(new.organization_id,auth.uid(),coalesce(actor_name,'Sistema'),'modelo.rascunho_guardado','message_templates',new.id::text,jsonb_build_object('revision',new.revision,'lifecycle',new.lifecycle,'ghl_modified',false),true);
 return new;
end $$;
revoke all on function public.stamp_message_template() from public,anon,authenticated;
create trigger message_templates_stamp before insert or update on public.message_templates for each row execute function public.stamp_message_template();

-- Mantém a RLS e os papéis existentes: não usa service_role nem bypass da organização.
create function public.save_message_template_draft(_org uuid,_id uuid,_expected_revision integer,_draft jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.message_templates%rowtype; b text; token text[];
begin
 if auth.uid() is null or _org is distinct from public.current_org_id() or not public.tem_papel(array['administrador','gestor']::public.app_role[]) then
  raise exception using errcode='42501',message='Sem permissão para editar modelos.';
 end if;
 if _id is null or jsonb_typeof(_draft) is distinct from 'object'
  or not (_draft ?& array['name','body','channel','language','stage_key','usage_note','lifecycle'])
  or (_draft-array['name','body','channel','language','stage_key','usage_note','lifecycle'])<>'{}'::jsonb
  or exists(select 1 from jsonb_each(_draft) e where e.key<>'stage_key' and jsonb_typeof(e.value)<>'string')
  or jsonb_typeof(_draft->'stage_key') not in ('string','null')
  or (_draft->>'stage_key' is not null and length(_draft->>'stage_key') not between 1 and 100)
  or coalesce(length(trim(_draft->>'name')),0) not between 1 and 120
  or coalesce(length(trim(_draft->>'body')),0) not between 1 and 6000
  or length(_draft->>'usage_note')>1000 or _draft->>'usage_note' is null
  or coalesce(_draft->>'language','') not in ('PT-PT','PT-BR','FR','ES','EN')
  or coalesce(_draft->>'channel','') not in ('whatsapp','sms','instagram','facebook','email')
  or coalesce(_draft->>'lifecycle','') not in ('draft','archived') then
  raise exception using errcode='22023',message='Rascunho inválido.';
 end if;
 b:=trim(_draft->>'body');
 if regexp_replace(b,'\{\{[[:space:]]*[a-z_][a-z0-9_.]*[[:space:]]*\}\}','','g') ~ '[{}]' then raise exception using errcode='22023',message='Variáveis incompletas.';end if;
 for token in select regexp_matches(b,'\{\{[[:space:]]*([^{}]*?)[[:space:]]*\}\}','g') loop
  if trim(token[1]) not in ('contact.first_name','contact.name','appointment.start_time','appointment.only_start_date','appointment.only_start_time','appointment.timezone','appointment.title','appointment.user.name','location.name') then raise exception using errcode='22023',message='Variável desconhecida.';end if;
 end loop;
 if _draft->>'stage_key' is not null and not exists(select 1 from public.journey_stages where organization_id=_org and key=_draft->>'stage_key') then raise exception using errcode='22023',message='Etapa inválida nesta organização.';end if;
 select * into r from public.message_templates where organization_id=_org and id=_id and not is_demo for update;
 if found then
  -- Recibo idempotente para criação repetida com o mesmo ID e conteúdo.
  if _expected_revision is null and r.revision=1 and r.name=trim(_draft->>'name') and r.body=b and r.channel::text=_draft->>'channel' and r.language=_draft->>'language' and r.stage_key is not distinct from _draft->>'stage_key' and r.usage_note=_draft->>'usage_note' and r.lifecycle=_draft->>'lifecycle' then return to_jsonb(r);end if;
  if r.revision is distinct from _expected_revision then raise exception using errcode='40001',message='Modelo alterado por outra sessão.';end if;
  update public.message_templates set name=trim(_draft->>'name'),body=b,channel=(_draft->>'channel')::public.channel_type,language=_draft->>'language',stage_key=_draft->>'stage_key',usage_note=_draft->>'usage_note',lifecycle=_draft->>'lifecycle' where id=_id and organization_id=_org returning * into r;
 else
  if _expected_revision is not null then raise exception using errcode='40001',message='Modelo indisponível.';end if;
  insert into public.message_templates(id,organization_id,name,body,channel,language,stage_key,usage_note,lifecycle,is_demo) values(_id,_org,trim(_draft->>'name'),b,(_draft->>'channel')::public.channel_type,_draft->>'language',_draft->>'stage_key',_draft->>'usage_note',_draft->>'lifecycle',false) returning * into r;
 end if;
 return to_jsonb(r);
end $$;
revoke all on function public.save_message_template_draft(uuid,uuid,integer,jsonb) from public,anon;
grant execute on function public.save_message_template_draft(uuid,uuid,integer,jsonb) to authenticated;

-- Biblioteca inicial solicitada: apenas rascunhos da organização Jornada AI.
insert into public.message_templates(organization_id,name,body,channel,language,stage_key,usage_note,lifecycle,starter_key,is_demo)
select o.id,t.name,t.body,t.channel::public.channel_type,t.language,t.stage_key,t.usage_note,'draft',t.starter_key,false
from public.organizations o cross join jsonb_to_recordset($starter$[{"starter_key": "jornada_v1_agendamento", "name": "Agendamento recebido", "stage_key": "consulta_agendada", "channel": "whatsapp", "language": "PT-BR", "body": "Olá, {{contact.first_name}}!\n\nSua consulta está agendada para {{appointment.only_start_date}}, às {{appointment.only_start_time}} ({{appointment.timezone}}).\n\nSe precisar ajustar o horário, fale com nossa equipe.\nEquipe Dr. João Falcão", "usage_note": "Usar após verificar o agendamento. O texto informa a marcação; não comprova presença confirmada.", "lifecycle": "draft"}, {"starter_key": "jornada_v1_confirmacao", "name": "Pedido de confirmação — SIM ou NÃO", "stage_key": "consulta_agendada", "channel": "whatsapp", "language": "PT-BR", "body": "Olá, {{contact.first_name}}!\n\nPodemos confirmar sua presença na consulta de {{appointment.only_start_date}}, às {{appointment.only_start_time}} ({{appointment.timezone}})?\n\nResponda SIM para confirmar ou NÃO se não puder comparecer. Nesse caso, nossa equipe ajudará com os próximos passos.\nEquipe Dr. João Falcão", "usage_note": "Usar no momento definido pelo workflow, com a consulta correta vinculada.", "lifecycle": "draft"}, {"starter_key": "jornada_v1_resposta_sim", "name": "Confirmação recebida", "stage_key": "consulta_confirmada", "channel": "whatsapp", "language": "PT-BR", "body": "Olá, {{contact.first_name}}!\n\nRecebemos sua confirmação de presença para {{appointment.only_start_date}}, às {{appointment.only_start_time}} ({{appointment.timezone}}).\n\nAguardamos você! Se houver algum imprevisto, avise nossa equipe.\nEquipe Dr. João Falcão", "usage_note": "Usar somente após uma resposta afirmativa validada para esta consulta.", "lifecycle": "draft"}, {"starter_key": "jornada_v1_remarcacao", "name": "Acolhimento do pedido de remarcação", "stage_key": "em_atendimento", "channel": "whatsapp", "language": "PT-BR", "body": "Olá, {{contact.first_name}}!\n\nRecebemos seu pedido de remarcação. Quais dias e períodos seriam melhores para você?\n\nNossa equipe verificará a disponibilidade e confirmará a nova data com você.\nEquipe Dr. João Falcão", "usage_note": "Usar após identificar um pedido de remarcação. Não significa que uma nova data já foi marcada.", "lifecycle": "draft"}, {"starter_key": "jornada_v1_lembrete", "name": "Lembrete da consulta", "stage_key": "consulta_agendada", "channel": "whatsapp", "language": "PT-BR", "body": "Olá, {{contact.first_name}}!\n\nLembramos que sua consulta será em {{appointment.only_start_date}}, às {{appointment.only_start_time}} ({{appointment.timezone}}).\n\nSe tiver alguma dúvida ou precisar de ajuda, responda a esta mensagem.\nEquipe Dr. João Falcão", "usage_note": "Usar antes da consulta, respeitando o agendamento e o prazo definido no workflow.", "lifecycle": "draft"}, {"starter_key": "jornada_v1_pre_consulta", "name": "Preparação para a consulta", "stage_key": "consulta_agendada", "channel": "whatsapp", "language": "PT-BR", "body": "Olá, {{contact.first_name}}!\n\nSua consulta está marcada para {{appointment.only_start_date}}, às {{appointment.only_start_time}} ({{appointment.timezone}}).\n\nSe recebeu orientações ou um formulário da nossa equipe, confira esse material antes da consulta. Caso não tenha recebido ou tenha alguma dúvida, fale conosco.\nEquipe Dr. João Falcão", "usage_note": "Mensagem administrativa. Orientações clínicas e links devem ser verificados pela equipe antes de acrescentá-los.", "lifecycle": "draft"}, {"starter_key": "jornada_v1_pos_consulta", "name": "Acompanhamento após a consulta", "stage_key": "consulta_realizada", "channel": "whatsapp", "language": "PT-BR", "body": "Olá, {{contact.first_name}}!\n\nGostaríamos de saber se ficou alguma dúvida sobre os próximos passos conversados na consulta.\n\nConte com nossa equipe para ajudar com agendamentos e encaminhar suas dúvidas ao profissional responsável.\nEquipe Dr. João Falcão", "usage_note": "Usar somente após confirmar que a consulta ocorreu. Questões clínicas devem ser encaminhadas à equipe responsável.", "lifecycle": "draft"}, {"starter_key": "jornada_v1_retomada", "name": "Retomada do atendimento", "stage_key": "reativacao", "channel": "whatsapp", "language": "PT-BR", "body": "Olá, {{contact.first_name}}! Tudo bem?\n\nGostaria de retomar seu atendimento com a equipe do Dr. João Falcão? Podemos ajudar a consultar opções de agendamento.\n\nSe preferir não receber novas mensagens de retomada, é só nos avisar.", "usage_note": "Usar em contatos elegíveis para retomada e respeitar pedidos de interrupção das mensagens.", "lifecycle": "draft"}]$starter$::jsonb) as t(name text,body text,channel text,language text,stage_key text,usage_note text,starter_key text)
where o.id='f07ab3be-7419-4779-a901-ef71c5fc27f0'
on conflict (organization_id,starter_key) where starter_key is not null do nothing;
commit;
