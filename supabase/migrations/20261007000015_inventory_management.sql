-- 015 · Inventory management (Phase 4)
--
-- Builds on 007 (one `inventory` row per product, auto-created by trigger,
-- quantity >= reserved_quantity >= 0). Adds:
--   1. inventory.low_stock_threshold
--   2. inventory_adjustments — append-only history of manual stock changes
--   3. Tightened grants: admins may update ONLY low_stock_threshold directly.
--      Stock quantities change exclusively through adjust_inventory(), which
--      locks the row, validates, updates and writes history in one
--      transaction. Future order/checkout functions will change
--      reserved_quantity the same way (SECURITY DEFINER, server-side).
--   4. inventory_overview — admin-only view (products ⟕ inventory) with
--      available quantity and stock status derived from the stored numbers
--      (nothing duplicated), so lists can search/filter/paginate in SQL.
--   5. inventory_summary(), initialize_inventory()
--
-- available_quantity = quantity - reserved_quantity (never stored).
-- stock status:
--   unconfigured  no inventory row
--   out_of_stock  available <= 0
--   low_stock     0 < available <= low_stock_threshold
--   in_stock      available > low_stock_threshold

-- ---------------------------------------------------------------------------
-- 1. Low-stock threshold
-- ---------------------------------------------------------------------------
alter table public.inventory
  add column low_stock_threshold integer not null default 0
    constraint inventory_low_stock_threshold_check check (low_stock_threshold >= 0);

-- ---------------------------------------------------------------------------
-- 2. Adjustment history
-- ---------------------------------------------------------------------------
create type public.inventory_adjustment_type as enum ('increase', 'decrease', 'set');

create type public.inventory_adjustment_reason as enum (
  'stock_received',
  'stock_count_correction',
  'damaged',
  'lost',
  'returned',
  'manual_correction',
  'other'
);

-- Each row records what happened at that moment; rows are never updated.
-- ON DELETE RESTRICT keeps history from being removed with its product.
create table public.inventory_adjustments (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid not null references public.inventory (id) on delete restrict,
  product_id uuid not null references public.products (id) on delete restrict,
  adjustment_type public.inventory_adjustment_type not null,
  quantity_before integer not null check (quantity_before >= 0),
  -- Signed change actually applied (+10, -5). For "set" it is computed.
  adjustment_quantity integer not null check (adjustment_quantity <> 0),
  quantity_after integer not null check (quantity_after >= 0),
  reason public.inventory_adjustment_reason not null,
  notes text check (char_length(notes) <= 500),
  -- The admin, taken from the session (auth.uid()) inside adjust_inventory().
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint inventory_adjustments_math check (quantity_after = quantity_before + adjustment_quantity),
  constraint inventory_adjustments_other_needs_notes check (reason <> 'other' or notes is not null)
);

alter table public.inventory_adjustments enable row level security;

-- History of one product, newest first (the only history query).
create index inventory_adjustments_product_created_idx
  on public.inventory_adjustments (product_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. Grants and policies
-- ---------------------------------------------------------------------------
-- Inventory rows are created by triggers / initialize_inventory(); quantities
-- change only through adjust_inventory(). Direct writes are limited to the
-- threshold (RLS policy inventory_update_admin still requires an admin).
revoke insert, update on table public.inventory from authenticated;
grant update (low_stock_threshold) on table public.inventory to authenticated;

-- History: admins read it; nobody writes it directly (append-only via function).
revoke all on table public.inventory_adjustments from anon, authenticated;
grant select on table public.inventory_adjustments to authenticated;

create policy inventory_adjustments_select_admin on public.inventory_adjustments
  for select to authenticated
  using ((select private.is_admin()));

-- ---------------------------------------------------------------------------
-- 4. Overview view
-- ---------------------------------------------------------------------------
-- security_invoker: the caller's RLS applies to every underlying table, and
-- the is_admin() filter returns nothing to anyone else.
create view public.inventory_overview
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
  i.updated_at
from public.products p
left join public.inventory i on i.product_id = p.id
left join public.categories c on c.id = p.category_id
where (select private.is_admin());

revoke all on public.inventory_overview from anon, authenticated;
grant select on public.inventory_overview to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Functions
-- ---------------------------------------------------------------------------

-- Summary counts for the inventory page, in one query.
create or replace function public.inventory_summary(p_include_inactive boolean default false)
returns table (
  total_products bigint,
  in_stock bigint,
  low_stock bigint,
  out_of_stock bigint,
  unconfigured bigint,
  total_units bigint,
  reserved_units bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    count(*),
    count(*) filter (where stock_status = 'in_stock'),
    count(*) filter (where stock_status = 'low_stock'),
    count(*) filter (where stock_status = 'out_of_stock'),
    count(*) filter (where stock_status = 'unconfigured'),
    coalesce(sum(quantity), 0),
    coalesce(sum(reserved_quantity), 0)
  from public.inventory_overview
  where p_include_inactive or product_active;
$$;

-- Atomic manual stock adjustment.
-- SECURITY DEFINER because API roles cannot write quantities directly; the
-- explicit is_admin() check is therefore the authorization. The acting admin
-- comes from auth.uid() (the verified session), never from a parameter.
-- Errors use messages prefixed "inventory:" that the app maps to safe text.
create or replace function public.adjust_inventory(
  p_product_id uuid,
  p_type public.inventory_adjustment_type,
  p_quantity integer,
  p_reason public.inventory_adjustment_reason,
  p_notes text default null,
  -- For "set": the quantity the admin saw. A different current value means
  -- someone else changed the stock meanwhile → refuse instead of overwriting.
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
  if p_reason = 'other' and v_notes is null then
    raise exception 'inventory:notes_required' using errcode = '22023';
  end if;
  if char_length(v_notes) > 500 then
    raise exception 'inventory:notes_too_long' using errcode = '22023';
  end if;

  -- Lock the row: concurrent adjustments queue up instead of overwriting.
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

-- Creates missing inventory rows (one product, or all when p_product_id is
-- null). Explicit admin action — lists never create rows as a side effect.
create or replace function public.initialize_inventory(p_product_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not private.is_admin() then
    raise exception 'inventory:forbidden' using errcode = '42501';
  end if;

  insert into public.inventory (product_id)
  select p.id
  from public.products p
  where (p_product_id is null or p.id = p_product_id)
    and not exists (select 1 from public.inventory i where i.product_id = p.id)
  on conflict (product_id) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.inventory_summary(boolean) from public, anon;
revoke all on function public.adjust_inventory(
  uuid, public.inventory_adjustment_type, integer, public.inventory_adjustment_reason, text, integer
) from public, anon;
revoke all on function public.initialize_inventory(uuid) from public, anon;
grant execute on function public.inventory_summary(boolean) to authenticated;
grant execute on function public.adjust_inventory(
  uuid, public.inventory_adjustment_type, integer, public.inventory_adjustment_reason, text, integer
) to authenticated;
grant execute on function public.initialize_inventory(uuid) to authenticated;
