-- PROPOSED for mirna-admin (the repo that owns the schema). Copy this file to
-- mirna-admin/supabase/migrations/ unchanged and apply it there BEFORE (or
-- with) the storefront's multi-category and tag browsing. This repo has no
-- migrations.
--
-- 029 · Storefront read access to product categories and tags
--
-- Migration 027 added product_categories, tags and product_tags with
-- admin-only RLS, so the storefront (anon) can't list a product under its
-- extra categories or show / filter by tags. This adds, for anon and
-- authenticated:
--
--   1. tags: read ACTIVE tags (id, name, slug, is_active).
--   2. product_tags / product_categories: read assignments whose product is
--      ACTIVE and whose tag / category is ACTIVE (product_id + tag_id /
--      category_id only).
--   3. category_product_counts(): per active category, the number of
--      DISTINCT active products in it or its active subcategories (a product
--      in both a parent and its child counts once). SECURITY INVOKER: RLS
--      decides what is counted.
--
-- Additive: grants, policies and one function. Admin policies, write access
-- and the existing tables are unchanged. Safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Grants (column level for anon; authenticated already has table SELECT)
-- ---------------------------------------------------------------------------
grant select (id, name, slug, is_active) on table public.tags to anon;
grant select (product_id, tag_id) on table public.product_tags to anon;
grant select (product_id, category_id) on table public.product_categories to anon;

-- ---------------------------------------------------------------------------
-- 2. Policies (permissive: OR-ed with the existing *_select_admin policies)
-- ---------------------------------------------------------------------------
drop policy if exists tags_select_active_public on public.tags;
create policy tags_select_active_public on public.tags
  for select to anon, authenticated
  using (is_active);

-- The subqueries run under the caller's RLS too (active products / tags /
-- categories only); the conditions are explicit so the rule is visible here.
drop policy if exists product_tags_select_public on public.product_tags;
create policy product_tags_select_public on public.product_tags
  for select to anon, authenticated
  using (
    exists (select 1 from public.products p where p.id = product_id and p.is_active)
    and exists (select 1 from public.tags t where t.id = tag_id and t.is_active)
  );

drop policy if exists product_categories_select_public on public.product_categories;
create policy product_categories_select_public on public.product_categories
  for select to anon, authenticated
  using (
    exists (select 1 from public.products p where p.id = product_id and p.is_active)
    and exists (select 1 from public.categories c where c.id = category_id and c.is_active)
  );

-- ---------------------------------------------------------------------------
-- 3. Distinct product counts per category scope
-- ---------------------------------------------------------------------------
-- Two levels only (027's categories_check_parent), so "scope" = the category
-- plus its direct subcategories.
create or replace function public.category_product_counts()
returns table (category_id uuid, product_count integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.id, count(distinct p.id)::integer
  from public.categories c
  left join public.categories sc
    on (sc.id = c.id or sc.parent_id = c.id) and sc.is_active
  left join public.product_categories pc on pc.category_id = sc.id
  left join public.products p on p.id = pc.product_id and p.is_active
  where c.is_active
  group by c.id;
$$;

revoke all on function public.category_product_counts() from public;
grant execute on function public.category_product_counts() to anon, authenticated;
