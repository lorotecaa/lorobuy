-- Secure profile and role management for the administrative users module.

begin;

create or replace function public.admin_update_user_profile(
  p_user_id uuid,
  p_display_name text,
  p_role text
)
returns setof public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_email text;
  target_confirmed_at timestamptz;
  updated_profile public.profiles%rowtype;
begin
  if auth.uid() is null or not public.is_admin(auth.uid()) then
    raise exception 'administrator required' using errcode = '42501';
  end if;
  if p_role not in ('customer', 'admin') then
    raise exception 'invalid user role' using errcode = '23514';
  end if;
  if p_display_name is not null and char_length(btrim(p_display_name)) > 100 then
    raise exception 'invalid display name' using errcode = '23514';
  end if;

  select lower(coalesce(email, '')), email_confirmed_at
  into target_email, target_confirmed_at
  from auth.users
  where id = p_user_id;
  if not found then
    raise exception 'user not found';
  end if;

  if target_email = 'loroteca98@gmail.com' and p_role <> 'admin' then
    raise exception 'primary administrator role is protected' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() and p_role <> 'admin' then
    raise exception 'administrators cannot remove their own access' using errcode = '42501';
  end if;
  if p_role = 'admin' and target_confirmed_at is null then
    raise exception 'confirmed email required for administrator role' using errcode = '23514';
  end if;

  update public.profiles
  set display_name = nullif(left(btrim(coalesce(p_display_name, '')), 100), ''),
      role = p_role
  where id = p_user_id
  returning * into updated_profile;
  if not found then
    raise exception 'profile not found';
  end if;

  return next updated_profile;
end;
$$;

revoke all on function public.admin_update_user_profile(uuid, text, text) from public;
grant execute on function public.admin_update_user_profile(uuid, text, text) to authenticated;

commit;
