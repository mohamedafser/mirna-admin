-- 043 · Purchases update stock
--
-- Before: place_order() checked that every line was in stock but never took
-- the units out, so stock only changed when an admin adjusted it.
--
-- Now, in the same transaction that creates the order:
--   - the stock rows of the cart's products and variants are locked, so two
--     customers can't both buy the last unit;
--   - every line's units are deducted: a variant's own stock AND its
--     product's stock pool (migration 042), or a simple product's stock;
--   - each change is recorded in stock history (reason "Sold", the order
--     number in the note, inventory_adjustments.order_id set).
--
-- Cancelling an order (status → CANCELLED) puts its units back the same way
-- (reason "Order cancelled"), once. Only orders placed from now on are
-- restocked (orders.stock_deducted): earlier orders never took stock out.
-- A variant deleted since the order returns its units to the product's pool.
--
-- Requires migrations 038 and 042. Safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Schema
-- ---------------------------------------------------------------------------

-- Used only inside function bodies (evaluated at run time), so safe to add in
-- the same transaction.
alter type public.inventory_adjustment_reason add value if not exists 'sold';
alter type public.inventory_adjustment_reason add value if not exists 'order_cancelled';

alter table public.orders
  add column if not exists stock_deducted boolean not null default false;

alter table public.inventory_adjustments
  add column if not exists order_id uuid references public.orders (id) on delete set null;

create index if not exists inventory_adjustments_order_id_idx
  on public.inventory_adjustments (order_id) where order_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Apply an order's lines to stock
-- ---------------------------------------------------------------------------

-- p_sign -1: deduct (sale); +1: put back (cancellation). Writes history rows
-- for the variant and for the product row it belongs to. Order matters for
-- the stock-pool guards: a sale shrinks the variant before its pool, a
-- return grows the pool before its variant.
create or replace function private.apply_order_stock(p_order_id uuid, p_sign integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_number bigint;
  v_line record;
  v_change integer;
  v_reason public.inventory_adjustment_reason;
  v_type public.inventory_adjustment_type;
  v_note text;
  v_id uuid;
  v_after integer;
begin
  select order_number into v_number from public.orders where id = p_order_id;
  v_reason := case when p_sign < 0 then 'sold' else 'order_cancelled' end;
  v_type := case when p_sign < 0 then 'decrease' else 'increase' end;
  v_note := 'Order #' || v_number;

  for v_line in
    select oi.product_id, oi.variant_id, sum(oi.quantity)::integer as quantity
    from public.order_items oi
    where oi.order_id = p_order_id and oi.product_id is not null
    group by oi.product_id, oi.variant_id
    order by oi.product_id, oi.variant_id
  loop
    v_change := p_sign * v_line.quantity;

    -- Return: the pool first, so the variant has room.
    if p_sign > 0 then
      update public.inventory set quantity = quantity + v_change
      where product_id = v_line.product_id
      returning id, quantity into v_id, v_after;
      if found then
        insert into public.inventory_adjustments (
          inventory_id, product_id, adjustment_type, quantity_before,
          adjustment_quantity, quantity_after, reason, notes, created_by, order_id
        ) values (
          v_id, v_line.product_id, v_type, v_after - v_change,
          v_change, v_after, v_reason, v_note, null, p_order_id
        );
      end if;
    end if;

    if v_line.variant_id is not null then
      update public.variant_inventory set quantity = quantity + v_change
      where variant_id = v_line.variant_id
      returning quantity into v_after;
      if found then
        insert into public.inventory_adjustments (
          variant_id, product_id, adjustment_type, quantity_before,
          adjustment_quantity, quantity_after, reason, notes, created_by, order_id
        ) values (
          v_line.variant_id, v_line.product_id, v_type, v_after - v_change,
          v_change, v_after, v_reason, v_note, null, p_order_id
        );
      end if;
    end if;

    -- Sale: the product row (a simple product's stock, or the pool) last.
    if p_sign < 0 then
      update public.inventory set quantity = quantity + v_change
      where product_id = v_line.product_id
      returning id, quantity into v_id, v_after;
      if found then
        insert into public.inventory_adjustments (
          inventory_id, product_id, adjustment_type, quantity_before,
          adjustment_quantity, quantity_after, reason, notes, created_by, order_id
        ) values (
          v_id, v_line.product_id, v_type, v_after - v_change,
          v_change, v_after, v_reason, v_note, null, p_order_id
        );
      end if;
    end if;
  end loop;
end;
$$;

revoke all on function private.apply_order_stock(uuid, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. place_order(): deducts what it sells
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

  -- Lock the stock rows too (in id order, so concurrent checkouts queue
  -- instead of deadlocking): the check below and the deduction after the
  -- insert see the same numbers, so two customers can't buy the last unit.
  perform 1 from public.inventory i
  where i.product_id in (select c.product_id from public.cart_items c where c.user_id = v_user)
  order by i.id
  for update;
  perform 1 from public.variant_inventory vi
  where vi.variant_id in (select c.variant_id from public.cart_items c where c.user_id = v_user)
  order by vi.id
  for update;

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
    shipping_method_id, shipping_method, shipping_snapshot, stock_deducted
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
    ),
    true
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

  -- The units leave stock now, recorded in stock history as "Sold".
  perform private.apply_order_stock(v_order_id, -1);

  delete from public.cart_items c where c.user_id = v_user;

  return query select v_order_id, v_order_number, v_total::text, p_currency_code;
end;
$$;

revoke all on function public.place_order(uuid, uuid, public.money_amount, text, uuid) from public;
grant execute on function public.place_order(uuid, uuid, public.money_amount, text, uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Cancelling an order puts its stock back (once)
-- ---------------------------------------------------------------------------

create or replace function private.orders_restock_on_cancel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'CANCELLED' and old.status <> 'CANCELLED' and old.stock_deducted then
    perform private.apply_order_stock(new.id, 1);
    new.stock_deducted := false;
  end if;
  return new;
end;
$$;

revoke all on function private.orders_restock_on_cancel() from public, anon, authenticated;

-- Named after orders_guard_status so the transition is validated first
-- (BEFORE triggers fire in name order).
drop trigger if exists orders_status_restock on public.orders;
create trigger orders_status_restock
  before update of status on public.orders
  for each row execute function private.orders_restock_on_cancel();
