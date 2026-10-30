-- 037 · Country-based shipping
--
--   shipping_countries  the countries the store delivers to (a subset of
--                       country_currency), each priced in that country's
--                       currency and switched on / off as a whole.
--   shipping_methods    per country: STANDARD and EXPRESS, each with its own
--                       status, delivery estimate (min / max days), free
--                       shipping threshold and rate type.
--   shipping_rates      a method's charge, as INTEGER MINOR UNITS of the
--                       country's currency (like product_prices: 15.00 AED =
--                       1500, 2.500 KWD = 2500). A FLAT method has one row
--                       (min_value 0, max_value null).
--
-- Rate types: only FLAT is enabled now (shipping_methods_rate_type_supported).
-- The tables already model tiers for the next ones, so they need no new
-- columns: each shipping_rates row covers [min_value, max_value) of the
-- method's basis — the order subtotal in minor units for ORDER_BASED, the
-- parcel weight in grams for WEIGHT_BASED (once products carry weights).
-- private.shipping_quotes() is the one place a rate is chosen; enabling a
-- type means dropping that constraint and teaching the quote its basis.
--
-- Free shipping: a method whose free_shipping_threshold (minor units) is
-- reached by the order subtotal costs 0. The quoted charge and whether it
-- was free are snapshotted on the order.
--
-- Checkout: place_order() gains p_shipping_method_id. It quotes the method
-- itself (country from the customer's own address, subtotal from the
-- database's own prices, currency must be the country's), adds the charge to
-- the order total, compares that total with the one the customer saw and
-- stores an immutable shipping snapshot on the order. checkout_shipping_options()
-- returns the same quotes to the storefront. A country without an active
-- shipping configuration can't be checked out to (shipping_unavailable).
--
-- Compatibility: the 4-argument place_order() (migration 031) stays, as a
-- wrapper choosing the cheapest available method. A storefront that doesn't
-- send a method yet keeps working wherever that method is free (the UAE seed
-- below copies Settings → Shipping, 0 by default) and gets cart_changed
-- otherwise, so nobody is ever charged a total they didn't see.
--
-- Seeds UAE, Saudi Arabia, Qatar, Kuwait, Oman, Bahrain, USA and UK. The UAE
-- starts active with Standard delivery copied from store_settings (fee,
-- free-shipping threshold, delivery days), so UAE checkout is unchanged.
-- The others start inactive with draft methods: set their rates in
-- Admin → Shipping and enable them.
--
-- store_settings' shipping columns are no longer read by checkout.
--
-- Requires migrations 031 and 035. Safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Types
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'shipping_method_code') then
    create type public.shipping_method_code as enum ('STANDARD', 'EXPRESS');
  end if;
  if not exists (select 1 from pg_type where typname = 'shipping_rate_type') then
    create type public.shipping_rate_type as enum ('FLAT', 'WEIGHT_BASED', 'ORDER_BASED');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------

-- Target of shipping_countries' composite FK: a shipping country's currency
-- is always the one its customers pay in.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'country_currency_country_currency_key'
  ) then
    alter table public.country_currency
      add constraint country_currency_country_currency_key unique (country_code, currency_code);
  end if;
end;
$$;

create table if not exists public.shipping_countries (
  country_code public.country_code primary key,
  currency_code public.currency_code not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  -- Rates are stored in this currency's minor units, so it never changes.
  constraint shipping_countries_currency_fkey foreign key (country_code, currency_code)
    references public.country_currency (country_code, currency_code)
    on update restrict on delete restrict
);

create index if not exists shipping_countries_updated_by_idx
  on public.shipping_countries (updated_by) where updated_by is not null;

create table if not exists public.shipping_methods (
  id uuid primary key default gen_random_uuid(),
  country_code public.country_code not null
    references public.shipping_countries (country_code) on delete cascade,
  code public.shipping_method_code not null,
  rate_type public.shipping_rate_type not null default 'FLAT',
  is_active boolean not null default false,
  -- Minor units of the country's currency; null = never free.
  free_shipping_threshold bigint
    check (free_shipping_threshold is null
      or (free_shipping_threshold > 0 and free_shipping_threshold < 100000000000000)),
  min_delivery_days smallint not null check (min_delivery_days between 0 and 365),
  max_delivery_days smallint not null check (max_delivery_days between 0 and 365),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One Standard and one Express per country (also the country_code index).
  constraint shipping_methods_country_code_key unique (country_code, code),
  constraint shipping_methods_delivery_days check (min_delivery_days <= max_delivery_days),
  -- Weight- and order-based rates are modelled (see header) but not enabled yet.
  constraint shipping_methods_rate_type_supported check (rate_type = 'FLAT')
);

create table if not exists public.shipping_rates (
  id uuid primary key default gen_random_uuid(),
  method_id uuid not null references public.shipping_methods (id) on delete cascade,
  -- Tier bounds in the method's basis, [min_value, max_value); FLAT: 0 / null.
  min_value bigint not null default 0 check (min_value >= 0),
  max_value bigint check (max_value is null or max_value > min_value),
  -- Minor units of the country's currency; 0 = free delivery.
  amount bigint not null check (amount >= 0 and amount < 100000000000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One tier per lower bound (also the method_id index).
  constraint shipping_rates_tier_key unique (method_id, min_value)
);

alter table public.shipping_countries enable row level security;
alter table public.shipping_methods enable row level security;
alter table public.shipping_rates enable row level security;

drop trigger if exists shipping_countries_set_updated_at on public.shipping_countries;
create trigger shipping_countries_set_updated_at
  before update on public.shipping_countries
  for each row execute function private.set_updated_at();
drop trigger if exists shipping_methods_set_updated_at on public.shipping_methods;
create trigger shipping_methods_set_updated_at
  before update on public.shipping_methods
  for each row execute function private.set_updated_at();
drop trigger if exists shipping_rates_set_updated_at on public.shipping_rates;
create trigger shipping_rates_set_updated_at
  before update on public.shipping_rates
  for each row execute function private.set_updated_at();

-- Records who changed a country, and refuses to switch a country on without
-- an active method that has a rate (it would accept no checkout).
create or replace function private.shipping_countries_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_by := coalesce((select auth.uid()), new.updated_by);
  if new.is_active and not exists (
    select 1
    from public.shipping_methods m
    join public.shipping_rates r on r.method_id = m.id
    where m.country_code = new.country_code and m.is_active
  ) then
    raise exception 'shipping:no_active_method' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists shipping_countries_before_write on public.shipping_countries;
create trigger shipping_countries_before_write
  before insert or update on public.shipping_countries
  for each row execute function private.shipping_countries_before_write();

revoke all on function private.shipping_countries_before_write() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Orders: immutable shipping snapshot
-- ---------------------------------------------------------------------------

alter table public.orders
  -- RESTRICT: a configuration that orders used is disabled, never deleted.
  add column if not exists shipping_method_id uuid
    references public.shipping_methods (id) on delete restrict,
  add column if not exists shipping_method public.shipping_method_code,
  add column if not exists shipping_snapshot jsonb
    check (shipping_snapshot is null or jsonb_typeof(shipping_snapshot) = 'object');

create index if not exists orders_shipping_method_id_idx
  on public.orders (shipping_method_id) where shipping_method_id is not null;

-- The charge, method and snapshot are written once, by place_order(), for
-- every role (API roles can't write these columns anyway: migration 011).
create or replace function private.guard_order_shipping()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.shipping, new.shipping_method_id, new.shipping_method, new.shipping_snapshot)
     is distinct from
     (old.shipping, old.shipping_method_id, old.shipping_method, old.shipping_snapshot) then
    raise exception 'order_shipping_immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists orders_guard_shipping on public.orders;
create trigger orders_guard_shipping
  before update on public.orders
  for each row execute function private.guard_order_shipping();

revoke all on function private.guard_order_shipping() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Quotes
-- ---------------------------------------------------------------------------

-- The methods available for a delivery country, priced for an order subtotal
-- (minor units of p_currency). Nothing when the country is inactive or isn't
-- priced in p_currency. Ordered STANDARD, EXPRESS.
create or replace function private.shipping_quotes(
  p_country_code text,
  p_currency_code text,
  p_subtotal_minor bigint
)
returns table (
  method_id uuid,
  method_code public.shipping_method_code,
  rate_type public.shipping_rate_type,
  base_amount bigint,
  amount bigint,
  free_shipping_threshold bigint,
  is_free boolean,
  min_delivery_days smallint,
  max_delivery_days smallint
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.code, m.rate_type, r.amount,
         case when f.reached then 0 else r.amount end,
         m.free_shipping_threshold,
         f.reached and r.amount > 0,
         m.min_delivery_days, m.max_delivery_days
  from public.shipping_countries sc
  join public.shipping_methods m on m.country_code = sc.country_code and m.is_active
  cross join lateral (
    select sr.amount
    from public.shipping_rates sr
    where sr.method_id = m.id
      and case m.rate_type
            when 'FLAT' then true
            when 'ORDER_BASED' then p_subtotal_minor >= sr.min_value
              and (sr.max_value is null or p_subtotal_minor < sr.max_value)
            -- WEIGHT_BASED needs product weights, which aren't tracked yet.
            else false
          end
    order by sr.min_value desc
    limit 1
  ) r
  cross join lateral (
    select m.free_shipping_threshold is not null
           and p_subtotal_minor >= m.free_shipping_threshold as reached
  ) f
  where sc.country_code = p_country_code
    and sc.currency_code = p_currency_code
    and sc.is_active
  order by m.code;
$$;

revoke all on function private.shipping_quotes(text, text, bigint) from public, anon, authenticated;

-- The signed-in customer's cart subtotal in a currency, in minor units:
-- null when a line has no price in it (never converted).
create or replace function private.cart_subtotal_minor(p_user uuid, p_currency_code text)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when count(*) filter (
             where private.line_unit_price(c.product_id, c.variant_id, p_currency_code) is null
           ) > 0 then null
           else coalesce(
             sum(private.line_unit_price(c.product_id, c.variant_id, p_currency_code) * c.quantity),
             0
           )::bigint
         end
  from public.cart_items c
  where c.user_id = p_user;
$$;

revoke all on function private.cart_subtotal_minor(uuid, text) from public, anon, authenticated;

-- Delivery options for the signed-in customer's cart to one of their own
-- addresses, in the checkout currency. Amounts are decimal strings in that
-- currency ("15.000"); `order_total` is subtotal + that option's charge, the
-- total place_order() expects. Empty = no delivery to that country (or not
-- in this currency). Raises address_invalid / price_missing like
-- place_order().
create or replace function public.checkout_shipping_options(
  p_address_id uuid,
  p_currency_code text
)
returns table (
  method_id uuid,
  method_code text,
  rate_type text,
  country_code text,
  currency_code text,
  base_amount text,
  amount text,
  is_free boolean,
  free_shipping_threshold text,
  free_shipping_remaining text,
  min_delivery_days integer,
  max_delivery_days integer,
  subtotal text,
  order_total text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_country text;
  v_decimals smallint;
  v_subtotal bigint;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_address_id is null or p_currency_code is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;

  select a.country_code into v_country
  from public.addresses a
  where a.id = p_address_id and a.user_id = v_user;
  if not found then
    raise exception 'address_invalid' using errcode = 'P0002';
  end if;

  select c.decimals into v_decimals
  from public.currencies c
  where c.code = p_currency_code and c.is_active;
  if not found then
    raise exception 'currency_invalid' using errcode = 'P0001';
  end if;

  v_subtotal := private.cart_subtotal_minor(v_user, p_currency_code);
  if v_subtotal is null then
    raise exception 'price_missing' using errcode = 'P0001';
  end if;

  return query
  select q.method_id, q.method_code::text, q.rate_type::text, v_country, p_currency_code,
         private.from_minor(q.base_amount, v_decimals)::text,
         private.from_minor(q.amount, v_decimals)::text,
         q.is_free,
         private.from_minor(q.free_shipping_threshold, v_decimals)::text,
         case when q.free_shipping_threshold is not null and q.amount > 0
              then private.from_minor(q.free_shipping_threshold - v_subtotal, v_decimals)::text
         end,
         q.min_delivery_days::integer, q.max_delivery_days::integer,
         private.from_minor(v_subtotal, v_decimals)::text,
         private.from_minor(v_subtotal + q.amount, v_decimals)::text
  from private.shipping_quotes(v_country, p_currency_code, v_subtotal) q;
end;
$$;

revoke all on function public.checkout_shipping_options(uuid, text) from public, anon;
grant execute on function public.checkout_shipping_options(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. place_order(): adds the delivery charge
-- ---------------------------------------------------------------------------

create or replace function public.place_order(
  p_address_id uuid,
  p_checkout_key uuid,
  p_expected_total public.money_amount,
  p_currency_code text,
  -- null = the cheapest available method (the 4-argument wrapper).
  p_shipping_method_id uuid
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
  v_ship_currency text;
  v_decimals smallint;
  v_email text;
  v_lines integer;
  v_unavailable integer;
  v_subtotal_minor bigint;
  v_subtotal numeric(14, 3);
  v_quote record;
  v_shipping numeric(14, 3);
  v_total numeric(14, 3);
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
  if not exists (
    select 1 from public.country_currency cc where cc.country_code = v_address.country_code
  ) then
    raise exception 'country_not_allowed' using errcode = 'P0001';
  end if;

  -- Delivery there must be configured and switched on. Locked, so the rates
  -- quoted below are the ones stored with the order.
  select sc.currency_code into v_ship_currency
  from public.shipping_countries sc
  where sc.country_code = v_address.country_code and sc.is_active
  for share;
  if not found then
    raise exception 'shipping_unavailable' using errcode = 'P0001';
  end if;
  -- Rates are in the delivery country's currency (never converted).
  if v_ship_currency <> p_currency_code then
    raise exception 'shipping_currency_mismatch' using errcode = 'P0001';
  end if;
  perform 1 from public.shipping_methods m
  where m.country_code = v_address.country_code
  for share;
  perform 1 from public.shipping_rates r
  where r.method_id in (
    select m.id from public.shipping_methods m where m.country_code = v_address.country_code
  )
  for share;

  select c.decimals into v_decimals
  from public.currencies c
  where c.code = p_currency_code and c.is_active;
  if not found then
    raise exception 'currency_invalid' using errcode = 'P0001';
  end if;

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

  v_subtotal_minor := private.cart_subtotal_minor(v_user, p_currency_code);
  if v_subtotal_minor is null then
    raise exception 'price_missing' using errcode = 'P0001';
  end if;
  v_subtotal := private.from_minor(v_subtotal_minor, v_decimals);

  -- The chosen method, quoted for this subtotal (free shipping included).
  select * into v_quote
  from private.shipping_quotes(v_address.country_code, p_currency_code, v_subtotal_minor) q
  where p_shipping_method_id is null or q.method_id = p_shipping_method_id
  order by q.amount, q.method_code
  limit 1;
  if not found then
    if p_shipping_method_id is null then
      raise exception 'shipping_unavailable' using errcode = 'P0001';
    end if;
    raise exception 'shipping_method_invalid' using errcode = 'P0001';
  end if;
  v_shipping := private.from_minor(v_quote.amount, v_decimals);
  v_total := v_subtotal + v_shipping;

  -- The customer must have seen this exact total, delivery included.
  if v_total <> p_expected_total then
    raise exception 'cart_changed' using errcode = 'P0001';
  end if;

  select u.email into v_email from auth.users u where u.id = v_user;

  insert into public.orders (
    user_id, status, subtotal, discount, shipping, tax, total, currency_code,
    shipping_address_snapshot, checkout_key,
    shipping_method_id, shipping_method, shipping_snapshot
  )
  values (
    v_user, 'PENDING', v_subtotal, 0, v_shipping, 0, v_total, p_currency_code,
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
    p_checkout_key,
    v_quote.method_id,
    v_quote.method_code,
    -- Amounts as decimal strings in the order currency (exact, like the
    -- money columns read as ::text).
    jsonb_build_object(
      'method_id', v_quote.method_id,
      'method_code', v_quote.method_code,
      'rate_type', v_quote.rate_type,
      'country_code', v_address.country_code,
      'currency_code', p_currency_code,
      'base_amount', private.from_minor(v_quote.base_amount, v_decimals)::text,
      'amount', v_shipping::text,
      'free_shipping_threshold',
        private.from_minor(v_quote.free_shipping_threshold, v_decimals)::text,
      'free_shipping_applied', v_quote.is_free,
      'min_delivery_days', v_quote.min_delivery_days,
      'max_delivery_days', v_quote.max_delivery_days,
      'quoted_at', now()
    )
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

  return query select v_order_id, v_order_number, v_total::text, p_currency_code;
end;
$$;

revoke all on function public.place_order(uuid, uuid, public.money_amount, text, uuid) from public;
grant execute on function public.place_order(uuid, uuid, public.money_amount, text, uuid)
  to authenticated;

-- Migration 031's signature, for a storefront that doesn't choose a method:
-- the cheapest available one. Its expected total is still compared with the
-- full total, delivery included.
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
language sql
security definer
set search_path = ''
as $$
  select * from public.place_order(p_address_id, p_checkout_key, p_expected_total, p_currency_code, null);
$$;

revoke all on function public.place_order(uuid, uuid, public.money_amount, text) from public;
grant execute on function public.place_order(uuid, uuid, public.money_amount, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Admin helpers (SECURITY INVOKER: RLS and grants still apply; the
--    is_admin() check only gives a clear error)
-- ---------------------------------------------------------------------------

-- Adds a delivery country (one of country_currency's, in its currency) with
-- draft Standard and Express methods: inactive, free (0), until configured.
create or replace function public.add_shipping_country(p_country_code text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_currency text;
begin
  if not private.is_admin() then
    raise exception 'only administrators can manage shipping' using errcode = '42501';
  end if;
  select cc.currency_code into v_currency
  from public.country_currency cc
  where cc.country_code = p_country_code;
  if not found then
    raise exception 'shipping:country_not_sold' using errcode = '23503';
  end if;

  insert into public.shipping_countries (country_code, currency_code, is_active)
  values (p_country_code, v_currency, false);

  with methods as (
    insert into public.shipping_methods
      (country_code, code, min_delivery_days, max_delivery_days)
    values (p_country_code, 'STANDARD', 3, 7), (p_country_code, 'EXPRESS', 1, 3)
    returning id
  )
  insert into public.shipping_rates (method_id, amount)
  select id, 0 from methods;
end;
$$;

-- Saves a country's configuration in one transaction: its status and each
-- method in p_methods (by code; methods left out are unchanged). Amounts are
-- minor units of the country's currency (strings or numbers):
--   [{"code": "STANDARD", "is_active": true, "rate_type": "FLAT",
--     "amount": "1500", "free_shipping_threshold": "20000" | null,
--     "min_delivery_days": 1, "max_delivery_days": 3}, …]
-- p_updated_at: the version the admin edited; a newer save wins nothing
-- (shipping:stale). Returns the new version.
create or replace function public.save_shipping_country(
  p_country_code text,
  p_updated_at timestamptz,
  p_is_active boolean,
  p_methods jsonb
)
returns timestamptz
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_country public.shipping_countries%rowtype;
  v_method jsonb;
  v_method_id uuid;
  v_updated timestamptz;
begin
  if not private.is_admin() then
    raise exception 'only administrators can manage shipping' using errcode = '42501';
  end if;
  select * into v_country
  from public.shipping_countries
  where country_code = p_country_code
  for update;
  if not found then
    raise exception 'shipping:not_found' using errcode = 'P0002';
  end if;
  if p_updated_at is not null and v_country.updated_at <> p_updated_at then
    raise exception 'shipping:stale' using errcode = '40001';
  end if;
  if jsonb_typeof(coalesce(p_methods, '[]')) <> 'array'
     or jsonb_array_length(coalesce(p_methods, '[]')) > 2 then
    raise exception 'shipping:invalid' using errcode = '22023';
  end if;

  for v_method in select * from jsonb_array_elements(coalesce(p_methods, '[]')) loop
    if coalesce(v_method ->> 'code', '') not in ('STANDARD', 'EXPRESS') then
      raise exception 'shipping:invalid' using errcode = '22023';
    end if;

    insert into public.shipping_methods (
      country_code, code, rate_type, is_active, free_shipping_threshold,
      min_delivery_days, max_delivery_days
    )
    values (
      p_country_code,
      (v_method ->> 'code')::public.shipping_method_code,
      coalesce(v_method ->> 'rate_type', 'FLAT')::public.shipping_rate_type,
      coalesce((v_method ->> 'is_active')::boolean, false),
      nullif(v_method ->> 'free_shipping_threshold', '')::bigint,
      (v_method ->> 'min_delivery_days')::smallint,
      (v_method ->> 'max_delivery_days')::smallint
    )
    on conflict on constraint shipping_methods_country_code_key do update set
      rate_type = excluded.rate_type,
      is_active = excluded.is_active,
      free_shipping_threshold = excluded.free_shipping_threshold,
      min_delivery_days = excluded.min_delivery_days,
      max_delivery_days = excluded.max_delivery_days
    returning id into v_method_id;

    -- FLAT: exactly one rate, covering everything.
    delete from public.shipping_rates r where r.method_id = v_method_id and r.min_value <> 0;
    insert into public.shipping_rates (method_id, min_value, max_value, amount)
    values (v_method_id, 0, null, (v_method ->> 'amount')::bigint)
    on conflict on constraint shipping_rates_tier_key do update set
      max_value = excluded.max_value,
      amount = excluded.amount;
  end loop;

  -- Always touched, so the version moves on every save (the trigger checks
  -- that an active country has an active method).
  update public.shipping_countries
  set is_active = coalesce(p_is_active, is_active), updated_at = now()
  where country_code = p_country_code
  returning updated_at into v_updated;
  return v_updated;
end;
$$;

revoke all on function public.add_shipping_country(text) from public, anon;
revoke all on function public.save_shipping_country(text, timestamptz, boolean, jsonb)
  from public, anon;
grant execute on function public.add_shipping_country(text) to authenticated;
grant execute on function public.save_shipping_country(text, timestamptz, boolean, jsonb)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Grants and RLS
-- ---------------------------------------------------------------------------

revoke all on table public.shipping_countries, public.shipping_methods, public.shipping_rates
from anon, authenticated;

-- Everyone reads the active configuration (storefront delivery info); admins
-- read and manage all of it. A country's code and currency never change.
grant select on table public.shipping_countries, public.shipping_methods, public.shipping_rates
  to anon, authenticated;
grant insert (country_code, currency_code, is_active) on table public.shipping_countries
  to authenticated;
grant update (is_active, updated_at) on table public.shipping_countries to authenticated;
grant delete on table public.shipping_countries to authenticated;
grant insert, update, delete on table public.shipping_methods, public.shipping_rates
  to authenticated;
grant select, insert, update, delete on table
  public.shipping_countries, public.shipping_methods, public.shipping_rates
to service_role;

-- shipping_countries ---------------------------------------------------------
-- anon can't call private.is_admin(), hence separate public / signed-in reads.
drop policy if exists shipping_countries_select_public on public.shipping_countries;
create policy shipping_countries_select_public on public.shipping_countries
  for select to anon
  using (is_active);
drop policy if exists shipping_countries_select_active_or_admin on public.shipping_countries;
create policy shipping_countries_select_active_or_admin on public.shipping_countries
  for select to authenticated
  using (is_active or (select private.is_admin()));
drop policy if exists shipping_countries_insert_admin on public.shipping_countries;
create policy shipping_countries_insert_admin on public.shipping_countries
  for insert to authenticated with check ((select private.is_admin()));
drop policy if exists shipping_countries_update_admin on public.shipping_countries;
create policy shipping_countries_update_admin on public.shipping_countries
  for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
drop policy if exists shipping_countries_delete_admin on public.shipping_countries;
create policy shipping_countries_delete_admin on public.shipping_countries
  for delete to authenticated using ((select private.is_admin()));

-- shipping_methods -----------------------------------------------------------
drop policy if exists shipping_methods_select_public on public.shipping_methods;
create policy shipping_methods_select_public on public.shipping_methods
  for select to anon
  using (
    is_active
    and exists (
      select 1 from public.shipping_countries sc
      where sc.country_code = shipping_methods.country_code and sc.is_active
    )
  );
drop policy if exists shipping_methods_select_active_or_admin on public.shipping_methods;
create policy shipping_methods_select_active_or_admin on public.shipping_methods
  for select to authenticated
  using (
    (select private.is_admin())
    or (
      is_active
      and exists (
        select 1 from public.shipping_countries sc
        where sc.country_code = shipping_methods.country_code and sc.is_active
      )
    )
  );
drop policy if exists shipping_methods_insert_admin on public.shipping_methods;
create policy shipping_methods_insert_admin on public.shipping_methods
  for insert to authenticated with check ((select private.is_admin()));
drop policy if exists shipping_methods_update_admin on public.shipping_methods;
create policy shipping_methods_update_admin on public.shipping_methods
  for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
drop policy if exists shipping_methods_delete_admin on public.shipping_methods;
create policy shipping_methods_delete_admin on public.shipping_methods
  for delete to authenticated using ((select private.is_admin()));

-- shipping_rates -------------------------------------------------------------
drop policy if exists shipping_rates_select_public on public.shipping_rates;
create policy shipping_rates_select_public on public.shipping_rates
  for select to anon
  using (
    exists (
      select 1
      from public.shipping_methods m
      join public.shipping_countries sc on sc.country_code = m.country_code
      where m.id = shipping_rates.method_id and m.is_active and sc.is_active
    )
  );
drop policy if exists shipping_rates_select_active_or_admin on public.shipping_rates;
create policy shipping_rates_select_active_or_admin on public.shipping_rates
  for select to authenticated
  using (
    (select private.is_admin())
    or exists (
      select 1
      from public.shipping_methods m
      join public.shipping_countries sc on sc.country_code = m.country_code
      where m.id = shipping_rates.method_id and m.is_active and sc.is_active
    )
  );
drop policy if exists shipping_rates_insert_admin on public.shipping_rates;
create policy shipping_rates_insert_admin on public.shipping_rates
  for insert to authenticated with check ((select private.is_admin()));
drop policy if exists shipping_rates_update_admin on public.shipping_rates;
create policy shipping_rates_update_admin on public.shipping_rates
  for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
drop policy if exists shipping_rates_delete_admin on public.shipping_rates;
create policy shipping_rates_delete_admin on public.shipping_rates
  for delete to authenticated using ((select private.is_admin()));

-- ---------------------------------------------------------------------------
-- 8. Seed: the GCC, the USA and the UK
-- ---------------------------------------------------------------------------
-- Countries start inactive (the trigger refuses an active country without
-- methods); the UAE is switched on once its Standard method exists.

insert into public.shipping_countries (country_code, currency_code, is_active)
select cc.country_code, cc.currency_code, false
from public.country_currency cc
where cc.country_code in ('AE', 'SA', 'QA', 'KW', 'OM', 'BH', 'US', 'GB')
on conflict (country_code) do nothing;

-- Delivery estimates: GCC Standard 3–5 / Express 1–3 days, USA and UK
-- Standard 7–14 / Express 3–5. The UAE's Standard method comes from Settings.
insert into public.shipping_methods
  (country_code, code, is_active, free_shipping_threshold, min_delivery_days, max_delivery_days)
select sc.country_code, m.code::public.shipping_method_code,
       sc.country_code = 'AE' and m.code = 'STANDARD',
       case when sc.country_code = 'AE' and m.code = 'STANDARD'
                 and s.currency_code = sc.currency_code
            then nullif(private.to_minor(s.free_shipping_threshold, c.decimals), 0) end,
       case when sc.country_code = 'AE' and m.code = 'STANDARD' and s.id is not null
            then s.delivery_min_days
            when sc.country_code in ('US', 'GB') then m.intl_min else m.gcc_min end,
       case when sc.country_code = 'AE' and m.code = 'STANDARD' and s.id is not null
            then s.delivery_max_days
            when sc.country_code in ('US', 'GB') then m.intl_max else m.gcc_max end
from public.shipping_countries sc
join public.currencies c on c.code = sc.currency_code
cross join (values ('STANDARD', 3, 5, 7, 14), ('EXPRESS', 1, 3, 3, 5))
  as m (code, gcc_min, gcc_max, intl_min, intl_max)
left join public.store_settings s on true
where sc.country_code in ('AE', 'SA', 'QA', 'KW', 'OM', 'BH', 'US', 'GB')
on conflict on constraint shipping_methods_country_code_key do nothing;

-- Flat rates: the UAE's Standard fee from Settings (when Settings are in
-- AED), every other draft method 0 until the admin sets it.
insert into public.shipping_rates (method_id, amount)
select m.id,
       case when m.country_code = 'AE' and m.code = 'STANDARD'
                 and s.currency_code = sc.currency_code
            then private.to_minor(s.shipping_fee, c.decimals)
            else 0 end
from public.shipping_methods m
join public.shipping_countries sc on sc.country_code = m.country_code
join public.currencies c on c.code = sc.currency_code
left join public.store_settings s on true
on conflict on constraint shipping_rates_tier_key do nothing;

update public.shipping_countries
set is_active = true
where country_code = 'AE'
  and not is_active
  and exists (
    select 1 from public.shipping_methods m
    where m.country_code = 'AE' and m.is_active
  )
  -- Only on the first run: a UAE switched off later stays off.
  and created_at = updated_at;

comment on column public.store_settings.shipping_fee is
  'Legacy (before migration 037): copied once into the UAE Standard rate; checkout uses shipping_rates.';
