-- 008 · Addresses
--
-- International address book. Only the fields every country needs are required
-- (recipient, phone, country, city, plus at least one locating detail).
-- Country-specific rules (e.g. a UAE emirate in `state_region`, a mandatory
-- postal code elsewhere) belong in application validation per country, not in
-- NOT NULL constraints here.

create table public.addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  label text check (char_length(label) <= 50),
  full_name text not null check (char_length(btrim(full_name)) between 1 and 200),
  phone text not null check (char_length(btrim(phone)) between 3 and 32),
  country_code public.country_code not null,
  state_region text check (char_length(state_region) <= 100),
  city text not null check (char_length(btrim(city)) between 1 and 100),
  area text check (char_length(area) <= 150),
  street text check (char_length(street) <= 200),
  building text check (char_length(building) <= 150),
  apartment text check (char_length(apartment) <= 50),
  postal_code text check (char_length(postal_code) <= 20),
  additional_instructions text check (char_length(additional_instructions) <= 500),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint addresses_has_locating_detail check (num_nonnulls(area, street, building) >= 1)
);

alter table public.addresses enable row level security;

create index addresses_user_id_idx on public.addresses (user_id);

-- At most one default address per user.
create unique index addresses_one_default_per_user_idx on public.addresses (user_id)
  where is_default;

create trigger addresses_set_updated_at
  before update on public.addresses
  for each row execute function private.set_updated_at();
