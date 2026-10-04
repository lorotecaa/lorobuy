-- Reuse the current Lemon Squeezy test variant for every active LoroBuy product.
-- The checkout name, amount and redirect are generated server-side from the
-- selected product, while the signed webhook remains bound to its unique order.

begin;

alter table public.payment_provider_variants
drop constraint if exists payment_provider_variants_provider_external_variant_id_key;

create index if not exists payment_provider_variants_provider_external_variant_idx
  on public.payment_provider_variants (provider, external_variant_id);

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
