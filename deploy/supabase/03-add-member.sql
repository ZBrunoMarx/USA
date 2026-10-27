-- Create the other person's Auth user first, with their own email/password.
-- This grants access only to the administrator's existing company.
do $$
declare
  admin_email text := 'EMAIL_DO_ADMIN_AQUI';
  member_email text := 'EMAIL_DO_COLABORADOR_AQUI';
  member_name text := 'Nome do profissional';
  member_role text := 'worker'; -- Use admin only for a company administrator.
  company uuid;
  user_id uuid;
  existing_company uuid;
begin
  select m.company_id into company from public.fr_members m join auth.users u on u.id=m.id
    where lower(u.email)=lower(admin_email) and m.role='admin' and m.active;
  select id into user_id from auth.users where lower(email)=lower(member_email);
  if company is null or user_id is null then raise exception 'Confira o administrador da companhia e crie primeiro o usuário do colaborador em Authentication > Users.'; end if;
  select company_id into existing_company from public.fr_members where id=user_id;
  if existing_company is not null and existing_company<>company then raise exception 'Este usuário já pertence a outra companhia; nenhum vínculo foi alterado.'; end if;
  insert into public.fr_members(id,company_id,display_name,role) values(user_id,company,member_name,member_role)
    on conflict(id) do update set display_name=excluded.display_name,role=excluded.role,active=true;
end $$;
