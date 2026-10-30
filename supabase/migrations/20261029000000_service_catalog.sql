-- Company-wide service definitions. Existing task names/photos remain unchanged.
create table if not exists public.fr_service_catalog (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.fr_companies(id),
  name text not null check(length(btrim(name)) between 1 and 100),
  instructions text not null default '' check(length(instructions)<=600),
  active boolean not null default true,
  revision integer not null default 1 check(revision>0),
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id),
  unique(id,company_id)
);
create unique index if not exists fr_service_catalog_name on public.fr_service_catalog(company_id,lower(btrim(name)));
create table if not exists public.fr_service_events (
  id uuid primary key default gen_random_uuid(), company_id uuid not null,
  service_id uuid not null, actor_id uuid not null references auth.users(id),
  at timestamptz not null default clock_timestamp(), revision integer not null,
  before_data jsonb, after_data jsonb not null,
  foreign key(service_id,company_id) references public.fr_service_catalog(id,company_id)
);
alter table public.fr_tasks add column if not exists service_id uuid;
alter table public.fr_tasks add column if not exists service_revision integer check(service_revision>0);
do $$ begin
  if not exists(select 1 from pg_constraint where conname='fr_task_catalog_same_company') then
    alter table public.fr_tasks add constraint fr_task_catalog_same_company foreign key(service_id,company_id) references public.fr_service_catalog(id,company_id);
    alter table public.fr_tasks add constraint fr_task_catalog_revision check((service_id is null)=(service_revision is null));
  end if;
end $$;
create index if not exists fr_task_catalog on public.fr_tasks(company_id,service_id);
alter table public.fr_service_catalog enable row level security;
alter table public.fr_service_events enable row level security;
revoke all on public.fr_service_catalog, public.fr_service_events from public,anon,authenticated;
grant select on public.fr_service_catalog, public.fr_service_events to authenticated;
create policy fr_catalog_read on public.fr_service_catalog for select to authenticated using(field_report_private.is_member(company_id) and (active or field_report_private.is_admin(company_id)));
create policy fr_catalog_events_read on public.fr_service_events for select to authenticated using(field_report_private.is_admin(company_id));

create or replace function public.fr_save_service(p_id uuid,p_revision integer,p_name text,p_instructions text,p_active boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  company uuid:=field_report_private.company_id(); actor uuid:=auth.uid();
  previous public.fr_service_catalog%rowtype; result public.fr_service_catalog%rowtype;
  target uuid:=coalesce(p_id,gen_random_uuid());
begin
  if not coalesce(field_report_private.is_admin(company),false) then raise exception using errcode='42501',message='Somente administradores cadastram serviços.'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target::text,0));
  select * into previous from public.fr_service_catalog where id=target for update;
  if previous.id is not null and previous.company_id<>company then raise exception using errcode='42501',message='Serviço indisponível.'; end if;
  if p_revision is null or coalesce(previous.revision,0)<>p_revision then raise exception using errcode='40001',message='Este serviço mudou. Reabra o cadastro para conferir a versão atual.'; end if;
  insert into public.fr_service_catalog(id,company_id,name,instructions,active,revision,created_by,updated_by)
  values(target,company,btrim(p_name),btrim(p_instructions),p_active,p_revision+1,actor,actor)
  on conflict(id) do update set name=excluded.name,instructions=excluded.instructions,active=excluded.active,revision=excluded.revision,updated_at=clock_timestamp(),updated_by=actor returning * into result;
  insert into public.fr_service_events(company_id,service_id,actor_id,revision,before_data,after_data)
  values(company,target,actor,result.revision,case when previous.id is null then null else to_jsonb(previous) end,to_jsonb(result));
  return to_jsonb(result);
end $$;

create or replace function public.fr_add_catalog_task(p_job_id uuid,p_service_id uuid,p_room text,p_instructions text,p_service_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare company uuid:=field_report_private.company_id(); service public.fr_service_catalog%rowtype; result public.fr_tasks%rowtype;
begin
  if not coalesce(field_report_private.is_admin(company),false) then raise exception using errcode='42501',message='Somente administradores definem os serviços previstos.'; end if;
  perform 1 from public.fr_jobs where id=p_job_id and company_id=company and status<>'delivered' for update;
  if not found then raise exception using errcode='42501',message='Escolha uma obra aberta da sua companhia.'; end if;
  select * into service from public.fr_service_catalog where id=p_service_id and company_id=company and active for share;
  if service.id is null then raise exception using errcode='22023',message='Selecione um serviço ativo do catálogo da companhia.'; end if;
  if service.revision is distinct from p_service_revision then raise exception using errcode='40001',message='O catálogo mudou. Confira o serviço antes de salvar a obra.'; end if;
  insert into public.fr_tasks(company_id,job_id,room,name,instructions,position,service_id,service_revision)
  values(company,p_job_id,btrim(p_room),service.name,coalesce(p_instructions,service.instructions),(select coalesce(max(position),0)+1 from public.fr_tasks where job_id=p_job_id),service.id,service.revision) returning * into result;
  return to_jsonb(result);
end $$;
create or replace function public.fr_create_catalog_job(p_name text,p_address text,p_kind text,p_tasks jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare company uuid:=field_report_private.company_id(); result public.fr_jobs%rowtype; item jsonb;
begin
  if not coalesce(field_report_private.is_admin(company),false) then raise exception using errcode='42501',message='Somente administradores cadastram obras.'; end if;
  if p_tasks is null or jsonb_typeof(p_tasks)<>'array' or jsonb_array_length(p_tasks) not between 1 and 80 then raise exception using errcode='22023',message='Selecione de 1 a 80 serviços previstos.'; end if;
  insert into public.fr_jobs(company_id,name,address,kind) values(company,btrim(p_name),btrim(p_address),p_kind) returning * into result;
  for item in select value from jsonb_array_elements(p_tasks) loop
    perform public.fr_add_catalog_task(result.id,(item->>'serviceId')::uuid,coalesce(item->>'room',''),item->>'instructions',(item->>'serviceRevision')::integer);
  end loop;
  return to_jsonb(result);
end $$;

-- Older clients can only use an exact match to an active catalog entry.
create or replace function public.fr_add_task(p_job_id uuid,p_room text,p_name text,p_instructions text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare service public.fr_service_catalog%rowtype;
begin
  select * into service from public.fr_service_catalog where company_id=field_report_private.company_id() and active and lower(btrim(name))=lower(btrim(p_name));
  return public.fr_add_catalog_task(p_job_id,service.id,p_room,p_instructions,service.revision);
end $$;
create or replace function public.fr_create_job(p_name text,p_address text,p_kind text,p_tasks jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare company uuid:=field_report_private.company_id(); item jsonb; service public.fr_service_catalog%rowtype; resolved jsonb:='[]'::jsonb;
begin
  if not coalesce(field_report_private.is_admin(company),false) then raise exception using errcode='42501',message='Somente administradores cadastram obras.'; end if;
  if p_tasks is null or jsonb_typeof(p_tasks)<>'array' then raise exception using errcode='22023',message='Selecione os serviços do catálogo.'; end if;
  for item in select value from jsonb_array_elements(p_tasks) loop
    select * into service from public.fr_service_catalog where company_id=company and active and lower(btrim(name))=lower(btrim(item->>'name'));
    if service.id is null then raise exception using errcode='22023',message='Atualize a página e selecione um serviço ativo do catálogo.'; end if;
    resolved:=resolved||jsonb_build_array(jsonb_build_object('serviceId',service.id,'serviceRevision',service.revision,'room',coalesce(item->>'room',''),'instructions',item->>'instructions'));
  end loop;
  return public.fr_create_catalog_job(p_name,p_address,p_kind,resolved);
end $$;
-- No direct insertion path can bypass catalog validation.
revoke insert on public.fr_jobs from authenticated;
revoke all on function public.fr_save_service(uuid,integer,text,text,boolean),public.fr_add_catalog_task(uuid,uuid,text,text,integer),public.fr_create_catalog_job(text,text,text,jsonb) from public,anon;
grant execute on function public.fr_save_service(uuid,integer,text,text,boolean),public.fr_add_catalog_task(uuid,uuid,text,text,integer),public.fr_create_catalog_job(text,text,text,jsonb) to authenticated;
do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    alter publication supabase_realtime add table public.fr_service_catalog;
  end if;
end $$;
notify pgrst,'reload schema';
