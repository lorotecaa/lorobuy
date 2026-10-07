-- Administrator-managed videos for storefront category sections.

begin;

create table public.category_media (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id) on delete cascade,
  storage_path text check (storage_path is null or char_length(storage_path) between 1 and 500),
  source_path text check (
    source_path is null
    or source_path ~ '^assets/(previews/)?[a-z0-9-]+\.(mp4|webm)$'
  ),
  media_type text not null default 'video' check (media_type = 'video'),
  mime_type text not null check (mime_type in ('video/mp4', 'video/webm', 'video/quicktime')),
  byte_size bigint check (byte_size is null or byte_size between 0 and 104857600),
  alt_text text check (alt_text is null or char_length(alt_text) <= 180),
  sort_order integer not null default 0 check (sort_order between 0 and 100000),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint category_media_exactly_one_source check (num_nonnulls(storage_path, source_path) = 1),
  constraint category_media_local_source_unique unique (category_id, source_path)
);

create index category_media_category_active_order_idx
on public.category_media (category_id, is_active, sort_order, created_at);

create index category_media_storage_path_idx
on public.category_media (storage_path)
where storage_path is not null;

create trigger category_media_set_updated_at before update on public.category_media
for each row execute function public.set_updated_at();

alter table public.category_media enable row level security;
revoke all on table public.category_media from anon, authenticated;
grant select on table public.category_media to anon, authenticated;
grant insert, update, delete on table public.category_media to authenticated;

create policy category_media_public_select
on public.category_media for select to anon, authenticated
using (
  is_active = true
  and exists (
    select 1
    from public.categories c
    where c.id = category_media.category_id
      and c.is_active = true
  )
);

create policy category_media_admin_all
on public.category_media for all to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

-- Preserve the current home preview as the initial video for Packs completos.
insert into public.category_media (
  category_id, source_path, media_type, mime_type, alt_text, sort_order
)
select
  id,
  'assets/hero.mp4',
  'video',
  'video/mp4',
  'Video principal de ' || name,
  0
from public.categories
where slug = 'packs-completos'
on conflict (category_id, source_path) do nothing;

commit;
