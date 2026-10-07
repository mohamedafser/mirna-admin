-- 002 · Enums and domains
--
-- Domains centralise the validation rules for values that appear in many tables
-- (money, currency, country) so every table enforces them identically.

create type public.user_role as enum ('ADMIN', 'CUSTOMER');

create type public.order_status as enum (
  'PENDING',
  'CONFIRMED',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
  'REFUNDED'
);

-- Non-negative monetary amount. Never FLOAT/REAL/DOUBLE.
-- Scale 3 supports 3-decimal currencies (KWD, BHD, OMR) as well as AED/USD/INR/etc.
create domain public.money_amount as numeric(14, 3)
  check (value >= 0);

-- ISO 4217 alphabetic currency code, e.g. AED, SAR, INR, USD, GBP.
create domain public.currency_code as text
  check (value ~ '^[A-Z]{3}$');

-- ISO 3166-1 alpha-2 country code, e.g. AE, SA, IN, US, GB.
create domain public.country_code as text
  check (value ~ '^[A-Z]{2}$');
