-- 012 · Storage: product-images bucket
--
-- Public bucket: product images are served by public URL to the storefront.
-- Only active admins can upload, replace or delete, and only under
-- products/{product-uuid}/{file}. Anonymous and customer uploads are denied.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  5242880, -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- products/<uuid>/<file name without slashes>
create policy product_images_storage_select_admin on storage.objects
  for select to authenticated
  using (bucket_id = 'product-images' and (select private.is_admin()));

create policy product_images_storage_insert_admin on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'product-images'
    and name ~ '^products/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$'
    and (select private.is_admin())
  );

create policy product_images_storage_update_admin on storage.objects
  for update to authenticated
  using (bucket_id = 'product-images' and (select private.is_admin()))
  with check (
    bucket_id = 'product-images'
    and name ~ '^products/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$'
    and (select private.is_admin())
  );

create policy product_images_storage_delete_admin on storage.objects
  for delete to authenticated
  using (bucket_id = 'product-images' and (select private.is_admin()));
