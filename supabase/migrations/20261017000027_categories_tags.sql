-- 027 · Multi-category products and product tags
--
--   product_categories  every category a product is listed in (main category
--                       plus any extra categories / subcategories)
--   tags                reusable product tags (soft-deactivated, never deleted)
--   product_tags        a product's tags
--
-- products.category_id stays as the product's MAIN category. Every existing
-- product keeps it, it is copied into product_categories here, and a trigger
-- keeps it there, so the main category is always one of the product's
-- categories. Nothing existing is dropped or rewritten.
--
-- product_categories has a surrogate primary key (not (product_id,
-- category_id)) on purpose: PostgREST then doesn't infer a second
-- products ↔ categories relationship, so existing un-hinted embeds such as
-- `category:categories(...)` and `categories?select=products(count)` (admin
-- and storefront) stay unambiguous. UNIQUE (product_id, category_id) still
-- prevents duplicate assignments.
--
-- Also hardens the category hierarchy (migration 022): hierarchy changes are
-- serialised and an explicit ancestor walk rejects cycles, so two concurrent
-- edits can't make A → B and B → A.
--
-- Access: active admins only (RLS + private.is_admin()), with explicit grants.
-- Safe to re-run: IF NOT EXISTS / OR REPLACE / DROP … IF EXISTS throughout.

-- ---------------------------------------------------------------------------
-- 1. Category hierarchy: no cycles, even under concurrent edits
-- ---------------------------------------------------------------------------

create or replace function public.categories_check_parent()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ancestor uuid;
  v_depth integer := 0;
begin
  if new.parent_id is not null then
    -- One hierarchy change at a time (cheap: parents change rarely). Without
    -- it, two transactions could each pass the checks below and form a cycle.
    perform pg_advisory_xact_lock(hashtext('public.categories.parent_id'));

    if new.parent_id = new.id then
      raise exception 'category:parent_not_self' using errcode = '23514';
    end if;

    -- Walk up from the new parent; reaching this category would be a cycle.
    v_ancestor := new.parent_id;
    while v_ancestor is not null loop
      if v_ancestor = new.id then
        raise exception 'category:parent_cycle' using errcode = '23514';
      end if;
      v_depth := v_depth + 1;
      exit when v_depth > 100;
      select c.parent_id into v_ancestor from public.categories c where c.id = v_ancestor;
    end loop;

    -- Two levels only (main category → subcategory), as the storefront menu expects.
    if exists (
      select 1 from public.categories c where c.id = new.parent_id and c.parent_id is not null
    ) then
      raise exception 'category:parent_is_subcategory' using errcode = '23514';
    end if;
    if exists (select 1 from public.categories c where c.parent_id = new.id) then
      raise exception 'category:has_subcategories' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.categories_check_parent() from public, anon, authenticated;

drop trigger if exists categories_check_parent on public.categories;
create trigger categories_check_parent
  before insert or update of parent_id on public.categories
  for each row execute function public.categories_check_parent();

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------

create table if not exists public.product_categories (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  -- Categories are only deactivated; RESTRICT just guards against hard deletes.
  category_id uuid not null references public.categories (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint product_categories_product_category_key unique (product_id, category_id)
);

-- "Products in category" (the unique index already covers product_id lookups).
create index if not exists product_categories_category_id_idx
  on public.product_categories (category_id);

create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  slug text not null unique
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 100),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- No two tags differ only by case or surrounding spaces ("Eid" / " eid ").
create unique index if not exists tags_name_key on public.tags (lower(btrim(name)));
-- Admin list default ordering / product form options.
create index if not exists tags_name_idx on public.tags (name);

create table if not exists public.product_tags (
  product_id uuid not null references public.products (id) on delete cascade,
  tag_id uuid not null references public.tags (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (product_id, tag_id)
);

create index if not exists product_tags_tag_id_idx on public.product_tags (tag_id);

alter table public.product_categories enable row level security;
alter table public.tags enable row level security;
alter table public.product_tags enable row level security;

drop trigger if exists tags_set_updated_at on public.tags;
create trigger tags_set_updated_at
  before update on public.tags
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Main category ⊆ product categories
-- ---------------------------------------------------------------------------

-- Existing products: their main category becomes their first assignment.
insert into public.product_categories (product_id, category_id)
select p.id, p.category_id
from public.products p
where p.category_id is not null
on conflict (product_id, category_id) do nothing;

-- A new or changed main category is always assigned too. The previous main
-- category stays assigned (it becomes an extra category) until removed.
create or replace function private.products_sync_main_category()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.category_id is not null then
    insert into public.product_categories (product_id, category_id)
    values (new.id, new.category_id)
    on conflict (product_id, category_id) do nothing;
  end if;
  return null;
end;
$$;

drop trigger if exists products_sync_main_category on public.products;
create trigger products_sync_main_category
  after insert or update of category_id on public.products
  for each row execute function private.products_sync_main_category();

-- The main category's assignment can't be removed or repointed on its own
-- (deleting the product still cascades: the product row is gone by then).
create or replace function private.product_categories_guard_main()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.product_id = old.product_id and new.category_id = old.category_id then
      return new;
    end if;
  end if;
  if exists (
    select 1 from public.products p
    where p.id = old.product_id and p.category_id = old.category_id
  ) then
    raise exception 'product_category:main_required' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists product_categories_guard_main on public.product_categories;
create trigger product_categories_guard_main
  before update or delete on public.product_categories
  for each row execute function private.product_categories_guard_main();

-- Trigger-only functions: never callable through the API.
revoke all on function private.products_sync_main_category() from public, anon, authenticated;
revoke all on function private.product_categories_guard_main() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Transactional helpers (SECURITY INVOKER: RLS and grants still apply; the
--    is_admin() check only gives a clear error)
-- ---------------------------------------------------------------------------

-- Replaces a product's categories with p_category_ids (duplicates ignored).
-- The main category is always kept. Newly added categories must be active;
-- ones the product already has may stay even if deactivated meanwhile.
create or replace function public.set_product_categories(
  p_product_id uuid,
  p_category_ids uuid[]
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_main uuid;
  v_ids uuid[];
begin
  if not private.is_admin() then
    raise exception 'only administrators can manage products' using errcode = '42501';
  end if;

  select category_id into v_main from public.products where id = p_product_id for update;
  if not found then
    raise exception 'product not found' using errcode = 'P0002';
  end if;

  select coalesce(array_agg(distinct id), '{}') into v_ids
  from unnest(coalesce(p_category_ids, '{}') || v_main) as ids (id)
  where id is not null;

  if cardinality(v_ids) > 100 then
    raise exception 'product_category:too_many' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(v_ids) as ids (id)
    where not exists (select 1 from public.categories c where c.id = ids.id)
  ) then
    raise exception 'product_category:invalid' using errcode = '23503';
  end if;
  if exists (
    select 1 from unnest(v_ids) as ids (id)
    join public.categories c on c.id = ids.id
    where not c.is_active
      and not exists (
        select 1 from public.product_categories pc
        where pc.product_id = p_product_id and pc.category_id = ids.id
      )
  ) then
    raise exception 'product_category:inactive' using errcode = '23514';
  end if;

  delete from public.product_categories
  where product_id = p_product_id and category_id <> all (v_ids);

  insert into public.product_categories (product_id, category_id)
  select p_product_id, ids.id from unnest(v_ids) as ids (id)
  on conflict (product_id, category_id) do nothing;
end;
$$;

-- Replaces a product's tags with p_tag_ids (duplicates ignored). Newly added
-- tags must be active; ones the product already has may stay.
create or replace function public.set_product_tags(p_product_id uuid, p_tag_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  if not private.is_admin() then
    raise exception 'only administrators can manage products' using errcode = '42501';
  end if;

  perform 1 from public.products where id = p_product_id for update;
  if not found then
    raise exception 'product not found' using errcode = 'P0002';
  end if;

  select coalesce(array_agg(distinct id), '{}') into v_ids
  from unnest(coalesce(p_tag_ids, '{}')) as ids (id)
  where id is not null;

  if cardinality(v_ids) > 100 then
    raise exception 'product_tag:too_many' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(v_ids) as ids (id)
    where not exists (select 1 from public.tags t where t.id = ids.id)
  ) then
    raise exception 'product_tag:invalid' using errcode = '23503';
  end if;
  if exists (
    select 1 from unnest(v_ids) as ids (id)
    join public.tags t on t.id = ids.id
    where not t.is_active
      and not exists (
        select 1 from public.product_tags pt
        where pt.product_id = p_product_id and pt.tag_id = ids.id
      )
  ) then
    raise exception 'product_tag:inactive' using errcode = '23514';
  end if;

  delete from public.product_tags
  where product_id = p_product_id and tag_id <> all (v_ids);

  insert into public.product_tags (product_id, tag_id)
  select p_product_id, ids.id from unnest(v_ids) as ids (id)
  on conflict (product_id, tag_id) do nothing;
end;
$$;

revoke all on function public.set_product_categories(uuid, uuid[]) from public, anon;
revoke all on function public.set_product_tags(uuid, uuid[]) from public, anon;
grant execute on function public.set_product_categories(uuid, uuid[]) to authenticated;
grant execute on function public.set_product_tags(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Grants (least privilege) and admin-only RLS
-- ---------------------------------------------------------------------------

revoke all on table public.product_categories, public.tags, public.product_tags
from anon, authenticated;

-- Tags are deactivated, not deleted (like categories): no DELETE grant.
grant select, insert, update on table public.tags to authenticated;
-- Assignments are replaced, never edited in place.
grant select, insert, delete on table public.product_categories, public.product_tags
to authenticated;

grant select, insert, update, delete on table
  public.product_categories, public.tags, public.product_tags
to service_role;

drop policy if exists tags_select_admin on public.tags;
drop policy if exists tags_insert_admin on public.tags;
drop policy if exists tags_update_admin on public.tags;
create policy tags_select_admin on public.tags
  for select to authenticated using ((select private.is_admin()));
create policy tags_insert_admin on public.tags
  for insert to authenticated with check ((select private.is_admin()));
create policy tags_update_admin on public.tags
  for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

do $$
declare
  v_table text;
begin
  foreach v_table in array array['product_categories', 'product_tags'] loop
    execute format('drop policy if exists %I on public.%I', v_table || '_select_admin', v_table);
    execute format('drop policy if exists %I on public.%I', v_table || '_insert_admin', v_table);
    execute format('drop policy if exists %I on public.%I', v_table || '_delete_admin', v_table);

    execute format(
      'create policy %I on public.%I for select to authenticated using ((select private.is_admin()))',
      v_table || '_select_admin', v_table);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select private.is_admin()))',
      v_table || '_insert_admin', v_table);
    execute format(
      'create policy %I on public.%I for delete to authenticated using ((select private.is_admin()))',
      v_table || '_delete_admin', v_table);
  end loop;
end;
$$;
