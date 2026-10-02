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
