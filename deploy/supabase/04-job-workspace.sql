-- Field Report v3: additive migration after 01-schema.sql. Keeps every existing report and photo.
begin;
alter table public.fr_jobs add column if not exists kind text not null default 'installation' check(kind in ('installation','repair'));
alter table public.fr_jobs add column if not exists revision integer not null default 1;
alter table public.fr_jobs drop constraint if exists fr_jobs_status_check;
alter table public.fr_jobs add constraint fr_jobs_status_check check(status in ('planned','active','adjustment','delivered'));
alter table public.fr_companies add column if not exists logo jsonb;
alter table public.fr_companies add column if not exists revision integer not null default 1;
create table if not exists public.fr_tasks (
  id uuid primary key default gen_random_uuid(), company_id uuid not null, job_id uuid not null,
  room text not null default '' check(length(room)<=100), name text not null check(length(btrim(name)) between 1 and 100),
  instructions text not null default '' check(length(instructions)<=600), position integer not null default 0,
  status text not null default 'planned' check(status in ('planned','active','completed')),
  percent integer not null default 0 check(percent between 0 and 100), cycle integer not null default 1, revision integer not null default 1,
  last_report_id uuid references public.fr_reports(id), updated_at timestamptz not null default now(),
  unique(id,job_id,company_id), foreign key(job_id,company_id) references public.fr_jobs(id,company_id)
);
alter table public.fr_reports add column if not exists task_id uuid;
alter table public.fr_reports add column if not exists task_cycle integer;
alter table public.fr_reports add column if not exists task_complete boolean not null default false;
do $$ begin
  if not exists(select 1 from pg_constraint where conname='fr_report_task_same_job') then
    alter table public.fr_reports add constraint fr_report_task_same_job foreign key(task_id,job_id,company_id) references public.fr_tasks(id,job_id,company_id);
  end if;
end $$;
create index if not exists fr_tasks_job on public.fr_tasks(company_id,job_id,position);
create table if not exists public.fr_staff (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.fr_companies(id),
  user_id uuid unique references auth.users(id), display_name text not null check(length(btrim(display_name)) between 1 and 100),
  code text not null check(length(btrim(code)) between 1 and 40),
  position text not null check(position in ('installer','grout','helper','other')),
  email text check(email is null or (length(email)<=254 and email like '%@%')),
  role text not null default 'worker' check(role in ('admin','worker')), active boolean not null default true,
  revision integer not null default 1, unique(company_id,code)
);
create unique index if not exists fr_staff_email on public.fr_staff(lower(email)) where email is not null;
insert into public.fr_staff(company_id,user_id,display_name,code,position,role,active)
select company_id,id,display_name,'U-'||substr(id::text,1,8),'other',role,active from public.fr_members
on conflict(user_id) do nothing;
alter table public.fr_tasks enable row level security;
alter table public.fr_staff enable row level security;
revoke all on public.fr_tasks, public.fr_staff from anon,authenticated;
grant select on public.fr_tasks, public.fr_staff to authenticated;
drop policy if exists fr_tasks_read on public.fr_tasks;
create policy fr_tasks_read on public.fr_tasks for select to authenticated using(field_report_private.is_member(company_id));
drop policy if exists fr_staff_read on public.fr_staff;
create policy fr_staff_read on public.fr_staff for select to authenticated using(field_report_private.is_admin(company_id));

-- Job + planned services are written atomically. No half-created job if any service is invalid.
create or replace function public.fr_create_job(p_name text,p_address text,p_kind text,p_tasks jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare company uuid:=field_report_private.company_id(); result public.fr_jobs%rowtype; item jsonb; ordinal integer:=0;
begin
  if not coalesce(field_report_private.is_admin(company),false) then raise exception using errcode='42501',message='Somente administradores cadastram obras.'; end if;
  if p_tasks is null or jsonb_typeof(p_tasks)<>'array' or jsonb_array_length(p_tasks) not between 1 and 80 then raise exception using errcode='22023',message='Cadastre de 1 a 80 serviços previstos.'; end if;
  insert into public.fr_jobs(company_id,name,address,kind) values(company,btrim(p_name),btrim(p_address),p_kind) returning * into result;
  for item in select value from jsonb_array_elements(p_tasks) loop
    ordinal:=ordinal+1;
    insert into public.fr_tasks(company_id,job_id,room,name,instructions,position) values(company,result.id,coalesce(item->>'room',''),item->>'name',coalesce(item->>'instructions',''),ordinal);
  end loop;
  return to_jsonb(result);
end $$;
create or replace function public.fr_add_task(p_job_id uuid,p_room text,p_name text,p_instructions text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare company uuid:=field_report_private.company_id(); result public.fr_tasks%rowtype;
begin
  if not coalesce(field_report_private.is_admin(company),false) or not exists(select 1 from public.fr_jobs where id=p_job_id and company_id=company and status<>'delivered') then raise exception using errcode='42501',message='Somente o administrador adiciona serviços a uma obra aberta.'; end if;
  perform 1 from public.fr_jobs where id=p_job_id for update;
  insert into public.fr_tasks(company_id,job_id,room,name,instructions,position) values(company,p_job_id,btrim(p_room),btrim(p_name),btrim(p_instructions),(select coalesce(max(position),0)+1 from public.fr_tasks where job_id=p_job_id)) returning * into result;
  return to_jsonb(result);
end $$;
create or replace function public.fr_change_job_status(p_id uuid,p_revision integer,p_status text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare company uuid:=field_report_private.company_id(); result public.fr_jobs%rowtype;
begin
  if not coalesce(field_report_private.is_admin(company),false) then raise exception using errcode='42501',message='Somente administradores alteram a situação da obra.'; end if;
  perform 1 from public.fr_jobs where id=p_id and company_id=company for update;
  if not found then raise exception using errcode='42501',message='Obra indisponível.'; end if;
  if p_status='delivered' and exists(select 1 from public.fr_tasks where job_id=p_id and status<>'completed') then raise exception using errcode='22023',message='Conclua os serviços previstos antes de entregar a obra.'; end if;
  update public.fr_jobs set status=p_status,revision=revision+1 where id=p_id and company_id=company and revision=p_revision returning * into result;
  if not found then raise exception using errcode='40001',message='A obra mudou. Atualize antes de tentar novamente.'; end if;
  return to_jsonb(result);
end $$;
create or replace function public.fr_reopen_task(p_id uuid,p_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare company uuid:=field_report_private.company_id(); result public.fr_tasks%rowtype;
begin
  if not coalesce(field_report_private.is_admin(company),false) then raise exception using errcode='42501',message='Somente administradores reabrem serviços.'; end if;
  update public.fr_tasks t set status='planned',percent=0,last_report_id=null,cycle=cycle+1,revision=t.revision+1,updated_at=clock_timestamp()
  where t.id=p_id and t.company_id=company and t.revision=p_revision and exists(select 1 from public.fr_jobs j where j.id=t.job_id and j.status<>'delivered') returning t.* into result;
  if not found then raise exception using errcode='40001',message='Reabra a obra e atualize o serviço antes de tentar novamente.'; end if;
  return to_jsonb(result);
end $$;

-- Keep the v2 writer private, so older clients cannot bypass task checks.
do $$ begin
  if to_regprocedure('field_report_private.save_report_v2(uuid,uuid,integer,text,jsonb,jsonb,jsonb)') is null then
    alter function public.fr_save_report(uuid,uuid,integer,text,jsonb,jsonb,jsonb) set schema field_report_private;
    alter function field_report_private.fr_save_report(uuid,uuid,integer,text,jsonb,jsonb,jsonb) rename to save_report_v2;
  end if;
end $$;
revoke all on function field_report_private.save_report_v2(uuid,uuid,integer,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
create or replace function public.fr_save_report(p_id uuid,p_job_id uuid,p_expected_revision integer,p_status text,p_fields jsonb,p_photos jsonb,p_logo jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text,0));
  if exists(select 1 from public.fr_reports where id=p_id and task_id is not null) then raise exception using errcode='22023',message='Atualize a página para editar um relatório vinculado a serviço.'; end if;
  return field_report_private.save_report_v2(p_id,p_job_id,p_expected_revision,p_status,p_fields,p_photos,p_logo);
end $$;
revoke all on function public.fr_save_report(uuid,uuid,integer,text,jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.fr_save_report(uuid,uuid,integer,text,jsonb,jsonb,jsonb) to authenticated;

-- Reuse the validated, versioned report writer. The task lock prevents conflicting completions.
create or replace function public.fr_save_task_report(p_id uuid,p_job_id uuid,p_expected_revision integer,p_status text,p_fields jsonb,p_photos jsonb,p_logo jsonb,p_task_id uuid,p_complete boolean,p_task_cycle integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare company uuid:=field_report_private.company_id(); task public.fr_tasks%rowtype; previous public.fr_reports%rowtype; result jsonb; last_date text;
begin
  if company is null then raise exception using errcode='42501',message='Acesso não habilitado.'; end if;
  perform 1 from public.fr_jobs where id=p_job_id and company_id=company for update;
  select * into previous from public.fr_reports where id=p_id;
  if previous.task_id is not null and previous.task_id is distinct from p_task_id then raise exception using errcode='22023',message='O relatório deve permanecer no serviço original.'; end if;
  if p_task_id is not null then
    select * into task from public.fr_tasks where id=p_task_id and job_id=p_job_id and company_id=company for update;
    if task.id is null then raise exception using errcode='22023',message='Escolha um serviço previsto desta obra.'; end if;
    if p_task_cycle is distinct from task.cycle then raise exception using errcode='22023',message='O serviço foi reaberto. Crie um novo registro; o histórico anterior foi preservado.'; end if;
    if task.status='completed' and task.last_report_id is distinct from p_id then raise exception using errcode='22023',message='Este serviço foi concluído. O administrador pode reabri-lo para novos registros.'; end if;
    if task.status='completed' and not coalesce(p_complete,false) then raise exception using errcode='22023',message='Peça ao administrador para reabrir o serviço antes de remover sua conclusão.'; end if;
    select fields->>'date' into last_date from public.fr_reports where id=task.last_report_id;
    if coalesce(p_complete,false) and ((p_fields->>'percent') is distinct from '100' or coalesce(jsonb_array_length(p_photos->'after'),0)=0 or coalesce(jsonb_array_length(p_photos->'pending'),0)>0 or length(btrim(coalesce(p_fields->>'remaining','')))>0) then raise exception using errcode='22023',message='Para concluir: informe 100%, inclua uma foto final e resolva as pendências.'; end if;
    if coalesce(p_complete,false) and last_date is not null and p_fields->>'date'<last_date then raise exception using errcode='22023',message='Um registro anterior não pode concluir o serviço após uma atualização mais recente.'; end if;
  elsif coalesce(p_complete,false) then raise exception using errcode='22023',message='Vincule um serviço previsto antes de concluir.';
  end if;
  result:=field_report_private.save_report_v2(p_id,p_job_id,p_expected_revision,p_status,p_fields,p_photos,p_logo);
  update public.fr_reports set task_id=p_task_id,task_cycle=p_task_cycle,task_complete=coalesce(p_complete,false) where id=p_id;
  if p_task_id is not null and (last_date is null or p_fields->>'date'>=last_date) then
    update public.fr_tasks set status=case when coalesce(p_complete,false) then 'completed' else 'active' end,
      percent=coalesce(nullif(p_fields->>'percent','')::integer,task.percent),last_report_id=p_id,revision=revision+1,updated_at=clock_timestamp() where id=p_task_id;
  end if;
  return result||jsonb_build_object('task_id',p_task_id,'task_cycle',p_task_cycle,'task_complete',coalesce(p_complete,false));
end $$;

create or replace function public.fr_save_company(p_name text,p_logo jsonb,p_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare company uuid:=field_report_private.company_id(); result public.fr_companies%rowtype; path text;
begin
  if not coalesce(field_report_private.is_admin(company),false) then raise exception using errcode='42501',message='Somente administradores configuram a companhia.'; end if;
  if p_logo is not null and p_logo<>'null'::jsonb then
    path:=p_logo->>'imageId';
    if jsonb_typeof(p_logo)<>'object' or p_logo->>'id' is null or length(p_logo->>'name')>120 or split_part(path,'/',1) is distinct from company::text or not exists(select 1 from storage.objects where bucket_id='field-report-photos' and name=path) then raise exception using errcode='22023',message='Logo inválida. Envie a imagem antes de salvar.'; end if;
  end if;
  update public.fr_companies set name=btrim(p_name),logo=p_logo,revision=revision+1 where id=company and revision=p_revision returning * into result;
  if not found then raise exception using errcode='40001',message='A configuração mudou. Atualize antes de tentar novamente.'; end if;
  return to_jsonb(result);
end $$;

-- The administrator registers a professional; passwords never pass through this function.
create or replace function public.fr_save_staff(p_id uuid,p_revision integer,p_name text,p_code text,p_position text,p_email text,p_role text,p_active boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare company uuid:=field_report_private.company_id(); previous public.fr_staff%rowtype; result public.fr_staff%rowtype;
begin
  if not coalesce(field_report_private.is_admin(company),false) then raise exception using errcode='42501',message='Somente administradores cadastram a equipe.'; end if;
  perform 1 from public.fr_companies where id=company for update;
  select * into previous from public.fr_staff where id=p_id;
  if previous.id is not null and previous.company_id<>company then raise exception using errcode='42501',message='Cadastro indisponível.'; end if;
  if coalesce(previous.revision,0)<>p_revision then raise exception using errcode='40001',message='Este cadastro mudou. Atualize e tente novamente.'; end if;
  if previous.user_id is not null and previous.role='admin' and (p_role<>'admin' or not p_active) and not exists(select 1 from public.fr_members where company_id=company and role='admin' and active and id<>previous.user_id) then raise exception using errcode='22023',message='Mantenha ao menos um administrador ativo.'; end if;
  insert into public.fr_staff(id,company_id,display_name,code,position,email,role,active,revision)
  values(coalesce(p_id,gen_random_uuid()),company,btrim(p_name),btrim(p_code),p_position,nullif(lower(btrim(p_email)),''),p_role,p_active,p_revision+1)
  on conflict(id) do update set display_name=excluded.display_name,code=excluded.code,position=excluded.position,email=excluded.email,role=excluded.role,active=excluded.active,revision=excluded.revision returning * into result;
  if result.user_id is not null then update public.fr_members set display_name=result.display_name,role=result.role,active=result.active where id=result.user_id and company_id=company; end if;
  return to_jsonb(result);
end $$;
-- A signed-in person can claim ONLY a pre-registered, confirmed email. Cannot self-select a company or role.
create or replace function public.fr_claim_access()
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); confirmed_email text; staff public.fr_staff%rowtype;
begin
  if actor is null then raise exception using errcode='42501',message='Entre primeiro.'; end if;
  if exists(select 1 from public.fr_members where id=actor) then return; end if;
  select lower(email) into confirmed_email from auth.users where id=actor and email_confirmed_at is not null;
  if confirmed_email is null then raise exception using errcode='42501',message='Confirme seu e-mail antes de acessar a companhia.'; end if;
  select * into staff from public.fr_staff where lower(email)=confirmed_email and active and user_id is null for update;
  if staff.id is null then raise exception using errcode='42501',message='Peça ao administrador para cadastrar seu e-mail na equipe.'; end if;
  insert into public.fr_members(id,company_id,display_name,role) values(actor,staff.company_id,staff.display_name,staff.role);
  update public.fr_staff set user_id=actor,revision=revision+1 where id=staff.id;
end $$;

do $$ declare fn record; table_name text; begin
  for fn in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on p.pronamespace=n.oid where n.nspname='public' and p.proname in ('fr_create_job','fr_add_task','fr_change_job_status','fr_reopen_task','fr_save_task_report','fr_save_company','fr_save_staff','fr_claim_access') loop
    execute format('revoke all on function %s from public, anon',fn.signature);
    execute format('grant execute on function %s to authenticated',fn.signature);
  end loop;
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    foreach table_name in array array['fr_tasks','fr_companies','fr_staff','fr_members'] loop
      if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=table_name) then execute format('alter publication supabase_realtime add table public.%I',table_name); end if;
    end loop;
  end if;
end $$;
notify pgrst, 'reload schema';
commit;
