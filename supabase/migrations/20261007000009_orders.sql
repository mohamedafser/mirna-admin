-- 009 · Orders
--
-- Orders keep an immutable JSONB snapshot of the address used at checkout, so
-- later address edits never rewrite history. Amounts and currency are stored on
-- the order itself.
--
-- API roles cannot INSERT orders and can only UPDATE `status` (column grant in
-- migration 011). Checkout (a later phase) will create orders through a
-- server-side SECURITY DEFINER function that prices items from the database.

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  -- Human-friendly reference for customers and support.
  order_number bigint generated always as identity unique,
  -- SET NULL keeps the order for accounting if the account is deleted.
  user_id uuid references public.profiles (id) on delete set null,
  status public.order_status not null default 'PENDING',
  subtotal public.money_amount not null,
  discount public.money_amount not null default 0,
  shipping public.money_amount not null default 0,
  tax public.money_amount not null default 0,
  total public.money_amount not null,
  currency_code public.currency_code not null,
  shipping_address_snapshot jsonb not null
    check (jsonb_typeof(shipping_address_snapshot) = 'object'),
  billing_address_snapshot jsonb
    check (billing_address_snapshot is null or jsonb_typeof(billing_address_snapshot) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_discount_lte_subtotal check (discount <= subtotal),
  constraint orders_total_matches check (total = subtotal - discount + shipping + tax),
  -- Target of order_items' composite FK, which keeps item currency = order currency.
  constraint orders_id_currency_key unique (id, currency_code)
);

alter table public.orders enable row level security;

-- "My orders, newest first"
create index orders_user_id_created_at_idx on public.orders (user_id, created_at desc);
-- Admin queue filtered by status, newest first
create index orders_status_created_at_idx on public.orders (status, created_at desc);
-- Admin "all orders, newest first" and date-range reporting
create index orders_created_at_idx on public.orders (created_at desc);

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function private.set_updated_at();
