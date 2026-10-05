-- Administrative catalog creation with automatic Lemon Squeezy mapping.
-- The caller must be a confirmed administrator; the function copies the
-- currently active base variant so new products never require a new variant.

begin;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'products_checkout_price_check'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_checkout_price_check check (price_cents >= 50);
  end if;
end;
$$;

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
  where ppv.provider = 'lemon_squeezy'
    and ppv.is_active = true
  group by ppv.external_variant_id
  order by count(*) desc, ppv.external_variant_id
  limit 1;

  if base_variant_id is null then
    raise exception 'active Lemon Squeezy base variant is not configured';
  end if;

  insert into public.products (
    category_id,
    slug,
    name,
    description,
    image_path,
    price_cents,
    compare_at_price_cents,
    currency,
    sort_order,
    is_active
  ) values (
    p_category_id,
    p_slug,
    p_name,
    p_description,
    p_image_path,
    p_price_cents,
    p_compare_at_price_cents,
    p_currency,
    p_sort_order,
    p_is_active
  )
  returning * into created_product;

  insert into public.payment_provider_variants (
    product_id,
    provider,
    external_variant_id,
    is_active
  ) values (
    created_product.id,
    'lemon_squeezy',
    base_variant_id,
    true
  );

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
