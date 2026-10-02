-- LoroBuy initial relational model.
-- Supabase Auth owns credentials in auth.users; application data lives in public.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) between 1 and 100),
  avatar_url text check (avatar_url is null or char_length(avatar_url) <= 500),
  role text not null default 'customer' check (role in ('customer', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null check (char_length(name) between 1 and 100),
  sort_order integer not null default 0 check (sort_order >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id) on delete restrict,
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null check (char_length(name) between 1 and 180),
  description text check (description is null or char_length(description) <= 2000),
  image_path text not null check (image_path ~ '^assets/[a-z0-9-]+\.(webp|png|jpg|jpeg)$'),
  price_cents integer not null check (price_cents >= 0),
  compare_at_price_cents integer check (
    compare_at_price_cents is null or compare_at_price_cents >= price_cents
  ),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  sort_order integer not null default 0 check (sort_order >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.product_files (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  storage_path text not null unique check (char_length(storage_path) between 1 and 500),
  download_name text not null check (char_length(download_name) between 1 and 255),
  mime_type text not null check (char_length(mime_type) between 1 and 150),
  byte_size bigint check (byte_size is null or byte_size >= 0),
  version integer not null default 1 check (version > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.carts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'converted', 'abandoned')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.cart_items (
  cart_id uuid not null references public.carts(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity integer not null default 1 check (quantity between 1 and 10),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (cart_id, product_id)
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  status text not null default 'draft' check (
    status in ('draft', 'pending', 'completed', 'cancelled', 'refunded')
  ),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  total_cents integer not null default 0 check (total_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  check ((status = 'completed' and completed_at is not null) or status <> 'completed')
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete restrict,
  product_name text not null check (char_length(product_name) between 1 and 180),
  quantity integer not null default 1 check (quantity between 1 and 10),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  subtotal_cents integer generated always as (quantity * unit_price_cents) stored,
  created_at timestamptz not null default now()
);

create table public.downloads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  order_item_id uuid not null references public.order_items(id) on delete restrict,
  product_file_id uuid not null references public.product_files(id) on delete restrict,
  downloaded_at timestamptz not null default now()
);

create table public.newsletter_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  email text not null unique check (
    char_length(email) between 3 and 254
    and email = lower(btrim(email))
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  status text not null default 'pending' check (status in ('pending', 'subscribed', 'unsubscribed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index carts_one_active_per_user
  on public.carts (user_id)
  where status = 'active';
create index categories_active_sort_idx on public.categories (is_active, sort_order);
create index products_category_active_sort_idx on public.products (category_id, is_active, sort_order);
create index product_files_product_active_idx on public.product_files (product_id, is_active);
create index carts_user_status_idx on public.carts (user_id, status);
create index cart_items_product_idx on public.cart_items (product_id);
create index orders_user_created_idx on public.orders (user_id, created_at desc);
create index orders_status_idx on public.orders (status);
create index order_items_order_idx on public.order_items (order_id);
create index order_items_product_idx on public.order_items (product_id);
create index downloads_user_date_idx on public.downloads (user_id, downloaded_at desc);
create index downloads_file_idx on public.downloads (product_file_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger categories_set_updated_at before update on public.categories
for each row execute function public.set_updated_at();
create trigger products_set_updated_at before update on public.products
for each row execute function public.set_updated_at();
create trigger product_files_set_updated_at before update on public.product_files
for each row execute function public.set_updated_at();
create trigger carts_set_updated_at before update on public.carts
for each row execute function public.set_updated_at();
create trigger cart_items_set_updated_at before update on public.cart_items
for each row execute function public.set_updated_at();
create trigger orders_set_updated_at before update on public.orders
for each row execute function public.set_updated_at();
create trigger newsletter_set_updated_at before update on public.newsletter_subscriptions
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    nullif(left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 100), '')
  );
  return new;
end;
$$;

insert into public.profiles (id, display_name)
select
  u.id,
  nullif(left(coalesce(u.raw_user_meta_data ->> 'full_name', ''), 100), '')
from auth.users u
on conflict (id) do nothing;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.is_admin(check_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = check_user_id and role = 'admin'
  );
$$;

revoke all on function public.is_admin(uuid) from public;
grant execute on function public.is_admin(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_files enable row level security;
alter table public.carts enable row level security;
alter table public.cart_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.downloads enable row level security;
alter table public.newsletter_subscriptions enable row level security;

revoke all on table public.profiles from anon, authenticated;
revoke all on table public.categories from anon, authenticated;
revoke all on table public.products from anon, authenticated;
revoke all on table public.product_files from anon, authenticated;
revoke all on table public.carts from anon, authenticated;
revoke all on table public.cart_items from anon, authenticated;
revoke all on table public.orders from anon, authenticated;
revoke all on table public.order_items from anon, authenticated;
revoke all on table public.downloads from anon, authenticated;
revoke all on table public.newsletter_subscriptions from anon, authenticated;

grant usage on schema public to anon, authenticated;
grant select on table public.categories, public.products to anon, authenticated;
grant select on table public.profiles to authenticated;
grant update (display_name, avatar_url) on table public.profiles to authenticated;
grant select, insert, update, delete on table public.categories, public.products to authenticated;
grant select, insert, update, delete on table public.product_files to authenticated;
grant select, insert, update, delete on table public.carts, public.cart_items to authenticated;
grant select, insert, update, delete on table public.orders, public.order_items to authenticated;
grant select, insert, delete on table public.downloads to authenticated;
grant select, update, delete on table public.newsletter_subscriptions to authenticated;

create policy profiles_select_own
on public.profiles for select to authenticated
using ((select auth.uid()) is not null and id = (select auth.uid()));

create policy profiles_select_admin
on public.profiles for select to authenticated
using ((select public.is_admin()));

create policy profiles_update_own
on public.profiles for update to authenticated
using ((select auth.uid()) is not null and id = (select auth.uid()))
with check ((select auth.uid()) is not null and id = (select auth.uid()));

create policy categories_select_public
on public.categories for select to anon, authenticated
using (is_active = true);

create policy categories_admin_all
on public.categories for all to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create policy products_select_public
on public.products for select to anon, authenticated
using (is_active = true);

create policy products_admin_all
on public.products for all to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create policy product_files_select_purchased
on public.product_files for select to authenticated
using (
  is_active = true
  and (select auth.uid()) is not null
  and exists (
    select 1
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where oi.product_id = product_files.product_id
      and o.user_id = (select auth.uid())
      and o.status = 'completed'
  )
);

create policy product_files_admin_all
on public.product_files for all to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create policy carts_owner_all
on public.carts for all to authenticated
using ((select auth.uid()) is not null and user_id = (select auth.uid()))
with check ((select auth.uid()) is not null and user_id = (select auth.uid()));

create policy carts_admin_select
on public.carts for select to authenticated
using ((select public.is_admin()));

create policy cart_items_owner_all
on public.cart_items for all to authenticated
using (
  exists (
    select 1 from public.carts c
    where c.id = cart_items.cart_id and c.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.carts c
    where c.id = cart_items.cart_id and c.user_id = (select auth.uid())
  )
);

create policy cart_items_admin_select
on public.cart_items for select to authenticated
using ((select public.is_admin()));

create policy orders_owner_select
on public.orders for select to authenticated
using ((select auth.uid()) is not null and user_id = (select auth.uid()));

create policy orders_admin_all
on public.orders for all to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create policy order_items_owner_select
on public.order_items for select to authenticated
using (
  exists (
    select 1 from public.orders o
    where o.id = order_items.order_id and o.user_id = (select auth.uid())
  )
);

create policy order_items_admin_all
on public.order_items for all to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create policy downloads_owner_select
on public.downloads for select to authenticated
using ((select auth.uid()) is not null and user_id = (select auth.uid()));

create policy downloads_owner_insert
on public.downloads for insert to authenticated
with check (
  (select auth.uid()) is not null
  and user_id = (select auth.uid())
  and exists (
    select 1
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    join public.product_files pf on pf.id = downloads.product_file_id
    where oi.id = downloads.order_item_id
      and oi.product_id = pf.product_id
      and o.user_id = (select auth.uid())
      and o.status = 'completed'
      and pf.is_active = true
  )
);

create policy downloads_admin_all
on public.downloads for all to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create policy newsletter_admin_all
on public.newsletter_subscriptions for all to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create or replace function public.subscribe_newsletter(p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(btrim(p_email));
begin
  if char_length(normalized_email) < 3
     or char_length(normalized_email) > 254
     or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'invalid email';
  end if;

  insert into public.newsletter_subscriptions (email, user_id, status)
  values (normalized_email, auth.uid(), 'pending')
  on conflict (email) do update
  set user_id = coalesce(public.newsletter_subscriptions.user_id, excluded.user_id),
      status = 'pending',
      updated_at = now();
end;
$$;

revoke all on function public.subscribe_newsletter(text) from public;
grant execute on function public.subscribe_newsletter(text) to anon, authenticated;

create or replace function public.add_cart_item(p_product_id uuid, p_quantity integer default 1)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  active_cart_id uuid;
begin
  if current_user_id is null then
    raise exception 'authentication required';
  end if;
  if p_quantity < 1 or p_quantity > 10 then
    raise exception 'invalid quantity';
  end if;

  select id into active_cart_id
  from public.carts
  where user_id = current_user_id and status = 'active'
  for update;

  if active_cart_id is null then
    insert into public.carts (user_id)
    values (current_user_id)
    returning id into active_cart_id;
  end if;

  insert into public.cart_items (cart_id, product_id, quantity, unit_price_cents, currency)
  select active_cart_id, p.id, p_quantity, p.price_cents, p.currency
  from public.products p
  where p.id = p_product_id and p.is_active = true
  on conflict (cart_id, product_id) do update
  set quantity = least(10, public.cart_items.quantity + excluded.quantity),
      unit_price_cents = excluded.unit_price_cents,
      currency = excluded.currency,
      updated_at = now();

  if not found then
    raise exception 'product not available';
  end if;

  update public.carts set updated_at = now() where id = active_cart_id;
  return active_cart_id;
end;
$$;

create or replace function public.remove_cart_item(p_product_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'authentication required';
  end if;

  delete from public.cart_items ci
  using public.carts c
  where ci.cart_id = c.id
    and ci.product_id = p_product_id
    and c.user_id = current_user_id
    and c.status = 'active';
end;
$$;

revoke all on function public.add_cart_item(uuid, integer) from public;
revoke all on function public.remove_cart_item(uuid) from public;
grant execute on function public.add_cart_item(uuid, integer) to authenticated;
grant execute on function public.remove_cart_item(uuid) to authenticated;
