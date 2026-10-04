-- Connect only Mega Pack Dioses Nórdicos to the current Lemon Squeezy test variant.

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
where slug = 'mega-pack-dioses-nordicos'
on conflict (product_id, provider) do update
set external_variant_id = excluded.external_variant_id,
    is_active = true,
    updated_at = now();

do $$
begin
  if not exists (
    select 1
    from public.payment_provider_variants ppv
    join public.products p on p.id = ppv.product_id
    where p.slug = 'mega-pack-dioses-nordicos'
      and ppv.provider = 'lemon_squeezy'
      and ppv.external_variant_id = '2202114'
      and ppv.is_active = true
  ) then
    raise exception 'Mega Pack Dioses Nórdicos was not found or could not be mapped';
  end if;
end;
$$;
