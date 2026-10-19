-- 031 · Multi-currency prices
--
--   currencies        the currencies the store sells in (code, symbol,
--                     decimals 0–3, is_active, exactly one is_default).
--   country_currency  the countries the store ships to, each with the
--                     currency its customers pay in. Checkout accepts only
--                     these countries.
--   product_prices    admin-set prices per product (variant_id NULL) or per
--                     variant, per currency, as INTEGER MINOR UNITS in that
--                     currency's decimals (1.500 BHD = 1500, 12.50 AED = 1250).
--                     `price` is the regular price; `sale_price`, when set, is
--                     what the customer pays and must be lower. A variant
--                     without its own row uses its product's row; no row means
--                     "not sold in that currency" (never converted).
--
-- Seeds INR (default), USD, BHD, QAR, GBP, EUR, SAR, KWD and AED, and the ten
-- countries IN, US, BH, QA, GB, BE, DE, SA, KW, AE.
--
-- Existing prices: products.price / compare_at_price and the variant columns
-- (in products.currency_code) stay, and are kept in step with the
-- product_prices row in that same currency, both ways:
--   legacy price     = coalesce(sale_price, price)      ("what you pay")
--   legacy compare-at = price when on sale, else NULL   ("was")
-- so the admin lists, variant editor and inventory screens keep working, and
-- every existing product starts with its current price in its own currency.
-- That row can't be deleted while the product / variant exists.
--
-- place_order() gains p_currency_code (the 3-argument version is dropped:
-- deploy the storefront that sends a currency together with this migration).
-- It prices every line from product_prices in that currency, refuses a line
-- without one (price_missing), refuses a delivery country outside
-- country_currency (country_not_allowed), and stores the currency and amounts
-- on the order as before.
--
-- Requires migration 025 (storefront variants: cart_items.variant_id,
-- order_items.variant_id / variant_label, private.cart_line_sellable).
-- Safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Currencies and shipping countries
-- ---------------------------------------------------------------------------

create table if not exists public.currencies (
  code public.currency_code primary key,
  symbol text not null check (char_length(btrim(symbol)) between 1 and 8),
  decimals smallint not null check (decimals between 0 and 3),
  is_active boolean not null default true,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The default currency is always sold.
  constraint currencies_default_active check (not is_default or is_active)
);

-- At most one default (set_default_currency() moves it atomically).
create unique index if not exists currencies_one_default_idx
  on public.currencies (is_default) where is_default;

create table if not exists public.country_currency (
  country_code public.country_code primary key,
  currency_code public.currency_code not null references public.currencies (code)
);

create index if not exists country_currency_currency_idx
  on public.country_currency (currency_code);

insert into public.currencies (code, symbol, decimals, is_default) values
  ('INR', '₹', 2, true),
  ('USD', '$', 2, false),
  ('BHD', 'BD', 3, false),
  ('QAR', 'QR', 2, false),
  ('GBP', '£', 2, false),
  ('EUR', '€', 2, false),
  ('SAR', 'SR', 2, false),
  ('KWD', 'KD', 3, false),
  ('AED', 'AED', 2, false)
on conflict (code) do nothing;

insert into public.country_currency (country_code, currency_code) values
  ('IN', 'INR'),
  ('US', 'USD'),
  ('BH', 'BHD'),
  ('QA', 'QAR'),
  ('GB', 'GBP'),
  ('BE', 'EUR'),
  ('DE', 'EUR'),
  ('SA', 'SAR'),
  ('KW', 'KWD'),
  ('AE', 'AED')
on conflict (country_code) do nothing;

alter table public.currencies enable row level security;
alter table public.country_currency enable row level security;

drop trigger if exists currencies_set_updated_at on public.currencies;
create trigger currencies_set_updated_at
  before update on public.currencies
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Product prices
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'product_variants_product_id_id_key'
  ) then
    alter table public.product_variants
      add constraint product_variants_product_id_id_key unique (product_id, id);
  end if;
end;
$$;

create table if not exists public.product_prices (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  variant_id uuid,
  currency_code public.currency_code not null references public.currencies (code),
  -- Integer minor units (see header). bigint: up to 11 integer digits at 3 decimals.
  price bigint not null check (price > 0 and price < 100000000000000),
  sale_price bigint check (sale_price is null or (sale_price > 0 and sale_price < price)),
  updated_at timestamptz not null default now(),
  -- The variant belongs to this product.
  constraint product_prices_variant_fkey foreign key (product_id, variant_id)
    references public.product_variants (product_id, id) on delete cascade,
  -- One product-level row and one row per variant, per currency.
  constraint product_prices_unique unique nulls not distinct (product_id, variant_id, currency_code)
);

create index if not exists product_prices_variant_idx
  on public.product_prices (variant_id) where variant_id is not null;
create index if not exists product_prices_currency_idx on public.product_prices (currency_code);

alter table public.product_prices enable row level security;

drop trigger if exists product_prices_set_updated_at on public.product_prices;
create trigger product_prices_set_updated_at
  before update on public.product_prices
  for each row execute function private.set_updated_at();

-- Minor units ↔ the NUMERIC money_amount used by orders and legacy columns.
create or replace function private.to_minor(p_amount numeric, p_decimals smallint)
returns bigint
language sql
immutable
set search_path = ''
as $$ select round(p_amount * power(10::numeric, p_decimals))::bigint $$;

create or replace function private.from_minor(p_minor bigint, p_decimals smallint)
returns numeric
language sql
immutable
set search_path = ''
as $$ select (p_minor::numeric / power(10::numeric, p_decimals))::numeric(14, 3) $$;

-- Existing prices → product_prices, in each product's own currency (only
-- currencies seeded above; amounts rounded to that currency's decimals).
insert into public.product_prices (product_id, variant_id, currency_code, price, sale_price)
select p.id, null, p.currency_code,
       private.to_minor(coalesce(p.compare_at_price, p.price), c.decimals),
       case when p.compare_at_price is not null then private.to_minor(p.price, c.decimals) end
from public.products p
join public.currencies c on c.code = p.currency_code
where p.price > 0
on conflict on constraint product_prices_unique do nothing;

insert into public.product_prices (product_id, variant_id, currency_code, price, sale_price)
select v.product_id, v.id, p.currency_code,
       private.to_minor(coalesce(v.compare_at_price, v.price), c.decimals),
       case when v.compare_at_price is not null then private.to_minor(v.price, c.decimals) end
from public.product_variants v
join public.products p on p.id = v.product_id
join public.currencies c on c.code = p.currency_code
where v.price > 0
on conflict on constraint product_prices_unique do nothing;

-- ---------------------------------------------------------------------------
-- 3. Legacy price columns ↔ product_prices (same currency), both ways
-- ---------------------------------------------------------------------------
-- pg_trigger_depth() stops each direction from re-triggering the other.

create or replace function private.legacy_price_to_prices()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product uuid;
  v_variant uuid;
  v_currency text;
  v_decimals smallint;
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  if tg_table_name = 'products' then
    v_product := new.id;
    v_variant := null;
    v_currency := new.currency_code;
  else
    v_product := new.product_id;
    v_variant := new.id;
    select p.currency_code into v_currency from public.products p where p.id = new.product_id;
  end if;
  select c.decimals into v_decimals from public.currencies c where c.code = v_currency;
  if v_decimals is null or new.price <= 0 then
    return null; -- currency not sold (or a zero price): nothing to mirror
  end if;

  insert into public.product_prices (product_id, variant_id, currency_code, price, sale_price)
  values (
    v_product, v_variant, v_currency,
    private.to_minor(coalesce(new.compare_at_price, new.price), v_decimals),
    case when new.compare_at_price is not null then private.to_minor(new.price, v_decimals) end
  )
  on conflict on constraint product_prices_unique do update
    set price = excluded.price, sale_price = excluded.sale_price;
  return null;
end;
$$;

drop trigger if exists products_legacy_price_sync on public.products;
create trigger products_legacy_price_sync
  after insert or update of price, compare_at_price, currency_code on public.products
  for each row execute function private.legacy_price_to_prices();

drop trigger if exists product_variants_legacy_price_sync on public.product_variants;
create trigger product_variants_legacy_price_sync
  after insert or update of price, compare_at_price on public.product_variants
  for each row execute function private.legacy_price_to_prices();

create or replace function private.prices_to_legacy_price()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_decimals smallint;
  v_pay numeric(14, 3);
  v_was numeric(14, 3);
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  -- Only the row in the product's own currency backs the legacy columns.
  if not exists (
    select 1 from public.products p
    where p.id = new.product_id and p.currency_code = new.currency_code
  ) then
    return null;
  end if;
  select c.decimals into v_decimals from public.currencies c where c.code = new.currency_code;
  v_pay := private.from_minor(coalesce(new.sale_price, new.price), v_decimals);
  v_was := case when new.sale_price is not null then private.from_minor(new.price, v_decimals) end;

  if new.variant_id is null then
    update public.products
    set price = v_pay, compare_at_price = v_was
    where id = new.product_id
      and (price, compare_at_price) is distinct from (v_pay, v_was);
  else
    update public.product_variants
    set price = v_pay, compare_at_price = v_was
    where id = new.variant_id
      and (price, compare_at_price) is distinct from (v_pay, v_was);
  end if;
  return null;
end;
$$;

drop trigger if exists product_prices_legacy_sync on public.product_prices;
create trigger product_prices_legacy_sync
  after insert or update on public.product_prices
  for each row execute function private.prices_to_legacy_price();

-- The row in the product's own currency can't be removed while its product /
-- variant exists (deleting the product or variant still cascades: the parent
-- row is already gone by then).
create or replace function private.product_prices_guard_base()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.products p
    where p.id = old.product_id and p.currency_code = old.currency_code
  ) and (
    old.variant_id is null
    or exists (select 1 from public.product_variants v where v.id = old.variant_id)
  ) then
    raise exception 'product_price:base_required' using errcode = '23514';
  end if;
  return old;
end;
$$;

drop trigger if exists product_prices_guard_base on public.product_prices;
create trigger product_prices_guard_base
  before delete on public.product_prices
  for each row execute function private.product_prices_guard_base();

revoke all on function private.to_minor(numeric, smallint) from public, anon, authenticated;
revoke all on function private.from_minor(bigint, smallint) from public, anon, authenticated;
revoke all on function private.legacy_price_to_prices() from public, anon, authenticated;
revoke all on function private.prices_to_legacy_price() from public, anon, authenticated;
revoke all on function private.product_prices_guard_base() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Admin helpers (SECURITY INVOKER: RLS and grants still apply; the
--    is_admin() check only gives a clear error)
-- ---------------------------------------------------------------------------

-- Makes p_code the only default currency (it must be active).
create or replace function public.set_default_currency(p_code text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'only administrators can manage currencies' using errcode = '42501';
  end if;
  if not exists (select 1 from public.currencies where code = p_code and is_active) then
    raise exception 'currency:not_active' using errcode = '23514';
  end if;
  update public.currencies set is_default = false where is_default and code <> p_code;
  update public.currencies set is_default = true where code = p_code and not is_default;
end;
$$;

-- Replaces a product's product-level prices in every currency EXCEPT its own
-- (that one is the legacy price, saved with the product). p_prices:
-- [{"currency_code": "USD", "price": 1999, "sale_price": null}, …];
-- currencies left out lose their product-level price.
create or replace function public.set_product_prices(p_product_id uuid, p_prices jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_base text;
begin
  if not private.is_admin() then
    raise exception 'only administrators can manage products' using errcode = '42501';
  end if;
  select currency_code into v_base from public.products where id = p_product_id for update;
  if not found then
    raise exception 'product not found' using errcode = 'P0002';
  end if;
  if jsonb_typeof(coalesce(p_prices, '[]')) <> 'array' or jsonb_array_length(coalesce(p_prices, '[]')) > 50 then
    raise exception 'product_price:invalid' using errcode = '22023';
  end if;

  delete from public.product_prices pp
  where pp.product_id = p_product_id
    and pp.variant_id is null
    and pp.currency_code <> v_base
    and pp.currency_code not in (
      select e ->> 'currency_code' from jsonb_array_elements(coalesce(p_prices, '[]')) e
    );

  insert into public.product_prices (product_id, variant_id, currency_code, price, sale_price)
  select p_product_id, null, e ->> 'currency_code', (e ->> 'price')::bigint,
         nullif(e ->> 'sale_price', '')::bigint
  from jsonb_array_elements(coalesce(p_prices, '[]')) e
  where e ->> 'currency_code' <> v_base
  on conflict on constraint product_prices_unique do update
    set price = excluded.price, sale_price = excluded.sale_price;
end;
$$;

-- Bulk CSV import, all or nothing. p_rows:
-- [{"product_id": …, "variant_id": … | null, "currency_code": "BHD",
--   "price": 1500 | null, "sale_price": 1200 | null}, …]
-- A null price removes that price (not allowed for the product's own currency).
create or replace function public.import_product_prices(p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not private.is_admin() then
    raise exception 'only administrators can manage products' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_rows, '[]')) <> 'array' or jsonb_array_length(coalesce(p_rows, '[]')) > 20000 then
    raise exception 'product_price:invalid' using errcode = '22023';
  end if;

  delete from public.product_prices pp
  using jsonb_array_elements(p_rows) e
  where e ->> 'price' is null
    and pp.product_id = (e ->> 'product_id')::uuid
    and pp.variant_id is not distinct from nullif(e ->> 'variant_id', '')::uuid
    and pp.currency_code = e ->> 'currency_code';

  insert into public.product_prices (product_id, variant_id, currency_code, price, sale_price)
  select (e ->> 'product_id')::uuid, nullif(e ->> 'variant_id', '')::uuid, e ->> 'currency_code',
         (e ->> 'price')::bigint, nullif(e ->> 'sale_price', '')::bigint
  from jsonb_array_elements(p_rows) e
  where e ->> 'price' is not null
  on conflict on constraint product_prices_unique do update
    set price = excluded.price, sale_price = excluded.sale_price;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.set_default_currency(text) from public, anon;
revoke all on function public.set_product_prices(uuid, jsonb) from public, anon;
revoke all on function public.import_product_prices(jsonb) from public, anon;
grant execute on function public.set_default_currency(text) to authenticated;
grant execute on function public.set_product_prices(uuid, jsonb) to authenticated;
grant execute on function public.import_product_prices(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Grants and RLS
-- ---------------------------------------------------------------------------

revoke all on table public.currencies, public.country_currency, public.product_prices
from anon, authenticated;

-- Everyone reads currencies and shipping countries (the storefront's switcher
-- and address form). Admins add currencies (Currencies page) and edit their
-- symbol and status; a currency's code and decimals never change once added
-- (prices are stored in its minor units). Shipping countries are seeded here.
grant select on table public.currencies, public.country_currency to anon, authenticated;
grant insert (code, symbol, decimals, is_active) on table public.currencies to authenticated;
-- is_default changes only through set_default_currency() (one default, unique index).
grant update (symbol, is_active, is_default) on table public.currencies to authenticated;
grant select on table public.product_prices to anon, authenticated;
grant insert, update, delete on table public.product_prices to authenticated;
grant select, insert, update, delete on table
  public.currencies, public.country_currency, public.product_prices
to service_role;

drop policy if exists currencies_select_all on public.currencies;
create policy currencies_select_all on public.currencies
  for select to anon, authenticated using (true);
drop policy if exists currencies_insert_admin on public.currencies;
create policy currencies_insert_admin on public.currencies
  for insert to authenticated with check ((select private.is_admin()));
drop policy if exists currencies_update_admin on public.currencies;
create policy currencies_update_admin on public.currencies
  for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

drop policy if exists country_currency_select_all on public.country_currency;
create policy country_currency_select_all on public.country_currency
  for select to anon, authenticated using (true);

-- Public: prices of active products (and active variants) in active currencies.
drop policy if exists product_prices_select_public on public.product_prices;
create policy product_prices_select_public on public.product_prices
  for select to anon, authenticated
  using (
    exists (select 1 from public.currencies c where c.code = currency_code and c.is_active)
    and exists (select 1 from public.products p where p.id = product_id and p.is_active)
    and (
      variant_id is null
      or exists (select 1 from public.product_variants v where v.id = variant_id and v.is_active)
    )
  );
drop policy if exists product_prices_select_admin on public.product_prices;
create policy product_prices_select_admin on public.product_prices
  for select to authenticated using ((select private.is_admin()));
drop policy if exists product_prices_insert_admin on public.product_prices;
create policy product_prices_insert_admin on public.product_prices
  for insert to authenticated with check ((select private.is_admin()));
drop policy if exists product_prices_update_admin on public.product_prices;
create policy product_prices_update_admin on public.product_prices
  for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
drop policy if exists product_prices_delete_admin on public.product_prices;
create policy product_prices_delete_admin on public.product_prices
  for delete to authenticated using ((select private.is_admin()));

-- ---------------------------------------------------------------------------
-- 6. place_order(): priced in the chosen currency
-- ---------------------------------------------------------------------------

-- A line's unit price in a currency, in minor units: the variant's own row,
-- else its product's row; null = not sold in that currency.
create or replace function private.line_unit_price(
  p_product_id uuid,
  p_variant_id uuid,
  p_currency text
)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select coalesce(pp.sale_price, pp.price) from public.product_prices pp
     where p_variant_id is not null and pp.variant_id = p_variant_id
       and pp.currency_code = p_currency),
    (select coalesce(pp.sale_price, pp.price) from public.product_prices pp
     where pp.product_id = p_product_id and pp.variant_id is null
       and pp.currency_code = p_currency)
  );
$$;

revoke all on function private.line_unit_price(uuid, uuid, text) from public, anon, authenticated;

drop function if exists public.place_order(uuid, uuid, public.money_amount);

create or replace function public.place_order(
  p_address_id uuid,
  p_checkout_key uuid,
  p_expected_total public.money_amount,
  p_currency_code text
)
returns table (
  placed_order_id uuid,
  placed_order_number bigint,
  placed_total text,
  placed_currency text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_existing public.orders%rowtype;
  v_profile public.profiles%rowtype;
  v_address public.addresses%rowtype;
  v_decimals smallint;
  v_email text;
  v_lines integer;
  v_unavailable integer;
  v_unpriced integer;
  v_subtotal numeric(14, 3);
  v_order_id uuid;
  v_order_number bigint;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_address_id is null or p_checkout_key is null or p_expected_total is null
     or p_currency_code is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('mirna.place_order:' || v_user::text, 0));

  select * into v_existing
  from public.orders o
  where o.user_id = v_user and o.checkout_key = p_checkout_key;
  if found then
    return query select v_existing.id, v_existing.order_number,
      v_existing.total::text, v_existing.currency_code::text;
    return;
  end if;

  select * into v_profile from public.profiles pr where pr.id = v_user;
  if not found or not v_profile.is_active or v_profile.role <> 'CUSTOMER' then
    raise exception 'account_not_allowed' using errcode = '42501';
  end if;

  select * into v_address
  from public.addresses a
  where a.id = p_address_id and a.user_id = v_user;
  if not found then
    raise exception 'address_invalid' using errcode = 'P0002';
  end if;
  -- Delivery only to the store's countries.
  if not exists (
    select 1 from public.country_currency cc where cc.country_code = v_address.country_code
  ) then
    raise exception 'country_not_allowed' using errcode = 'P0001';
  end if;

  -- The order's currency: an active one, locked here for the whole order.
  select c.decimals into v_decimals
  from public.currencies c
  where c.code = p_currency_code and c.is_active;
  if not found then
    raise exception 'currency_invalid' using errcode = 'P0001';
  end if;

  -- Lock the cart lines, their products, variants and prices, so nothing can
  -- change between the checks below and the inserts.
  perform 1 from public.cart_items c where c.user_id = v_user for update;
  perform 1 from public.products p
  where p.id in (select c.product_id from public.cart_items c where c.user_id = v_user)
  for share;
  perform 1 from public.product_variants v
  where v.id in (select c.variant_id from public.cart_items c where c.user_id = v_user)
  for share;
  perform 1 from public.product_prices pp
  where pp.currency_code = p_currency_code
    and pp.product_id in (select c.product_id from public.cart_items c where c.user_id = v_user)
  for share;

  select count(*) into v_lines from public.cart_items c where c.user_id = v_user;
  if v_lines = 0 then
    raise exception 'cart_empty' using errcode = 'P0001';
  end if;

  -- Every line must match its product's configuration and have enough
  -- sellable stock at that level (quantity - reserved).
  select count(*) into v_unavailable
  from public.cart_items c
  left join public.inventory i on i.product_id = c.product_id and c.variant_id is null
  left join public.variant_inventory vi on vi.variant_id = c.variant_id
  where c.user_id = v_user
    and (
      not private.cart_line_sellable(c.product_id, c.variant_id)
      or (c.variant_id is null and coalesce(i.quantity - i.reserved_quantity, 0) < c.quantity)
      or (c.variant_id is not null and coalesce(vi.quantity - vi.reserved_quantity, 0) < c.quantity)
    );
  if v_unavailable > 0 then
    raise exception 'cart_unavailable' using errcode = 'P0001';
  end if;

  -- Every line needs an admin-set price in this currency (never converted).
  select count(*) filter (
           where private.line_unit_price(c.product_id, c.variant_id, p_currency_code) is null
         ),
         private.from_minor(
           sum(private.line_unit_price(c.product_id, c.variant_id, p_currency_code) * c.quantity)::bigint,
           v_decimals
         )
  into v_unpriced, v_subtotal
  from public.cart_items c
  where c.user_id = v_user;
  if v_unpriced > 0 then
    raise exception 'price_missing' using errcode = 'P0001';
  end if;

  if v_subtotal <> p_expected_total then
    raise exception 'cart_changed' using errcode = 'P0001';
  end if;

  select u.email into v_email from auth.users u where u.id = v_user;

  insert into public.orders (
    user_id, status, subtotal, discount, shipping, tax, total, currency_code,
    shipping_address_snapshot, checkout_key
  )
  values (
    v_user, 'PENDING', v_subtotal, 0, 0, 0, v_subtotal, p_currency_code,
    jsonb_build_object(
      'address_id', v_address.id,
      'full_name', v_address.full_name,
      'phone', v_address.phone,
      'country_code', v_address.country_code,
      'state_region', v_address.state_region,
      'city', v_address.city,
      'area', v_address.area,
      'street', v_address.street,
      'building', v_address.building,
      'apartment', v_address.apartment,
      'postal_code', v_address.postal_code,
      'additional_instructions', v_address.additional_instructions,
      'customer', jsonb_build_object(
        'user_id', v_user,
        'email', v_email,
        'full_name', v_profile.full_name,
        'phone', v_profile.phone
      )
    ),
    p_checkout_key
  )
  returning id, order_number into v_order_id, v_order_number;

  insert into public.order_items (
    order_id, product_id, variant_id, product_name, variant_label, sku,
    quantity, unit_price, total_price, currency_code
  )
  select v_order_id, p.id, v.id, p.name,
         (
           select left(string_agg(a.name || ': ' || av.value, ' / '
                         order by coalesce(pta.sort_order, 2147483647), a.name), 500)
           from public.variant_attribute_values vav
           join public.attributes a on a.id = vav.attribute_id
           join public.attribute_values av on av.id = vav.attribute_value_id
           left join public.product_type_attributes pta
             on pta.product_type_id = p.product_type_id and pta.attribute_id = vav.attribute_id
           where vav.variant_id = v.id
         ),
         coalesce(v.sku, p.sku), c.quantity,
         private.from_minor(u.minor, v_decimals),
         private.from_minor(u.minor * c.quantity, v_decimals),
         p_currency_code
  from public.cart_items c
  join public.products p on p.id = c.product_id
  left join public.product_variants v on v.id = c.variant_id
  cross join lateral (
    select private.line_unit_price(c.product_id, c.variant_id, p_currency_code) as minor
  ) u
  where c.user_id = v_user
  order by c.created_at;

  delete from public.cart_items c where c.user_id = v_user;

  return query select v_order_id, v_order_number, v_subtotal::text, p_currency_code;
end;
$$;

revoke all on function public.place_order(uuid, uuid, public.money_amount, text) from public;
grant execute on function public.place_order(uuid, uuid, public.money_amount, text) to authenticated;
