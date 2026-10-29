-- 035 · Every GCC currency and country
--
-- Migration 031 seeded five of the six GCC currencies (AED, SAR, KWD, QAR,
-- BHD) and their countries. This adds the sixth: the Omani rial (OMR, three
-- decimals like BHD and KWD) and Oman (OM) as a shipping country paying in it,
-- so checkout accepts Omani addresses.
--
-- OMR starts active, like the others. Products are not sold in it until they
-- have an OMR price (prices are never converted).
--
-- Data only. Safe to re-run: existing rows are left as they are.

insert into public.currencies (code, symbol, decimals, is_default) values
  ('OMR', 'RO', 3, false)
on conflict (code) do nothing;

insert into public.country_currency (country_code, currency_code) values
  ('OM', 'OMR')
on conflict (country_code) do nothing;
