-- 023 · Product types and attributes (Phase 17)
--
-- A generic attribute engine, so any category can describe its products
-- without hard-coded columns (dress size, colour, length, …):
--
--   product_types            Dress, Shoes, Perfume … (soft-deactivated)
--   attributes               Size, Colour, Length, Material … with a data type
--   attribute_values         reusable choices for SELECT / COLOR attributes
--   product_type_attributes  a type's default attributes (required, order)
--   product_attributes       a product's chosen values (type defaults plus
--                            product-level extra attributes)
--   products.product_type_id optional; existing products keep NULL
--
-- Additive only: no existing column, row or constraint is changed or dropped.
-- Variants, variant stock, cart, checkout and orders are untouched (later phases).
--
-- Access: active admins only (RLS + private.is_admin()), with explicit grants.
-- The storefront gets read access in a later phase, when it needs it.
--
-- Safe to re-run: IF NOT EXISTS / OR REPLACE / DROP … IF EXISTS throughout.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

create table if not exists public.product_types (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  slug text not null unique
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 200),
  description text check (char_length(description) <= 2000),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.attributes (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  -- Stable machine key (storefront filters, later variant generation).
  code text not null unique
    check (code ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(code) <= 100),
  data_type text not null check (data_type in ('SELECT', 'TEXT', 'NUMBER', 'BOOLEAN', 'COLOR')),
  -- Shown after NUMBER values ("cm", "ml").
  unit text check (char_length(btrim(unit)) between 1 and 20),
  -- SELECT / COLOR only: a product may pick several values (sizes S, M, L).
  allows_multiple boolean not null default false,
  description text check (char_length(description) <= 2000),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attributes_unit_number_only check (unit is null or data_type = 'NUMBER'),
  constraint attributes_multiple_choice_only
    check (not allows_multiple or data_type in ('SELECT', 'COLOR'))
);

create table if not exists public.attribute_values (
  id uuid primary key default gen_random_uuid(),
  attribute_id uuid not null references public.attributes (id) on delete cascade,
  value text not null check (char_length(btrim(value)) between 1 and 200),
  -- COLOR attributes: the swatch (#RRGGBB). NULL for SELECT.
  color_hex text check (color_hex ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Target of product_attributes' composite FK (value must belong to the attribute).
  constraint attribute_values_attribute_id_id_key unique (attribute_id, id)
);

-- No two values of one attribute differ only by case or surrounding spaces.
create unique index if not exists attribute_values_attribute_value_key
  on public.attribute_values (attribute_id, lower(btrim(value)));

create table if not exists public.product_type_attributes (
  product_type_id uuid not null references public.product_types (id) on delete cascade,
  attribute_id uuid not null references public.attributes (id) on delete cascade,
  is_required boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (product_type_id, attribute_id)
);

create index if not exists product_type_attributes_attribute_id_idx
  on public.product_type_attributes (attribute_id);

alter table public.products
  add column if not exists product_type_id uuid
    references public.product_types (id) on delete restrict;

create index if not exists products_product_type_id_idx on public.products (product_type_id);

-- One row per scalar value (TEXT / NUMBER / BOOLEAN) or per chosen value
-- (SELECT / COLOR; several rows when the attribute allows multiple).
create table if not exists public.product_attributes (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  attribute_id uuid not null references public.attributes (id) on delete restrict,
  attribute_value_id uuid,
  value_text text check (char_length(btrim(value_text)) between 1 and 500),
  value_number numeric(14, 4) check (value_number between -1e9 and 1e9),
  value_boolean boolean,
  created_at timestamptz not null default now(),
  -- Exactly one value column is set.
  constraint product_attributes_one_value check (
    num_nonnulls(attribute_value_id, value_text, value_number, value_boolean) = 1
  ),
  -- A chosen value must belong to this attribute; values in use can't be deleted.
  constraint product_attributes_value_fkey foreign key (attribute_id, attribute_value_id)
    references public.attribute_values (attribute_id, id) on delete restrict
);

create unique index if not exists product_attributes_choice_key
  on public.product_attributes (product_id, attribute_id, attribute_value_id)
  where attribute_value_id is not null;
create unique index if not exists product_attributes_scalar_key
  on public.product_attributes (product_id, attribute_id)
  where attribute_value_id is null;
create index if not exists product_attributes_attribute_id_idx
  on public.product_attributes (attribute_id);
create index if not exists product_attributes_attribute_value_id_idx
  on public.product_attributes (attribute_value_id);

alter table public.product_types enable row level security;
alter table public.attributes enable row level security;
alter table public.attribute_values enable row level security;
alter table public.product_type_attributes enable row level security;
alter table public.product_attributes enable row level security;

drop trigger if exists product_types_set_updated_at on public.product_types;
create trigger product_types_set_updated_at
  before update on public.product_types
  for each row execute function private.set_updated_at();

drop trigger if exists attributes_set_updated_at on public.attributes;
create trigger attributes_set_updated_at
  before update on public.attributes
  for each row execute function private.set_updated_at();

drop trigger if exists attribute_values_set_updated_at on public.attribute_values;
create trigger attribute_values_set_updated_at
  before update on public.attribute_values
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Integrity triggers (error messages are stable codes the app maps)
-- ---------------------------------------------------------------------------

-- Attribute values exist only for SELECT / COLOR; COLOR values need a swatch.
create or replace function private.attribute_values_check()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_type text;
begin
  select data_type into v_type from public.attributes where id = new.attribute_id;
  if v_type not in ('SELECT', 'COLOR') then
    raise exception 'attribute_value:not_choice' using errcode = '23514';
  end if;
  if v_type = 'COLOR' and new.color_hex is null then
    raise exception 'attribute_value:color_required' using errcode = '23514';
  end if;
  if v_type = 'SELECT' then
    new.color_hex := null;
  end if;
  return new;
end;
$$;

drop trigger if exists attribute_values_check on public.attribute_values;
create trigger attribute_values_check
  before insert or update of attribute_id, color_hex on public.attribute_values
  for each row execute function private.attribute_values_check();

-- An attribute used by a product keeps its data type, and can't stop allowing
-- multiple values while a product has several. An unused attribute may change
-- type; becoming TEXT / NUMBER / BOOLEAN drops its (unused) choice values in
-- the same statement.
create or replace function private.attributes_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.data_type is distinct from old.data_type then
    if exists (select 1 from public.product_attributes where attribute_id = old.id) then
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

drop trigger if exists attributes_guard_update on public.attributes;
create trigger attributes_guard_update
  before update of data_type, allows_multiple on public.attributes
  for each row execute function private.attributes_guard_update();

-- A product value must use the column that matches the attribute's type, and
-- single-choice attributes take one value per product.
create or replace function private.product_attributes_check()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_attribute public.attributes%rowtype;
begin
  select * into v_attribute from public.attributes where id = new.attribute_id;
  if not found then
    raise exception 'product_attribute:attribute_missing' using errcode = '23503';
  end if;

  if v_attribute.data_type in ('SELECT', 'COLOR') then
    if new.attribute_value_id is null then
      raise exception 'product_attribute:value_type' using errcode = '23514';
    end if;
    if not v_attribute.allows_multiple and exists (
      select 1 from public.product_attributes
      where product_id = new.product_id
        and attribute_id = new.attribute_id
        and id <> new.id
    ) then
      raise exception 'product_attribute:single_value' using errcode = '23514';
    end if;
  elsif (v_attribute.data_type = 'TEXT' and new.value_text is null)
     or (v_attribute.data_type = 'NUMBER' and new.value_number is null)
     or (v_attribute.data_type = 'BOOLEAN' and new.value_boolean is null) then
    raise exception 'product_attribute:value_type' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists product_attributes_check on public.product_attributes;
create trigger product_attributes_check
  before insert or update on public.product_attributes
  for each row execute function private.product_attributes_check();

-- Trigger-only functions: never callable through the API.
revoke all on function private.attribute_values_check() from public, anon, authenticated;
revoke all on function private.attributes_guard_update() from public, anon, authenticated;
revoke all on function private.product_attributes_check() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Transactional helpers (SECURITY INVOKER: RLS and grants still apply; the
--    is_admin() check only gives a clear error)
-- ---------------------------------------------------------------------------

-- Replaces a type's default attributes. p_attributes: ordered
-- [{"attribute_id": uuid, "is_required": bool}]; sort_order = position.
create or replace function public.set_product_type_attributes(
  p_product_type_id uuid,
  p_attributes jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'only administrators can manage product types' using errcode = '42501';
  end if;
  if jsonb_typeof(p_attributes) is distinct from 'array' then
    raise exception 'product_type:invalid_attributes' using errcode = '22023';
  end if;
  perform 1 from public.product_types where id = p_product_type_id for update;
  if not found then
    raise exception 'product type not found' using errcode = 'P0002';
  end if;

  delete from public.product_type_attributes where product_type_id = p_product_type_id;

  insert into public.product_type_attributes (product_type_id, attribute_id, is_required, sort_order)
  select p_product_type_id,
         (item ->> 'attribute_id')::uuid,
         coalesce((item ->> 'is_required')::boolean, false),
         (ordinal - 1)::integer
  from jsonb_array_elements(p_attributes) with ordinality as entries (item, ordinal);
end;
$$;

-- Replaces an attribute's values. p_values: ordered
-- [{"id": uuid|null, "value": text, "color_hex": text|null, "is_active": bool}].
-- Listed ids are updated, new entries inserted, unlisted values deleted (a
-- value used by a product can't be deleted: the FK raises 23503).
create or replace function public.set_attribute_values(p_attribute_id uuid, p_values jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'only administrators can manage attributes' using errcode = '42501';
  end if;
  if jsonb_typeof(p_values) is distinct from 'array' then
    raise exception 'attribute:invalid_values' using errcode = '22023';
  end if;
  perform 1 from public.attributes where id = p_attribute_id for update;
  if not found then
    raise exception 'attribute not found' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_values) as item
    where nullif(item ->> 'id', '') is not null
      and not exists (
        select 1 from public.attribute_values v
        where v.id = (item ->> 'id')::uuid and v.attribute_id = p_attribute_id
      )
  ) then
    raise exception 'attribute value not found' using errcode = 'P0002';
  end if;

  delete from public.attribute_values v
  where v.attribute_id = p_attribute_id
    and not exists (
      select 1 from jsonb_array_elements(p_values) as item
      where nullif(item ->> 'id', '')::uuid = v.id
    );

  -- Renamed values get a unique placeholder first, so renames that swap two
  -- names never collide with the unique index mid-statement.
  update public.attribute_values v
  set value = v.id::text
  from jsonb_array_elements(p_values) as item
  where v.id = nullif(item ->> 'id', '')::uuid
    and v.value is distinct from btrim(item ->> 'value');

  update public.attribute_values v
  set value = btrim(i.item ->> 'value'),
      color_hex = nullif(i.item ->> 'color_hex', ''),
      is_active = coalesce((i.item ->> 'is_active')::boolean, true),
      sort_order = (i.ordinal - 1)::integer
  from jsonb_array_elements(p_values) with ordinality as i (item, ordinal)
  where v.id = nullif(i.item ->> 'id', '')::uuid;

  insert into public.attribute_values (attribute_id, value, color_hex, is_active, sort_order)
  select p_attribute_id,
         btrim(i.item ->> 'value'),
         nullif(i.item ->> 'color_hex', ''),
         coalesce((i.item ->> 'is_active')::boolean, true),
         (i.ordinal - 1)::integer
  from jsonb_array_elements(p_values) with ordinality as i (item, ordinal)
  where nullif(i.item ->> 'id', '') is null;
end;
$$;

-- Sets a product's type and replaces its attribute values in one
-- transaction. p_values: flat rows [{"attribute_id", "attribute_value_id"?,
-- "value_text"?, "value_number"?, "value_boolean"?}]. Every required, active
-- attribute of the type must end up with a value.
create or replace function public.set_product_attributes(
  p_product_id uuid,
  p_product_type_id uuid,
  p_values jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_current uuid;
  v_missing text;
begin
  if not private.is_admin() then
    raise exception 'only administrators can manage products' using errcode = '42501';
  end if;
  if jsonb_typeof(p_values) is distinct from 'array' then
    raise exception 'product_attribute:invalid_values' using errcode = '22023';
  end if;

  select product_type_id into v_current
  from public.products where id = p_product_id
  for update;
  if not found then
    raise exception 'product not found' using errcode = 'P0002';
  end if;

  if p_product_type_id is not null and p_product_type_id is distinct from v_current
     and not exists (
       select 1 from public.product_types where id = p_product_type_id and is_active
     ) then
    raise exception 'product_type:inactive' using errcode = '23514';
  end if;

  -- Only touch the product row when the type changes (keeps updated_at stable).
  if p_product_type_id is distinct from v_current then
    update public.products set product_type_id = p_product_type_id where id = p_product_id;
  end if;

  delete from public.product_attributes where product_id = p_product_id;

  insert into public.product_attributes (
    product_id, attribute_id, attribute_value_id, value_text, value_number, value_boolean
  )
  select p_product_id, r.attribute_id, r.attribute_value_id,
         nullif(btrim(r.value_text), ''), r.value_number, r.value_boolean
  from jsonb_to_recordset(p_values) as r (
    attribute_id uuid,
    attribute_value_id uuid,
    value_text text,
    value_number numeric,
    value_boolean boolean
  );

  if p_product_type_id is not null then
    select string_agg(a.code, ', ' order by pta.sort_order) into v_missing
    from public.product_type_attributes pta
    join public.attributes a on a.id = pta.attribute_id
    where pta.product_type_id = p_product_type_id
      and pta.is_required
      and a.is_active
      and not exists (
        select 1 from public.product_attributes pa
        where pa.product_id = p_product_id and pa.attribute_id = pta.attribute_id
      );
    if v_missing is not null then
      raise exception 'product_attribute:required_missing'
        using errcode = '23514', detail = v_missing;
    end if;
  end if;
end;
$$;

revoke all on function public.set_product_type_attributes(uuid, jsonb) from public, anon;
revoke all on function public.set_attribute_values(uuid, jsonb) from public, anon;
revoke all on function public.set_product_attributes(uuid, uuid, jsonb) from public, anon;
grant execute on function public.set_product_type_attributes(uuid, jsonb) to authenticated;
grant execute on function public.set_attribute_values(uuid, jsonb) to authenticated;
grant execute on function public.set_product_attributes(uuid, uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Grants (least privilege) and admin-only RLS
-- ---------------------------------------------------------------------------

revoke all on table
  public.product_types,
  public.attributes,
  public.attribute_values,
  public.product_type_attributes,
  public.product_attributes
from anon, authenticated;

-- DELETE is allowed but the foreign keys refuse it while anything uses the
-- row; in-use types / attributes / values are deactivated instead.
grant select, insert, update, delete on table
  public.product_types,
  public.attributes,
  public.attribute_values,
  public.product_type_attributes,
  public.product_attributes
to authenticated;

grant select, insert, update, delete on table
  public.product_types,
  public.attributes,
  public.attribute_values,
  public.product_type_attributes,
  public.product_attributes
to service_role;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'product_types', 'attributes', 'attribute_values',
    'product_type_attributes', 'product_attributes'
  ] loop
    execute format('drop policy if exists %I on public.%I', v_table || '_select_admin', v_table);
    execute format('drop policy if exists %I on public.%I', v_table || '_insert_admin', v_table);
    execute format('drop policy if exists %I on public.%I', v_table || '_update_admin', v_table);
    execute format('drop policy if exists %I on public.%I', v_table || '_delete_admin', v_table);

    execute format(
      'create policy %I on public.%I for select to authenticated using ((select private.is_admin()))',
      v_table || '_select_admin', v_table);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select private.is_admin()))',
      v_table || '_insert_admin', v_table);
    execute format(
      'create policy %I on public.%I for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()))',
      v_table || '_update_admin', v_table);
    execute format(
      'create policy %I on public.%I for delete to authenticated using ((select private.is_admin()))',
      v_table || '_delete_admin', v_table);
  end loop;
end;
$$;
