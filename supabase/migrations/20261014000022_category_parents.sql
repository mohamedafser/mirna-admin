-- 022 · Subcategories
--
-- A category may have a parent (one level: Women → Abaya). Top-level
-- categories have parent_id null; the storefront shows them in the header and
-- lists their subcategories in its dropdown. A parent's page and home row
-- include the products of its subcategories.
--
-- Rules (enforced here, and by the admin form first):
--   * a category can't be its own parent;
--   * a parent must be top-level (no grandchildren);
--   * a category that has subcategories can't get a parent itself.
-- Categories are only soft-deleted, so ON DELETE RESTRICT never blocks the app.
--
-- Self-contained and safe to re-run (no helper functions from other files).

alter table public.categories
  add column if not exists parent_id uuid references public.categories (id) on delete restrict;

alter table public.categories drop constraint if exists categories_parent_not_self;
alter table public.categories
  add constraint categories_parent_not_self check (parent_id is null or parent_id <> id);

create index if not exists categories_parent_id_idx on public.categories (parent_id);

create or replace function public.categories_check_parent()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.parent_id is not null then
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

-- Trigger-only function: never callable through the API.
revoke execute on function public.categories_check_parent() from public, anon, authenticated;

drop trigger if exists categories_check_parent on public.categories;
create trigger categories_check_parent
  before insert or update of parent_id on public.categories
  for each row execute function public.categories_check_parent();
