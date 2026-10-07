-- 014 · Catalogue management (Phase 3)
--
-- Tables from migrations 004–006 already cover categories, products and
-- product images. This adds only what the admin catalogue UI needs:
--   1. categories.image_path — Storage object behind categories.image_url, so
--      a replaced image's file can be deleted (no orphans).
--   2. `category-images` bucket + admin-only write policies.
--   3. Transactional product-image helpers (primary / reorder / delete).
--      SECURITY INVOKER: they run as the caller, so RLS and grants still apply;
--      the explicit is_admin() check just gives a clear error.

-- ---------------------------------------------------------------------------
-- 1. Category image path
-- ---------------------------------------------------------------------------
alter table public.categories
  add column image_path text
    check (image_path is null or image_path like 'categories/' || id::text || '/_%');

-- ---------------------------------------------------------------------------
-- 2. Storage: category-images bucket
-- ---------------------------------------------------------------------------
-- Public read (storefront navigation), admin-only write, under
-- categories/{category-uuid}/{file}. Same limits as product images.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'category-images',
  'category-images',
  true,
  5242880, -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy category_images_storage_select_admin on storage.objects
  for select to authenticated
  using (bucket_id = 'category-images' and (select private.is_admin()));

create policy category_images_storage_insert_admin on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'category-images'
    and name ~ '^categories/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$'
    and (select private.is_admin())
  );

create policy category_images_storage_update_admin on storage.objects
  for update to authenticated
  using (bucket_id = 'category-images' and (select private.is_admin()))
  with check (
    bucket_id = 'category-images'
    and name ~ '^categories/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$'
    and (select private.is_admin())
  );

create policy category_images_storage_delete_admin on storage.objects
  for delete to authenticated
  using (bucket_id = 'category-images' and (select private.is_admin()));

-- ---------------------------------------------------------------------------
-- 3. Product image helpers
-- ---------------------------------------------------------------------------

-- Makes one image the product's primary image. Unsets the previous primary
-- first (product_images_one_primary_idx allows only one), in one transaction.
create or replace function public.set_primary_product_image(p_image_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_product_id uuid;
begin
  if not private.is_admin() then
    raise exception 'only administrators can manage product images' using errcode = '42501';
  end if;

  select product_id into v_product_id from public.product_images where id = p_image_id;
  if v_product_id is null then
    raise exception 'product image not found' using errcode = 'P0002';
  end if;

  update public.product_images
  set is_primary = false
  where product_id = v_product_id and is_primary and id <> p_image_id;

  update public.product_images set is_primary = true where id = p_image_id;
end;
$$;

-- Sets sort_order = position in p_image_ids (0-based) for that product's images.
create or replace function public.reorder_product_images(p_product_id uuid, p_image_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'only administrators can manage product images' using errcode = '42501';
  end if;

  update public.product_images as image
  set sort_order = ordered.ordinal - 1
  from unnest(p_image_ids) with ordinality as ordered (id, ordinal)
  where image.id = ordered.id and image.product_id = p_product_id;
end;
$$;

-- Deletes the image row and, if it was primary, promotes the next image.
-- Returns the Storage path so the caller can remove the file.
create or replace function public.delete_product_image(p_image_id uuid)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_product_id uuid;
  v_storage_path text;
  v_was_primary boolean;
begin
  if not private.is_admin() then
    raise exception 'only administrators can manage product images' using errcode = '42501';
  end if;

  delete from public.product_images
  where id = p_image_id
  returning product_id, storage_path, is_primary
  into v_product_id, v_storage_path, v_was_primary;

  if v_product_id is null then
    raise exception 'product image not found' using errcode = 'P0002';
  end if;

  if v_was_primary then
    update public.product_images
    set is_primary = true
    where id = (
      select id from public.product_images
      where product_id = v_product_id
      order by sort_order, created_at
      limit 1
    );
  end if;

  return v_storage_path;
end;
$$;

revoke all on function public.set_primary_product_image(uuid) from public, anon;
revoke all on function public.reorder_product_images(uuid, uuid[]) from public, anon;
revoke all on function public.delete_product_image(uuid) from public, anon;
grant execute on function public.set_primary_product_image(uuid) to authenticated;
grant execute on function public.reorder_product_images(uuid, uuid[]) to authenticated;
grant execute on function public.delete_product_image(uuid) to authenticated;

-- Admin product list default ordering (updated_at desc), including inactive.
create index products_updated_at_idx on public.products (updated_at desc);
