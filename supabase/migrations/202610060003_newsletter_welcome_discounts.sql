-- One single-use Lemon Squeezy welcome discount per newsletter address.
alter table public.newsletter_subscriptions
  add column if not exists discount_code text,
  add column if not exists discount_provider_id text,
  add column if not exists discount_created_at timestamptz;

alter table public.newsletter_subscriptions
  drop constraint if exists newsletter_subscriptions_discount_code_check;

alter table public.newsletter_subscriptions
  add constraint newsletter_subscriptions_discount_code_check
  check (
    discount_code is null
    or (char_length(discount_code) between 3 and 256 and discount_code ~ '^[A-Z0-9]+$')
  );

create unique index if not exists newsletter_subscriptions_discount_code_key
  on public.newsletter_subscriptions (discount_code)
  where discount_code is not null;

grant select, update on table public.newsletter_subscriptions to service_role;
