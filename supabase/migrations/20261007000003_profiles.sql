-- 003 · Profiles
--
-- One row per auth.users row, created automatically by a trigger.
-- `role` is the single source of truth for authorization. It is never read from
-- user-controlled signup metadata, and RLS + a guard trigger (migration 011)
-- prevent users from changing it.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text check (char_length(full_name) <= 200),
  phone text check (char_length(phone) <= 32),
  role public.user_role not null default 'CUSTOMER',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Supports the future admin customer list ("customers, newest first").
-- `id` lookups (the hot path, including is_admin()) use the primary key.
create index profiles_role_created_at_idx on public.profiles (role, created_at desc);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

-- Create a CUSTOMER profile for every new auth user.
-- SECURITY DEFINER because the inserting role (supabase_auth_admin) has no
-- privileges on public.profiles. Only full_name is copied from metadata; role is
-- deliberately left at its CUSTOMER default.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (
    new.id,
    nullif(left(btrim(new.raw_user_meta_data ->> 'full_name'), 200), ''),
    nullif(left(new.phone, 32), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Backfill profiles for users that existed before this migration.
insert into public.profiles (id)
select id from auth.users
on conflict (id) do nothing;
