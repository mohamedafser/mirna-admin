-- 032 · Delete variants that have stock or stock history
--
-- Until now a variant could only be deleted with no stock (trigger) and no
-- stock history (inventory_adjustments.variant_id ON DELETE RESTRICT), so
-- variants left over after an option change were stuck. This migration:
--
--   inventory_adjustments.variant_sku   SKU snapshot of a deleted variant;
--                                        its history rows are kept (variant_id
--                                        set to null) and still listed under
--                                        the product
--   reason 'variant_deleted'             the final "set to 0" adjustment
--   delete_product_variants(...)         clears stock (recorded in history)
--                                        and deletes, in one transaction
--
-- Variants with reserved units are never deleted (skipped). Additive, safe
-- to re-run.

alter type public.inventory_adjustment_reason add value if not exists 'variant_deleted';

alter table public.inventory_adjustments add column if not exists variant_sku text;

-- History of a deleted variant has no target left, only its SKU snapshot.
alter table public.inventory_adjustments drop constraint if exists inventory_adjustments_one_target;
alter table public.inventory_adjustments
  add constraint inventory_adjustments_one_target check (
    num_nonnulls(inventory_id, variant_id) = 1
    or (inventory_id is null and variant_id is null and variant_sku is not null)
  );

alter table public.inventory_adjustments
  drop constraint if exists inventory_adjustments_variant_id_fkey;
alter table public.inventory_adjustments
  add constraint inventory_adjustments_variant_id_fkey
    foreign key (variant_id) references public.product_variants (id) on delete set null;

-- Deletes some of a product's variants. With p_clear_stock, a variant's
-- on-hand units are first set to 0 (one 'variant_deleted' history row);
-- without it, variants with stock are skipped. Variants with reserved units
-- are always skipped. Returns {"deleted": n, "skipped": n}.
-- SECURITY DEFINER: API roles can't write quantities or history.
create or replace function public.delete_product_variants(
  p_product_id uuid,
  p_variant_ids uuid[],
  p_clear_stock boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_deleted integer := 0;
  v_skipped integer := 0;
begin
  if not private.is_admin() then
    raise exception 'variant:forbidden' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_variant_ids), 0) = 0 then
    raise exception 'variant:not_found' using errcode = 'P0002';
  end if;
  if cardinality(p_variant_ids) > 500 then
    raise exception 'variant:too_many' using errcode = '22023';
  end if;

  for v_row in
    select v.id, v.sku, vi.id as inventory_id, coalesce(vi.quantity, 0) as quantity,
           coalesce(vi.reserved_quantity, 0) as reserved
    from public.product_variants v
    left join public.variant_inventory vi on vi.variant_id = v.id
    where v.product_id = p_product_id and v.id = any (p_variant_ids)
    order by v.id
    for update of v
  loop
    if v_row.reserved > 0 or (v_row.quantity > 0 and not p_clear_stock) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if v_row.quantity > 0 then
      insert into public.inventory_adjustments (
        variant_id, product_id, adjustment_type, quantity_before,
        adjustment_quantity, quantity_after, reason, created_by
      ) values (
        v_row.id, p_product_id, 'set', v_row.quantity,
        -v_row.quantity, 0, 'variant_deleted', auth.uid()
      );
      update public.variant_inventory set quantity = 0 where id = v_row.inventory_id;
    end if;

    -- Keep the history readable once variant_id is set to null.
    update public.inventory_adjustments set variant_sku = v_row.sku where variant_id = v_row.id;
    delete from public.product_variants where id = v_row.id;
    v_deleted := v_deleted + 1;
  end loop;

  return jsonb_build_object('deleted', v_deleted, 'skipped', v_skipped);
end;
$$;

revoke all on function public.delete_product_variants(uuid, uuid[], boolean) from public, anon;
grant execute on function public.delete_product_variants(uuid, uuid[], boolean) to authenticated;
