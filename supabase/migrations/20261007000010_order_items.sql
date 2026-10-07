-- 010 · Order items
--
-- product_name / sku / unit_price are snapshots taken when the order is placed,
-- so the order stays correct after the product is renamed, re-priced or
-- deactivated. product_id is kept for reporting; RESTRICT stops a product that
-- has been ordered from being hard-deleted.

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  product_id uuid references public.products (id) on delete restrict,
  product_name text not null check (char_length(btrim(product_name)) between 1 and 200),
  sku text not null check (char_length(sku) between 1 and 64),
  quantity integer not null check (quantity > 0),
  unit_price public.money_amount not null,
  total_price public.money_amount not null,
  currency_code public.currency_code not null,
  created_at timestamptz not null default now(),
  constraint order_items_total_matches check (total_price = unit_price * quantity),
  -- Item currency must equal its order's currency.
  constraint order_items_order_fkey foreign key (order_id, currency_code)
    references public.orders (id, currency_code) on delete cascade
);

alter table public.order_items enable row level security;

create index order_items_order_id_idx on public.order_items (order_id);
create index order_items_product_id_idx on public.order_items (product_id);
