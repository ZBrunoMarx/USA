-- Field Report: run in the SQL Editor of your own Supabase Free project.
-- No API keys or passwords belong in this file. Does not change existing app tables.
begin;
create schema if not exists field_report_private;
revoke all on schema field_report_private from public, anon;
grant usage on schema field_report_private to authenticated;

create table if not exists public.fr_companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 100)
);
create table if not exists public.fr_members (
  id uuid primary key references auth.users(id),
  company_id uuid not null references public.fr_companies(id),
  display_name text not null check (length(btrim(display_name)) between 1 and 100),
  role text not null check (role in ('admin', 'worker')),
  active boolean not null default true,
  unique(id, company_id)
);
create table if not exists public.fr_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.fr_companies(id),
  name text not null check (length(btrim(name)) between 1 and 160),
  address text not null default '' check (length(address) <= 300),
  status text not null default 'active' check (status in ('planned', 'active', 'delivered')),
  created_at timestamptz not null default now(),
  unique(id, company_id)
);
create table if not exists public.fr_reports (
  id uuid primary key,
  company_id uuid not null,
  job_id uuid not null,
  owner_id uuid not null,
  revision integer not null check (revision > 0),
  status text not null check (status in ('active', 'archived')),
  fields jsonb not null,
  photos jsonb not null,
  logo jsonb,
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  foreign key(job_id, company_id) references public.fr_jobs(id, company_id),
  foreign key(owner_id, company_id) references public.fr_members(id, company_id)
);
create index if not exists fr_reports_company on public.fr_reports(company_id, updated_at desc);
create index if not exists fr_jobs_company on public.fr_jobs(company_id);
create index if not exists fr_members_company on public.fr_members(company_id);

create or replace function field_report_private.company_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select company_id from public.fr_members where id = (select auth.uid()) and active;
$$;
create or replace function field_report_private.is_member(company uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.fr_members where id = (select auth.uid()) and company_id = company and active);
$$;
create or replace function field_report_private.is_admin(company uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.fr_members where id = (select auth.uid()) and company_id = company and active and role = 'admin');
$$;
revoke all on all functions in schema field_report_private from public, anon;
grant execute on function field_report_private.company_id(), field_report_private.is_member(uuid), field_report_private.is_admin(uuid) to authenticated;

alter table public.fr_companies enable row level security;
alter table public.fr_members enable row level security;
alter table public.fr_jobs enable row level security;
alter table public.fr_reports enable row level security;
revoke all on public.fr_companies, public.fr_members, public.fr_jobs, public.fr_reports from anon, authenticated;
grant select on public.fr_companies, public.fr_members, public.fr_jobs, public.fr_reports to authenticated;
grant insert on public.fr_jobs to authenticated;
drop policy if exists fr_company_read on public.fr_companies;
create policy fr_company_read on public.fr_companies for select to authenticated using (field_report_private.is_member(id));
drop policy if exists fr_members_read on public.fr_members;
create policy fr_members_read on public.fr_members for select to authenticated using (field_report_private.is_member(company_id));
drop policy if exists fr_jobs_read on public.fr_jobs;
create policy fr_jobs_read on public.fr_jobs for select to authenticated using (field_report_private.is_member(company_id));
drop policy if exists fr_jobs_create on public.fr_jobs;
create policy fr_jobs_create on public.fr_jobs for insert to authenticated with check (field_report_private.is_admin(company_id));
drop policy if exists fr_reports_read on public.fr_reports;
create policy fr_reports_read on public.fr_reports for select to authenticated using (field_report_private.is_member(company_id));

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('field-report-photos', 'field-report-photos', false, 3145728, array['image/jpeg', 'image/png'])
on conflict(id) do update set public=false, file_size_limit=3145728, allowed_mime_types=array['image/jpeg', 'image/png'];
drop policy if exists fr_photo_read on storage.objects;
create policy fr_photo_read on storage.objects for select to authenticated using (
  bucket_id = 'field-report-photos' and (storage.foldername(name))[1] = (select field_report_private.company_id())::text
);
drop policy if exists fr_photo_upload on storage.objects;
create policy fr_photo_upload on storage.objects for insert to authenticated with check (
  bucket_id = 'field-report-photos'
  and (storage.foldername(name))[1] = (select field_report_private.company_id())::text
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and name ~ '^[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9]{64}\.(jpg|png)$'
);
-- No update/delete policy: members cannot overwrite or delete another device's photos.

create or replace function public.fr_save_report(
  p_id uuid, p_job_id uuid, p_expected_revision integer, p_status text,
  p_fields jsonb, p_photos jsonb, p_logo jsonb default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  company uuid := field_report_private.company_id();
  manager boolean;
  previous public.fr_reports%rowtype;
  result public.fr_reports%rowtype;
  job public.fr_jobs%rowtype;
  key text; max_length integer; item jsonb; item_path text;
  seen_ids text[] := array[]::text[];
  image_list jsonb := '[]'::jsonb;
begin
  if actor is null or company is null then raise exception using errcode='42501', message='Seu acesso à companhia não está habilitado.'; end if;
  manager := field_report_private.is_admin(company);
  if p_id is null or p_expected_revision is null or p_expected_revision < 0 or p_status is null or p_status not in ('active', 'archived') then
    raise exception using errcode='22023', message='Revisão ou status inválido.';
  end if;
  -- Includes first-insert races; serializes only this report, within the transaction.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text, 0));
  select * into previous from public.fr_reports where id=p_id for update;
  if previous.id is not null and (previous.company_id <> company or (previous.owner_id <> actor and not manager)) then
    raise exception using errcode='42501', message='Você pode editar somente seus próprios relatórios.';
  end if;
  if coalesce(previous.revision, 0) <> p_expected_revision then
    raise exception using errcode='40001', message='Outra pessoa atualizou este relatório. Sua cópia local foi preservada.';
  end if;
  select * into job from public.fr_jobs where id=p_job_id and company_id=company;
  if job.id is null or (previous.id is not null and previous.job_id <> p_job_id) then raise exception using errcode='22023', message='Selecione uma obra existente da sua companhia.'; end if;
  if job.status='delivered' and p_status<>'archived' then raise exception using errcode='22023', message='A obra precisa ser reaberta antes de receber atualizações.'; end if;

  if p_fields is null or jsonb_typeof(p_fields)<>'object' then raise exception using errcode='22023', message='Campos inválidos.'; end if;
  for key, max_length in select * from (values ('title',70),('date',10),('author',45),('scope',90),('language',2),('percent',3),('company',55),('completed',220),('remaining',220)) as limits(name, size) loop
    if jsonb_typeof(p_fields->key) is distinct from 'string' or length(p_fields->>key)>max_length then raise exception using errcode='22023', message='Campo inválido: ' || key; end if;
  end loop;
  if length(btrim(p_fields->>'title'))=0 or p_fields->>'language' not in ('en','pt') then raise exception using errcode='22023', message='Informe título e idioma válidos.'; end if;
  if (p_fields->>'date') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception using errcode='22023', message='Data inválida.'; end if;
  begin
    if to_char((p_fields->>'date')::date,'YYYY-MM-DD') <> p_fields->>'date' then raise exception 'invalid date'; end if;
  exception when others then raise exception using errcode='22023', message='Data inválida.'; end;
  if p_fields->>'percent' <> '' then
    if (p_fields->>'percent') !~ '^\d{1,3}$' then raise exception using errcode='22023', message='Percentual inválido.'; end if;
    if (p_fields->>'percent')::integer>100 then raise exception using errcode='22023', message='Percentual inválido.'; end if;
  end if;
  -- Drop unknown fields; the report API never accepts financial or account settings.
  select jsonb_object_agg(k, p_fields->k) into p_fields from unnest(array['title','date','author','scope','language','percent','company','completed','remaining']) as k;
  if p_photos is null or jsonb_typeof(p_photos)<>'object' then raise exception using errcode='22023', message='Fotos inválidas.'; end if;
  for key in select unnest(array['before','after','pending']) loop
    if jsonb_typeof(p_photos->key) is distinct from 'array' then raise exception using errcode='22023', message='Fotos inválidas.'; end if;
    if jsonb_array_length(p_photos->key)>4 then raise exception using errcode='22023', message='Envie até 4 fotos por etapa.'; end if;
    image_list := image_list || (p_photos->key);
  end loop;
  if p_logo is not null and p_logo<>'null'::jsonb then image_list:=image_list || jsonb_build_array(p_logo); end if;
  for item in select value from jsonb_array_elements(image_list) loop
    item_path := item->>'imageId';
    if jsonb_typeof(item)<>'object' or item->>'id' is null or item->>'id' !~ '^[a-f0-9-]{36}$'
      or jsonb_typeof(item->'name') is distinct from 'string' or length(item->>'name')>120
      or item_path is null or item_path !~ '^[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9]{64}\.(jpg|png)$'
      or split_part(item_path,'/',1)<>company::text then raise exception using errcode='22023', message='Foto inválida.'; end if;
    if item->>'id'=any(seen_ids) then raise exception using errcode='22023', message='Fotos duplicadas.'; end if;
    seen_ids:=array_append(seen_ids,item->>'id');
    if not exists(select 1 from storage.objects where bucket_id='field-report-photos' and name=item_path) then raise exception using errcode='22023', message='Envie a foto antes de salvar.'; end if;
    if not manager and split_part(item_path,'/',2)<>actor::text and not exists(
      select 1 from jsonb_array_elements(coalesce(previous.photos->'before','[]') || coalesce(previous.photos->'after','[]') || coalesce(previous.photos->'pending','[]') || case when previous.logo is null or previous.logo='null'::jsonb then '[]'::jsonb else jsonb_build_array(previous.logo) end) as old
      where old->>'imageId'=item_path
    ) then raise exception using errcode='42501', message='Esta foto não pertence ao seu registro.'; end if;
  end loop;
  select jsonb_build_object('before',p_photos->'before','after',p_photos->'after','pending',p_photos->'pending') into p_photos;
  insert into public.fr_reports(id,company_id,job_id,owner_id,revision,status,fields,photos,logo,updated_by,updated_at)
  values(p_id,company,p_job_id,coalesce(previous.owner_id,actor),p_expected_revision+1,p_status,p_fields,p_photos,p_logo,actor,clock_timestamp())
  on conflict(id) do update set revision=excluded.revision,status=excluded.status,fields=excluded.fields,photos=excluded.photos,logo=excluded.logo,updated_by=excluded.updated_by,updated_at=excluded.updated_at
  returning * into result;
  return to_jsonb(result);
end;
$$;
revoke all on function public.fr_save_report(uuid,uuid,integer,text,jsonb,jsonb,jsonb) from public, anon;
grant execute on function public.fr_save_report(uuid,uuid,integer,text,jsonb,jsonb,jsonb) to authenticated;

do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='fr_reports') then alter publication supabase_realtime add table public.fr_reports; end if;
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='fr_jobs') then alter publication supabase_realtime add table public.fr_jobs; end if;
  end if;
end $$;
commit;
