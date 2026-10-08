-- 018 · Order status transitions (Phase 13: admin order management)
--
-- Admins may already UPDATE orders.status (column grant + orders_update_admin
-- policy, migration 011). This trigger makes the database itself refuse
-- invalid moves, so the rule holds even for a request that bypasses the app:
--
--   PENDING → CONFIRMED → PROCESSING → SHIPPED → DELIVERED
--   PENDING / CONFIRMED / PROCESSING → CANCELLED
--
-- DELIVERED and CANCELLED are final. REFUNDED is reserved for a later refunds
-- phase and can't be reached from here. Statuses never move backwards.
-- Only API roles are checked; SQL run as postgres (migrations, the dashboard
-- SQL editor, future SECURITY DEFINER functions) is trusted, as with the
-- profiles guard. updated_at keeps being set by orders_set_updated_at.

create or replace function private.order_status_transition_allowed(
  p_from public.order_status,
  p_to public.order_status
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_from, p_to) in (
    ('PENDING'::public.order_status, 'CONFIRMED'::public.order_status),
    ('PENDING', 'CANCELLED'),
    ('CONFIRMED', 'PROCESSING'),
    ('CONFIRMED', 'CANCELLED'),
    ('PROCESSING', 'SHIPPED'),
    ('PROCESSING', 'CANCELLED'),
    ('SHIPPED', 'DELIVERED')
  );
$$;

create or replace function private.guard_order_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if new.status is distinct from old.status
     and not private.order_status_transition_allowed(old.status, new.status) then
    raise exception 'orders:invalid_transition' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.order_status_transition_allowed(public.order_status, public.order_status) from public;
revoke all on function private.guard_order_status() from public;
-- The trigger runs as the caller, who must be able to call the helper.
grant execute on function private.order_status_transition_allowed(public.order_status, public.order_status) to authenticated;

create trigger orders_guard_status
  before update of status on public.orders
  for each row execute function private.guard_order_status();
