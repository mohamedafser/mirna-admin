-- 040 · Delivery quotes for any delivery address
--
-- checkout_shipping_options() refused (price_missing) when a cart line has no
-- price in the delivery country's currency, so checkout couldn't show what
-- delivery to that country costs. It now quotes anyway:
--
--   - FLAT and WEIGHT_BASED methods are quoted (they don't need the item
--     prices); ORDER_BASED methods need the subtotal and are left out;
--   - the free-delivery threshold can't be checked, so it isn't applied;
--   - subtotal, order_total and free_shipping_remaining are null.
--
-- place_order() is unchanged: it still refuses an order with an unpriced
-- line (price_missing), so nothing can be ordered at a price nobody saw.
--
-- Requires migration 038. Safe to re-run.

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

  -- null when a line isn't priced in this currency: delivery is still quoted
  -- (see header), the order totals are null.
  v_subtotal := private.cart_subtotal_minor(v_user, p_currency_code);

  return query
  select q.method_id, q.method_code::text, q.rate_type::text, v_country, p_currency_code,
         private.from_minor(q.base_amount, v_decimals)::text,
         private.from_minor(q.amount, v_decimals)::text,
         coalesce(q.is_free, false),
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
