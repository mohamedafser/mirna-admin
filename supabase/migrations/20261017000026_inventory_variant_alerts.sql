-- 026 · Inventory list: variant alerts and variant SKU search
--
-- A product with variants shows the total of its active variants, so one
-- sold-out size could hide behind a healthy total. This migration appends
-- per-product variant counts to inventory_overview (new last columns; nothing
-- removed or renamed) and adds a summary function for them:
--
--   variant_low_stock     active variants that are low on stock
--   variant_out_of_stock  active variants that are out of stock
--   variant_alerts        the two added (filterable in one condition)
--   variant_skus          every variant SKU, space-separated (search only)
--
--   inventory_variant_summary(p_include_inactive)  totals for the page tiles
--
-- Both stay admin-only: the view keeps security_invoker + is_admin(), and the
-- function is SECURITY INVOKER over that view. Additive, safe to re-run.

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
  va.skus as variant_skus
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
    string_agg(v.sku, ' ') as skus
  from public.product_variants v
  left join public.variant_inventory vi on vi.variant_id = v.id
  where v.product_id = p.id
) va on true
where (select private.is_admin());

revoke all on public.inventory_overview from anon, authenticated;
grant select on public.inventory_overview to authenticated;

-- Variant totals for the inventory page tiles, in one query.
create or replace function public.inventory_variant_summary(
  p_include_inactive boolean default false
)
returns table (
  products_with_alerts bigint,
  low_stock_variants bigint,
  out_of_stock_variants bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    count(*) filter (where variant_alerts > 0),
    coalesce(sum(variant_low_stock), 0),
    coalesce(sum(variant_out_of_stock), 0)
  from public.inventory_overview
  where p_include_inactive or product_active;
$$;

revoke all on function public.inventory_variant_summary(boolean) from public, anon;
grant execute on function public.inventory_variant_summary(boolean) to authenticated;
