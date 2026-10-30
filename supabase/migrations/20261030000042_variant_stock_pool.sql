-- 042 · Product stock is a pool shared by its variants
--
-- Before: a product with variants had no stock of its own: its inventory row
-- was the sum of its active variants, product-level adjustments were refused,
-- and adding units to any variant raised the total without limit.
--
-- Now: the product's stock (inventory.quantity) is the POOL of physical
-- units, adjusted at product level like a simple product (receive, count,
-- remove: adjust_inventory(), with history). Its variants share that pool:
--
--   allocated    = Σ variant_inventory.quantity (every variant, active or not:
--                  the units physically exist)
--   unallocated  = pool − allocated   (always ≥ 0)
--
-- Enforced in the database, for every path (dialog, batch, generator, SQL):
--   - a variant change that would make allocated > pool → inventory:exceeds_pool
--   - a pool decrease below allocated                   → inventory:below_allocated
-- Both lock the product's inventory row, so concurrent changes can't overrun.
--
-- reserved_quantity of the product row stays the sum over its active
-- variants. Creating the first variants keeps the pool; giving it all to one
-- variant is now optional. Deleting a variant (with its stock cleared) returns
-- its units to the pool.
--
-- The storefront still sells per variant (variant_inventory). For a product
-- with variants, product_availability() / product_stock_limit() now report
-- what its purchasable variants can sell, not the pool (unallocated units
-- can't be bought), so the storefront behaves exactly as before.
--
-- Existing data: each pool becomes at least what its variants hold (units on
-- inactive variants were left out of the old sum), recorded in history.
--
-- Requires migrations 024, 026 and 036. Safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Pools start from what the variants hold
-- ---------------------------------------------------------------------------

with pools as (
  select i.id, i.product_id, i.quantity,
         (select coalesce(sum(vi.quantity), 0)
          from public.variant_inventory vi
          where vi.product_id = i.product_id)::integer as allocated
  from public.inventory i
  where exists (select 1 from public.product_variants v where v.product_id = i.product_id)
), raised as (
  update public.inventory i
  set quantity = p.allocated
  from pools p
  where i.id = p.id and p.allocated > p.quantity
  returning i.id, i.product_id, p.quantity as before, p.allocated as after
)
insert into public.inventory_adjustments (
  inventory_id, product_id, adjustment_type, quantity_before,
  adjustment_quantity, quantity_after, reason, notes, created_by
)
select id, product_id, 'set', before, after - before, after, 'manual_correction',
       'Stock pool: includes units held by inactive variants', null
from raised;

-- ---------------------------------------------------------------------------
-- 2. The product row keeps its own quantity; only reserved is derived
-- ---------------------------------------------------------------------------

create or replace function private.sync_product_inventory(p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.product_variants where product_id = p_product_id) then
    return; -- simple product: its inventory row is managed directly
  end if;
  -- A pool row always exists; a new one starts with what the variants hold.
  insert into public.inventory as i (product_id, quantity, reserved_quantity)
  select p_product_id,
         coalesce(sum(vi.quantity), 0),
         coalesce(sum(vi.reserved_quantity) filter (where v.is_active), 0)
  from public.product_variants v
  left join public.variant_inventory vi on vi.variant_id = v.id
  where v.product_id = p_product_id
  on conflict (product_id) do update
    set reserved_quantity = excluded.reserved_quantity
    where i.reserved_quantity is distinct from excluded.reserved_quantity;
end;
$$;

revoke all on function private.sync_product_inventory(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Guards
-- ---------------------------------------------------------------------------

-- Variants can't hold more than the pool.
create or replace function private.variant_inventory_within_pool()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pool integer;
  v_allocated bigint;
begin
  if tg_op = 'UPDATE' and new.quantity <= old.quantity then
    return null; -- decreases always fit
  end if;
  select quantity into v_pool
  from public.inventory where product_id = new.product_id
  for update;
  select coalesce(sum(quantity), 0) into v_allocated
  from public.variant_inventory where product_id = new.product_id;
  if v_allocated > coalesce(v_pool, 0) then
    raise exception 'inventory:exceeds_pool' using errcode = '23514';
  end if;
  return null;
end;
$$;

revoke all on function private.variant_inventory_within_pool() from public, anon, authenticated;

drop trigger if exists variant_inventory_within_pool on public.variant_inventory;
create trigger variant_inventory_within_pool
  after insert or update of quantity on public.variant_inventory
  for each row execute function private.variant_inventory_within_pool();

-- The pool can't drop below what its variants hold.
create or replace function private.inventory_pool_covers_variants()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.quantity < old.quantity and new.quantity < (
    select coalesce(sum(vi.quantity), 0)
    from public.variant_inventory vi
    where vi.product_id = new.product_id
  ) then
    raise exception 'inventory:below_allocated' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.inventory_pool_covers_variants() from public, anon, authenticated;

drop trigger if exists inventory_pool_covers_variants on public.inventory;
create trigger inventory_pool_covers_variants
  before update of quantity on public.inventory
  for each row execute function private.inventory_pool_covers_variants();

-- ---------------------------------------------------------------------------
-- 4. Product-level adjustments for products with variants (the pool)
-- ---------------------------------------------------------------------------

create or replace function public.adjust_inventory(
  p_product_id uuid,
  p_type public.inventory_adjustment_type,
  p_quantity integer,
  p_reason public.inventory_adjustment_reason,
  p_notes text default null,
  p_expected_quantity integer default null
)
returns public.inventory
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.inventory;
  v_new bigint;
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  if not private.is_admin() then
    raise exception 'inventory:forbidden' using errcode = '42501';
  end if;
  if p_quantity is null or p_quantity < 0 or (p_type <> 'set' and p_quantity = 0) then
    raise exception 'inventory:invalid_quantity' using errcode = '22023';
  end if;
  if p_reason::text = 'variant_migration' then
    raise exception 'inventory:invalid_reason' using errcode = '22023';
  end if;
  if p_reason = 'other' and v_notes is null then
    raise exception 'inventory:notes_required' using errcode = '22023';
  end if;
  if char_length(v_notes) > 500 then
    raise exception 'inventory:notes_too_long' using errcode = '22023';
  end if;

  select * into v_row from public.inventory where product_id = p_product_id for update;
  if not found then
    raise exception 'inventory:not_found' using errcode = 'P0002';
  end if;

  if p_type = 'set' and p_expected_quantity is not null
     and p_expected_quantity <> v_row.quantity then
    raise exception 'inventory:conflict' using errcode = '40001';
  end if;

  v_new := case p_type
    when 'increase' then v_row.quantity::bigint + p_quantity
    when 'decrease' then v_row.quantity::bigint - p_quantity
    else p_quantity
  end;

  if v_new < 0 then
    raise exception 'inventory:below_zero' using errcode = '22023';
  end if;
  if v_new < v_row.reserved_quantity then
    raise exception 'inventory:below_reserved' using errcode = '22023';
  end if;
  if v_new > 2147483647 then
    raise exception 'inventory:too_large' using errcode = '22023';
  end if;
  if v_new = v_row.quantity then
    raise exception 'inventory:no_change' using errcode = '22023';
  end if;

  insert into public.inventory_adjustments (
    inventory_id, product_id, adjustment_type, quantity_before,
    adjustment_quantity, quantity_after, reason, notes, created_by
  ) values (
    v_row.id, v_row.product_id, p_type, v_row.quantity,
    (v_new - v_row.quantity)::integer, v_new::integer, p_reason, v_notes, auth.uid()
  );

  -- For a product with variants, inventory_pool_covers_variants refuses a
  -- pool below what the variants hold (inventory:below_allocated).
  update public.inventory set quantity = v_new::integer where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.adjust_inventory(
  uuid, public.inventory_adjustment_type, integer, public.inventory_adjustment_reason, text, integer
) from public, anon;
grant execute on function public.adjust_inventory(
  uuid, public.inventory_adjustment_type, integer, public.inventory_adjustment_reason, text, integer
) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Creating variants keeps the pool
-- ---------------------------------------------------------------------------

create or replace function public.generate_product_variants(
  p_product_id uuid,
  p_variants jsonb,
  p_stock_variant integer default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products%rowtype;
  v_had_variants boolean;
  v_quantity integer := 0;
  v_reserved integer := 0;
  -- The product's variant options: parallel arrays of (attribute, value).
  v_option_attributes uuid[];
  v_option_values uuid[];
  v_axes integer;
  v_sort integer;
  v_item jsonb;
  v_index integer;
  v_ids uuid[];
  v_variant_id uuid;
  v_target uuid;
  v_count integer := 0;
begin
  if not private.is_admin() then
    raise exception 'variant:forbidden' using errcode = '42501';
  end if;
  if jsonb_typeof(p_variants) is distinct from 'array' or jsonb_array_length(p_variants) = 0 then
    raise exception 'variant:invalid_combination' using errcode = '22023';
  end if;
  if jsonb_array_length(p_variants) > 500 then
    raise exception 'variant:too_many' using errcode = '22023';
  end if;

  select * into v_product from public.products where id = p_product_id for update;
  if not found then
    raise exception 'variant:not_found' using errcode = 'P0002';
  end if;

  v_had_variants := exists (select 1 from public.product_variants where product_id = p_product_id);
  -- The product's stock is the pool the variants share (migration 042).
  select quantity, reserved_quantity into v_quantity, v_reserved
  from public.inventory where product_id = p_product_id
  for update;
  v_quantity := coalesce(v_quantity, 0);
  v_reserved := coalesce(v_reserved, 0);

  -- Multi-value SELECT / COLOR attributes that create variants, with the
  -- values selected on the product.
  select coalesce(array_agg(pa.attribute_id), '{}'), coalesce(array_agg(pa.attribute_value_id), '{}')
  into v_option_attributes, v_option_values
  from public.product_attributes pa
  join public.attributes a on a.id = pa.attribute_id
  where pa.product_id = p_product_id
    and pa.attribute_value_id is not null
    and a.data_type in ('SELECT', 'COLOR')
    and a.allows_multiple
    and a.creates_variants;

  select count(distinct attribute_id) into v_axes
  from unnest(v_option_attributes) as o (attribute_id);
  if v_axes = 0 then
    raise exception 'variant:no_options' using errcode = '22023';
  end if;

  -- Optional: give the whole pool to one new variant (first variants only).
  -- Otherwise the units stay unallocated, to share out on the variants page.
  if p_stock_variant is not null then
    if v_had_variants or v_quantity = 0 then
      p_stock_variant := null;
    elsif v_reserved > 0 then
      raise exception 'variant:product_reserved' using errcode = '22023';
    elsif p_stock_variant < 0 or p_stock_variant >= jsonb_array_length(p_variants) then
      raise exception 'variant:stock_target_required' using errcode = '22023';
    end if;
  end if;

  select coalesce(max(sort_order), -1) into v_sort
  from public.product_variants where product_id = p_product_id;

  for v_item, v_index in
    select item, (ordinal - 1)::integer
    from jsonb_array_elements(p_variants) with ordinality as entries (item, ordinal)
  loop
    if jsonb_typeof(v_item -> 'value_ids') is distinct from 'array' then
      raise exception 'variant:invalid_combination' using errcode = '22023';
    end if;
    select array_agg(distinct value::uuid order by value::uuid) into v_ids
    from jsonb_array_elements_text(v_item -> 'value_ids') as ids (value);

    -- One allowed value per option, covering every option.
    if coalesce(array_length(v_ids, 1), 0) <> v_axes
       or (select count(distinct o.attribute_id)
           from unnest(v_option_attributes, v_option_values) as o (attribute_id, attribute_value_id)
           where o.attribute_value_id = any (v_ids)) <> v_axes
       or (select count(*)
           from unnest(v_option_attributes, v_option_values) as o (attribute_id, attribute_value_id)
           where o.attribute_value_id = any (v_ids)) <> v_axes then
      raise exception 'variant:invalid_combination' using errcode = '22023';
    end if;

    v_sort := v_sort + 1;
    insert into public.product_variants (
      product_id, sku, price, compare_at_price, sort_order, combination_key
    ) values (
      p_product_id,
      btrim(v_item ->> 'sku'),
      v_product.price,
      v_product.compare_at_price,
      v_sort,
      array_to_string(v_ids, ',')
    )
    returning id into v_variant_id;

    insert into public.variant_attribute_values (variant_id, attribute_id, attribute_value_id)
    select v_variant_id, o.attribute_id, o.attribute_value_id
    from unnest(v_option_attributes, v_option_values) as o (attribute_id, attribute_value_id)
    where o.attribute_value_id = any (v_ids);

    if v_index = p_stock_variant then
      v_target := v_variant_id;
    end if;
    v_count := v_count + 1;
  end loop;

  -- Allocate the pool to the chosen variant (the pool itself is unchanged).
  if v_target is not null then
    update public.variant_inventory set quantity = v_quantity where variant_id = v_target;
    insert into public.inventory_adjustments (
      variant_id, product_id, adjustment_type, quantity_before,
      adjustment_quantity, quantity_after, reason, notes, created_by
    ) values (
      v_target, p_product_id, 'increase', 0,
      v_quantity, v_quantity, 'variant_migration', null, auth.uid()
    );
  end if;

  return v_count;
end;
$$;

revoke all on function public.generate_product_variants(uuid, jsonb, integer) from public, anon;
grant execute on function public.generate_product_variants(uuid, jsonb, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Storefront: a product with variants sells what its variants can sell
-- ---------------------------------------------------------------------------

-- Sellable units of a product: its own stock (simple product), or the sum
-- over its purchasable variants (never the unallocated part of the pool).
create or replace function private.product_sellable_units(p_product_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (select 1 from public.product_variants v where v.product_id = p_product_id) then (
      select coalesce(sum(greatest(vi.quantity - vi.reserved_quantity, 0)), 0)
      from public.product_variants v
      join public.variant_inventory vi on vi.variant_id = v.id
      where v.product_id = p_product_id and private.variant_purchasable(v.id)
    )
    else (
      select coalesce(greatest(i.quantity - i.reserved_quantity, 0), 0)
      from public.inventory i where i.product_id = p_product_id
    )
  end;
$$;

revoke all on function private.product_sellable_units(uuid) from public, anon, authenticated;

create or replace function public.product_availability(p_product_ids uuid[])
returns table (product_id uuid, available boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, coalesce(private.product_sellable_units(p.id) > 0, false)
  from public.products p
  where p.is_active
    and p.id = any (p_product_ids[1:100]);
$$;

revoke all on function public.product_availability(uuid[]) from public;
grant execute on function public.product_availability(uuid[]) to anon, authenticated;

create or replace function public.product_stock_limit(p_product_ids uuid[])
returns table (product_id uuid, max_quantity integer)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, least(coalesce(private.product_sellable_units(p.id), 0), 99)::integer
  from public.products p
  where p.is_active
    and p.id = any (p_product_ids[1:100]);
$$;

revoke all on function public.product_stock_limit(uuid[]) from public;
grant execute on function public.product_stock_limit(uuid[]) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Admin overview: allocated / unallocated per product (appended columns)
-- ---------------------------------------------------------------------------

create or replace view public.inventory_overview
with (security_invoker = true)
as
select
  p.id as product_id,
  p.name,
  p.sku,
  p.is_active as product_active,
  p.category_id,
  c.name as category_name,
  (
    select pi.public_url
    from public.product_images pi
    where pi.product_id = p.id and pi.is_primary
    limit 1
  ) as image_url,
  i.id as inventory_id,
  i.quantity,
  i.reserved_quantity,
  i.quantity - i.reserved_quantity as available_quantity,
  i.low_stock_threshold,
  case
    when i.id is null then 'unconfigured'
    when i.quantity - i.reserved_quantity <= 0 then 'out_of_stock'
    when i.quantity - i.reserved_quantity <= i.low_stock_threshold then 'low_stock'
    else 'in_stock'
  end as stock_status,
  i.updated_at,
  (select count(*) from public.product_variants v where v.product_id = p.id)::integer
    as variant_count,
  coalesce(va.low_stock, 0) as variant_low_stock,
  coalesce(va.out_of_stock, 0) as variant_out_of_stock,
  coalesce(va.low_stock + va.out_of_stock, 0) as variant_alerts,
  va.skus as variant_skus,
  -- Products with variants: units held by variants, and what's left to share.
  coalesce(va.allocated, 0) as allocated_quantity,
  case when va.skus is not null then coalesce(i.quantity, 0) - coalesce(va.allocated, 0) end
    as unallocated_quantity
from public.products p
left join public.inventory i on i.product_id = p.id
left join public.categories c on c.id = p.category_id
left join lateral (
  select
    (count(*) filter (
      where v.is_active
        and vi.quantity - vi.reserved_quantity > 0
        and vi.quantity - vi.reserved_quantity <= vi.low_stock_threshold
    ))::integer as low_stock,
    (count(*) filter (
      where v.is_active and vi.quantity - vi.reserved_quantity <= 0
    ))::integer as out_of_stock,
    string_agg(v.sku, ' ') as skus,
    coalesce(sum(vi.quantity), 0)::integer as allocated
  from public.product_variants v
  left join public.variant_inventory vi on vi.variant_id = v.id
  where v.product_id = p.id
) va on true
where (select private.is_admin());

revoke all on public.inventory_overview from anon, authenticated;
grant select on public.inventory_overview to authenticated;
