-- 024 · Product variants & variant inventory (Phase 18)
--
-- Variants are generated from a product's multi-value SELECT / COLOR
-- attributes (migration 023): Size {S, M} × Colour {Red, Blue} → 4 variants.
--
--   product_variants          SKU, price, compare-at, image, active, order
--   variant_attribute_values  the variant's value per attribute (immutable)
--   variant_inventory         stock per variant (quantity, reserved, threshold)
--   inventory_adjustments     + variant_id: one audit history for both levels
--
-- Simple products (no variants) keep using `inventory` exactly as before.
-- For a product WITH variants, its `inventory` row becomes derived: quantity
-- and reserved are the sums over its active variants, kept in sync by
-- triggers. The storefront's product_availability() and checkout (016/017)
-- therefore keep working unchanged, and adjust_inventory() refuses manual
-- product-level changes for such products.
--
-- Existing stock is never dropped: when a product gets its first variants,
-- generate_product_variants() moves the product's units onto a variant the
-- admin chose, in the same transaction, and records it in the history.
--
-- Cart, checkout, payments and orders are not changed.
-- Access: active admins only. Safe to re-run.

-- ---------------------------------------------------------------------------
-- 0. Audit reason for stock moved onto a variant
-- ---------------------------------------------------------------------------
-- Only used inside PL/pgSQL bodies below (evaluated at run time), so it is
-- safe to add in the same transaction.
alter type public.inventory_adjustment_reason add value if not exists 'variant_migration';

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

-- Target for the variant image FK (an image must belong to the same product).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'product_images_product_id_id_key'
  ) then
    alter table public.product_images
      add constraint product_images_product_id_id_key unique (product_id, id);
  end if;
end;
$$;

create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  -- Same rule as products.sku; unique case-insensitively, and never equal to
  -- any product's SKU (trigger below).
  sku text not null check (sku ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  -- In the product's currency (products.currency_code).
  price public.money_amount not null,
  compare_at_price public.money_amount,
  image_id uuid,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  -- The variant's attribute_value ids, sorted, joined with ','. Set once by
  -- generate_product_variants(); makes duplicate combinations impossible.
  combination_key text not null
    check (combination_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(,[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})*$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_variants_compare_at_price_gt_price
    check (compare_at_price is null or compare_at_price > price),
  constraint product_variants_combination_key unique (product_id, combination_key),
  -- Deleting the image only clears image_id (the variant stays).
  constraint product_variants_image_fkey foreign key (product_id, image_id)
    references public.product_images (product_id, id) on delete set null (image_id)
);

create unique index if not exists product_variants_sku_key
  on public.product_variants (upper(sku));
create index if not exists product_variants_product_id_idx
  on public.product_variants (product_id, sort_order);

create table if not exists public.variant_attribute_values (
  variant_id uuid not null references public.product_variants (id) on delete cascade,
  attribute_id uuid not null references public.attributes (id) on delete restrict,
  attribute_value_id uuid not null,
  primary key (variant_id, attribute_id),
  constraint variant_attribute_values_value_fkey foreign key (attribute_id, attribute_value_id)
    references public.attribute_values (attribute_id, id) on delete restrict
);

create index if not exists variant_attribute_values_value_idx
  on public.variant_attribute_values (attribute_value_id);

create table if not exists public.variant_inventory (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null unique references public.product_variants (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  quantity integer not null default 0 check (quantity >= 0),
  reserved_quantity integer not null default 0 check (reserved_quantity >= 0),
  low_stock_threshold integer not null default 0 check (low_stock_threshold >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint variant_inventory_reserved_lte_quantity check (reserved_quantity <= quantity)
);

create index if not exists variant_inventory_product_id_idx
  on public.variant_inventory (product_id);

-- One history for product- and variant-level stock: exactly one target.
alter table public.inventory_adjustments
  add column if not exists variant_id uuid
    references public.product_variants (id) on delete restrict;
alter table public.inventory_adjustments alter column inventory_id drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'inventory_adjustments_one_target'
  ) then
    alter table public.inventory_adjustments
      add constraint inventory_adjustments_one_target
        check (num_nonnulls(inventory_id, variant_id) = 1);
  end if;
end;
$$;

create index if not exists inventory_adjustments_variant_created_idx
  on public.inventory_adjustments (variant_id, created_at desc)
  where variant_id is not null;

-- Case-insensitive SKU lookups across products and variants.
create index if not exists products_sku_upper_idx on public.products (upper(sku));

alter table public.product_variants enable row level security;
alter table public.variant_attribute_values enable row level security;
alter table public.variant_inventory enable row level security;

drop trigger if exists product_variants_set_updated_at on public.product_variants;
create trigger product_variants_set_updated_at
  before update on public.product_variants
  for each row execute function private.set_updated_at();

drop trigger if exists variant_inventory_set_updated_at on public.variant_inventory;
create trigger variant_inventory_set_updated_at
  before update on public.variant_inventory
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Triggers
-- ---------------------------------------------------------------------------

-- SKUs are unique across products and variants. The advisory lock (same key
-- in both tables) serialises concurrent writers of the same SKU, so the
-- cross-table check can't race.
create or replace function private.check_sku_across_catalogue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('mirna-sku:' || upper(new.sku)));
  if tg_table_name = 'product_variants' then
    if exists (select 1 from public.products where upper(sku) = upper(new.sku)) then
      raise exception 'sku:taken' using errcode = '23505', detail = 'products_sku_key';
    end if;
  elsif exists (
    select 1 from public.product_variants where upper(sku) = upper(new.sku)
  ) then
    raise exception 'sku:taken' using errcode = '23505', detail = 'product_variants_sku_key';
  end if;
  return new;
end;
$$;

drop trigger if exists product_variants_check_sku on public.product_variants;
create trigger product_variants_check_sku
  before insert or update of sku on public.product_variants
  for each row execute function private.check_sku_across_catalogue();

drop trigger if exists products_check_variant_sku on public.products;
create trigger products_check_variant_sku
  before insert or update of sku on public.products
  for each row execute function private.check_sku_across_catalogue();

-- Every variant gets a stock row (quantity 0).
create or replace function private.create_variant_inventory()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.variant_inventory (variant_id, product_id)
  values (new.id, new.product_id)
  on conflict (variant_id) do nothing;
  return new;
end;
$$;

drop trigger if exists product_variants_create_inventory on public.product_variants;
create trigger product_variants_create_inventory
  after insert on public.product_variants
  for each row execute function private.create_variant_inventory();

-- A variant with stock (or reserved units) can't be deleted: deactivate it.
create or replace function private.product_variants_guard_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.variant_inventory
    where variant_id = old.id and (quantity > 0 or reserved_quantity > 0)
  ) then
    raise exception 'variant:has_stock' using errcode = '23514';
  end if;
  return old;
end;
$$;

drop trigger if exists product_variants_guard_delete on public.product_variants;
create trigger product_variants_guard_delete
  before delete on public.product_variants
  for each row execute function private.product_variants_guard_delete();

-- Product-level stock of a product with variants = sums over active variants.
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
  insert into public.inventory as i (product_id, quantity, reserved_quantity)
  select p_product_id,
         coalesce(sum(vi.quantity) filter (where v.is_active), 0),
         coalesce(sum(vi.reserved_quantity) filter (where v.is_active), 0)
  from public.product_variants v
  left join public.variant_inventory vi on vi.variant_id = v.id
  where v.product_id = p_product_id
  on conflict (product_id) do update
    set quantity = excluded.quantity, reserved_quantity = excluded.reserved_quantity
    where (i.quantity, i.reserved_quantity)
      is distinct from (excluded.quantity, excluded.reserved_quantity);
end;
$$;

create or replace function private.variant_inventory_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.sync_product_inventory(
    case when tg_op = 'DELETE' then old.product_id else new.product_id end
  );
  return null;
end;
$$;

drop trigger if exists variant_inventory_sync on public.variant_inventory;
create trigger variant_inventory_sync
  after insert or delete or update of quantity, reserved_quantity on public.variant_inventory
  for each row execute function private.variant_inventory_sync();

drop trigger if exists product_variants_sync on public.product_variants;
create trigger product_variants_sync
  after update of is_active on public.product_variants
  for each row execute function private.variant_inventory_sync();

-- An attribute used by variants keeps its data type (023 locked it only for
-- product values).
create or replace function private.attributes_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.data_type is distinct from old.data_type then
    if exists (select 1 from public.product_attributes where attribute_id = old.id)
       or exists (select 1 from public.variant_attribute_values where attribute_id = old.id) then
      raise exception 'attribute:type_locked' using errcode = '23514';
    end if;
    if new.data_type not in ('SELECT', 'COLOR') then
      delete from public.attribute_values where attribute_id = old.id;
    end if;
  end if;
  if old.allows_multiple and not new.allows_multiple and exists (
    select 1 from public.product_attributes
    where attribute_id = old.id
    group by product_id
    having count(*) > 1
  ) then
    raise exception 'attribute:multiple_in_use' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.check_sku_across_catalogue() from public, anon, authenticated;
revoke all on function private.create_variant_inventory() from public, anon, authenticated;
revoke all on function private.product_variants_guard_delete() from public, anon, authenticated;
revoke all on function private.sync_product_inventory(uuid) from public, anon, authenticated;
revoke all on function private.variant_inventory_sync() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Functions
-- ---------------------------------------------------------------------------

-- Creates variants for chosen combinations. p_variants:
--   [{"value_ids": [uuid, …], "sku": text}, …]
-- Each combination must take exactly one value from every variant option of
-- the product (its multi-value SELECT / COLOR attributes, using the values
-- selected on the product). Price and compare-at start from the product.
-- Existing variants are never changed; an existing combination or SKU makes
-- the whole call fail (nothing is half-created).
--
-- First variants of a product that has stock: p_stock_variant (0-based index
-- into p_variants) receives the product's units, recorded in the history as
-- 'variant_migration'. Units reserved at product level can't be moved.
--
-- SECURITY DEFINER because API roles have no INSERT grant on variants (so
-- combinations can only be created consistently, here); is_admin() is the
-- authorization and auth.uid() the acting admin.
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
  -- Read before inserting: the first variant makes the product row derived.
  select coalesce(quantity, 0), coalesce(reserved_quantity, 0) into v_quantity, v_reserved
  from public.inventory where product_id = p_product_id
  for update;
  v_quantity := coalesce(v_quantity, 0);
  v_reserved := coalesce(v_reserved, 0);

  -- The product's variant options and their allowed values.
  create temporary table if not exists pg_temp.variant_options (
    attribute_id uuid, attribute_value_id uuid
  ) on commit drop;
  delete from pg_temp.variant_options;
  insert into pg_temp.variant_options
  select pa.attribute_id, pa.attribute_value_id
  from public.product_attributes pa
  join public.attributes a on a.id = pa.attribute_id
  where pa.product_id = p_product_id
    and pa.attribute_value_id is not null
    and a.data_type in ('SELECT', 'COLOR')
    and a.allows_multiple;

  select count(distinct attribute_id) into v_axes from pg_temp.variant_options;
  if v_axes = 0 then
    raise exception 'variant:no_options' using errcode = '22023';
  end if;

  if not v_had_variants and v_quantity > 0 then
    if v_reserved > 0 then
      raise exception 'variant:product_reserved' using errcode = '22023';
    end if;
    if p_stock_variant is null or p_stock_variant < 0
       or p_stock_variant >= jsonb_array_length(p_variants) then
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
       or (select count(distinct o.attribute_id) from pg_temp.variant_options o
           where o.attribute_value_id = any (v_ids)) <> v_axes
       or (select count(*) from pg_temp.variant_options o
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
    from pg_temp.variant_options o
    where o.attribute_value_id = any (v_ids);

    if v_index = p_stock_variant then
      v_target := v_variant_id;
    end if;
    v_count := v_count + 1;
  end loop;

  -- Move the product's existing units onto the chosen variant (the product
  -- row is recomputed to the same total by the sync trigger).
  if not v_had_variants and v_quantity > 0 then
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

-- Atomic manual stock adjustment for one variant (same rules and error codes
-- as adjust_inventory()). SECURITY DEFINER: API roles can't write quantities.
create or replace function public.adjust_variant_inventory(
  p_variant_id uuid,
  p_type public.inventory_adjustment_type,
  p_quantity integer,
  p_reason public.inventory_adjustment_reason,
  p_notes text default null,
  p_expected_quantity integer default null
)
returns public.variant_inventory
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.variant_inventory;
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

  select * into v_row from public.variant_inventory where variant_id = p_variant_id for update;
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
    variant_id, product_id, adjustment_type, quantity_before,
    adjustment_quantity, quantity_after, reason, notes, created_by
  ) values (
    v_row.variant_id, v_row.product_id, p_type, v_row.quantity,
    (v_new - v_row.quantity)::integer, v_new::integer, p_reason, v_notes, auth.uid()
  );

  update public.variant_inventory set quantity = v_new::integer where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;

-- adjust_inventory() (015) unchanged, except: a product with variants has a
-- derived product-level row, so manual changes there are refused.
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
  if exists (select 1 from public.product_variants where product_id = p_product_id) then
    raise exception 'inventory:has_variants' using errcode = '22023';
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

  update public.inventory set quantity = v_new::integer where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.generate_product_variants(uuid, jsonb, integer) from public, anon;
revoke all on function public.adjust_variant_inventory(
  uuid, public.inventory_adjustment_type, integer, public.inventory_adjustment_reason, text, integer
) from public, anon;
grant execute on function public.generate_product_variants(uuid, jsonb, integer) to authenticated;
grant execute on function public.adjust_variant_inventory(
  uuid, public.inventory_adjustment_type, integer, public.inventory_adjustment_reason, text, integer
) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Views (security_invoker + is_admin() filter, like inventory_overview)
-- ---------------------------------------------------------------------------

-- inventory_overview (015) + variant_count (new last column; nothing removed).
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
    as variant_count
from public.products p
left join public.inventory i on i.product_id = p.id
left join public.categories c on c.id = p.category_id
where (select private.is_admin());

-- One row per variant: label ("M / Red", options in the product type's order),
-- image, prices, stock and derived status.
create or replace view public.variant_inventory_overview
with (security_invoker = true)
as
select
  v.id as variant_id,
  v.product_id,
  v.sku,
  v.price,
  v.compare_at_price,
  p.currency_code,
  v.is_active,
  p.is_active as product_active,
  v.image_id,
  img.public_url as image_url,
  v.sort_order,
  v.combination_key,
  (
    select string_agg(av.value, ' / ' order by coalesce(pta.sort_order, 2147483647), a.name)
    from public.variant_attribute_values vav
    join public.attribute_values av on av.id = vav.attribute_value_id
    join public.attributes a on a.id = vav.attribute_id
    left join public.product_type_attributes pta
      on pta.product_type_id = p.product_type_id and pta.attribute_id = vav.attribute_id
    where vav.variant_id = v.id
  ) as label,
  vi.id as inventory_id,
  vi.quantity,
  vi.reserved_quantity,
  vi.quantity - vi.reserved_quantity as available_quantity,
  vi.low_stock_threshold,
  case
    when vi.id is null then 'unconfigured'
    when vi.quantity - vi.reserved_quantity <= 0 then 'out_of_stock'
    when vi.quantity - vi.reserved_quantity <= vi.low_stock_threshold then 'low_stock'
    else 'in_stock'
  end as stock_status,
  v.updated_at,
  vi.updated_at as stock_updated_at
from public.product_variants v
join public.products p on p.id = v.product_id
left join public.variant_inventory vi on vi.variant_id = v.id
left join public.product_images img on img.id = v.image_id
where (select private.is_admin());

revoke all on public.variant_inventory_overview from anon, authenticated;
grant select on public.inventory_overview, public.variant_inventory_overview to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Grants (least privilege) and admin-only RLS
-- ---------------------------------------------------------------------------
-- Variants are created only by generate_product_variants(); combinations are
-- immutable; stock changes only through adjust_variant_inventory().

revoke all on table
  public.product_variants,
  public.variant_attribute_values,
  public.variant_inventory
from anon, authenticated;

grant select, delete on table public.product_variants to authenticated;
grant update (sku, price, compare_at_price, image_id, is_active, sort_order)
  on table public.product_variants to authenticated;
grant select on table public.variant_attribute_values to authenticated;
grant select on table public.variant_inventory to authenticated;
grant update (low_stock_threshold) on table public.variant_inventory to authenticated;

grant select, insert, update, delete on table
  public.product_variants,
  public.variant_attribute_values,
  public.variant_inventory
to service_role;

drop policy if exists product_variants_select_admin on public.product_variants;
create policy product_variants_select_admin on public.product_variants
  for select to authenticated using ((select private.is_admin()));
drop policy if exists product_variants_update_admin on public.product_variants;
create policy product_variants_update_admin on public.product_variants
  for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
drop policy if exists product_variants_delete_admin on public.product_variants;
create policy product_variants_delete_admin on public.product_variants
  for delete to authenticated using ((select private.is_admin()));

drop policy if exists variant_attribute_values_select_admin on public.variant_attribute_values;
create policy variant_attribute_values_select_admin on public.variant_attribute_values
  for select to authenticated using ((select private.is_admin()));

drop policy if exists variant_inventory_select_admin on public.variant_inventory;
create policy variant_inventory_select_admin on public.variant_inventory
  for select to authenticated using ((select private.is_admin()));
drop policy if exists variant_inventory_update_admin on public.variant_inventory;
create policy variant_inventory_update_admin on public.variant_inventory
  for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
