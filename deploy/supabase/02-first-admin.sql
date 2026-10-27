-- First create your user in Authentication > Users > Add user (confirm email).
-- Change the three values below, then run once in the project's SQL Editor.
-- Passwords are entered only in Supabase Auth, never in this script.
do $$
declare
  admin_email text := 'SEU_EMAIL_AQUI';
  admin_name text := 'Bruno';
  company_name text := 'Minha companhia';
  user_id uuid;
  company uuid;
begin
  select id into user_id from auth.users where lower(email)=lower(admin_email);
  if user_id is null then raise exception 'Crie primeiro o usuário em Authentication > Users com o mesmo e-mail informado neste arquivo.'; end if;
  select company_id into company from public.fr_members where id=user_id;
  if company is not null then raise notice 'Este usuário já possui uma companhia. Nenhum acesso foi alterado.'; return; end if;
  insert into public.fr_companies(name) values(company_name) returning id into company;
  insert into public.fr_members(id,company_id,display_name,role) values(user_id,company,admin_name,'admin');
end $$;
