-- 005 · Products
--
-- Products are deactivated (is_active = false), not deleted, so order history and
-- reporting keep their references. No DELETE grant is given to API roles, and
-- order_items references products with ON DELETE RESTRICT.
-- Each product stores its own currency explicitly; nothing assumes AED.

create table public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.categories (id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  slug text not null unique
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 200),
  sku text not null unique check (sku ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  description text check (char_length(description) <= 20000),
  short_description text check (char_length(short_description) <= 500),
  price public.money_amount not null,
  compare_at_price public.money_amount,
  currency_code public.currency_code not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_compare_at_price_gt_price
    check (compare_at_price is null or compare_at_price > price)
);

alter table public.products enable row level security;

-- FK lookups / "products in category". (slug and sku already have unique indexes.)
create index products_category_id_idx on public.products (category_id);
-- Storefront listing: newest active products.
create index products_active_created_at_idx on public.products (created_at desc)
  where is_active;

create trigger products_set_updated_at
  before update on public.products
  for each row execute function private.set_updated_at();
