-- 041 · Batch stock updates
--
-- adjust_stock_batch() applies one adjustment type, reason and note to many
-- products and variants in ONE transaction (Admin → Update stock: receiving a
-- delivery, a stock count, writing off damaged goods). Each line goes through
-- the existing adjust_inventory() / adjust_variant_inventory(), so the rules
-- (admin only, never below zero or below reserved, "set" conflict check) and
-- the history rows (inventory_adjustments, by auth.uid()) are exactly those of
-- a single adjustment. Any failing line rolls everything back and is reported
-- as "inventory:item:<index>:<code>" (index from 0).
--
-- p_items: [{"product_id": …, "variant_id": … | null, "quantity": 12,
--            "expected_quantity": 10 | null}, …]  (1–200 lines, no duplicates)
-- For "set", a line whose quantity equals its expected_quantity is skipped
-- (counted, nothing to change). Returns the number of adjustments made.
--
-- Requires migrations 015 and 024. Safe to re-run.

create or replace function public.adjust_stock_batch(
  p_type public.inventory_adjustment_type,
  p_reason public.inventory_adjustment_reason,
  p_notes text,
  p_items jsonb
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item jsonb;
  v_index integer := -1;
  v_product uuid;
  v_variant uuid;
  v_quantity integer;
  v_expected integer;
  v_count integer := 0;
  v_code text;
begin
  if not private.is_admin() then
    raise exception 'inventory:forbidden' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_items, 'null')) <> 'array'
     or jsonb_array_length(p_items) not between 1 and 200 then
    raise exception 'inventory:invalid_batch' using errcode = '22023';
  end if;
  -- The same product (no variant) or variant twice would be ambiguous.
  if (
    select count(*) <> count(distinct coalesce(e ->> 'variant_id', e ->> 'product_id'))
    from jsonb_array_elements(p_items) e
  ) then
    raise exception 'inventory:duplicate' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_index := v_index + 1;
    begin
      v_product := (v_item ->> 'product_id')::uuid;
      v_variant := nullif(v_item ->> 'variant_id', '')::uuid;
      v_quantity := (v_item ->> 'quantity')::integer;
      v_expected := nullif(v_item ->> 'expected_quantity', '')::integer;

      if p_type = 'set' and v_expected is not null and v_quantity = v_expected then
        continue;
      end if;

      if v_variant is null then
        perform public.adjust_inventory(
          v_product, p_type, v_quantity, p_reason, p_notes,
          case when p_type = 'set' then v_expected end
        );
      else
        perform public.adjust_variant_inventory(
          v_variant, p_type, v_quantity, p_reason, p_notes,
          case when p_type = 'set' then v_expected end
        );
      end if;
      v_count := v_count + 1;
    exception when others then
      -- "inventory:below_reserved" → "below_reserved"; anything else as is.
      v_code := case when sqlerrm like 'inventory:%' then substr(sqlerrm, 11) else sqlstate end;
      raise exception 'inventory:item:%:%', v_index, v_code using errcode = sqlstate;
    end;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.adjust_stock_batch(
  public.inventory_adjustment_type, public.inventory_adjustment_reason, text, jsonb
) from public, anon;
grant execute on function public.adjust_stock_batch(
  public.inventory_adjustment_type, public.inventory_adjustment_reason, text, jsonb
) to authenticated;
