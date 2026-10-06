-- LoroBuy consolidated Supabase setup.
-- Run once in the Supabase SQL Editor on a new project.
-- Supabase provides auth.users, auth.uid(), storage.buckets, and storage.objects.

begin;

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



-- One-time catalog bootstrap. Runtime reads and writes use Supabase only.

insert into public.categories (slug, name, sort_order)
values
  ('packs-completos', 'Packs completos', 10),
  ('quiereme', 'Animaciones Quiéreme', 20),
  ('snipe-galeria', 'Snipe y galería', 30)
on conflict (slug) do update
set name = excluded.name,
    sort_order = excluded.sort_order,
    is_active = true;

insert into public.products (
  category_id, slug, name, image_path, price_cents, compare_at_price_cents, currency, sort_order
)
values
  ((select id from public.categories where slug = 'packs-completos'), 'mega-pack-dioses-nordicos', 'Mega Pack Dioses Nórdicos ❄️', 'assets/nordicos.webp', 13900, 19900, 'USD', 10),
  ((select id from public.categories where slug = 'packs-completos'), 'mega-pack-dioses-egipto', 'Mega Pack Dioses de Egipto 🏜️', 'assets/egipto.webp', 13900, 19900, 'USD', 20),
  ((select id from public.categories where slug = 'packs-completos'), 'mega-pack-dioses-olimpo', 'Mega Pack Dioses del Olimpo 🏛️', 'assets/olimpo.webp', 13900, 19900, 'USD', 30),
  ((select id from public.categories where slug = 'packs-completos'), 'mega-pack-galactico', 'Mega Pack Galáctico 🌌', 'assets/galactico.webp', 13900, 19900, 'USD', 40),
  ((select id from public.categories where slug = 'packs-completos'), 'mega-pack-dragon-fire', 'Mega Pack Dragon Fire 🐉', 'assets/dragon.webp', 13900, 19900, 'USD', 50),
  ((select id from public.categories where slug = 'packs-completos'), 'mega-pack-kawaii-pastel', 'Mega Pack Kawaii Pastel 🎀', 'assets/kawaii.webp', 13900, 18900, 'USD', 60),
  ((select id from public.categories where slug = 'packs-completos'), 'mega-pack-glam', 'Mega Pack Glam 💎', 'assets/glam.webp', 13900, 18900, 'USD', 70),
  ((select id from public.categories where slug = 'packs-completos'), 'mega-pack-carga-toxica', 'Mega Pack Carga Tóxica ☢️', 'assets/toxic.webp', 13900, 19900, 'USD', 80),
  ((select id from public.categories where slug = 'packs-completos'), 'pack-batallero-crystal-magic', 'Pack Batallero Crystal Magic 💎', 'assets/crystal.webp', 8900, 12900, 'USD', 90),
  ((select id from public.categories where slug = 'packs-completos'), 'pack-batallero-transformer', 'Pack Batallero Transformer 🤖', 'assets/transformer.webp', 8900, 12900, 'USD', 100),
  ((select id from public.categories where slug = 'quiereme'), 'quiereme-genio', 'Quiéreme Genio 🧞', 'assets/genio.webp', 2499, 3999, 'USD', 10),
  ((select id from public.categories where slug = 'quiereme'), 'quiereme-zeus', 'Quiéreme Zeus ⚡', 'assets/zeus.webp', 2499, 3999, 'USD', 20),
  ((select id from public.categories where slug = 'quiereme'), 'quiereme-luchador', 'Quiéreme Luchador 🤼', 'assets/luchador.webp', 2499, 3999, 'USD', 30),
  ((select id from public.categories where slug = 'quiereme'), 'quiereme-vaporwave', 'Quiéreme Vaporwave 🐬', 'assets/vaporwave.webp', 2499, 3999, 'USD', 40),
  ((select id from public.categories where slug = 'quiereme'), 'quiereme-detective', 'Quiéreme Detective 🕵️', 'assets/detective.webp', 2499, 3999, 'USD', 50),
  ((select id from public.categories where slug = 'snipe-galeria'), 'snipe-chrome-purple-pack', 'Snipe! Chrome-Purple Pack (3 animaciones)', 'assets/snipe-chrome.webp', 5900, null, 'USD', 10),
  ((select id from public.categories where slug = 'snipe-galeria'), 'snipe-amatista-pack', 'Snipe! Amatista (3 animaciones)', 'assets/snipe-amatista.webp', 5900, null, 'USD', 20),
  ((select id from public.categories where slug = 'snipe-galeria'), 'gracias-por-tu-regalo-pack', 'Paquete ''Gracias por tu regalo'' (3 animaciones)', 'assets/regalo.webp', 4999, null, 'USD', 30),
  ((select id from public.categories where slug = 'snipe-galeria'), 'llenemos-galeria', 'Animación ''Llenemos galería''', 'assets/galeria.webp', 3499, null, 'USD', 40)
on conflict (slug) do update
set category_id = excluded.category_id,
    name = excluded.name,
    image_path = excluded.image_path,
    price_cents = excluded.price_cents,
    compare_at_price_cents = excluded.compare_at_price_cents,
    currency = excluded.currency,
    sort_order = excluded.sort_order,
    is_active = true;



-- Purchased files are stored in a private Supabase Storage bucket.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-files',
  'product-files',
  false,
  104857600,
  array[
    'application/zip',
    'application/octet-stream',
    'video/mp4',
    'video/webm',
    'video/quicktime'
  ]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy product_files_storage_select_purchased
on storage.objects for select to authenticated
using (
  bucket_id = 'product-files'
  and exists (
    select 1
    from public.product_files pf
    join public.order_items oi on oi.product_id = pf.product_id
    join public.orders o on o.id = oi.order_id
    where pf.storage_path = storage.objects.name
      and pf.is_active = true
      and o.user_id = (select auth.uid())
      and o.status = 'completed'
  )
);

create policy product_files_storage_admin_select
on storage.objects for select to authenticated
using (bucket_id = 'product-files' and (select public.is_admin()));

create policy product_files_storage_admin_insert
on storage.objects for insert to authenticated
with check (bucket_id = 'product-files' and (select public.is_admin()));

create policy product_files_storage_admin_update
on storage.objects for update to authenticated
using (bucket_id = 'product-files' and (select public.is_admin()))
with check (bucket_id = 'product-files' and (select public.is_admin()));

create policy product_files_storage_admin_delete
on storage.objects for delete to authenticated
using (bucket_id = 'product-files' and (select public.is_admin()));



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



-- Provider-neutral payment records with Lemon Squeezy as the first adapter.
-- Orders are created by the shopper session and completed only by a service-role webhook RPC.

alter table public.orders
add column customer_email text check (
  customer_email is null
  or (
    char_length(customer_email) between 3 and 254
    and customer_email = lower(btrim(customer_email))
    and customer_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  )
);

create table public.payment_provider_variants (
  product_id uuid not null references public.products(id) on delete cascade,
  provider text not null check (provider in ('lemon_squeezy', 'mercado_pago')),
  external_variant_id text not null check (char_length(external_variant_id) between 1 and 120),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (product_id, provider)
);

create table public.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  provider text not null check (provider in ('lemon_squeezy', 'mercado_pago')),
  status text not null default 'created' check (
    status in ('created', 'checkout_created', 'paid', 'failed', 'expired')
  ),
  checkout_token uuid not null unique,
  provider_variant_id text not null check (char_length(provider_variant_id) between 1 and 120),
  external_checkout_id text check (
    external_checkout_id is null or char_length(external_checkout_id) between 1 and 160
  ),
  external_order_id text check (
    external_order_id is null or char_length(external_order_id) between 1 and 160
  ),
  expected_amount_cents integer not null check (expected_amount_cents > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  test_mode boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz
);

create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('lemon_squeezy', 'mercado_pago')),
  event_key text not null check (char_length(event_key) between 1 and 240),
  event_type text not null check (char_length(event_type) between 1 and 100),
  provider_object_id text not null check (char_length(provider_object_id) between 1 and 160),
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  order_id uuid not null references public.orders(id) on delete restrict,
  received_at timestamptz not null default now(),
  processed_at timestamptz not null default now(),
  unique (provider, event_key)
);

create index payment_attempts_order_idx on public.payment_attempts (order_id, created_at desc);
create index payment_provider_variants_provider_external_variant_idx
  on public.payment_provider_variants (provider, external_variant_id);
create unique index payment_attempts_external_order_unique
  on public.payment_attempts (provider, external_order_id)
  where external_order_id is not null;
create index payment_attempts_status_created_idx on public.payment_attempts (status, created_at desc);
create index payment_events_order_idx on public.payment_events (order_id, received_at desc);

create trigger payment_provider_variants_set_updated_at
before update on public.payment_provider_variants
for each row execute function public.set_updated_at();

create trigger payment_attempts_set_updated_at
before update on public.payment_attempts
for each row execute function public.set_updated_at();

create or replace function public.prevent_unverified_order_completion()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status = 'completed'
     and (tg_op = 'INSERT' or old.status <> 'completed')
     and auth.role() <> 'service_role' then
    raise exception 'orders can only be completed by a verified payment webhook';
  end if;
  return new;
end;
$$;

create trigger orders_require_verified_payment
before insert or update on public.orders
for each row execute function public.prevent_unverified_order_completion();

revoke all on function public.prevent_unverified_order_completion() from public;

alter table public.payment_provider_variants enable row level security;
alter table public.payment_attempts enable row level security;
alter table public.payment_events enable row level security;

revoke all on table public.payment_provider_variants from anon, authenticated;
revoke all on table public.payment_attempts from anon, authenticated;
revoke all on table public.payment_events from anon, authenticated;

grant select, insert, update, delete on table public.payment_provider_variants to authenticated;
grant select, insert, update, delete on table public.payment_attempts to authenticated;
grant select, insert, update, delete on table public.payment_events to authenticated;
grant all on table public.payment_provider_variants, public.payment_attempts, public.payment_events to service_role;

create policy payment_provider_variants_admin_all
on public.payment_provider_variants for all to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create policy payment_attempts_admin_all
on public.payment_attempts for all to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create policy payment_events_admin_all
on public.payment_events for all to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create or replace function public.create_payment_order(
  p_product_id uuid,
  p_provider text,
  p_checkout_token uuid,
  p_test_mode boolean
)
returns table (
  order_id uuid,
  attempt_token uuid,
  provider_variant_id text,
  amount_cents integer,
  currency text,
  product_name text,
  product_slug text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  selected_product public.products%rowtype;
  selected_variant public.payment_provider_variants%rowtype;
  created_order_id uuid;
begin
  if current_user_id is null then
    raise exception 'authentication required';
  end if;
  if p_provider <> 'lemon_squeezy' then
    raise exception 'payment provider unavailable';
  end if;

  select * into selected_product
  from public.products
  where id = p_product_id and is_active = true;
  if not found then
    raise exception 'product not available';
  end if;

  select * into selected_variant
  from public.payment_provider_variants
  where product_id = selected_product.id
    and provider = p_provider
    and is_active = true;
  if not found then
    raise exception 'payment variant not configured';
  end if;

  insert into public.orders (user_id, status, currency, total_cents)
  values (current_user_id, 'pending', selected_product.currency, selected_product.price_cents)
  returning id into created_order_id;

  insert into public.order_items (
    order_id, product_id, product_name, quantity, unit_price_cents, currency
  ) values (
    created_order_id,
    selected_product.id,
    selected_product.name,
    1,
    selected_product.price_cents,
    selected_product.currency
  );

  insert into public.payment_attempts (
    order_id,
    provider,
    checkout_token,
    provider_variant_id,
    expected_amount_cents,
    currency,
    test_mode
  ) values (
    created_order_id,
    p_provider,
    p_checkout_token,
    selected_variant.external_variant_id,
    selected_product.price_cents,
    selected_product.currency,
    p_test_mode
  );

  return query select
    created_order_id,
    p_checkout_token,
    selected_variant.external_variant_id,
    selected_product.price_cents,
    selected_product.currency,
    selected_product.name,
    selected_product.slug;
end;
$$;

create or replace function public.register_payment_checkout(
  p_order_id uuid,
  p_checkout_token uuid,
  p_external_checkout_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  update public.payment_attempts pa
  set status = 'checkout_created',
      external_checkout_id = p_external_checkout_id
  from public.orders o
  where pa.order_id = p_order_id
    and pa.checkout_token = p_checkout_token
    and pa.status = 'created'
    and o.id = pa.order_id
    and o.user_id = auth.uid()
    and o.status = 'pending';

  if not found then
    raise exception 'payment attempt not available';
  end if;
end;
$$;

create or replace function public.complete_payment_order(
  p_order_id uuid,
  p_attempt_token uuid,
  p_event_key text,
  p_event_type text,
  p_provider_object_id text,
  p_external_order_id text,
  p_payload_sha256 text,
  p_provider_variant_id text,
  p_currency text,
  p_subtotal_cents integer,
  p_customer_email text,
  p_test_mode boolean
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_attempt public.payment_attempts%rowtype;
  selected_order public.orders%rowtype;
  normalized_email text := lower(btrim(coalesce(p_customer_email, '')));
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required';
  end if;
  if p_event_type <> 'order_created' then
    raise exception 'unsupported payment event';
  end if;
  if p_subtotal_cents is null or p_subtotal_cents <= 0 then
    raise exception 'invalid payment amount';
  end if;

  select * into selected_attempt
  from public.payment_attempts
  where order_id = p_order_id
    and checkout_token = p_attempt_token
    and provider = 'lemon_squeezy'
  for update;
  if not found then
    raise exception 'payment attempt not found';
  end if;

  select * into selected_order
  from public.orders
  where id = p_order_id
  for update;
  if not found then
    raise exception 'order not found';
  end if;

  if selected_attempt.provider_variant_id <> p_provider_variant_id
     or selected_attempt.expected_amount_cents <> p_subtotal_cents
     or selected_attempt.currency <> upper(p_currency)
     or selected_attempt.test_mode <> p_test_mode
     or selected_order.total_cents <> p_subtotal_cents
     or selected_order.currency <> upper(p_currency) then
    raise exception 'payment does not match the pending order';
  end if;

  insert into public.payment_events (
    provider,
    event_key,
    event_type,
    provider_object_id,
    payload_sha256,
    order_id
  ) values (
    'lemon_squeezy',
    p_event_key,
    p_event_type,
    p_provider_object_id,
    p_payload_sha256,
    p_order_id
  ) on conflict (provider, event_key) do nothing;

  if not found then
    return 'duplicate';
  end if;

  if selected_order.status = 'completed' then
    return 'already_completed';
  end if;
  if selected_order.status <> 'pending' then
    raise exception 'order is not pending';
  end if;
  if char_length(normalized_email) < 3
     or char_length(normalized_email) > 254
     or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'invalid customer email';
  end if;

  update public.payment_attempts
  set status = 'paid',
      external_order_id = p_external_order_id,
      paid_at = now()
  where id = selected_attempt.id;

  update public.orders
  set status = 'completed',
      completed_at = now(),
      customer_email = normalized_email
  where id = p_order_id;

  return 'completed';
end;
$$;

revoke all on function public.create_payment_order(uuid, text, uuid, boolean) from public;
revoke all on function public.register_payment_checkout(uuid, uuid, text) from public;
revoke all on function public.complete_payment_order(uuid, uuid, text, text, text, text, text, text, text, integer, text, boolean) from public;

grant execute on function public.create_payment_order(uuid, text, uuid, boolean) to authenticated;
grant execute on function public.register_payment_checkout(uuid, uuid, text) to authenticated;
grant execute on function public.complete_payment_order(uuid, uuid, text, text, text, text, text, text, text, integer, text, boolean) to service_role;

-- Reuse the current Lemon Squeezy test variant for every active catalog product.
-- Product identity and pricing remain bound to the server-created LoroBuy order.

insert into public.payment_provider_variants (
  product_id,
  provider,
  external_variant_id,
  is_active
)
select
  id,
  'lemon_squeezy',
  '2202114',
  true
from public.products
where is_active = true
on conflict (product_id, provider) do update
set external_variant_id = excluded.external_variant_id,
    is_active = true,
    updated_at = now();

do $$
declare
  active_product_count integer;
  mapped_product_count integer;
begin
  select count(*)
  into active_product_count
  from public.products
  where is_active = true;

  select count(*)
  into mapped_product_count
  from public.payment_provider_variants ppv
  join public.products p on p.id = ppv.product_id
  where p.is_active = true
    and ppv.provider = 'lemon_squeezy'
    and ppv.external_variant_id = '2202114'
    and ppv.is_active = true;

  if active_product_count = 0 or mapped_product_count <> active_product_count then
    raise exception 'Not every active LoroBuy product was mapped to Lemon Squeezy';
  end if;
end;
$$;
commit;

-- Admin product creation stays atomic with its reusable Lemon variant mapping.
begin;

alter table public.products
  add constraint products_checkout_price_check check (price_cents >= 50);

create or replace function public.admin_create_product(
  p_category_id uuid,
  p_slug text,
  p_name text,
  p_description text,
  p_image_path text,
  p_price_cents integer,
  p_compare_at_price_cents integer,
  p_currency text,
  p_sort_order integer,
  p_is_active boolean
)
returns setof public.products
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_product public.products%rowtype;
  base_variant_id text;
begin
  if auth.uid() is null or not public.is_admin(auth.uid()) then
    raise exception 'administrator required' using errcode = '42501';
  end if;
  if p_price_cents is null or p_price_cents < 50 or p_price_cents > 100000000 then
    raise exception 'invalid product price' using errcode = '23514';
  end if;
  if p_compare_at_price_cents is not null and p_compare_at_price_cents < p_price_cents then
    raise exception 'compare price must be greater than or equal to product price' using errcode = '23514';
  end if;
  if upper(coalesce(p_currency, '')) <> 'USD' then
    raise exception 'unsupported product currency' using errcode = '23514';
  end if;

  select ppv.external_variant_id
  into base_variant_id
  from public.payment_provider_variants ppv
  where ppv.provider = 'lemon_squeezy' and ppv.is_active = true
  group by ppv.external_variant_id
  order by count(*) desc, ppv.external_variant_id
  limit 1;

  if base_variant_id is null then
    raise exception 'active Lemon Squeezy base variant is not configured';
  end if;

  insert into public.products (
    category_id, slug, name, description, image_path, price_cents,
    compare_at_price_cents, currency, sort_order, is_active
  ) values (
    p_category_id, p_slug, p_name, p_description, p_image_path, p_price_cents,
    p_compare_at_price_cents, p_currency, p_sort_order, p_is_active
  ) returning * into created_product;

  insert into public.payment_provider_variants (
    product_id, provider, external_variant_id, is_active
  ) values (created_product.id, 'lemon_squeezy', base_variant_id, true);

  return next created_product;
end;
$$;

revoke all on function public.admin_create_product(
  uuid, text, text, text, text, integer, integer, text, integer, boolean
) from public;
grant execute on function public.admin_create_product(
  uuid, text, text, text, text, integer, integer, text, integer, boolean
) to authenticated;

commit;

-- Secure user profile and role management for confirmed administrators.
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
  if not found then raise exception 'user not found'; end if;
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
  if not found then raise exception 'profile not found'; end if;
  return next updated_profile;
end;
$$;

revoke all on function public.admin_update_user_profile(uuid, text, text) from public;
grant execute on function public.admin_update_user_profile(uuid, text, text) to authenticated;

commit;

-- Administrable public gallery for every product.
begin;

create table public.product_media (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  storage_path text check (storage_path is null or char_length(storage_path) between 1 and 500),
  source_path text check (
    source_path is null
    or source_path ~ '^assets/(previews/)?[a-z0-9-]+\.(mp4|webm|webp|png|jpg|jpeg|gif)$'
  ),
  media_type text not null check (media_type in ('image', 'video')),
  mime_type text not null check (char_length(mime_type) between 1 and 100),
  byte_size bigint check (byte_size is null or byte_size between 0 and 104857600),
  alt_text text check (alt_text is null or char_length(alt_text) <= 180),
  sort_order integer not null default 0 check (sort_order >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_media_exactly_one_source check (num_nonnulls(storage_path, source_path) = 1),
  constraint product_media_local_source_unique unique (product_id, source_path)
);

create index product_media_product_active_order_idx
on public.product_media (product_id, is_active, sort_order, created_at);

create index product_media_storage_path_idx
on public.product_media (storage_path)
where storage_path is not null;

create trigger product_media_set_updated_at before update on public.product_media
for each row execute function public.set_updated_at();

alter table public.product_media enable row level security;
revoke all on table public.product_media from anon, authenticated;
grant select on table public.product_media to anon, authenticated;
grant insert, update, delete on table public.product_media to authenticated;

create policy product_media_public_select
on public.product_media for select to anon, authenticated
using (
  is_active = true
  and exists (
    select 1
    from public.products p
    join public.categories c on c.id = p.category_id
    where p.id = product_media.product_id
      and p.is_active = true
      and c.is_active = true
  )
);

create policy product_media_admin_all
on public.product_media for all to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-media', 'product-media', true, 104857600,
  array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime']
)
on conflict (id) do update
set public = true,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy product_media_storage_admin_insert
on storage.objects for insert to authenticated
with check (bucket_id = 'product-media' and (select public.is_admin()));

create policy product_media_storage_admin_update
on storage.objects for update to authenticated
using (bucket_id = 'product-media' and (select public.is_admin()))
with check (bucket_id = 'product-media' and (select public.is_admin()));

create policy product_media_storage_admin_delete
on storage.objects for delete to authenticated
using (bucket_id = 'product-media' and (select public.is_admin()));

insert into public.product_media (
  product_id, source_path, media_type, mime_type, alt_text, sort_order
)
select
  id,
  case
    when slug = 'mega-pack-dioses-nordicos'
      then 'assets/previews/mega-pack-dioses-nordicos.mp4'
    else 'assets/hero.mp4'
  end,
  'video',
  'video/mp4',
  'Vista previa de ' || name,
  0
from public.products
on conflict (product_id, source_path) do nothing;

commit;

-- Read-only installation check: expected result is 3 categories, 19 products,
-- a private product-files bucket, a public product-media bucket, and RLS enabled
-- on all 14 application tables.
select
  (select count(*) from public.categories) as categories,
  (select count(*) from public.products) as products,
  (
    select count(*)
    from public.payment_provider_variants
    where provider = 'lemon_squeezy'
      and external_variant_id = '2202114'
      and is_active = true
  ) as lemon_mapped_products,
  (select count(*) from storage.buckets where id = 'product-files' and public = false) as private_buckets,
  (select count(*) from storage.buckets where id = 'product-media' and public = true) as public_media_buckets,
  (
    select count(*)
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'profiles', 'categories', 'products', 'product_files', 'carts',
        'cart_items', 'orders', 'order_items', 'downloads', 'newsletter_subscriptions',
        'payment_provider_variants', 'payment_attempts', 'payment_events', 'product_media'
      )
      and c.relrowsecurity = true
  ) as rls_enabled_tables;

