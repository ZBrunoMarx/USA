-- Company-level output policy. Existing companies retain the English video default.
alter table public.fr_companies add column if not exists video_languages text[] not null default array['en']::text[];
alter table public.fr_companies add constraint fr_company_video_languages_valid check (
  cardinality(video_languages) between 1 and 3 and array_ndims(video_languages)=1
  and array_position(video_languages,null) is null and video_languages <@ array['en','pt','es']::text[]
  and cardinality(array_positions(video_languages,'en'))<=1
  and cardinality(array_positions(video_languages,'pt'))<=1
  and cardinality(array_positions(video_languages,'es'))<=1
);

create or replace function public.fr_save_company_settings(p_name text,p_logo jsonb,p_revision integer,p_video_languages jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare company uuid:=field_report_private.company_id(); result public.fr_companies%rowtype; languages text[];
begin
  if not coalesce(field_report_private.is_admin(company),false) then
    raise exception using errcode='42501',message='Somente administradores configuram a companhia.';
  end if;
  if jsonb_typeof(p_video_languages) is distinct from 'array' then
    raise exception using errcode='22023',message='Selecione os idiomas dos vídeos.';
  end if;
  if jsonb_array_length(p_video_languages) not between 1 and 3
    or exists(select 1 from jsonb_array_elements(p_video_languages) item where jsonb_typeof(item)<>'string' or item#>>'{}' not in ('en','pt','es')) then
    raise exception using errcode='22023',message='Selecione de um a três idiomas de vídeo válidos.';
  end if;
  select array_agg(item order by ordinal) into languages from jsonb_array_elements_text(p_video_languages) with ordinality as items(item,ordinal);
  if (select count(distinct item) from unnest(languages) item)<>cardinality(languages) then
    raise exception using errcode='22023',message='Não repita um idioma de vídeo.';
  end if;
  -- Reuse branding validation, company isolation and optimistic revision locking.
  perform public.fr_save_company(p_name,p_logo,p_revision);
  update public.fr_companies set video_languages=languages where id=company returning * into result;
  return to_jsonb(result);
end $$;
revoke all on function public.fr_save_company_settings(text,jsonb,integer,jsonb) from public,anon;
grant execute on function public.fr_save_company_settings(text,jsonb,integer,jsonb) to authenticated;
