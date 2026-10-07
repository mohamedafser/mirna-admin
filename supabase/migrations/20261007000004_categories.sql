-- 004 · Categories
--
-- Categories are deactivated (is_active = false), not deleted. No DELETE grant is
-- given to API roles (migration 011).
-- Localisation: `name`/`description` hold the default-locale text. Per-locale text
-- can later live in a `category_translations (category_id, locale, ...)` table
-- without changing this one.

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  slug text not null unique
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 200),
  description text check (char_length(description) <= 5000),
  image_url text check (char_length(image_url) <= 2048),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.categories enable row level security;

-- Storefront navigation: active categories in display order. (slug already has a
-- unique index.)
create index categories_active_sort_idx on public.categories (sort_order, name)
  where is_active;

create trigger categories_set_updated_at
  before update on public.categories
  for each row execute function private.set_updated_at();
