-- 016 · Customer cart (mirna-storefront Phase 9)
--
-- Signed-in customers' carts. Guests keep their cart in the browser and it is
-- merged into this table when they sign in.
--
-- Deliberately minimal: a cart line is (customer, product, quantity). There is
-- NO price column: totals are always computed from the current
-- products.price, so a client can never persist or submit a price. Nothing
-- here reserves or deducts stock; that belongs to checkout.

create table public.cart_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  quantity integer not null check (quantity between 1 and 99),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One line per product per customer: adding again updates the quantity.
  constraint cart_items_user_product_key unique (user_id, product_id)
);

alter table public.cart_items enable row level security;

-- (user_id, product_id) unique index also serves "my cart" lookups.

create trigger cart_items_set_updated_at
  before update on public.cart_items
  for each row execute function private.set_updated_at();

-- Grants (least privilege). Only quantity can change after insert.
revoke all on table public.cart_items from anon, authenticated;
grant select, insert, delete on table public.cart_items to authenticated;
grant update (quantity) on table public.cart_items to authenticated;

-- Customers see and change only their own lines. New lines must point at an
-- active product (RLS on products would hide inactive ones anyway, but the
-- check makes the rule explicit). Admins get no extra access to carts.
create policy cart_items_select_own on public.cart_items
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy cart_items_insert_own_active on public.cart_items
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.products p
      where p.id = product_id and p.is_active
    )
  );

create policy cart_items_update_own on public.cart_items
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy cart_items_delete_own on public.cart_items
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Public availability check
-- ---------------------------------------------------------------------------
-- Anonymous visitors and customers cannot read `inventory`. This returns only
-- a yes/no per ACTIVE product ("can at least one be ordered right now?"),
-- never quantities, reservations or thresholds. Unknown or inactive ids are
-- simply absent from the result. Bounded to 100 ids per call.
create or replace function public.product_availability(p_product_ids uuid[])
returns table (product_id uuid, available boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, coalesce(i.quantity - i.reserved_quantity > 0, false)
  from public.products p
  left join public.inventory i on i.product_id = p.id
  where p.is_active
    and p.id = any (p_product_ids[1:100]);
$$;

revoke all on function public.product_availability(uuid[]) from public;
grant execute on function public.product_availability(uuid[]) to anon, authenticated;
