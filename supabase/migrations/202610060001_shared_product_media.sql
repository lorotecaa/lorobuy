-- Allow several products to reuse one CDN preview without duplicating large files.

begin;

alter table public.product_media
drop constraint if exists product_media_storage_path_key;

create index if not exists product_media_storage_path_idx
on public.product_media (storage_path)
where storage_path is not null;

commit;
