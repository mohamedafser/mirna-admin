-- 020 · Store settings (Phase 16)
--
-- One active store configuration: a single-row table (id is always true), so
-- there is never a second, conflicting configuration. The row is created here;
-- API roles can't insert or delete it, only update it.
--
-- config/region.ts keeps the code-level fallbacks used before this row exists
-- (and the list of selectable markets); this row is the configured value.
--
-- Access: active admins read and update it (RLS + is_admin()). Nobody else can
-- read it yet; a storefront phase can expose a public subset through a view
-- or function.
--
-- Shipping, order and notification values are stored for the checkout,
-- order and notification phases to apply. Nothing is sent or charged here.

create table public.store_settings (
  id boolean primary key default true constraint store_settings_single_row check (id),

  -- Store
  store_name text not null check (char_length(btrim(store_name)) between 1 and 200),
  logo_path text check (char_length(logo_path) <= 300),
  logo_url text check (char_length(logo_url) <= 1000),

  -- Contact
  contact_email text check (
    contact_email is null
    or (char_length(contact_email) <= 254 and contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
  ),
  contact_phone text check (contact_phone is null or contact_phone ~ '^\+?[0-9 ()-]{6,32}$'),

  -- Address
  address_line1 text check (char_length(address_line1) <= 200),
  address_line2 text check (char_length(address_line2) <= 200),
  city text check (char_length(city) <= 100),
  state_region text check (char_length(state_region) <= 100),
  postal_code text check (char_length(postal_code) <= 20),

  -- Market
  country_code public.country_code not null,
  currency_code public.currency_code not null,
  -- IANA name; checked against pg_timezone_names by the trigger below.
  timezone text not null check (char_length(timezone) <= 64),
  default_locale text not null check (default_locale in ('en', 'ar')),

  -- VAT / tax
  tax_enabled boolean not null default false,
  -- Percentage, e.g. 5.00 for UAE VAT.
  tax_rate numeric(5, 2) not null default 0 check (tax_rate between 0 and 100),
  prices_include_tax boolean not null default true,
  tax_registration_number text check (char_length(tax_registration_number) <= 50),

  -- Shipping (amounts in currency_code)
  shipping_fee public.money_amount not null default 0,
  -- Orders at or above this subtotal ship free; null = never free.
  free_shipping_threshold public.money_amount,
  delivery_min_days smallint not null default 1 check (delivery_min_days between 0 and 365),
  delivery_max_days smallint not null default 3 check (delivery_max_days between 0 and 365),

  -- Orders
  -- null = no minimum.
  min_order_amount public.money_amount,
  max_quantity_per_item integer not null default 10 check (max_quantity_per_item between 1 and 10000),
  -- Customers may cancel their own PENDING orders.
  allow_customer_cancellation boolean not null default true,

  -- Notification preferences (stored only; nothing is sent yet)
  notify_new_order boolean not null default true,
  notify_low_stock boolean not null default true,
  notify_order_cancelled boolean not null default true,
  -- null = the store contact email.
  notification_email text check (
    notification_email is null
    or (char_length(notification_email) <= 254 and notification_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
  ),

  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,

  constraint store_settings_delivery_days check (delivery_min_days <= delivery_max_days),
  constraint store_settings_tax_rate_when_enabled check (not tax_enabled or tax_rate > 0)
);

alter table public.store_settings enable row level security;

-- Validates the timezone and records who changed the settings. updated_at is
-- set by private.set_updated_at.
create or replace function private.store_settings_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'settings:invalid_timezone' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    new.updated_by := (select auth.uid());
  end if;
  return new;
end;
$$;

create trigger store_settings_before_write
  before insert or update on public.store_settings
  for each row execute function private.store_settings_before_write();

create trigger store_settings_set_updated_at
  before update on public.store_settings
  for each row execute function private.set_updated_at();

-- The one configuration, from the current market defaults (config/region.ts).
insert into public.store_settings (store_name, country_code, currency_code, timezone, default_locale)
values ('Mirna', 'AE', 'AED', 'Asia/Dubai', 'en')
on conflict (id) do nothing;

-- Grants: admins read and update the editable columns only (no insert/delete,
-- no id / updated_at / updated_by).
revoke all on table public.store_settings from anon, authenticated;
grant select on table public.store_settings to authenticated;
grant update (
  store_name, logo_path, logo_url,
  contact_email, contact_phone,
  address_line1, address_line2, city, state_region, postal_code,
  country_code, currency_code, timezone, default_locale,
  tax_enabled, tax_rate, prices_include_tax, tax_registration_number,
  shipping_fee, free_shipping_threshold, delivery_min_days, delivery_max_days,
  min_order_amount, max_quantity_per_item, allow_customer_cancellation,
  notify_new_order, notify_low_stock, notify_order_cancelled, notification_email
) on table public.store_settings to authenticated;
grant select, update on table public.store_settings to service_role;

create policy store_settings_select_admin on public.store_settings
  for select to authenticated
  using ((select private.is_admin()));

create policy store_settings_update_admin on public.store_settings
  for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

-- ---------------------------------------------------------------------------
-- Storage: store-assets bucket (the logo)
-- ---------------------------------------------------------------------------
-- Public so the storefront can show the logo by URL. Only active admins can
-- write, and only under logo/<file name>.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'store-assets',
  'store-assets',
  true,
  5242880, -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy store_assets_select_admin on storage.objects
  for select to authenticated
  using (bucket_id = 'store-assets' and (select private.is_admin()));

create policy store_assets_insert_admin on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'store-assets'
    and name ~ '^logo/[^/]+$'
    and (select private.is_admin())
  );

create policy store_assets_delete_admin on storage.objects
  for delete to authenticated
  using (bucket_id = 'store-assets' and (select private.is_admin()));
