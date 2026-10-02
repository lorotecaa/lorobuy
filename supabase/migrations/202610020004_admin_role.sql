-- Assign the configured LoroBuy administrator only after Supabase has confirmed
-- ownership of the email address. Browser clients cannot update profiles.role.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, role)
  values (
    new.id,
    nullif(left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 100), ''),
    case
      when lower(coalesce(new.email, '')) = 'loroteca98@gmail.com'
       and new.email_confirmed_at is not null then 'admin'
      else 'customer'
    end
  );
  return new;
end;
$$;

create or replace function public.sync_lorobuy_admin_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if lower(coalesce(new.email, '')) = 'loroteca98@gmail.com'
     and new.email_confirmed_at is not null then
    update public.profiles
    set role = 'admin'
    where id = new.id and role <> 'admin';
  elsif lower(coalesce(old.email, '')) = 'loroteca98@gmail.com'
        and (
          lower(coalesce(new.email, '')) <> 'loroteca98@gmail.com'
          or new.email_confirmed_at is null
        ) then
    update public.profiles
    set role = 'customer'
    where id = new.id and role = 'admin';
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_admin_sync on auth.users;
create trigger on_auth_user_admin_sync
after update of email, email_confirmed_at on auth.users
for each row execute function public.sync_lorobuy_admin_role();

update public.profiles p
set role = 'admin'
from auth.users u
where p.id = u.id
  and lower(coalesce(u.email, '')) = 'loroteca98@gmail.com'
  and u.email_confirmed_at is not null
  and p.role <> 'admin';

create or replace function public.is_admin(check_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.id = check_user_id
      and p.role = 'admin'
      and u.email_confirmed_at is not null
  );
$$;

revoke all on function public.handle_new_user() from public;
revoke all on function public.sync_lorobuy_admin_role() from public;
revoke all on function public.is_admin(uuid) from public;
grant execute on function public.is_admin(uuid) to authenticated;
