-- 007 · Inventory
--
-- One row per product (product_id is UNIQUE). Single-location stock only;
-- multi-warehouse is out of scope.

create table public.inventory (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null unique references public.products (id) on delete cascade,
  quantity integer not null default 0 check (quantity >= 0),
  reserved_quantity integer not null default 0 check (reserved_quantity >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_reserved_lte_quantity check (reserved_quantity <= quantity)
);

alter table public.inventory enable row level security;

create trigger inventory_set_updated_at
  before update on public.inventory
  for each row execute function private.set_updated_at();

-- Every product gets an inventory row (quantity 0) so stock lookups never miss.
create or replace function private.create_inventory_for_product()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.inventory (product_id)
  values (new.id)
  on conflict (product_id) do nothing;
  return new;
end;
$$;

create trigger products_create_inventory
  after insert on public.products
  for each row execute function private.create_inventory_for_product();
