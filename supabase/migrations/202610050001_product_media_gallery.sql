-- Public product gallery metadata and administrator-only media uploads.

begin;

create table public.product_media (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  storage_path text unique check (storage_path is null or char_length(storage_path) between 1 and 500),
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
  'product-media',
  'product-media',
  true,
  104857600,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'video/mp4',
    'video/webm',
    'video/quicktime'
  ]
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

-- Preserve the preview each existing product currently displays. The product cover
-- remains managed by products.image_path and is always part of the public gallery.
insert into public.product_media (
  product_id,
  source_path,
  media_type,
  mime_type,
  alt_text,
  sort_order
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
