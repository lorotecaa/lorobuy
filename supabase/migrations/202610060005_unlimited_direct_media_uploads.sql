-- Remove LoroBuy's own media-size ceiling. Supabase's plan-level storage limit
-- remains the final infrastructure boundary.

begin;

alter table public.product_media
  drop constraint if exists product_media_byte_size_check;
alter table public.product_media
  add constraint product_media_byte_size_check
  check (byte_size is null or byte_size >= 0);

alter table public.category_media
  drop constraint if exists category_media_byte_size_check;
alter table public.category_media
  add constraint category_media_byte_size_check
  check (byte_size is null or byte_size >= 0);

update storage.buckets
set file_size_limit = null
where id = 'product-media';

commit;
