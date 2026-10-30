-- 039 · Every country the store sells in has a shipping configuration
--
-- Migration 037 seeded only the GCC, the USA and the UK. Shipping now lists
-- every country in country_currency (the "Ships to" countries on the
-- Currencies page), in that country's currency:
--
--   - countries missing today (e.g. India, Belgium, Germany) are added;
--   - a country added to country_currency later gets one automatically
--     (trigger), so Shipping always matches Currencies.
--
-- New configurations are drafts: the country disabled, Standard and Express
-- disabled with a 0 rate. Nothing is enabled here, because a 0 rate means
-- free delivery: set the rates in Admin → Shipping, then enable them.
-- Countries already configured are left exactly as they are.
--
-- add_shipping_country() (re-adding a deleted configuration) uses the same
-- draft. Requires migrations 037 and 038. Safe to re-run.

-- One draft configuration: country + Standard (3–7 days) and Express (1–3
-- days), both inactive with a flat 0 rate. No-op when the country exists.
create or replace function private.create_shipping_draft(
  p_country_code text,
  p_currency_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.shipping_countries (country_code, currency_code, is_active)
  values (p_country_code, p_currency_code, false)
  on conflict (country_code) do nothing;
  if not found then
    return;
  end if;

  with methods as (
    insert into public.shipping_methods
      (country_code, code, min_delivery_days, max_delivery_days)
    values (p_country_code, 'STANDARD', 3, 7), (p_country_code, 'EXPRESS', 1, 3)
    on conflict on constraint shipping_methods_country_code_key do nothing
    returning id
  )
  insert into public.shipping_rates (method_id, amount)
  select id, 0 from methods
  on conflict on constraint shipping_rates_tier_key do nothing;
end;
$$;

revoke all on function private.create_shipping_draft(text, text) from public, anon, authenticated;

-- Backfill: every country the store sells in.
select private.create_shipping_draft(cc.country_code, cc.currency_code)
from public.country_currency cc
order by cc.country_code;

-- Keep Shipping in step with Currencies.
create or replace function private.country_currency_add_shipping()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.create_shipping_draft(new.country_code, new.currency_code);
  return null;
end;
$$;

revoke all on function private.country_currency_add_shipping() from public, anon, authenticated;

drop trigger if exists country_currency_add_shipping on public.country_currency;
create trigger country_currency_add_shipping
  after insert on public.country_currency
  for each row execute function private.country_currency_add_shipping();

-- Same draft when an admin re-adds a deleted configuration.
create or replace function public.add_shipping_country(p_country_code text)
returns void
language plpgsql
-- Definer so it can call the private helper; is_admin() still gates it.
security definer
set search_path = ''
as $$
declare
  v_currency text;
begin
  if not private.is_admin() then
    raise exception 'only administrators can manage shipping' using errcode = '42501';
  end if;
  select cc.currency_code into v_currency
  from public.country_currency cc
  where cc.country_code = p_country_code;
  if not found then
    raise exception 'shipping:country_not_sold' using errcode = '23503';
  end if;
  if exists (select 1 from public.shipping_countries where country_code = p_country_code) then
    raise exception 'shipping:exists' using errcode = '23505';
  end if;
  perform private.create_shipping_draft(p_country_code, v_currency);
end;
$$;

revoke all on function public.add_shipping_country(text) from public, anon;
grant execute on function public.add_shipping_country(text) to authenticated;
