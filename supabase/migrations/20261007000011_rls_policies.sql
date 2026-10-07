-- 011 · Row Level Security, grants and role protection
--
-- Security model
--   anon           → read active catalogue (categories, products, product images)
--   authenticated  → own profile, addresses, orders, order items
--   ADMIN profile  → manage catalogue and inventory, read customers/orders,
--                    update order status
--   service_role   → bypasses RLS; server-only, never shipped to the browser
--
-- RLS is already enabled on every table (migrations 003–010). This migration
-- adds explicit GRANTs (so access never depends on the project's
-- "auto-expose new tables" setting) and the policies.
-- Future tables must add their own explicit GRANTs and policies.

-- ---------------------------------------------------------------------------
-- Role check
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER so it can read profiles without re-entering profiles' RLS
-- policies (which would recurse). Lives in the non-exposed `private` schema.
create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'ADMIN'
      and is_active
  );
$$;

grant usage on schema private to authenticated;
revoke all on function private.is_admin() from public;
grant execute on function private.is_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- Privilege-escalation guard on profiles
-- ---------------------------------------------------------------------------
-- RLS lets users update their own row, so this trigger stops them changing the
-- privileged columns. Only an active admin may change role / is_active, never
-- on their own row (prevents self-lockout and self-escalation).
-- Applies to API roles only; SQL run as postgres (migrations, dashboard SQL
-- editor, SECURITY DEFINER functions) is trusted.
create or replace function private.guard_profile_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if new.id is distinct from old.id or new.created_at is distinct from old.created_at then
    raise exception 'profiles.id and profiles.created_at are immutable'
      using errcode = '42501';
  end if;

  if new.role is distinct from old.role or new.is_active is distinct from old.is_active then
    if not private.is_admin() then
      raise exception 'only administrators can change role or active status'
        using errcode = '42501';
    end if;
    if old.id = (select auth.uid()) then
      raise exception 'administrators cannot change their own role or active status'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

create trigger profiles_guard_update
  before update on public.profiles
  for each row execute function private.guard_profile_update();

-- ---------------------------------------------------------------------------
-- Grants (least privilege). RLS then narrows rows.
-- ---------------------------------------------------------------------------
revoke all on table
  public.profiles,
  public.categories,
  public.products,
  public.product_images,
  public.inventory,
  public.addresses,
  public.orders,
  public.order_items
from anon, authenticated;

-- Public catalogue (rows limited by RLS to active items)
grant select on table public.categories, public.products, public.product_images to anon;

-- Profiles: no INSERT (trigger creates them), no DELETE (cascade from auth.users).
grant select on table public.profiles to authenticated;
grant update (full_name, phone, role, is_active) on table public.profiles to authenticated;

-- Catalogue: soft delete only for categories/products (no DELETE grant).
grant select, insert, update on table public.categories, public.products to authenticated;
grant select, insert, update, delete on table public.product_images to authenticated;
grant select, insert, update on table public.inventory to authenticated;

grant select, insert, update, delete on table public.addresses to authenticated;

-- Orders are created server-side (later phase). Admins may only move status.
grant select on table public.orders, public.order_items to authenticated;
grant update (status) on table public.orders to authenticated;

-- ---------------------------------------------------------------------------
-- Policies
-- `(select auth.uid())` / `(select private.is_admin())` are wrapped in a
-- sub-select so Postgres evaluates them once per statement, not once per row.
-- ---------------------------------------------------------------------------

-- profiles ------------------------------------------------------------------
create policy profiles_select_own_or_admin on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select private.is_admin()));

create policy profiles_update_own_or_admin on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) or (select private.is_admin()))
  with check (id = (select auth.uid()) or (select private.is_admin()));

-- categories ----------------------------------------------------------------
create policy categories_select_active_public on public.categories
  for select to anon
  using (is_active);

create policy categories_select_active_or_admin on public.categories
  for select to authenticated
  using (is_active or (select private.is_admin()));

create policy categories_insert_admin on public.categories
  for insert to authenticated
  with check ((select private.is_admin()));

create policy categories_update_admin on public.categories
  for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

-- products ------------------------------------------------------------------
create policy products_select_active_public on public.products
  for select to anon
  using (is_active);

create policy products_select_active_or_admin on public.products
  for select to authenticated
  using (is_active or (select private.is_admin()));

create policy products_insert_admin on public.products
  for insert to authenticated
  with check ((select private.is_admin()));

create policy products_update_admin on public.products
  for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

-- product_images ------------------------------------------------------------
create policy product_images_select_active_public on public.product_images
  for select to anon
  using (
    exists (
      select 1 from public.products p
      where p.id = product_images.product_id and p.is_active
    )
  );

create policy product_images_select_active_or_admin on public.product_images
  for select to authenticated
  using (
    (select private.is_admin())
    or exists (
      select 1 from public.products p
      where p.id = product_images.product_id and p.is_active
    )
  );

create policy product_images_insert_admin on public.product_images
  for insert to authenticated
  with check ((select private.is_admin()));

create policy product_images_update_admin on public.product_images
  for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy product_images_delete_admin on public.product_images
  for delete to authenticated
  using ((select private.is_admin()));

-- inventory (admin only for now; storefront stock display comes later) -------
create policy inventory_select_admin on public.inventory
  for select to authenticated
  using ((select private.is_admin()));

create policy inventory_insert_admin on public.inventory
  for insert to authenticated
  with check ((select private.is_admin()));

create policy inventory_update_admin on public.inventory
  for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

-- addresses -----------------------------------------------------------------
create policy addresses_select_own_or_admin on public.addresses
  for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()));

create policy addresses_insert_own on public.addresses
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy addresses_update_own on public.addresses
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy addresses_delete_own on public.addresses
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- orders --------------------------------------------------------------------
create policy orders_select_own_or_admin on public.orders
  for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()));

create policy orders_update_admin on public.orders
  for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

-- order_items ---------------------------------------------------------------
create policy order_items_select_own_or_admin on public.order_items
  for select to authenticated
  using (
    (select private.is_admin())
    or exists (
      select 1 from public.orders o
      where o.id = order_items.order_id and o.user_id = (select auth.uid())
    )
  );
