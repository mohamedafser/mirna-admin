-- 006 · Product images
--
-- Files live in the `product-images` Storage bucket (migration 012) under
-- products/{product_id}/{file}. The CHECK keeps storage_path in that layout.

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  storage_path text not null unique
    check (storage_path like 'products/' || product_id::text || '/_%'),
  public_url text check (char_length(public_url) <= 2048),
  alt_text text check (char_length(alt_text) <= 300),
  sort_order integer not null default 0,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.product_images enable row level security;

create index product_images_product_sort_idx on public.product_images (product_id, sort_order);

-- At most one primary image per product.
create unique index product_images_one_primary_idx on public.product_images (product_id)
  where is_primary;

create trigger product_images_set_updated_at
  before update on public.product_images
  for each row execute function private.set_updated_at();
