-- 017 · Checkout (mirna-storefront Phase 11)
--
-- place_order() is the ONLY way an order is created. API roles still have no
-- INSERT grant on orders / order_items (migration 011); this SECURITY DEFINER
-- function re-reads everything from the database inside one transaction:
--   - the caller (auth.uid()), who must be an active CUSTOMER;
--   - their own address (snapshotted into the order);
--   - their own cart_items, each an ACTIVE product with enough stock;
--   - current product names, SKUs and prices (snapshotted into order_items).
-- Nothing priced by the client is stored. The client's expected total is only
-- compared, so a customer never pays a price they didn't see.
--
-- Duplicate submissions: a per-customer advisory lock serialises checkouts,
-- and (user_id, checkout_key) is unique, so retrying the same checkout returns
-- the order already created instead of a second one.
--
-- Out of scope here: payment, shipping rates, tax, coupons, stock
-- reservation/deduction (shipping, tax and discount are stored as 0).

alter table public.orders add column checkout_key uuid;

create unique index orders_user_checkout_key_idx on public.orders (user_id, checkout_key)
  where checkout_key is not null;

create or replace function public.place_order(
  p_address_id uuid,
  p_checkout_key uuid,
  p_expected_total public.money_amount
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
  v_email text;
  v_lines integer;
  v_unavailable integer;
  v_currencies integer;
  v_currency text;
  v_subtotal numeric(14, 3);
  v_order_id uuid;
  v_order_number bigint;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_address_id is null or p_checkout_key is null or p_expected_total is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;

  -- One checkout at a time per customer (double clicks, several tabs).
  perform pg_advisory_xact_lock(hashtextextended('mirna.place_order:' || v_user::text, 0));

  -- Same checkout submitted again: return the order it already created.
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

  -- Lock the cart lines and their products, so prices and lines can't change
  -- between the checks below and the inserts.
  perform 1 from public.cart_items c where c.user_id = v_user for update;
  perform 1 from public.products p
  where p.id in (select c.product_id from public.cart_items c where c.user_id = v_user)
  for share;

  select count(*) into v_lines from public.cart_items c where c.user_id = v_user;
  if v_lines = 0 then
    raise exception 'cart_empty' using errcode = 'P0001';
  end if;

  -- Every line must be an active product with enough sellable stock
  -- (quantity - reserved). Nothing is reserved or deducted here.
  select count(*) into v_unavailable
  from public.cart_items c
  left join public.products p on p.id = c.product_id and p.is_active
  left join public.inventory i on i.product_id = c.product_id
  where c.user_id = v_user
    and (p.id is null or coalesce(i.quantity - i.reserved_quantity, 0) < c.quantity);
  if v_unavailable > 0 then
    raise exception 'cart_unavailable' using errcode = 'P0001';
  end if;

  select count(distinct p.currency_code), min(p.currency_code), sum(p.price * c.quantity)
  into v_currencies, v_currency, v_subtotal
  from public.cart_items c
  join public.products p on p.id = c.product_id
  where c.user_id = v_user;
  if v_currencies <> 1 then
    raise exception 'mixed_currency' using errcode = 'P0001';
  end if;

  -- The customer must have seen this exact total.
  if v_subtotal <> p_expected_total then
    raise exception 'cart_changed' using errcode = 'P0001';
  end if;

  select u.email into v_email from auth.users u where u.id = v_user;

  insert into public.orders (
    user_id, status, subtotal, discount, shipping, tax, total, currency_code,
    shipping_address_snapshot, checkout_key
  )
  values (
    v_user, 'PENDING', v_subtotal, 0, 0, 0, v_subtotal, v_currency,
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
    order_id, product_id, product_name, sku, quantity, unit_price, total_price, currency_code
  )
  select v_order_id, p.id, p.name, p.sku, c.quantity, p.price, p.price * c.quantity, p.currency_code
  from public.cart_items c
  join public.products p on p.id = c.product_id
  where c.user_id = v_user
  order by c.created_at;

  -- Cleared only here, after the order and its items exist (same transaction).
  delete from public.cart_items c where c.user_id = v_user;

  return query select v_order_id, v_order_number, v_subtotal::text, v_currency;
end;
$$;

revoke all on function public.place_order(uuid, uuid, public.money_amount) from public;
grant execute on function public.place_order(uuid, uuid, public.money_amount) to authenticated;
