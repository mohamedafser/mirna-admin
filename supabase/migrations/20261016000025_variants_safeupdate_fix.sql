-- 025 · Fix generate_product_variants() under pg-safeupdate
--
-- Supabase loads pg-safeupdate for API requests, which rejects any DELETE or
-- UPDATE without a WHERE clause ("21000: DELETE requires a WHERE clause"),
-- including statements inside functions. The 024 version reset a temporary
-- table with a bare DELETE, so every call through the API failed.
--
-- This version keeps the product's variant options in two local arrays
-- instead (no temporary table, nothing to clear). Behaviour, arguments,
-- errors and grants are unchanged. Safe to re-run.

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
  -- Read before inserting: the first variant makes the product row derived.
  select quantity, reserved_quantity into v_quantity, v_reserved
  from public.inventory where product_id = p_product_id
  for update;
  v_quantity := coalesce(v_quantity, 0);
  v_reserved := coalesce(v_reserved, 0);

  -- Multi-value SELECT / COLOR attributes, with the values selected on the product.
  select coalesce(array_agg(pa.attribute_id), '{}'), coalesce(array_agg(pa.attribute_value_id), '{}')
  into v_option_attributes, v_option_values
  from public.product_attributes pa
  join public.attributes a on a.id = pa.attribute_id
  where pa.product_id = p_product_id
    and pa.attribute_value_id is not null
    and a.data_type in ('SELECT', 'COLOR')
    and a.allows_multiple;

  select count(distinct attribute_id) into v_axes
  from unnest(v_option_attributes) as o (attribute_id);
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

revoke all on function public.generate_product_variants(uuid, jsonb, integer) from public, anon;
grant execute on function public.generate_product_variants(uuid, jsonb, integer) to authenticated;
