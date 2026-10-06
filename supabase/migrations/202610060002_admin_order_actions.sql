-- Safe administrator actions for unpaid orders (202610060002).
-- Active Lemon Squeezy checkouts expire after 30 minutes. A five-minute grace
-- period prevents cancelling an order while its checkout can still be paid.

create or replace function public.admin_cancel_order(p_order_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_order public.orders%rowtype;
begin
  if auth.uid() is null or not public.is_admin(auth.uid()) then
    raise exception 'admin role required';
  end if;

  select * into selected_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'order not found';
  end if;
  if selected_order.status not in ('draft', 'pending') then
    raise exception 'only unpaid orders can be cancelled';
  end if;
  if exists (
    select 1
    from public.payment_attempts
    where order_id = p_order_id
      and (status = 'paid' or external_order_id is not null)
  ) then
    raise exception 'paid orders cannot be cancelled';
  end if;
  if exists (
    select 1
    from public.payment_attempts
    where order_id = p_order_id
      and status = 'checkout_created'
      and created_at > now() - interval '35 minutes'
  ) then
    raise exception 'checkout is still active';
  end if;

  update public.payment_attempts
  set status = 'expired'
  where order_id = p_order_id
    and status in ('created', 'checkout_created', 'failed');

  update public.orders
  set status = 'cancelled',
      completed_at = null,
      updated_at = now()
  where id = p_order_id;

  return 'cancelled';
end;
$$;

create or replace function public.admin_delete_test_order(p_order_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_order public.orders%rowtype;
begin
  if auth.uid() is null or not public.is_admin(auth.uid()) then
    raise exception 'admin role required';
  end if;

  select * into selected_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'order not found';
  end if;
  if selected_order.status <> 'cancelled' then
    raise exception 'order must be cancelled first';
  end if;
  if not exists (
    select 1 from public.payment_attempts
    where order_id = p_order_id and test_mode = true
  ) or exists (
    select 1
    from public.payment_attempts
    where order_id = p_order_id
      and (test_mode = false or status = 'paid' or external_order_id is not null)
  ) then
    raise exception 'only unpaid test orders can be deleted';
  end if;
  if exists (
    select 1 from public.payment_events where order_id = p_order_id
  ) then
    raise exception 'orders with payment events cannot be deleted';
  end if;

  delete from public.orders where id = p_order_id;
  return 'deleted';
end;
$$;

revoke all on function public.admin_cancel_order(uuid) from public;
revoke all on function public.admin_delete_test_order(uuid) from public;
grant execute on function public.admin_cancel_order(uuid) to authenticated;
grant execute on function public.admin_delete_test_order(uuid) to authenticated;
