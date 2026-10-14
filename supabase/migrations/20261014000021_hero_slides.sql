-- 021 · Homepage hero slides
--
-- Up to two images for the storefront's homepage hero, shown as a fading
-- slideshow. One row per slot (position 1 or 2); an empty slot has no row.
--
-- Access: everyone (anon included) can read, so the storefront can render the
-- hero; only active admins can add, replace or remove slides.
--
-- Files live in the public store-assets bucket under hero/<file name>.
--
-- Self-contained on purpose: the admin check reads public.profiles directly
-- (role ADMIN + is_active, the same rule as lib/auth/dal.ts) instead of
-- relying on helper functions, and every statement is safe to re-run.

create table if not exists public.hero_slides (
  position smallint primary key check (position between 1 and 2),
  image_path text not null check (char_length(image_path) <= 300),
  image_url text not null check (char_length(image_url) <= 1000),
  -- Set by the app on every save (lib/hero/actions.ts).
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references public.profiles (id) on delete set null
);

alter table public.hero_slides enable row level security;

grant select on table public.hero_slides to anon, authenticated;
grant insert, update, delete on table public.hero_slides to authenticated;
grant select, insert, update, delete on table public.hero_slides to service_role;

drop policy if exists hero_slides_select_all on public.hero_slides;
create policy hero_slides_select_all on public.hero_slides
  for select to anon, authenticated
  using (true);

drop policy if exists hero_slides_insert_admin on public.hero_slides;
create policy hero_slides_insert_admin on public.hero_slides
  for insert to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.role = 'ADMIN' and p.is_active
    )
  );

drop policy if exists hero_slides_update_admin on public.hero_slides;
create policy hero_slides_update_admin on public.hero_slides
  for update to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.role = 'ADMIN' and p.is_active
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.role = 'ADMIN' and p.is_active
    )
  );

drop policy if exists hero_slides_delete_admin on public.hero_slides;
create policy hero_slides_delete_admin on public.hero_slides
  for delete to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.role = 'ADMIN' and p.is_active
    )
  );

-- ---------------------------------------------------------------------------
-- Storage: hero/ files in the public store-assets bucket
-- ---------------------------------------------------------------------------
-- The bucket normally exists already (020, store logo); create it if not.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'store-assets',
  'store-assets',
  true,
  5242880, -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

drop policy if exists store_assets_hero_select_admin on storage.objects;
create policy store_assets_hero_select_admin on storage.objects
  for select to authenticated
  using (
    bucket_id = 'store-assets'
    and name ~ '^hero/[^/]+$'
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.role = 'ADMIN' and p.is_active
    )
  );

drop policy if exists store_assets_hero_insert_admin on storage.objects;
create policy store_assets_hero_insert_admin on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'store-assets'
    and name ~ '^hero/[^/]+$'
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.role = 'ADMIN' and p.is_active
    )
  );

drop policy if exists store_assets_hero_delete_admin on storage.objects;
create policy store_assets_hero_delete_admin on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'store-assets'
    and name ~ '^hero/[^/]+$'
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.role = 'ADMIN' and p.is_active
    )
  );
