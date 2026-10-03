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
  primary key (product_id, provider),
  unique (provider, external_variant_id)
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
