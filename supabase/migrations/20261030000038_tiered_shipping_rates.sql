-- 038 · Weight-based and order value-based shipping rates
--
-- Enables the two tiered rate types modelled by migration 037:
--
--   ORDER_BASED   bands of the order subtotal, in minor units of the
--                 country's currency (e.g. 0–99.99 AED → 25, 100–249.99 → 15,
--                 250+ → 0).
--   WEIGHT_BASED  bands of the parcel weight in grams: the sum of each cart
--                 line's quantity × its weight (the variant's own weight,
--                 else its product's; unweighed items count as 0 g).
--
-- Each band is a shipping_rates row covering [min_value, max_value). A
-- method's bands always cover everything: the first starts at 0, each
-- starts where the previous ends and the last has no upper bound
-- (save_shipping_country() refuses anything else), so a tiered method can
-- always be quoted. FLAT keeps its single 0 / null row. The free-delivery
-- threshold still applies on top of any rate type.
--
-- Adds products.weight_grams and product_variants.weight_grams (optional,
-- 1 g – 1,000 kg). The order's shipping snapshot also records the band that
-- priced it and the parcel weight.
--
-- Requires migration 037. Safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Weights
-- ---------------------------------------------------------------------------

alter table public.products
  add column if not exists weight_grams integer
    constraint products_weight_grams_check
    check (weight_grams is null or weight_grams between 1 and 1000000);
alter table public.product_variants
  add column if not exists weight_grams integer
    constraint product_variants_weight_grams_check
    check (weight_grams is null or weight_grams between 1 and 1000000);

-- products: table-level UPDATE already (migration 011). Variants use column
-- grants (migration 024). Weights aren't exposed to anon.
grant update (weight_grams) on table public.product_variants to authenticated;

-- The signed-in customer's cart weight in grams (variant weight, else the
-- product's; unweighed lines count as 0).
create or replace function private.cart_weight_grams(p_user uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(c.quantity::bigint * coalesce(v.weight_grams, p.weight_grams, 0)), 0)::bigint
  from public.cart_items c
  join public.products p on p.id = c.product_id
  left join public.product_variants v on v.id = c.variant_id
  where c.user_id = p_user;
$$;

revoke all on function private.cart_weight_grams(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Every rate type is supported
-- ---------------------------------------------------------------------------

alter table public.shipping_methods
  drop constraint if exists shipping_methods_rate_type_supported;

-- ---------------------------------------------------------------------------
-- 3. Quotes priced by subtotal or weight
-- ---------------------------------------------------------------------------

create or replace function private.shipping_quotes(
  p_country_code text,
  p_currency_code text,
  p_subtotal_minor bigint,
  p_weight_grams bigint
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
  max_delivery_days smallint,
  rate_min_value bigint,
  rate_max_value bigint
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
         m.min_delivery_days, m.max_delivery_days,
         r.min_value, r.max_value
  from public.shipping_countries sc
  join public.shipping_methods m on m.country_code = sc.country_code and m.is_active
  cross join lateral (
    -- The band containing the method's basis (FLAT: its single row).
    select sr.amount, sr.min_value, sr.max_value
    from public.shipping_rates sr
    cross join lateral (
      select case m.rate_type
               when 'ORDER_BASED' then p_subtotal_minor
               when 'WEIGHT_BASED' then coalesce(p_weight_grams, 0)
               else 0
             end as basis
    ) b
    where sr.method_id = m.id
      and b.basis >= sr.min_value
      and (sr.max_value is null or b.basis < sr.max_value)
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

revoke all on function private.shipping_quotes(text, text, bigint, bigint)
  from public, anon, authenticated;

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
  from private.shipping_quotes(
    v_country, p_currency_code, v_subtotal, private.cart_weight_grams(v_user)
  ) q;
end;
$$;

revoke all on function public.checkout_shipping_options(uuid, text) from public, anon;
grant execute on function public.checkout_shipping_options(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. place_order(): quotes with the parcel weight, snapshots the band
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
  v_weight bigint;
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
  v_weight := private.cart_weight_grams(v_user);

  -- The chosen method, quoted for this subtotal (free shipping included).
  select * into v_quote
  from private.shipping_quotes(
    v_address.country_code, p_currency_code, v_subtotal_minor, v_weight
  ) q
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
      -- The band that priced it: subtotal in minor units (ORDER_BASED) or
      -- grams (WEIGHT_BASED), [min, max); FLAT: 0 / null.
      'rate_min_value', v_quote.rate_min_value,
      'rate_max_value', v_quote.rate_max_value,
      'order_weight_grams', v_weight,
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

-- Nothing calls the 3-argument quote any more.
drop function if exists private.shipping_quotes(text, text, bigint);

-- ---------------------------------------------------------------------------
-- 5. save_shipping_country(): bands for tiered methods
-- ---------------------------------------------------------------------------
-- Each method in p_methods (see migration 037) now also takes, for
-- ORDER_BASED / WEIGHT_BASED, its bands instead of "amount":
--   "rates": [{"min_value": "0", "max_value": "10000", "amount": "2500"},
--             {"min_value": "10000", "max_value": null, "amount": "0"}]
-- (at most 20; contiguous from 0, last one unbounded). FLAT still uses
-- "amount". A method's bands are replaced as a whole.

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
  v_rate_type public.shipping_rate_type;
  v_rates jsonb;
  v_band record;
  v_next bigint;
  v_count integer;
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
    v_rate_type := coalesce(v_method ->> 'rate_type', 'FLAT')::public.shipping_rate_type;
    v_rates := case
      when v_rate_type = 'FLAT' then jsonb_build_array(jsonb_build_object(
        'min_value', 0, 'max_value', null, 'amount', v_method -> 'amount'))
      else v_method -> 'rates'
    end;

    -- Bands: 1–20, contiguous from 0, the last one unbounded.
    if jsonb_typeof(v_rates) is distinct from 'array'
       or jsonb_array_length(v_rates) not between 1 and 20 then
      raise exception 'shipping:invalid_bands' using errcode = '22023';
    end if;
    v_next := 0;
    v_count := jsonb_array_length(v_rates);
    for v_band in
      select (e ->> 'min_value')::bigint as min_value,
             nullif(e ->> 'max_value', '')::bigint as max_value,
             row_number() over (order by (e ->> 'min_value')::bigint) as position
      from jsonb_array_elements(v_rates) e
      order by 1
    loop
      if v_next is null or v_band.min_value is distinct from v_next
         or (v_band.position < v_count and v_band.max_value is null)
         or (v_band.position = v_count and v_band.max_value is not null) then
        raise exception 'shipping:invalid_bands' using errcode = '22023';
      end if;
      v_next := v_band.max_value;
    end loop;

    insert into public.shipping_methods (
      country_code, code, rate_type, is_active, free_shipping_threshold,
      min_delivery_days, max_delivery_days
    )
    values (
      p_country_code,
      (v_method ->> 'code')::public.shipping_method_code,
      v_rate_type,
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

    delete from public.shipping_rates r where r.method_id = v_method_id;
    insert into public.shipping_rates (method_id, min_value, max_value, amount)
    select v_method_id, (e ->> 'min_value')::bigint, nullif(e ->> 'max_value', '')::bigint,
           (e ->> 'amount')::bigint
    from jsonb_array_elements(v_rates) e;
  end loop;

  update public.shipping_countries
  set is_active = coalesce(p_is_active, is_active), updated_at = now()
  where country_code = p_country_code
  returning updated_at into v_updated;
  return v_updated;
end;
$$;

revoke all on function public.save_shipping_country(text, timestamptz, boolean, jsonb)
  from public, anon;
grant execute on function public.save_shipping_country(text, timestamptz, boolean, jsonb)
  to authenticated;
